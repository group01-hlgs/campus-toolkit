import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { SETTINGS_COLLECTION, SETTINGS_DOC_ID } from "@/lib/settings-server";
import { UserRole } from "@/types/users";
import {
  allRolesEnabled,
  readRoleEnabled,
  RoleEnabledMap,
  ROLE_ENABLED_FIELD,
} from "@/types/role-settings";

const CACHE_TTL_MS = 30_000;

/** 現行身分開關的 30 秒 in-process 快取（與 settings 共用同一套策略） */
let cache: { roles: RoleEnabledMap; at: number } | null = null;

/** 身分開關寫入後呼叫，讓快取立即失效（新登入立即套用） */
export function invalidateRoleSettingsCache(): void {
  cache = null;
}

/**
 * 讀取四種身分的現行啟用狀態（settings/system 的 roleEnabled 欄位）。
 * 欄位不存在＝四身分全啟用；讀失敗時回退快取值或全部啟用。
 */
export async function getRoleEnabled(): Promise<RoleEnabledMap> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.roles;

  try {
    const snap = await getAdminDb()
      .collection(SETTINGS_COLLECTION)
      .doc(SETTINGS_DOC_ID)
      .get();
    const raw = snap.exists
      ? (snap.data() as Record<string, unknown> | undefined)?.[ROLE_ENABLED_FIELD]
      : undefined;
    const roles = readRoleEnabled(raw);
    cache = { roles, at: now };
    return roles;
  } catch (error) {
    console.error("Role enabled settings read error:", error);
    if (cache) return cache.roles;
    return allRolesEnabled();
  }
}

/** 該身分是否啟用（停用＝全校不可以此身分登入／切換） */
export async function isRoleEnabled(role: UserRole): Promise<boolean> {
  const roles = await getRoleEnabled();
  return roles[role];
}
