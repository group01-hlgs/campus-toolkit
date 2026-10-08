/**
 * 類別標籤（公告分類／行事曆類型）的共用純函式。
 *
 * 刪除機制：管理端可直接刪除不再使用的標籤，**不做批次遷移**（避免大量讀寫額度）。
 * 代價是既有文件會留下失效的 `categoryId`，因此以「讀取時後備」兜住顯示：
 *
 * 1. 每個模組指定一個**不可刪除的後備標籤**（`fallbackId`），設定讀寫時強制存在且啟用；
 * 2. 顯示名稱依序取：原 id → 後備標籤名稱 → 預設名稱（永不露出原始 id）；
 * 3. 寫入時才正規化：編輯表單發現 id 已失效就自動歸到後備標籤，
 *    使用者按下儲存的那一筆才被修正（一次一筆，非批次遷移）；
 * 4. 新增來源一律以後備標籤為預設值，從此不再產生新的失效引用。
 *
 * 全部為純函式：不碰 Firestore、零額度，前端後端皆可 import。
 */

export interface CategoryLike {
  id: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
}

/**
 * 確保後備標籤存在且啟用（設定讀入與存檔前各跑一次）。
 * 已存在：強制 `enabled = true`（後備標籤必須出現在新建表單的選單）。
 * 不存在：以 `createDefault()` 補在最後，不動既有排序。
 */
export function ensureFallbackCategory<T extends CategoryLike>(
  categories: T[],
  fallbackId: string,
  createDefault: () => T
): T[] {
  if (categories.some((item) => item.id === fallbackId)) {
    return categories.map((item) =>
      item.id === fallbackId && !item.enabled ? { ...item, enabled: true } : item
    );
  }
  return [...categories, createDefault()];
}

/**
 * 顯示名稱解析：原 id → 後備標籤名稱 → `fallbackName`。
 * 已停用的標籤仍照原名顯示（歷史條目不受影響）；id 已刪除則自動落後備標籤。
 */
export function resolveCategoryName(
  categories: CategoryLike[],
  fallbackId: string,
  fallbackName: string,
  categoryId: string
): string {
  const hit = categories.find((item) => item.id === categoryId);
  if (hit) return hit.name;
  const fallback = categories.find((item) => item.id === fallbackId);
  return fallback ? fallback.name : fallbackName;
}

/**
 * 表單正規化：id 不在給定清單（通常＝啟用中的標籤）時改指後備標籤。
 * 呼叫端把回傳值直接當 select 的 value 與送出值，即可同時處理新增與編輯。
 */
export function normalizeCategoryId(
  categories: CategoryLike[],
  fallbackId: string,
  categoryId: string
): string {
  if (categoryId && categories.some((item) => item.id === categoryId)) return categoryId;
  return fallbackId;
}
