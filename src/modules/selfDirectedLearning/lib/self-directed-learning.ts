import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { cachedRead, invalidateReadCache } from "@/lib/read-cache";
import { getCacheTtlSeconds } from "@/lib/settings-server";
import {
  DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS,
  SELF_DIRECTED_LEARNING_SETTINGS_COLLECTION,
  SELF_DIRECTED_LEARNING_SETTINGS_DOC_ID,
  normalizeSettings,
  type SelfDirectedLearningSettings,
} from "../types/self-directed-learning";

const SETTINGS_CACHE_KEY = "selfDirectedLearning:settings";

async function settingsTtlMs(): Promise<number> {
  return (await getCacheTtlSeconds()) * 1000;
}

function settingsRef() {
  return getAdminDb()
    .collection(SELF_DIRECTED_LEARNING_SETTINGS_COLLECTION)
    .doc(SELF_DIRECTED_LEARNING_SETTINGS_DOC_ID);
}

/** 讀設定（缺檔即建預設值：lazy init） */
export async function getSettings(): Promise<SelfDirectedLearningSettings> {
  return cachedRead(SETTINGS_CACHE_KEY, await settingsTtlMs(), async () => {
    const snap = await settingsRef().get();
    if (!snap.exists) {
      const initial = { ...DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS, updatedAt: Date.now() };
      await settingsRef().set(initial);
      return initial;
    }
    return normalizeSettings(snap.data());
  });
}

/** 存設定（合併寫入＋失效快取） */
export async function saveSettings(
  value: SelfDirectedLearningSettings
): Promise<SelfDirectedLearningSettings> {
  const next: SelfDirectedLearningSettings = { ...value, updatedAt: Date.now() };
  await settingsRef().set(next, { merge: true });
  invalidateReadCache(SETTINGS_CACHE_KEY);
  return next;
}
