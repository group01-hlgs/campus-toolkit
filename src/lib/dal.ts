import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { getSession, SessionPayload } from "@/lib/server-session";
import { isJtiRevoked } from "@/lib/revocation";
import { getClientIp } from "@/lib/audit";
import { getSessionTimeoutMinutes, getCurrentPeriod, isSystemEnabled } from "@/lib/settings-server";
import { adminAttributeGuard, adminModulesOf, getRosterEntry, isActiveEntry } from "@/lib/roster";
import { isRoleEnabled } from "@/lib/role-settings";
import { AdminModule, isAccountActive, USER_COLLECTION, UserRole } from "@/types/users";

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
      .collection(USER_COLLECTION)
      .doc(session.uid)
      .get();
    if (!snap.exists) return null;

    const data = snap.data();
    // 停用（無效）帳號的既有 session 全數失效
    if (!isAccountActive(data)) return null;

    const tokenVersion = typeof data?.tokenVersion === "number" ? data.tokenVersion : 1;
    if (session.tokenVersion !== tokenVersion) return null;

    // 當期身分名冊：該身分不存在、無效或已被移除時，session 失效
    const period = await getCurrentPeriod();
    const entry = await getRosterEntry(session.uid, session.role, period);
    if (!isActiveEntry(entry)) return null;

    // 身分開關停用該身分時，既有 session 同步失效
    if (!(await isRoleEnabled(session.role))) return null;

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

/**
 * 管理功能模組權限：超級管理員全開；一般管理員須被指派該模組。
 * 模組指派存於「當期管理員身分名冊」（attribute、modules）。
 */
export async function hasAdminModule(
  session: SessionPayload,
  module: AdminModule
): Promise<boolean> {
  if (session.role !== "admin") return false;
  try {
    const entry = await getRosterEntry(session.uid, "admin", await getCurrentPeriod());
    return adminModulesOf(entry).includes(module);
  } catch {
    // fail-closed：讀不到權限資訊一律視為無權限
    return false;
  }
}

export async function requireAdminModule(module: AdminModule): Promise<
  { session: SessionPayload; denial: null } | { session: null; denial: AuthDenial }
> {
  const result = await requireRole("admin");
  if (result.denial) return result;
  if (!(await hasAdminModule(result.session, module))) {
    return { session: null, denial: { status: 403, message: "此帳號未被指派該功能模組" } };
  }
  return result;
}

/**
 * 超級管理員判定：當期管理員名冊條目 `attribute === "超級"`。
 * 屬性指派、新增管理員、系統設定等高風險操作都以本函式把關。
 */
export async function isSuperAdmin(session: SessionPayload): Promise<boolean> {
  if (session.role !== "admin") return false;
  try {
    const entry = await getRosterEntry(session.uid, "admin", await getCurrentPeriod());
    const attribute = entry && typeof entry.attribute === "string" ? entry.attribute : "";
    return attribute === "超級";
  } catch {
    // fail-closed：讀不到屬性一律視為非超級
    return false;
  }
}

/** 僅超級管理員可執行的操作（升級超級、新增管理員等） */
export async function requireSuperAdmin(
  message = "僅超級管理員可執行此操作"
): Promise<
  { session: SessionPayload; denial: null } | { session: null; denial: AuthDenial }
> {
  const result = await requireRole("admin");
  if (result.denial) return result;
  if (!(await isSuperAdmin(result.session))) {
    return { session: null, denial: { status: 403, message } };
  }
  return result;
}

/**
 * 「系統設定」的可設定判定：**僅超級管理員**。
 * 「系統設定」是每位管理員的基本入口（首頁固定顯示），但實際可讀寫的設定項目僅超級可用；
 * 一般管理員與其他身分只有入口、頁內顯示「尚無可用設定項目」。
 */
export async function hasSettingsManage(session: SessionPayload): Promise<boolean> {
  return isSuperAdmin(session);
}

/**
 * 管理員名冊的屬性寫入守門（建立／修改／停用／刪除管理員條目都應先過這關）：
 * 非超級管理員不得指定「超級」屬性，也不得變更既有的超級條目。
 * 通過回 null；否則回 403 denial（呼叫端以 `toAuthResponse` 回覆）。
 */
export async function checkAdminAttribute(
  session: SessionPayload,
  nextAttribute: string | null,
  currentAttribute: string | null
): Promise<AuthDenial | null> {
  const message = adminAttributeGuard({
    isSuper: await isSuperAdmin(session),
    nextAttribute,
    currentAttribute,
  });
  return message ? { status: 403, message } : null;
}

export async function requireSettingsManage(): Promise<
  { session: SessionPayload; denial: null } | { session: null; denial: AuthDenial }
> {
  const result = await requireRole("admin");
  if (result.denial) return result;
  if (!(await hasSettingsManage(result.session))) {
    return { session: null, denial: { status: 403, message: "僅超級管理員可修改系統設定" } };
  }
  return result;
}
