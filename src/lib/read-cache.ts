import "server-only";

interface CacheEntry {
  value: unknown;
  at: number;
}

const store = new Map<string, CacheEntry>();
/** 進行中的讀取：同 key 的併發請求共用同一次查詢（避免前端重複請求各打一次） */
const inflight = new Map<string, Promise<unknown>>();

/**
 * 讀取快取（docs/資料庫讀取規範.md 鐵律 6）：
 * 同 key 於 `ttlMs` 內的重複請求直接回快取值、併發請求共用同一次載入，皆不打 Firestore。
 * 讀失敗（load() 拋錯）不寫入快取、直接拋出。
 *
 * **寫入後必須呼叫 `invalidateReadCache()`**，否則同程序最多陳舊 `ttlMs`；
 * 跨程序（serverless 多實例）無法互相通知，陳舊上限同樣是 `ttlMs`——
 * 因此 ttlMs 請取「使用者可接受的最短資料延遲」（清單類建議 10～30 秒）。
 */
export async function cachedRead<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    try {
      const value = await load();
      store.set(key, { value, at: Date.now() });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

/**
 * 清除讀取快取：資料變更（增修刪）後呼叫。
 * 不帶前綴＝全部清除（目前快取量小、清除成本趨近 0，優先確保正確性）；
 * 帶前綴＝只清指定開頭的 key（如 `"admin:roster:"）。
 */
export function invalidateReadCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** 設定類文件（settings 子文件）的快取時間：寫入後 invalidateReadCache() 失效，30 秒為跨實例陳舊上限 */
export const SETTING_DOC_TTL_MS = 30_000;

/**
 * 設定類文件（settings 子文件）的 30 秒快取，key＝`setting-doc:<docId>`。
 * 同一份文件不管從哪個路由讀（api/admin/classes 與 api/admin/school/*）都命中同一份；
 * 寫入路徑呼叫 invalidateAdminListCache()（內部 invalidateReadCache()）即清。
 * 注意：驗證需要「改完立刻看到新值」的路徑（如 school/classes PUT 的 context）不要走這裡。
 */
export async function cachedSettingDoc<T>(
  docId: string,
  load: () => Promise<T>
): Promise<T> {
  return cachedRead(`setting-doc:${docId}`, SETTING_DOC_TTL_MS, load);
}
