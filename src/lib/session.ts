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
  /** 管理員可用的功能模組（管理員恆全權＝全部；首頁卡片顯示用） */
  adminModules?: string[];
  /** 非管理員身分被指定管理的模組（導覽入口顯示用；政策修改書 G3） */
  delegatedModules?: Array<{ module: string; permissions: string[] }>;
  /** 首次登入須先修改密碼（管理員代設的預設密碼）：全螢幕強制改密碼遮罩用 */
  mustChangePassword?: boolean;
}

let cached: UserSession | null = null;
let checked = false;
let inFlight: Promise<UserSession | null> | null = null;

/** session 快取的訂閱者（強制改密碼遮罩等元件用來即時反應登入／改密後的旗標） */
type SessionListener = () => void;
const listeners = new Set<SessionListener>();

export function subscribeSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifySession(): void {
  for (const listener of listeners) listener();
}

function toUserSession(user: unknown): UserSession | null {
  if (!user || typeof user !== "object") return null;
  const u = user as Record<string, unknown>;
  if (!isUserRole(u.role) || typeof u.uid !== "string" || !u.uid) return null;
  const roles = Array.isArray(u.roles)
    ? u.roles.filter(isUserRole).slice(0, 4)
    : [];
  const delegated = Array.isArray(u.delegatedModules)
    ? u.delegatedModules
        .filter(
          (item): item is { module: string; permissions: string[] } =>
            !!item &&
            typeof item === "object" &&
            typeof (item as { module?: unknown }).module === "string" &&
            Array.isArray((item as { permissions?: unknown }).permissions)
        )
        .map((item) => ({
          module: item.module,
          permissions: item.permissions.filter(
            (perm): perm is string => typeof perm === "string"
          ),
        }))
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
    delegatedModules: delegated.length > 0 ? delegated : undefined,
    mustChangePassword: u.mustChangePassword === true,
  };
}

export function getCachedSession(): UserSession | null {
  return cached;
}

export async function fetchSession(force = false): Promise<UserSession | null> {
  // 進行中的請求一律併入（force 也共用）：避免同畫面多處呼叫時重複打 /api/auth/me
  if (inFlight) return inFlight;
  if (!force && checked) return cached;

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
      notifySession();
    }
    return cached;
  })();

  return inFlight;
}

export function setCachedSession(user: UserSession): void {
  cached = user;
  checked = true;
  notifySession();
}

export function clearSession(): void {
  cached = null;
  checked = true;
  notifySession();
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
