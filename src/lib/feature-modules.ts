import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { SETTINGS_COLLECTION, SETTINGS_DOC_ID } from "@/lib/settings-server";
import {
  FEATURE_MODULES_FIELD,
  FEATURE_MODULE_ROLES_FIELD,
  FeatureModuleRolesMap,
  FeatureModulesEnabledMap,
  readFeatureModuleRoles,
  readFeatureModulesEnabled,
} from "@/types/feature-modules";

const CACHE_TTL_MS = 30_000;

/** 功能模組啟用狀態與「模組 × 身分」開關共用的 30 秒 in-process 快取（與 settings／身分開關同一套策略） */
let cache: {
  enabled: FeatureModulesEnabledMap;
  roles: FeatureModuleRolesMap;
  at: number;
} | null = null;

/** 功能模組設定寫入後呼叫，讓快取立即失效（新請求立即套用） */
export function invalidateFeatureModulesCache(): void {
  cache = null;
}

/** 讀一次 settings/system 文件，解析出啟用狀態與身分開關（快取有效時直接回快取） */
async function loadFeatureModuleSettings(): Promise<{
  enabled: FeatureModulesEnabledMap;
  roles: FeatureModuleRolesMap;
}> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache;

  try {
    const snap = await getAdminDb()
      .collection(SETTINGS_COLLECTION)
      .doc(SETTINGS_DOC_ID)
      .get();
    const doc = snap.exists ? (snap.data() as Record<string, unknown> | undefined) : undefined;
    const loaded = {
      enabled: readFeatureModulesEnabled(doc?.[FEATURE_MODULES_FIELD]),
      roles: readFeatureModuleRoles(doc?.[FEATURE_MODULE_ROLES_FIELD]),
    };
    cache = { ...loaded, at: now };
    return loaded;
  } catch (error) {
    console.error("Feature modules settings read error:", error);
    if (cache) return cache;
    // 讀失敗回退預設：選用模組全部未啟用、身分開關全部啟用
    return {
      enabled: readFeatureModulesEnabled(undefined),
      roles: readFeatureModuleRoles(undefined),
    };
  }
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
