/**
 * 遊戲快捷區（各身分功能首頁左上角浮動按鈕）的順序來源：
 * 讀取 /recreation「快捷區」分類在本瀏覽器記住的卡片順序（localStorage）。
 * 快捷區可為空（不顯示任何遊戲），最多 3 個；未設定過則預設顯示全部 3 個既有遊戲。
 */
export const GAME_SHORTCUT_STORAGE_KEY = "campusCardOrder.recreation";

/** /recreation 分類版面的預設分類 id（不可刪除的「快捷區」） */
export const GAME_SHORTCUT_CATEGORY_ID = "uncategorized";

export const GAME_SHORTCUT_CATEGORY_NAME = "快捷區";

export const GAME_SHORTCUT_MAX = 3;

export type GameKey = "wrench" | "changE" | "exam";

/** 既有 3 個遊戲（順序＝遊戲發表順序，作為尚未設定快捷區時的預設值） */
export const GAME_KEYS: readonly GameKey[] = ["wrench", "changE", "exam"];

const GAME_KEY_SET = new Set<string>(GAME_KEYS);

export function isGameKey(value: string): value is GameKey {
  return GAME_KEY_SET.has(value);
}

/** 讀取快捷區內的遊戲順序；未設定或無法解析時回傳全部遊戲 */
export function readGameShortcutOrder(): GameKey[] {
  if (typeof window === "undefined") return [...GAME_KEYS];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(GAME_SHORTCUT_STORAGE_KEY);
  } catch {
    return [...GAME_KEYS];
  }
  if (!raw) return [...GAME_KEYS];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [...GAME_KEYS];
    const categories = (parsed as { categories?: unknown }).categories;
    if (!Array.isArray(categories)) return [...GAME_KEYS];

    const shortcut = categories.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const category = entry as { id?: unknown; name?: unknown };
      return (
        category.id === GAME_SHORTCUT_CATEGORY_ID ||
        category.name === GAME_SHORTCUT_CATEGORY_NAME
      );
    });
    // 找不到預設分類＝尚未建立快捷區，沿用預設全部遊戲
    if (!shortcut) return [...GAME_KEYS];

    const rows = (shortcut as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) return [];
    const ids = rows
      .flatMap((row) => (Array.isArray(row) ? row : []))
      .filter((id): id is string => typeof id === "string")
      .filter(isGameKey);
    return [...new Set(ids)].slice(0, GAME_SHORTCUT_MAX);
  } catch {
    return [...GAME_KEYS];
  }
}
