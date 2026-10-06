import "server-only";
import { cachedRead, invalidateReadCache } from "@/lib/read-cache";
import { bumpCacheEpoch, getCacheEpoch } from "@/lib/settings-server";

/**
 * 管理端大清單的快取（docs/資料庫讀取規範.md 鐵律 6）：
 *
 * - **失效靠 epoch（跨實例）**：key 綁定 `settings/system.cacheEpoch`，
 *   任何管理端資料變更呼叫 `invalidateAdminListCache()` 遞增該旗標，
 *   所有實例（含 serverless 冷啟動）的下一次讀取自動改 key＝自動失效，
 *   延遲上限＝設定快取 TTL（30 秒）。
 * - **TTL 只是硬上限**：防 bump 失敗／旗標被清掉時快取永久不終，
 *   故取 10 分鐘；「每次變更立即失效」由 epoch 負責，不受 TTL 限制。
 * - 讀 epoch 走 readSystemDoc 共用快取，驗證路徑已讀過時為 0 次額外讀取。
 */

/** 清單 payload 的 TTL 硬上限（正確性由 epoch 保證，此值僅防呆） */
export const LIST_CACHE_TTL_MS = 600_000;

/**
 * 以 epoch 綁定 key 的清單快取。
 * epoch 變動 → key 變動 → 舊 payload 自動作廢（跨實例生效）。
 * 回傳值連同「用於 key 的那個 epoch」一起交給呼叫端：
 * 快取 key 與回應的 cacheEpoch 必須同源，否則並發寫入時可能把
 * 舊 payload 誤掛在新 epoch 上（內容過期卻永遠命中）。
 */
export async function cachedListRead<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs: number = LIST_CACHE_TTL_MS
): Promise<{ data: T; epoch: number }> {
  const epoch = await getCacheEpoch();
  const data = await cachedRead(`${key}#${epoch}`, ttlMs, load);
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
