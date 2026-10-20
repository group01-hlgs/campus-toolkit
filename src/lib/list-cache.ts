import "server-only";
import { cachedRead, invalidateReadCache } from "@/lib/read-cache";
import { bumpCacheEpoch, getCacheEpoch, getCacheTtlSeconds } from "@/lib/settings-server";

/**
 * 管理端大清單的快取（docs/資料庫讀取規範.md 鐵律 6）：
 *
 * - **失效靠 epoch（跨實例）**：key 綁定 `settings/system.cacheEpoch`，
 *   任何管理端資料變更呼叫 `invalidateAdminListCache()` 遞增該旗標，
 *   所有實例（含 serverless 冷啟動）的下一次讀取自動改 key＝自動失效，
 *   延遲上限＝設定快取 TTL（30 秒）。
 * - **TTL 由系統設定統一控管**：預設 TTL 讀 `settings.cacheTtlSeconds`
 *   （系統設定→省錢專區，30–300 秒）。管理端寫入由 epoch 立即失效；
 *   非管理端寫入（學生報名等）不 bump epoch，此 TTL 即為跨實例新鮮度上限。
 * - 讀 epoch 走 readSystemDoc 共用快取，驗證路徑已讀過時為 0 次額外讀取。
 */

/**
 * 以 epoch 綁定 key 的清單快取。
 * epoch 變動 → key 變動 → 舊 payload 自動作廢（跨實例生效）。
 * `ttlMs` 省略時採系統設定的清單快取壽命（cacheTtlSeconds）。
 * 回傳值連同「用於 key 的那個 epoch」一起交給呼叫端：
 * 快取 key 與回應的 cacheEpoch 必須同源，否則並發寫入時可能把
 * 舊 payload 誤掛在新 epoch 上（內容過期卻永遠命中）。
 */
export async function cachedListRead<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs?: number
): Promise<{ data: T; epoch: number }> {
  const epoch = await getCacheEpoch();
  const effectiveTtl = ttlMs ?? (await getCacheTtlSeconds()) * 1000;
  const data = await cachedRead(`${key}#${epoch}`, effectiveTtl, load);
  return { data, epoch };
}

/**
 * 管理端資料變更（增修刪）成功後呼叫：本程序立即清空讀取快取，
 * 並遞增跨實例的 cacheEpoch 讓其他實例的清單快取失效。
 * 榜單等非管理端寫入維持 `invalidateReadCache()`，不 bump（避免高頻寫入打爆清單快取）。
 */
export async function invalidateAdminListCache(): Promise<void> {
  invalidateReadCache();
  try {
    await bumpCacheEpoch();
  } catch (error) {
    // 旗標寫入失敗不阻斷變更流程：本程序仍已清空，其他實例退回 TTL 硬上限
    console.error("Cache epoch bump error:", error);
  }
}
