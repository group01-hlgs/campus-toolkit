/**
 * 身分啟用開關：回答「四種身分現在是否開放全校登入」。
 *
 * 資料存於 `settings/system` 的 `roleEnabled` 欄位（現行狀態，不按學期分文件），
 * 因此沒有期間不一致的問題、學期轉換自動沿用；變更歷史另記錄於稽核紀錄。
 * 欄位不存在或毀損＝四種身分一律視為啟用（fail-safe，避免把所有人擋在門外）。
 */

import { ALL_ROLES, UserRole } from "@/types/users";

/** 四種身分的啟用狀態 */
export type RoleEnabledMap = Record<UserRole, boolean>;

/** `settings/system` 上存開關的欄位名 */
export const ROLE_ENABLED_FIELD = "roleEnabled";

/** 全部啟用（欄位未建立時的預設值） */
export function allRolesEnabled(): RoleEnabledMap {
  const roles = {} as RoleEnabledMap;
  for (const role of ALL_ROLES) roles[role] = true;
  return roles;
}

/**
 * 讀回啟用狀態：僅承認布林值，缺漏或型別不符一律視為啟用。
 */
export function readRoleEnabled(raw: unknown): RoleEnabledMap {
  const roles = allRolesEnabled();
  if (!raw || typeof raw !== "object") return roles;
  const data = raw as Record<string, unknown>;
  for (const role of ALL_ROLES) {
    if (typeof data[role] === "boolean") roles[role] = data[role] as boolean;
  }
  return roles;
}
