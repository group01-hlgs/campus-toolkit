import { UserRole, ROLE_HOME, isUserRole } from "@/types/users";
import { ensureSignedOut } from "@/lib/firebase";

export interface UserSession {
  uid: string;
  email: string;
  account: string;
  displayName: string;
  role: UserRole;
  /** 本次登入可用的身分（多身分切換選單用；單一時僅含目前身分） */
  roles?: UserRole[];
  /** 管理員被指派的功能模組（首頁卡片顯示用；超級管理員＝全部） */
  adminModules?: string[];
}

let cached: UserSession | null = null;
let checked = false;
let inFlight: Promise<UserSession | null> | null = null;

function toUserSession(user: unknown): UserSession | null {
  if (!user || typeof user !== "object") return null;
  const u = user as Record<string, unknown>;
  if (!isUserRole(u.role) || typeof u.uid !== "string" || !u.uid) return null;
  const roles = Array.isArray(u.roles)
    ? u.roles.filter(isUserRole).slice(0, 4)
    : [];
  return {
    uid: u.uid,
    email: typeof u.email === "string" ? u.email : "",
    account: typeof u.account === "string" ? u.account : "",
    displayName: typeof u.displayName === "string" ? u.displayName : "",
    role: u.role,
    roles: roles.length > 0 ? roles : [u.role],
    adminModules: Array.isArray(u.adminModules)
      ? u.adminModules.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

export function getCachedSession(): UserSession | null {
  return cached;
}

export async function fetchSession(force = false): Promise<UserSession | null> {
  if (!force && checked && !inFlight) return cached;
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        cached = toUserSession(data.user);
      } else {
        cached = null;
      }
    } catch {
      cached = null;
    } finally {
      checked = true;
      inFlight = null;
    }
    return cached;
  })();

  return inFlight;
}

export function setCachedSession(user: UserSession): void {
  cached = user;
  checked = true;
}

export function clearSession(): void {
  cached = null;
  checked = true;
}

export async function logout(): Promise<void> {
  clearSession();
  await ensureSignedOut();
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // cookie 可能已過期，忽略網路錯誤
  }
}

export function getHomePath(role: UserRole): string {
  return ROLE_HOME[role];
}
