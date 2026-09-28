import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { SchoolPeriod } from "@/types/settings";
import { UserRole } from "@/types/users";
import {
  allRolesEnabled,
  readRoleEnabled,
  ROLE_SETTINGS_COLLECTION,
  RoleEnabledMap,
  roleSettingsId,
} from "@/types/role-settings";

const CACHE_TTL_MS = 30_000;

/** 以學年度學期為鍵的 30 秒 in-process 快取（與 settings 共用同一套策略） */
let cache: { key: string; roles: RoleEnabledMap; at: number } | null = null;

/** 身分設定寫入後呼叫，讓快取立即失效（新登入立即套用） */
export function invalidateRoleSettingsCache(): void {
  cache = null;
}

/**
 * 讀取該學期四種身分的啟用狀態。
 * 文件不存在＝該期資料未建立，回傳全部啟用；讀失敗時回退快取值或全部啟用。
 */
export async function getRoleSettings(period: SchoolPeriod): Promise<RoleEnabledMap> {
  const key = roleSettingsId(period);
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < CACHE_TTL_MS) return cache.roles;

  try {
    const snap = await getAdminDb()
      .collection(ROLE_SETTINGS_COLLECTION)
      .doc(key)
      .get();
    const roles = snap.exists ? readRoleEnabled(snap.data()) : allRolesEnabled();
    cache = { key, roles, at: now };
    return roles;
  } catch (error) {
    console.error("Role settings read error:", error);
    if (cache && cache.key === key) return cache.roles;
    return allRolesEnabled();
  }
}

/** 該學期該身分是否啟用（停用＝該期不可登入／切換此身分） */
export async function isRoleEnabled(role: UserRole, period: SchoolPeriod): Promise<boolean> {
  const roles = await getRoleSettings(period);
  return roles[role];
}
