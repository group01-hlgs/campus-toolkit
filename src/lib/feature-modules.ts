import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { SETTINGS_COLLECTION, SETTINGS_DOC_ID } from "@/lib/settings-server";
import {
  FEATURE_MODULES_FIELD,
  FeatureModulesEnabledMap,
  readFeatureModulesEnabled,
} from "@/types/feature-modules";

const CACHE_TTL_MS = 30_000;

/** 選用功能模組啟用狀態的 30 秒 in-process 快取（與 settings／身分開關同一套策略） */
let cache: { enabled: FeatureModulesEnabledMap; at: number } | null = null;

/** 功能模組啟用狀態寫入後呼叫，讓快取立即失效（新請求立即套用） */
export function invalidateFeatureModulesCache(): void {
  cache = null;
}

/**
 * 讀取選用功能模組的現行啟用狀態（settings/system 的 featureModulesEnabled 欄位）。
 * 欄位不存在＝全部未啟用；讀失敗時回退快取值或全部未啟用。
 */
export async function getFeatureModulesEnabled(): Promise<FeatureModulesEnabledMap> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.enabled;

  try {
    const snap = await getAdminDb()
      .collection(SETTINGS_COLLECTION)
      .doc(SETTINGS_DOC_ID)
      .get();
    const raw = snap.exists
      ? (snap.data() as Record<string, unknown> | undefined)?.[FEATURE_MODULES_FIELD]
      : undefined;
    const enabled = readFeatureModulesEnabled(raw);
    cache = { enabled, at: now };
    return enabled;
  } catch (error) {
    console.error("Feature modules settings read error:", error);
    if (cache) return cache.enabled;
    return readFeatureModulesEnabled(undefined);
  }
}
