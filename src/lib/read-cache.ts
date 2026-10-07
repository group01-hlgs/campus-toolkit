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

/**
 * 驗證基線（使用者文件＋當期名冊條目）的快取 TTL——**只能 5～10 秒**。
 * 這是權限判定資料，不是清單；絕不抄清單的 10 分鐘（見 docs/資料讀取省流.md Phase 5）。
 * 停用帳號／停用身分／移除名冊條目最多晚本 TTL 全面生效（跨實例）；
 * 管理端寫入路徑的 invalidateAdminListCache() 會清本機快取並 bump epoch，同實例立即。
 */
export const AUTHZ_TTL_MS = 8_000;

/** 驗證基線快取 key 的前綴（invalidateReadCache("authz:") 可只清這類） */
export const AUTHZ_CACHE_PREFIX = "authz:";

export interface AuthzDocs {
  /** 使用者文件；不存在＝null（同樣快取，免重打孤兒查詢） */
  user: Record<string, unknown> | null;
  /** 當期身分名冊條目；不存在＝null */
  entry: Record<string, unknown> | null;
}

/**
 * 驗證基線的 8 秒快取（docs/資料庫讀取規範.md 鐵律 6＋Phase 5）：
 * key＝`authz:<uid>:<role>:<tokenVersion>#<cacheEpoch>`。
 * - tokenVersion 在 key 內：改密後 key 自動分家（舊 session 對不上「成功」快取）；
 *   舊 session 另有 jti 撤銷在快取外先把關。
 * - cacheEpoch 在 key 內：管理端變更 bump epoch → key 變動 → 跨實例自動失效。
 * - user／entry 皆可為 null：「不存在」也快取，否則孤兒查詢每請求照打。
 */
export async function cachedAuthzDocs<T extends AuthzDocs>(
  uid: string,
  role: string,
  tokenVersion: number,
  epoch: number,
  load: () => Promise<T>
): Promise<T> {
  return cachedRead(
    `${AUTHZ_CACHE_PREFIX}${uid}:${role}:${tokenVersion}#${epoch}`,
    AUTHZ_TTL_MS,
    load
  );
}
