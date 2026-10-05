import "server-only";
import { readSystemDoc, invalidateSettingsCache } from "@/lib/settings-server";
import { UserRole } from "@/types/users";
import {
  readRoleEnabled,
  RoleEnabledMap,
  ROLE_ENABLED_FIELD,
} from "@/types/role-settings";

/**
 * 身分開關寫入後呼叫，讓快取立即失效（新登入立即套用）。
 * 身分開關存於 `settings/system`，與全站設定共用同一份快取，故直接走統一失效。
 */
export function invalidateRoleSettingsCache(): void {
  invalidateSettingsCache();
}

/**
 * 讀取四種身分的現行啟用狀態（settings/system 的 roleEnabled 欄位）。
 * 讀全站共用的 settings/system 快取（見 settings-server.readSystemDoc）；
 * 欄位不存在＝四身分全啟用，讀失敗時回退上次快取值或全部啟用。
 */
export async function getRoleEnabled(): Promise<RoleEnabledMap> {
  const raw = await readSystemDoc();
  return readRoleEnabled(raw?.[ROLE_ENABLED_FIELD]);
}

/** 該身分是否啟用（停用＝全校不可以此身分登入／切換） */
export async function isRoleEnabled(role: UserRole): Promise<boolean> {
  const roles = await getRoleEnabled();
  return roles[role];
}
