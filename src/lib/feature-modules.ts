import "server-only";
import { readSystemDoc, invalidateSettingsCache } from "@/lib/settings-server";
import {
  FEATURE_MODULES_FIELD,
  FEATURE_MODULE_ROLES_FIELD,
  FeatureModuleRolesMap,
  FeatureModulesEnabledMap,
  readFeatureModuleRoles,
  readFeatureModulesEnabled,
} from "@/types/feature-modules";

/**
 * 功能模組設定寫入後呼叫，讓快取立即失效（新請求立即套用）。
 * 功能模組設定存於 `settings/system`，與全站設定共用同一份快取，故直接走統一失效。
 */
export function invalidateFeatureModulesCache(): void {
  invalidateSettingsCache();
}

/** 從共用的 settings/system 快取解析出啟用狀態與身分開關 */
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
 * 讀取每個功能模組對四種身分的啟用狀態（settings/system 的 featureModuleRoles 欄位）。
 * 欄位不存在＝全部啟用；讀失敗時回退快取值或全部啟用。
 */
export async function getFeatureModuleRoles(): Promise<FeatureModuleRolesMap> {
  return (await loadFeatureModuleSettings()).roles;
}
