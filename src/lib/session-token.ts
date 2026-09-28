import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { UserRole, TwoFactorMethod, isUserRole, isTwoFactorMethod } from "@/types/users";

// __Host- 前綴強制 Secure／Path=/／無 Domain，防止子域覆寫 session cookie（需 HTTPS）；
// 本機開發走 http（含 LAN IP）無法設定 Secure cookie，故維持原名稱。
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-session" : "session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
/** 絕對上限：無論 keepalive 如何續期，超過此時間必須重新登入（防被竊 cookie 無限續命） */
export const SESSION_ABSOLUTE_MAX_AGE_SECONDS = 12 * 60 * 60;

/** 兩階段驗證中途憑證 cookie：密碼驗證通過、第二階段尚未完成時使用 */
export const PENDING_2FA_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-pending2fa" : "pending2fa";
/** 第二階段驗證時限：逾時必須重新輸入帳密 */
export const PENDING_2FA_MAX_AGE_SECONDS = 10 * 60;

/** 選擇身分中途憑證 cookie：登入（含兩階段驗證）完成、尚未選擇要進入的身分時使用 */
export const PENDING_ROLE_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-pendingRole" : "pendingRole";
/** 選擇身分時限：逾時必須重新登入 */
export const PENDING_ROLE_MAX_AGE_SECONDS = 10 * 60;

/** 多身分候選：身分＋該身分的使用者帳號文件 id（登入時一併帶入 session，供切換身分使用） */
export interface RoleCandidate {
  role: UserRole;
  id: string;
}

/** 驗證並整理候選清單：非法項目剔除、同身分去重、上限四筆 */
function readCandidates(value: unknown, fallback: RoleCandidate[]): RoleCandidate[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<UserRole>();
  const list: RoleCandidate[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const id = (item as { id?: unknown }).id;
    if (!isUserRole(role) || typeof id !== "string" || !id) continue;
    if (seen.has(role)) continue;
    seen.add(role);
    list.push({ role, id });
  }
  return list.length > 0 ? list.slice(0, 4) : fallback;
}

export interface SessionPayload {
  uid: string;
  email: string;
  account: string;
  displayName: string;
  role: UserRole;
  /** 本次登入可進入的身分（多身分共用帳號時用於選擇與切換） */
  candidates?: RoleCandidate[];
  tokenVersion: number;
  jti: string;
  /** 最後一次使用者活動（epoch ms），用於伺服器端閒置逾時檢查 */
  lastActivityAt: number;
  /** 絕對過期時間（epoch ms），續期時保留原值、不重設 */
  absoluteExpiresAt: number;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET 未設定或長度不足 32 字元");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    uid: payload.uid,
    email: payload.email,
    account: payload.account,
    displayName: payload.displayName,
    role: payload.role,
    candidates: readCandidates(payload.candidates, [{ role: payload.role, id: payload.uid }]),
    tokenVersion: payload.tokenVersion,
    lastActivityAt: payload.lastActivityAt,
    absoluteExpiresAt: payload.absoluteExpiresAt,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .setJti(payload.jti || crypto.randomUUID())
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });

    if (!payload || !isUserRole(payload.role) || typeof payload.uid !== "string" || !payload.uid) {
      return null;
    }

    // 有 purpose 的是其他用途的 token（如兩階段驗證中途憑證），不可當 session 使用
    if (typeof payload.purpose === "string" && payload.purpose) return null;

    if (
      typeof payload.iat === "number" &&
      Date.now() / 1000 - payload.iat > SESSION_MAX_AGE_SECONDS
    ) {
      return null;
    }

    const iatMs = typeof payload.iat === "number" ? payload.iat * 1000 : Date.now();

    // 絕對過期：續期只更新 lastActivityAt，不重設此值；
    // 舊 token 無此 claim 時以 iat + 絕對上限推導，保持同等約束。
    const absoluteExpiresAt =
      typeof payload.absoluteExpiresAt === "number" && payload.absoluteExpiresAt > 0
        ? payload.absoluteExpiresAt
        : iatMs + SESSION_ABSOLUTE_MAX_AGE_SECONDS * 1000;
    if (Date.now() >= absoluteExpiresAt) return null;

    return {
      uid: payload.uid,
      email: typeof payload.email === "string" ? payload.email : "",
      account: typeof payload.account === "string" ? payload.account : "",
      displayName: typeof payload.displayName === "string" ? payload.displayName : "",
      role: payload.role,
      candidates: readCandidates(payload.candidates, [{ role: payload.role, id: payload.uid }]),
      tokenVersion: typeof payload.tokenVersion === "number" ? payload.tokenVersion : 1,
      jti: typeof payload.jti === "string" ? payload.jti : "",
      lastActivityAt:
        typeof payload.lastActivityAt === "number" && payload.lastActivityAt > 0
          ? payload.lastActivityAt
          : iatMs,
      absoluteExpiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * 兩階段驗證中途憑證：帳密已驗證通過、第二階段尚未完成。
 * 與 session 共用金鑰但帶 purpose claim，兩者不可互換（見 verifySessionToken）。
 */
export interface Pending2FAInput {
  uid: string;
  email: string;
  account: string;
  displayName: string;
  role: UserRole;
  /** 本次登入的多身分候選：第二階段完成後用來決定要進入的身分 */
  candidates?: RoleCandidate[];
  /** 登入時已判定的慣用身分（候選唯一命中時才存在；候選文件不在手邊，故先算好帶入） */
  preferred?: UserRole | null;
  /** 需要完成的第二階段方式 */
  method: Exclude<TwoFactorMethod, "off" | "email_notify">;
  /** 是從密碼登入還是 Google 登入進入第二階段（用來記 lastLoginMethod） */
  via: "password" | "google";
}

export interface Pending2FAPayload extends Pending2FAInput {
  /** 中途憑證過期時間（epoch ms） */
  expiresAt: number;
}

export async function signPending2FAToken(payload: Pending2FAInput): Promise<string> {
  return new SignJWT({
    purpose: "2fa",
    uid: payload.uid,
    email: payload.email,
    account: payload.account,
    displayName: payload.displayName,
    role: payload.role,
    candidates: readCandidates(payload.candidates, [{ role: payload.role, id: payload.uid }]),
    preferred: payload.preferred,
    method: payload.method,
    via: payload.via,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_2FA_MAX_AGE_SECONDS}s`)
    .setJti(crypto.randomUUID())
    .sign(getSecretKey());
}

export async function verifyPending2FAToken(token: string): Promise<Pending2FAPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });
    if (!payload || payload.purpose !== "2fa") return null;
    if (!isUserRole(payload.role) || typeof payload.uid !== "string" || !payload.uid) return null;
    if (payload.method !== "email_otp" && payload.method !== "totp") return null;
    // exp 已由 jose 驗證；再以 iat 對照上限，防止時鐘偏移放行過舊 token
    if (
      typeof payload.iat === "number" &&
      Date.now() / 1000 - payload.iat > PENDING_2FA_MAX_AGE_SECONDS
    ) {
      return null;
    }

    return {
      uid: payload.uid,
      email: typeof payload.email === "string" ? payload.email : "",
      account: typeof payload.account === "string" ? payload.account : "",
      displayName: typeof payload.displayName === "string" ? payload.displayName : "",
      role: payload.role,
      candidates: readCandidates(payload.candidates, [{ role: payload.role, id: payload.uid }]),
      preferred: isUserRole(payload.preferred) ? payload.preferred : null,
      method: payload.method === "email_otp" ? payload.method : "totp",
      via: payload.via === "google" ? "google" : "password",
      expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : 0,
    };
  } catch {
    return null;
  }
}

/**
 * 選擇身分中途憑證：登入（含兩階段驗證）已驗證通過、尚未決定要進入的身分。
 * 與 session 共用金鑰但帶 purpose claim，兩者不可互換（見 verifySessionToken）。
 */
export interface PendingRoleInput {
  /** 登入用的電子郵件／帳號：選擇時用來確認候選文件仍是同一組帳號 */
  email: string;
  account: string;
  /** 顯示用稱謂（取自通過驗證的帳號文件） */
  displayName: string;
  /** 寫入 lastLoginMethod 的來源（password／google，兩階段驗證以 +方式 併接） */
  via: string;
  /** 可選擇的身分候選 */
  candidates: RoleCandidate[];
}

export interface PendingRolePayload extends PendingRoleInput {
  /** 中途憑證過期時間（epoch ms） */
  expiresAt: number;
}

export async function signPendingRoleToken(payload: PendingRoleInput): Promise<string> {
  return new SignJWT({
    purpose: "role",
    email: payload.email,
    account: payload.account,
    displayName: payload.displayName,
    via: payload.via,
    candidates: readCandidates(payload.candidates, []),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_ROLE_MAX_AGE_SECONDS}s`)
    .setJti(crypto.randomUUID())
    .sign(getSecretKey());
}

export async function verifyPendingRoleToken(token: string): Promise<PendingRolePayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });
    if (!payload || payload.purpose !== "role") return null;
    const candidates = readCandidates(payload.candidates, []);
    if (candidates.length === 0) return null;
    if (
      typeof payload.iat === "number" &&
      Date.now() / 1000 - payload.iat > PENDING_ROLE_MAX_AGE_SECONDS
    ) {
      return null;
    }

    return {
      email: typeof payload.email === "string" ? payload.email : "",
      account: typeof payload.account === "string" ? payload.account : "",
      displayName: typeof payload.displayName === "string" ? payload.displayName : "",
      via: typeof payload.via === "string" && payload.via ? payload.via : "password",
      candidates,
      expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : 0,
    };
  } catch {
    return null;
  }
}

