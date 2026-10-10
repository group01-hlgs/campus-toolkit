import "server-only";
import { readSystemDoc, invalidateSettingsCache } from "@/lib/settings-server";
import {
  FEATURE_MODULES_FIELD,
  FEATURE_MODULE_ROLES_FIELD,
  FeatureModuleRolesMap,
  FeatureModulesEnabledMap,
  readFeatureModuleRoles,
  readFeatureModulesEnabled,
  visibleFeatureModuleValues,
} from "@/types/feature-modules";
import type { UserRole } from "@/types/users";

/**
 * 功能模組設定寫入後呼叫，讓快取立即失效（新請求立即套用）。
 * 功能模組設定存於 `settings/system`，與全站設定共用同一份快取，故直接走統一失效。
 */
export function invalidateFeatureModulesCache(): void {
  invalidateSettingsCache();
}

/** 從共用的 settings/system 快取解析出啟用狀態與顯示開關 */
async function loadFeatureModuleSettings(): Promise<{
  enabled: FeatureModulesEnabledMap;
  roles: FeatureModuleRolesMap;
}> {
  const raw = await readSystemDoc();
  return {
    enabled: readFeatureModulesEnabled(raw?.[FEATURE_MODULES_FIELD]),
    roles: readFeatureModuleRoles(raw?.[FEATURE_MODULE_ROLES_FIELD]),
  };
}

/**
 * 讀取選用功能模組的現行啟用狀態（settings/system 的 featureModulesEnabled 欄位）。
 * 欄位不存在＝全部未啟用；讀失敗時回退快取值或全部未啟用。
 */
export async function getFeatureModulesEnabled(): Promise<FeatureModulesEnabledMap> {
  return (await loadFeatureModuleSettings()).enabled;
}

/**
 * 讀取每個功能模組對四種身分的顯示開關（settings/system 的 featureModuleRoles 欄位）。
 * 已依註冊表「提供功能」裁剪：provides＝false 的身分一律回 false。
 * 欄位不存在＝有提供者皆顯示；讀失敗時回退快取值或同上。
 */
export async function getFeatureModuleRoles(): Promise<FeatureModuleRolesMap> {
  return (await loadFeatureModuleSettings()).roles;
}

/**
 * 某身分可見的功能模組代碼清單（供首頁卡片過濾）。
 * 超級管理員完全不受限制時，請由呼叫端直接回註冊表全部代碼
 * （見 api/settings 的 GET）；本函式處理一般身分的 provides＋顯示開關＋
 * **選用模組總開關**（停用即對該身分隱藏入口卡，fail-safe【0.393】）。
 */
export async function getVisibleFeatureModuleValues(
  role: UserRole,
  options?: { isSuper?: boolean }
): Promise<string[]> {
  const { roles, enabled } = await loadFeatureModuleSettings();
  return visibleFeatureModuleValues(role, roles, { ...options, enabled });
}
