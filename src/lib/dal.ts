import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSession, SessionPayload } from "@/lib/server-session";
import { isJtiRevoked } from "@/lib/revocation";
import { getClientIp } from "@/lib/audit";
import { getSessionTimeoutMinutes, isSystemEnabled } from "@/lib/settings-server";
import { ROLE_COLLECTIONS, isAccountActive, UserRole } from "@/types/users";

export async function verifySession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;

  // fail-closed：缺 jti 的 token 無法查詢撤銷狀態，直接拒絕
  if (!session.jti) return null;
  if (await isJtiRevoked(session.jti)) return null;

  // 系統停用（維護模式）時僅保留管理員 session，以便管理員重新啟用
  if (session.role !== "admin" && !(await isSystemEnabled())) return null;

  // 伺服器端閒置逾時：以 JWT lastActivityAt 對照 settings.sessionTimeout
  const idleTimeoutMs = (await getSessionTimeoutMinutes()) * 60 * 1000;
  if (Date.now() - session.lastActivityAt > idleTimeoutMs) return null;

  try {
    const snap = await getAdminDb()
      .collection(ROLE_COLLECTIONS[session.role])
      .doc(session.uid)
      .get();
    if (!snap.exists) return null;

    const data = snap.data();
    // 停用（無效／停權）帳號的既有 session 全數失效
    if (!isAccountActive(data)) return null;

    const tokenVersion = typeof data?.tokenVersion === "number" ? data.tokenVersion : 1;
    if (session.tokenVersion !== tokenVersion) return null;

    // 鎖定與登入路由一致：僅當鎖定綁定的來源 IP（或未綁定）命中目前請求才失效
    const lockedUntil = typeof data?.lockedUntil === "number" ? data.lockedUntil : 0;
    if (lockedUntil > Date.now()) {
      const lockIp = typeof data?.lockIp === "string" ? data.lockIp : "";
      const currentIp = getClientIp({ headers: await headers() });
      if (!lockIp || !currentIp || lockIp === currentIp) return null;
    }

    return session;
  } catch {
    return null;
  }
}

export async function verifyRole(role: UserRole): Promise<SessionPayload | null> {
  const session = await verifySession();
  if (!session || session.role !== role) return null;
  return session;
}

export type AuthDenial =
  | { status: 401; message: string }
  | { status: 403; message: string };

export function toAuthResponse(denial: AuthDenial): NextResponse {
  return NextResponse.json(
    { success: false, message: denial.message },
    { status: denial.status }
  );
}

export async function requireRole(role: UserRole): Promise<
  { session: SessionPayload; denial: null } | { session: null; denial: AuthDenial }
> {
  const session = await verifySession();
  if (!session) {
    return { session: null, denial: { status: 401, message: "未登入或登入已失效" } };
  }
  if (session.role !== role) {
    return { session: null, denial: { status: 403, message: "權限不足" } };
  }
  return { session, denial: null };
}
