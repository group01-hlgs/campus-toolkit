"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import DisclosureArrow from "@/components/DisclosureArrow";

export interface ModuleCardItem {
  /** 穩定識別碼：用於排序與 localStorage，日後改標籤也不會打亂已記住的版面 */
  id: string;
  icon: ReactNode;
  label: string;
  href: string;
  /** 點擊卡片時改為執行此動作（如開啟遊戲視窗），不導頁；有提供時優先於 href */
  onClick?: () => void;
}

const DEFAULT_HINT =
  "拖曳卡片可調整顯示順序，拖到行與行的間隙可另起一行；分類標題可拖曳調整彼此位置，此瀏覽器會自動記住";

const EDIT_HINT =
  "編輯模式：點分類名稱可改名，可設定每行最多張數、預設收合、刪除分類；拖曳卡片可跨分類移動，按右側 ✓ 完成";

/** 標題可顯示的最大字數（以目前字級，一個中文字＝1em＝16px）；＋2px 縫隙避免字型進位誤差讓剛好12字被截斷 */
const LABEL_MAX_CHARS = 12;
const LABEL_WIDTH = `calc(${LABEL_MAX_CHARS}em + 2px)`; // 192px + 2px

/**
 * 卡片固定寬度（寫死）：左 padding 16 + 圖示 24 + 間距 12 + 標題 12字 192px ＋2px 縫隙
 * + 右側預留（拖曳握把 28 ＋間距 12）40 = 286px。
 */
const CARD_WIDTH = "286px";

/** 卡片區寬度（.content-width，定義在 globals.css）：與首頁其他區塊共用同一個寬度 */
const AREA_WIDTH_CLASS = "content-width";

/** 行與行的距離（px）：比卡片間距 16px 大，用來區隔「行」，同時也是拖到行間隙的判定範圍 */
const ROW_GAP_PX = 24;

/** 指標超出卡片區多少距離內仍算數（拖到頁面角落時不動作，避免誤建新行） */
const EDGE_MARGIN_PX = ROW_GAP_PX;

/** 「未分類」的固定 id：永遠存在、不可刪除，是新增/刪除分類時卡片的退回處 */
const UNCATEGORIZED_ID = "uncategorized";

/** 每行張數可設的最大值（超過絕大部分螢幕的可用寬度，設了也會自動折行） */
const MAX_COLUMNS = 6;

/** 卡片間距（px）：與卡片行的 gap-4 一致，用來推算「每行 N 張」的分類框寬度 */
const CARD_GAP_PX = 16;

/** 拖曳中的放置提示：間隙＝另起一行（畫指示線，可限定左右範圍），行內＝該行外框，標題列＝放入該分類，catBox＝分類前後落點 */
type DropHint =
  | { type: "gap"; top: number; left?: number; right?: number }
  | { type: "row"; category: string; row: number }
  | { type: "category"; category: string }
  | { type: "catBox"; category: string }
  | null;

/**
 * 放置目標：
 * - insert：插到指定分類指定行的第 index 張卡片之前（index 可等於該行長度＝加到行尾）
 * - newRow：在 (beforeRow, beforeIndex) 之前另起一行（限定同一分類內）
 * - category：放到該分類末尾（用在收合中/空白分類的標題列上，等同手機資料夾）
 */
type DropTarget =
  | { kind: "insert"; category: string; row: number; index: number }
  | { kind: "newRow"; category: string; beforeRow: number; beforeIndex: number }
  | { kind: "category"; category: string };

/** 視覺上的「一條橫列」：同一行的卡片 top 相同；一行超出寬度折行後會產生多條橫列 */
interface CardLine {
  top: number;
  bottom: number;
  /** 此橫列所屬的模型行索引 */
  row: number;
  /** 此橫列所屬的分類 id */
  category: string;
  cards: { id: string; rect: DOMRect }[];
}

interface Geometry {
  grid: DOMRect;
  cardRects: Map<string, DOMRect>;
  /** 各分類標題列（summary）的位置：拖到標題列上＝放入該分類 */
  headings: Map<string, DOMRect>;
  /** 各分類框（含收合中＝只剩標題列）的位置：卡片落點先判定所在的分類框 */
  boxes: Map<string, DOMRect>;
  lines: CardLine[];
}

/** 分類（群組）：包住數個「行」，可命名、可收合、可設每行張數（未分類不可刪除） */
interface StoredCategory {
  /** 穩定識別碼：未分類固定為 "uncategorized"，其餘建立時生成 */
  id: string;
  name: string;
  /** 此分類的預設收合狀態（新增分類預設展開）；變更時會同步目前狀態 */
  defaultCollapsed: boolean;
  /** 目前收合狀態：使用者手動切換會記住到下次造訪 */
  collapsed: boolean;
  /**
   * 每行張數上限（1..6）：分類框寬度上限＝N 張卡（窄螢幕自動減少），每行顯示 1~N 張、
   * 超過框寬自動折行；斷行仍由使用者拖曳決定（含拖到行間隙另起一行）。
   * null＝自由（吃滿整行、可手動斷行）。
   */
  columns: number | null;
  /** 沿用原有的「行」模型：每個元素是一行的卡片 id */
  rows: string[][];
}

interface StoredLayout {
  version: 4;
  categories: StoredCategory[];
  /** 已由使用者自行拖曳定位、不再套用排版規則的卡片 id */
  anchored: string[];
}

/** 六點握把圖示：提示此卡片可拖曳換位（滑鼠與觸控皆可） */
function DragHandleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {[5, 8, 11].map((cy) => (
        <g key={cy}>
          <circle cx="5.5" cy={cy} r="1.4" />
          <circle cx="10.5" cy={cy} r="1.4" />
        </g>
      ))}
    </svg>
  );
}

/** 鉛筆圖示（Heroicons outline 風格）：說明文字列的「編輯」入口、分類改名 */
function PencilIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487z" />
      <path d="M15 4.875L19.125 9" />
    </svg>
  );
}

/** 打勾圖示：編輯模式的「完成」 */
function CheckIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

/** 垃圾桶圖示：刪除分類 */
function TrashIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

const cleanRow = (row: unknown): string[] =>
  Array.isArray(row) ? row.filter((entry): entry is string => typeof entry === "string") : [];

/** 建立「預設分類」：永遠存在的退回容器（初始時裝著全部卡片） */
function mkUncategorized(ids: string[], name = "未分類"): StoredCategory {
  return {
    id: UNCATEGORIZED_ID,
    name,
    defaultCollapsed: false,
    collapsed: false,
    columns: null,
    rows: ids.length > 0 ? [[...ids]] : [],
  };
}

/** 解析每行張數上限：1..6 的整數才有效，其餘（含舊版無此欄位）一律為「自由」 */
function normalizeColumns(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 1 && value <= MAX_COLUMNS ? value : null;
}

function normalizeCategory(entry: unknown, fallbackName = "未分類"): StoredCategory | null {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as {
    id?: unknown;
    name?: unknown;
    defaultCollapsed?: unknown;
    collapsed?: unknown;
    columns?: unknown;
    rows?: unknown;
  };
  if (typeof raw.id !== "string" || raw.id === "") return null;
  const rows = Array.isArray(raw.rows) ? raw.rows.map(cleanRow).filter((row) => row.length > 0) : [];
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name : fallbackName,
    defaultCollapsed: raw.defaultCollapsed === true,
    collapsed: raw.collapsed === true,
    columns: normalizeColumns(raw.columns),
    rows,
  };
}

/** 解析 localStorage 版面：v4/v3 分類格式，以及舊版 v2（二維行）／v1（一維卡片）皆可讀（自動包成單一未分類） */
function parseStoredLayout(
  raw: string,
  defaultCategoryName = "未分類"
): { categories: StoredCategory[]; anchored: string[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const isString = (value: unknown): value is string => typeof value === "string";
  if (Array.isArray(parsed) && parsed.every((entry) => Array.isArray(entry))) {
    return {
      categories: [mkUncategorized((parsed as unknown[]).flatMap(cleanRow), defaultCategoryName)],
      anchored: [],
    };
  }
  if (Array.isArray(parsed) && parsed.every(isString)) {
    return { categories: [mkUncategorized(parsed, defaultCategoryName)], anchored: [] };
  }
  if (parsed && typeof parsed === "object") {
    const stored = parsed as { rows?: unknown; anchored?: unknown; categories?: unknown };
    const anchored = Array.isArray(stored.anchored) ? stored.anchored.filter(isString) : [];
    if (Array.isArray(stored.categories)) {
      const categories = stored.categories
        .map((entry) => normalizeCategory(entry, defaultCategoryName))
        .filter((category): category is StoredCategory => category !== null);
      if (categories.length > 0) return { categories, anchored };
      return null;
    }
    if (Array.isArray(stored.rows)) {
      return {
        categories: [
          mkUncategorized((stored.rows as unknown[]).flatMap(cleanRow), defaultCategoryName),
        ],
        anchored,
      };
    }
  }
  return null;
}

/**
 * 對齊目前的卡片清單：清掉已不存在的卡片、跨分類去重，
 * 新增的卡片補進「未分類」末行；「未分類」不在清單中時自動補建。
 */
function reconcileCategories(
  source: StoredCategory[],
  ids: string[],
  defaultCategoryName = "未分類"
): StoredCategory[] {
  const known = new Set(ids);
  const seen = new Set<string>();
  const result: StoredCategory[] = [];
  for (const category of source) {
    const rows: string[][] = [];
    for (const row of category.rows) {
      const kept = row.filter((id) => known.has(id) && !seen.has(id));
      if (kept.length === 0) continue;
      for (const id of kept) seen.add(id);
      rows.push(kept);
    }
    result.push({ ...category, rows });
  }
  let uncategorized = result.find((category) => category.id === UNCATEGORIZED_ID);
  if (!uncategorized) {
    uncategorized = mkUncategorized([], defaultCategoryName);
    result.unshift(uncategorized);
  }
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    if (uncategorized.rows.length === 0) uncategorized.rows.push([...missing]);
    else {
      uncategorized.rows[uncategorized.rows.length - 1] = [
        ...uncategorized.rows[uncategorized.rows.length - 1],
        ...missing,
      ];
    }
  }
  // 設了每行張數上限的分類只影響框寬與折行，行模型維持使用者拖曳的結果
  return result;
}

/**
 * 排版規則：把子卡片移到錨點卡片正後方（僅在「尚未被使用者拖曳挪動」時套用），
 * 且兩張卡必須同分類才有效。有實際變動才回傳新版面，否則回傳 null。
 */
function moveAfter(rows: string[][], childId: string, anchorId: string): string[][] | null {
  if (childId === anchorId) return null;
  let child: { row: number; index: number } | null = null;
  let anchor: { row: number; index: number } | null = null;
  for (let row = 0; row < rows.length; row++) {
    for (let index = 0; index < rows[row].length; index++) {
      const id = rows[row][index];
      if (id === childId) child = { row, index };
      if (id === anchorId) anchor = { row, index };
    }
  }
  if (!child || !anchor) return null;
  if (child.row === anchor.row && child.index === anchor.index + 1) return null;
  const next = rows.map((row) => row.slice());
  next[child.row].splice(child.index, 1);
  const cleaned = next.filter((entry) => entry.length > 0);
  for (const row of cleaned) {
    const index = row.indexOf(anchorId);
    if (index < 0) continue;
    row.splice(index + 1, 0, childId);
    return cleaned;
  }
  return null;
}

function sameHint(a: DropHint, b: DropHint): boolean {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "row" && b.type === "row") return a.category === b.category && a.row === b.row;
  if (a.type === "category" && b.type === "category") return a.category === b.category;
  if (a.type === "catBox" && b.type === "catBox") return a.category === b.category;
  if (a.type === "gap" && b.type === "gap") {
    return (
      Math.abs(a.top - b.top) < 0.5 &&
      (a.left ?? 0) === (b.left ?? 0) &&
      (a.right ?? 0) === (b.right ?? 0)
    );
  }
  return false;
}

/**
 * 功能首頁的入口卡片網格：卡片分成「行」保存、可再分成數個「分類」群組，
 * 分類框以 flex-wrap 並排（寬度不足自動換行），行內超出框寬就自動往下折。
 * 可拖曳調整順序（含跨分類搬移）、拖到行與行的間隙另起一行，版面存入 localStorage（每張卡片以 data-card-id 識別）。
 * 另可給 `anchorAfter` 排版規則（如「行事曆」緊接「系統公告」）：只在使用者尚未自行拖曳該卡片時套用。
 *
 * 分類編輯（說明文字列右端的鉛筆圖示切換）：
 * - 只有一個分類時不顯示標題列（畫面與無分類時完全相同）；新增第 2 個分類或進入編輯模式才顯示。
 * - 分類標題列為原生 `<details>`／`<summary>`＋DisclosureArrow：顯示名稱、卡片數、收合箭頭；
 *   收合狀態記住到下次造訪，「預設收合」開關決定首次（與重設後）的狀態。
 * - 編輯模式可就地改名、設每行最多張數、切換預設收合、刪除分類（未分類不可刪除，刪除後卡片退回未分類）、新增分類。
 * - 每行最多張數（1..6）：分類框寬度上限＝N 張卡（窄螢幕自動減少），每行顯示 1~N 張、超過框寬自動折行；
 *   斷行仍由拖曳決定（拖到行間隙另起一行）；「自由」＝吃滿整行。卡片維持 286px 固定寬不變形。
 * - 拖到收合中（或空白）分類的標題列上＝放進該分類末尾，不會自動展開（手機資料夾規則）。
 *
 * 分類拖曳（標題列握把，比照卡片常駐）：
 * - 拖到分類框左/右半＝插到該分類前/後；拖到分類列間隙＝移到下一列首個分類前；全部下方＝排到最後。
 * - 卡片落點先判定「指標所在的分類框」，行/間隙判定限定在該框內（並排後上下相鄰不可靠）；
 *   框外取水平重疊且垂直最近的分類框（列間隙、框下方仍可放置），左右溝槽則不放置。
 *
 * 實作要點：
 * - 版面模型是分類→二維 string[][]（rows）：斷行一律由拖曳決定；每行張數設定只影響框寬與折行上限。
 * - 全程使用 Pointer Events，滑鼠與手指（觸控）走同一套邏輯；不依賴 HTML5 拖曳 API（其不支援觸控）。
 * - 指標捕捉掛在「不會被搬動」的網格容器上，拖曳中 React 重排子節點也不會中斷事件。
 * - 每次 pointermove 都重新量測：跨行、跨分類搬移都會改變列高，
 *   所以結構真的改變時用 flushSync 同步重繪，確保下一次 pointermove 量到的是最新版面。
 * - 卡片區寬度固定用 .content-width（80vw，與首頁其他區塊同寬），卡片本身寫死 286px 不隨視窗縮放；
 *   行內用 flex-wrap 自動折行，畫面越寬每條橫列放得下越多張；小螢幕每行只剩 1 張時左右置中。
 * - 全部使用主題類別（border-themed／bg-hover／text-t1~t3／opacity），未寫死色票。
 */
export default function DraggableModuleGrid({
  items,
  storageKey,
  hint = DEFAULT_HINT,
  gridClassName = `${AREA_WIDTH_CLASS} relative flex flex-wrap gap-6 items-start mb-8`,
  anchorAfter,
  defaultCategoryName = "未分類",
  alwaysShowHeadings = false,
  defaultCategoryNote,
}: {
  items: ModuleCardItem[];
  storageKey: string;
  hint?: string;
  gridClassName?: string;
  /**
   * 排版規則：`{ 子卡片 id: 錨點卡片 id }`，子卡片緊接在錨點卡片之後
   * （如管理員首頁的「行事曆」排在「系統公告」下方），兩張卡同分類時才套用。
   * 只在使用者尚未自行拖曳該卡片時套用——一旦拖過就以拖曳結果為準並記住。
   */
  anchorAfter?: Record<string, string>;
  /** 預設分類（不可刪除的退回容器）名稱；未指定時沿用「未分類」 */
  defaultCategoryName?: string;
  /** 分類標題列一律顯示（即使只有一個分類、或該分類目前沒有卡片） */
  alwaysShowHeadings?: boolean;
  /** 預設分類標題下方的簡要說明（可放不同主題色的文字片段） */
  defaultCategoryNote?: ReactNode;
}) {
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [categories, setCategories] = useState<StoredCategory[]>(() => [
    mkUncategorized(items.map((item) => item.id), defaultCategoryName),
  ]);
  const catsRef = useRef<StoredCategory[]>(categories);
  /** 已被使用者自行拖曳定位的錨點子卡片（不再套用排版規則），隨版面一起存進 localStorage */
  const anchoredRef = useRef<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  /** 編輯模式：改名、預設收合、刪除、新增分類（拖曳在兩種模式下都可） */
  const [editMode, setEditMode] = useState(false);
  /** 正在就地改名的分類 id */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /** 等待確認刪除的分類 id */
  const [deleteId, setDeleteId] = useState<string | null>(null);
  /** Escape 取消改名時略過緊接的 onBlur 存檔 */
  const skipBlurRef = useRef(false);
  /** 分類拖曳（標題列握把）：與卡片拖曳共用網格的 pointer 捕捉，兩者互斥進行 */
  const catDragIdRef = useRef<string | null>(null);
  const [catDragId, setCatDragId] = useState<string | null>(null);
  const catMovedRef = useRef(false);
  /** 分類拖曳結束後的那一次 click 不觸發 summary 收合（下一次 pointerdown 重設） */
  const suppressSummaryClickRef = useRef(false);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item] as const)), [items]);

  /** 套用排版規則（anchorAfter）：只移動「使用者尚未自行拖曳」且與錨點同分類的子卡片 */
  function applyAnchorRules(source: StoredCategory[]): StoredCategory[] {
    if (!anchorAfter) return source;
    let next = source;
    for (const [childId, anchorId] of Object.entries(anchorAfter)) {
      if (anchoredRef.current.has(childId)) continue;
      const anchorCategory = next.find((category) =>
        category.rows.some((row) => row.includes(anchorId))
      );
      if (!anchorCategory) continue;
      const moved = moveAfter(anchorCategory.rows, childId, anchorId);
      if (moved) {
        next = next.map((category) =>
          category === anchorCategory ? { ...category, rows: moved } : category
        );
      }
    }
    return next;
  }

  function persist(value: StoredCategory[] = catsRef.current) {
    try {
      const layout: StoredLayout = {
        version: 4,
        categories: value,
        anchored: [...anchoredRef.current],
      };
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      // 私隱模式或儲存空間不足時忽略
    }
  }

  /** 套用新版面並立刻存檔（改名、收合、刪除、新增分類等編輯操作走這裡） */
  function applyCategories(next: StoredCategory[]) {
    catsRef.current = next;
    setCategories(next);
    persist(next);
  }

  // 載入此瀏覽器記住的版面（延後到掛載後執行，避免 SSR 與用戶端渲染不一致）
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(storageKey);
    } catch {
      // 無法存取時維持預設版面
      return;
    }
    if (!raw) return;
    const stored = parseStoredLayout(raw, defaultCategoryName);
    if (!stored) return; // 資料毀損時維持預設版面
    anchoredRef.current = new Set(stored.anchored);
    // 舊版預設分類名稱為「未分類」：指定自訂名稱時一併升級，避免沿用舊標題
    const categories = stored.categories.map((category) =>
      category.id === UNCATEGORIZED_ID &&
      category.name === "未分類" &&
      defaultCategoryName !== "未分類"
        ? { ...category, name: defaultCategoryName }
        : category
    );
    const reconciled = reconcileCategories(
      categories,
      items.map((item) => item.id),
      defaultCategoryName
    );
    if (reconciled.length === 0) return;
    const next = applyAnchorRules(reconciled);
    catsRef.current = next;
    setCategories(next);
    // 只有「排版規則有實際挪動卡片」才存回（讓這次歸位只做一次）；
    // 對齊卡片清單（reconcile）的變動維持原樣、等使用者拖曳時才存，避免暫時載入不全就覆寫版面
    if (JSON.stringify(next) !== JSON.stringify(reconciled)) persist(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // 卡片有增減時（例如功能改版）同步到版面：新卡片補進「未分類」末行，再套排版規則
  useEffect(() => {
    const next = applyAnchorRules(
      reconcileCategories(
        catsRef.current,
        items.map((item) => item.id),
        defaultCategoryName
      )
    );
    if (JSON.stringify(next) === JSON.stringify(catsRef.current)) return;
    catsRef.current = next;
    setCategories(next);
  }, [items, defaultCategoryName]);

  function locateCard(id: string): { category: string; row: number; index: number } | null {
    for (const category of catsRef.current) {
      for (let row = 0; row < category.rows.length; row++) {
        const index = category.rows[row].indexOf(id);
        if (index >= 0) return { category: category.id, row, index };
      }
    }
    return null;
  }

  function rowsOf(categoryId: string): string[][] {
    return catsRef.current.find((category) => category.id === categoryId)?.rows ?? [];
  }

  /** 量測目前版面：所有卡片座標、各分類標題列座標，以及依視覺橫列分組的資料（用來判定間隙與折行處） */
  function collectGeometry(): Geometry | null {
    const grid = gridRef.current;
    if (!grid) return null;
    const cardRects = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>("[data-card-id]").forEach((element) => {
      const id = element.dataset.cardId;
      const rect = element.getBoundingClientRect();
      // 收合中的分類內容不顯示（尺寸為 0），不參與量測
      if (id && rect.width > 0 && rect.height > 0) cardRects.set(id, rect);
    });
    const headings = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>("[data-category-heading]").forEach((element) => {
      const id = element.dataset.categoryHeading;
      const rect = element.getBoundingClientRect();
      if (id && rect.height > 0) headings.set(id, rect);
    });
    const boxes = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>("[data-category-id]").forEach((element) => {
      const id = element.dataset.categoryId;
      const rect = element.getBoundingClientRect();
      // 收合中的分類框＝只剩標題列（高度 > 0），仍可作為卡片與分類的放置目標
      if (id && rect.height > 0) boxes.set(id, rect);
    });
    const lines: CardLine[] = [];
    catsRef.current.forEach((category) => {
      category.rows.forEach((row, rowIndex) => {
        let current: CardLine | null = null;
        for (const id of row) {
          const rect = cardRects.get(id);
          if (!rect) continue;
          if (!current || Math.abs(rect.top - current.top) > 1) {
            current = { top: rect.top, bottom: rect.bottom, row: rowIndex, category: category.id, cards: [] };
            lines.push(current);
          }
          current.cards.push({ id, rect });
          current.top = Math.min(current.top, rect.top);
          current.bottom = Math.max(current.bottom, rect.bottom);
        }
      });
    });
    return { grid: grid.getBoundingClientRect(), cardRects, headings, boxes, lines };
  }

  /** 依放置目標算出新版面；沒有實際變化時回傳 null */
  function buildRows(
    draggedId: string,
    target: DropTarget
  ): { categories: StoredCategory[]; category: string; row: number } | null {
    const current = catsRef.current;
    const from = locateCard(draggedId);
    if (!from) return null;

    // 先把拖曳卡片從原分類拿掉（必要時連同被清空的行一起移除），再依目標放回去
    const next = current.map((category) => ({ ...category, rows: category.rows.map((row) => [...row]) }));
    const sourceIndex = next.findIndex((category) => category.id === from.category);
    if (sourceIndex < 0) return null;
    const source = next[sourceIndex];
    const sourceCleared = source.rows[from.row].length === 1;
    const [movedId] = source.rows[from.row].splice(from.index, 1);
    if (sourceCleared) source.rows.splice(from.row, 1);

    const targetIndex = next.findIndex((category) => category.id === target.category);
    if (targetIndex < 0) return null;
    const sameCategory = targetIndex === sourceIndex;
    const destination = next[targetIndex];

    if (target.kind === "category") {
      // 放到分類末尾（收合中/空白分類的標題列）
      if (destination.rows.length === 0) destination.rows.push([movedId]);
      else destination.rows[destination.rows.length - 1].push(movedId);
    } else {
      let row = target.kind === "insert" ? target.row : target.beforeRow;
      let index = target.kind === "insert" ? target.index : target.beforeIndex;
      if (sameCategory) {
        // 目標行就是被清空的那一行＝放回原處，沒有變化
        if (sourceCleared && row === from.row) return null;
        // 座標換算到「拿掉之後」的版面
        if (sourceCleared && from.row < row) row -= 1;
        if (!sourceCleared && row === from.row && index > from.index) index -= 1;
      }
      row = Math.max(0, Math.min(row, destination.rows.length - 1));

      if (destination.rows.length === 0) {
        destination.rows.push([movedId]);
      } else if (target.kind === "insert") {
        const position = Math.max(0, Math.min(index, destination.rows[row].length));
        destination.rows[row].splice(position, 0, movedId);
      } else if (index <= 0) {
        destination.rows.splice(Math.max(0, row), 0, [movedId]);
      } else if (index >= destination.rows[row].length) {
        destination.rows.splice(row + 1, 0, [movedId]);
      } else {
        // 落在行的中間：把該行從此切開，新行放中間
        destination.rows.splice(
          row,
          1,
          destination.rows[row].slice(0, index),
          [movedId],
          destination.rows[row].slice(index)
        );
      }
    }

    if (JSON.stringify(next) === JSON.stringify(current)) return null;
    const landed = destination.rows.findIndex((entry) => entry.includes(movedId));
    return { categories: next, category: destination.id, row: Math.max(0, landed) };
  }

  /** 套用放置：結構改變時同步重繪，讓緊接著的 pointermove 量到新版面 */
  function place(draggedId: string, target: DropTarget, hint: DropHint) {
    const result = buildRows(draggedId, target);
    if (!result) {
      if (!sameHint(dropHint, hint)) setDropHint(hint);
      return;
    }
    flushSync(() => {
      catsRef.current = result.categories;
      setCategories(result.categories);
      setDropHint(
        hint && hint.type === "row" ? { type: "row", category: result.category, row: result.row } : hint
      );
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLSpanElement>, id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (catDragIdRef.current !== null) return; // 分類拖曳中不啟動卡片拖曳
    event.preventDefault();
    movedRef.current = false;
    dragIdRef.current = id;
    setDragId(id);
    const grid = gridRef.current;
    if (!grid) return;
    try {
      grid.setPointerCapture(event.pointerId);
    } catch {
      // 指標已結束或不支援捕捉時，改以容器上的一般事件接續
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    // 分類拖曳（標題列握把）走另一套邏輯
    if (catDragIdRef.current !== null) {
      handleCategoryMove(event);
      return;
    }
    const draggedId = dragIdRef.current;
    if (draggedId === null) return;
    movedRef.current = true;
    const geometry = collectGeometry();
    if (!geometry) return;
    const x = event.clientX;
    const y = event.clientY;
    const { grid, cardRects, headings, boxes, lines } = geometry;

    // 指標離開卡片區（含邊緣餘裕）就不動作，避免拖到頁面角落誤建新行
    if (
      x < grid.left - EDGE_MARGIN_PX ||
      x > grid.right + EDGE_MARGIN_PX ||
      y < grid.top - EDGE_MARGIN_PX ||
      y > grid.bottom + EDGE_MARGIN_PX
    ) {
      if (!sameHint(dropHint, null)) setDropHint(null);
      return;
    }

    // 1) 指標壓在卡片上：插到該卡片之前（左半）或之後（右半）
    for (const [id, rect] of cardRects) {
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const at = locateCard(id);
      if (!at) return;
      const index = x < rect.left + rect.width / 2 ? at.index : at.index + 1;
      place(
        draggedId,
        { kind: "insert", category: at.category, row: at.row, index },
        { type: "row", category: at.category, row: at.row }
      );
      return;
    }

    // 2) 指標在分類標題列上（含收合中與空白的分類）：放進該分類末尾（手機資料夾規則，不自動展開）
    for (const [categoryId, rect] of headings) {
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      place(draggedId, { kind: "category", category: categoryId }, { type: "category", category: categoryId });
      return;
    }

    // 3) 指標所在的分類框：行／間隙判定限定在框內（分類並排後上下相鄰不可靠）
    let boxId: string | null = null;
    let boxRect: DOMRect | null = null;
    for (const [id, rect] of boxes) {
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      boxId = id;
      boxRect = rect;
      break;
    }
    if (boxRect === null) {
      // 框外（列間隙、框下方、頂部餘裕）：取與指標水平重疊且垂直最近的分類框繼續判定；
      // 左右溝槽（與任何框都無水平重疊）不放置——放入分類＝拖到框內或標題列
      let best: { id: string; rect: DOMRect; distance: number } | null = null;
      for (const [id, rect] of boxes) {
        if (x < rect.left || x > rect.right) continue;
        const distance = y < rect.top ? rect.top - y : y - rect.bottom;
        if (!best || distance < best.distance) best = { id, rect, distance };
      }
      if (!best) {
        if (!sameHint(dropHint, null)) setDropHint(null);
        return;
      }
      boxId = best.id;
      boxRect = best.rect;
    }
    if (boxId === null) return;
    const gapLeft = boxRect.left - grid.left;
    const gapRight = grid.right - boxRect.right;
    const catLines = lines.filter((entry) => entry.category === boxId);

    // 3-1) 指標在該分類的橫列範圍內（該列左右的空白）：插到該行最接近的位置
    const line = catLines.find((entry) => y >= entry.top && y <= entry.bottom);
    if (line) {
      const rowIds = rowsOf(boxId)[line.row] ?? [];
      const last = line.cards[line.cards.length - 1];
      const lastPosition = last ? rowIds.indexOf(last.id) : -1;
      let index = lastPosition >= 0 ? lastPosition + 1 : rowIds.length;
      for (const card of line.cards) {
        if (x >= card.rect.left + card.rect.width / 2) continue;
        const position = rowIds.indexOf(card.id);
        if (position >= 0) {
          index = position;
          break;
        }
      }
      place(
        draggedId,
        { kind: "insert", category: boxId, row: line.row, index },
        { type: "row", category: boxId, row: line.row }
      );
      return;
    }

    // 3-2) 指標在框內橫列之間的間隙：在該處另起一行（含模型行折行後的視覺橫列，超出框寬自動折）
    const below = catLines.findIndex((entry) => entry.top > y);
    let target: DropTarget;
    let top: number;
    if (below === -1) {
      // 該分類最後一條橫列下方（框內底部空白）
      const last = catLines[catLines.length - 1];
      if (!last) {
        // 空白分類框（編輯模式的空分類）：放進該分類末尾
        place(draggedId, { kind: "category", category: boxId }, { type: "category", category: boxId });
        return;
      }
      const rowIds = rowsOf(boxId)[last.row] ?? [];
      target = { kind: "newRow", category: boxId, beforeRow: last.row, beforeIndex: rowIds.length };
      top = last.bottom + ROW_GAP_PX / 2;
    } else {
      const nextLine = catLines[below];
      const previousLine = below > 0 ? catLines[below - 1] : null;
      const firstId = nextLine.cards[0]?.id;
      if (!firstId) return;
      const at = locateCard(firstId);
      if (!at) return;
      target = { kind: "newRow", category: boxId, beforeRow: at.row, beforeIndex: at.index };
      top = previousLine
        ? (previousLine.bottom + nextLine.top) / 2
        : nextLine.top - ROW_GAP_PX / 2;
    }
    place(draggedId, target, {
      type: "gap",
      top: top - grid.top,
      left: gapLeft,
      right: gapRight,
    });
  }

  function handlePointerEnd() {
    if (catDragIdRef.current !== null) {
      // 拖曳分類後的那一次 click 不觸發 summary 收合（下一次 pointerdown 會重設）
      suppressSummaryClickRef.current = catMovedRef.current;
      persist();
      catDragIdRef.current = null;
      setCatDragId(null);
      setDropHint(null);
      return;
    }
    if (dragIdRef.current === null) return;
    const movedId = dragIdRef.current;
    // 使用者親手挪動受排版規則管理的卡片＝這張以拖曳結果為準，之後不再套用規則
    if (movedRef.current && movedId && anchorAfter && anchorAfter[movedId]) {
      anchoredRef.current.add(movedId);
    }
    // 拖曳後的這一次 click 不導頁（下一次 pointerdown 會重設）
    suppressClickRef.current = movedRef.current;
    persist();
    dragIdRef.current = null;
    setDragId(null);
    setDropHint(null);
  }

  function openModule(item: ModuleCardItem) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // 編輯模式下點卡片不導頁（避免編輯時誤入功能）
    if (editMode) return;
    // 有自訂動作的卡片（如遊戲卡開啟視窗）優先執行，不導頁
    if (item.onClick) {
      item.onClick();
      return;
    }
    // 無入口頁的卡片（如休閒歡樂誠：入口為首頁浮動遊戲按鈕）不導頁
    if (!item.href) return;
    router.push(item.href);
  }

  // ── 分類拖曳（標題列握把，比照卡片） ────────────────────────────

  function handleCategoryPointerDown(event: ReactPointerEvent<HTMLSpanElement>, id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (dragIdRef.current !== null) return; // 卡片拖曳中不啟動分類拖曳
    event.preventDefault();
    catMovedRef.current = false;
    suppressSummaryClickRef.current = false;
    catDragIdRef.current = id;
    setCatDragId(id);
    const grid = gridRef.current;
    if (!grid) return;
    try {
      grid.setPointerCapture(event.pointerId);
    } catch {
      // 指標已結束或不支援捕捉時，改以容器上的一般事件接續
    }
  }

  /**
   * 套用分類重排：targetIndex＝以「拖曳前座標」表示的「插到第幾位之前」
   * （可等於陣列長度＝排到最後）。沒有實際變化時只更新提示。
   */
  function applyCategoryOrder(draggedId: string, targetIndex: number, hint: DropHint) {
    const current = catsRef.current;
    const from = current.findIndex((category) => category.id === draggedId);
    if (from < 0) {
      if (!sameHint(dropHint, hint)) setDropHint(hint);
      return;
    }
    const next = [...current];
    const [moved] = next.splice(from, 1);
    const at = Math.max(
      0,
      Math.min(targetIndex > from ? targetIndex - 1 : targetIndex, next.length)
    );
    next.splice(at, 0, moved);
    if (JSON.stringify(next) === JSON.stringify(current)) {
      if (!sameHint(dropHint, hint)) setDropHint(hint);
      return;
    }
    flushSync(() => {
      catsRef.current = next;
      setCategories(next);
      setDropHint(hint);
    });
  }

  /** 分類拖曳中：框左/右半＝插到該分類前/後；列間隙＝移到下一列首個分類前；全部下方＝排最後 */
  function handleCategoryMove(event: ReactPointerEvent<HTMLDivElement>) {
    const draggedId = catDragIdRef.current;
    if (draggedId === null) return;
    catMovedRef.current = true;
    const grid = gridRef.current;
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;

    // 指標離開卡片區（含邊緣餘裕）就不動作
    if (
      x < gridRect.left - EDGE_MARGIN_PX ||
      x > gridRect.right + EDGE_MARGIN_PX ||
      y < gridRect.top - EDGE_MARGIN_PX ||
      y > gridRect.bottom + EDGE_MARGIN_PX
    ) {
      if (!sameHint(dropHint, null)) setDropHint(null);
      return;
    }

    const boxes = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>("[data-category-id]").forEach((element) => {
      const id = element.dataset.categoryId;
      const rect = element.getBoundingClientRect();
      if (id && rect.width > 0 && rect.height > 0) boxes.set(id, rect);
    });
    const order = catsRef.current.map((category) => category.id);
    const indexOf = (id: string) => order.indexOf(id);

    // 1) 指標在某分類框內：左半＝插到該分類之前、右半＝之後（同一框不高亮）
    for (const [id, rect] of boxes) {
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      if (id === draggedId) {
        if (!sameHint(dropHint, null)) setDropHint(null);
        return;
      }
      const targetIndex = x < rect.left + rect.width / 2 ? indexOf(id) : indexOf(id) + 1;
      applyCategoryOrder(draggedId, targetIndex, { type: "catBox", category: id });
      return;
    }

    // 2) 依頂邊把分類框分成視覺列（同列＝頂邊相同）
    const groups: { top: number; bottom: number; items: { id: string; rect: DOMRect }[] }[] = [];
    for (const [id, rect] of boxes) {
      let group = groups.find((entry) => Math.abs(entry.top - rect.top) <= 1);
      if (!group) {
        group = { top: rect.top, bottom: rect.bottom, items: [] };
        groups.push(group);
      }
      group.items.push({ id, rect });
      group.top = Math.min(group.top, rect.top);
      group.bottom = Math.max(group.bottom, rect.bottom);
    }
    groups.sort((a, b) => a.top - b.top);
    for (const group of groups) group.items.sort((a, b) => a.rect.left - b.rect.left);

    // 2-1) 在某一列範圍內（列左右的空白）：以該列的分類框判定前後（同卡片規則）
    const line = groups.find((entry) => y >= entry.top && y <= entry.bottom);
    if (line && line.items.length > 0) {
      let targetIndex = indexOf(line.items[0].id);
      for (const item of line.items) {
        if (x < item.rect.left + item.rect.width / 2) {
          targetIndex = indexOf(item.id);
          break;
        }
        targetIndex = indexOf(item.id) + 1;
      }
      const anchorId = targetIndex < order.length ? order[targetIndex] : order[order.length - 1];
      applyCategoryOrder(
        draggedId,
        targetIndex,
        anchorId && anchorId !== draggedId ? { type: "catBox", category: anchorId } : null
      );
      return;
    }

    // 2-2) 列與列的間隙：插到下一列首個分類之前；全部下方＝排最後
    const below = groups.findIndex((entry) => entry.top > y);
    if (below === -1) {
      const last = groups[groups.length - 1];
      if (!last) return;
      applyCategoryOrder(draggedId, order.length, {
        type: "gap",
        top: last.bottom + ROW_GAP_PX / 2 - gridRect.top,
      });
      return;
    }
    const firstOfNext = groups[below].items[0];
    if (!firstOfNext) return;
    const previousGroup = below > 0 ? groups[below - 1] : null;
    const top = previousGroup
      ? (previousGroup.bottom + groups[below].top) / 2
      : groups[below].top - ROW_GAP_PX / 2;
    applyCategoryOrder(draggedId, indexOf(firstOfNext.id), {
      type: "gap",
      top: top - gridRect.top,
    });
  }

  // ── 分類編輯操作 ────────────────────────────────────────────────

  function startRename(category: StoredCategory) {
    if (!editMode) return;
    if (editingId === category.id) return;
    // 改名中直接切到別的分類：先把前一個的輸入存起來（輸入框卸載不會觸發 onBlur）
    if (editingId !== null) commitRename();
    skipBlurRef.current = false;
    setEditingId(category.id);
    setRenameValue(category.name);
  }

  function commitRename() {
    const id = editingId;
    setEditingId(null);
    if (id === null) return;
    const name = renameValue.trim();
    if (!name) return; // 空名稱＝維持原名
    const current = catsRef.current.find((category) => category.id === id);
    if (!current || current.name === name) return;
    applyCategories(
      catsRef.current.map((category) => (category.id === id ? { ...category, name } : category))
    );
  }

  function toggleDefaultCollapsed(id: string) {
    applyCategories(
      catsRef.current.map((category) =>
        category.id === id
          ? {
              ...category,
              defaultCollapsed: !category.defaultCollapsed,
              // 變更預設值同時套用到目前狀態（設定只在首次出現時生效）
              collapsed: !category.defaultCollapsed,
            }
          : category
      )
    );
  }

  /** 設定每行張數上限：N＝分類框寬度上限 N 張卡（每行 1~N 張、超過自動折行）；「自由」＝吃滿整行。行的斷行與順序一律由拖曳決定 */
  function setColumns(id: string, raw: string) {
    const parsed = raw === "" ? null : Number.parseInt(raw, 10);
    const columns = parsed !== null && parsed >= 1 && parsed <= MAX_COLUMNS ? parsed : null;
    applyCategories(
      catsRef.current.map((category) => (category.id === id ? { ...category, columns } : category))
    );
  }

  function addCategory() {
    // 改名中按下新增：先存起正在編輯的名稱（輸入框卸載不會觸發 onBlur）
    if (editingId !== null) commitRename();
    const id = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const name = `分類 ${catsRef.current.length}`;
    applyCategories([
      ...catsRef.current,
      { id, name, defaultCollapsed: false, collapsed: false, columns: null, rows: [] },
    ]);
    skipBlurRef.current = false;
    setEditingId(id);
    setRenameValue(name);
  }

  function confirmDelete() {
    const id = deleteId;
    setDeleteId(null);
    if (id === null) return;
    const current = catsRef.current;
    const removed = current.find((category) => category.id === id);
    if (!removed) return;
    const next = current
      .filter((category) => category.id !== id)
      .map((category) =>
        category.id === UNCATEGORIZED_ID
          ? {
              ...category,
              rows: [...category.rows, ...removed.rows.filter((row) => row.length > 0)],
            }
          : category
      );
    if (editingId === id) setEditingId(null);
    applyCategories(next);
  }

  /**
   * 目前要顯示的分類：一般模式隱藏空白分類（含空白的預設分類），編輯模式全部顯示（才能拖入）；
   * alwaysShowHeadings 時預設分類即使空白也保留（名稱永遠顯示）。
   */
  const visibleCategories = useMemo(
    () =>
      editMode
        ? categories
        : categories.filter(
            (category) =>
              category.rows.some((row) => row.length > 0) ||
              (alwaysShowHeadings && category.id === UNCATEGORIZED_ID)
          ),
    [categories, editMode, alwaysShowHeadings]
  );
  /** 只有一個分類時不顯示標題列（畫面與無分類時相同）；編輯模式與 alwaysShowHeadings 一律顯示 */
  const showHeadings = editMode || alwaysShowHeadings || visibleCategories.length > 1;
  const deleteTarget = deleteId === null ? null : categories.find((c) => c.id === deleteId) ?? null;

  return (
    <>
      {/* 拖曳提示 ＋ 編輯入口（說明文字列最右端的鉛筆圖示） */}
      <div className={`${AREA_WIDTH_CLASS} mb-4 flex items-start justify-between gap-3`}>
        <p className="text-sm text-t3">{editMode ? EDIT_HINT : hint}</p>
        <button
          type="button"
          onClick={() => {
            setEditMode((value) => !value);
            setEditingId(null);
            setDeleteId(null);
          }}
          aria-pressed={editMode}
          aria-label={editMode ? "完成編輯" : "編輯分類"}
          title={editMode ? "完成編輯" : "編輯分類"}
          className="shrink-0 rounded-md p-1 text-t3 transition cursor-pointer hover:bg-hover hover:text-t2"
        >
          {editMode ? <CheckIcon /> : <PencilIcon />}
        </button>
      </div>

      <div
        ref={gridRef}
        className={`select-none ${gridClassName}`}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
      >
        {visibleCategories.map((category) => {
          const count = category.rows.reduce((total, row) => total + row.length, 0);
          const headingHighlighted =
            dropHint?.type === "category" && dropHint.category === category.id;
          const highlightedRow =
            dropHint?.type === "row" && dropHint.category === category.id ? dropHint.row : -1;
          const boxHighlighted =
            dropHint?.type === "catBox" && dropHint.category === category.id;
          const isCatDragging = catDragId === category.id;
          // 分類框寬度：自由＝吃滿整行；設每行張數＝上限 N 張卡（窄螢幕靠 min(100%) 自動縮）
          const boxStyle = {
            ...(category.columns === null
              ? { width: "100%" }
              : {
                  width: `min(100%, calc(${category.columns} * ${CARD_WIDTH} + ${category.columns - 1} * ${CARD_GAP_PX}px))`,
                }),
            ...(boxHighlighted ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined),
          };

          const rowsBlock = (
            <div className="flex flex-col gap-y-6">
              {category.rows.map((row, rowIndex) => {
                const highlighted = highlightedRow === rowIndex;
                return (
                  <div
                    key={rowIndex}
                    className="flex flex-wrap gap-4 justify-start rounded-lg max-[734px]:justify-center"
                    style={highlighted ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined}
                  >
                    {row
                      .map((id) => itemById.get(id))
                      .filter((item): item is ModuleCardItem => Boolean(item))
                      .map((item) => {
                        const isDragging = dragId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            data-card-id={item.id}
                            onClick={() => openModule(item)}
                            onPointerDown={() => {
                              suppressClickRef.current = false;
                            }}
                            style={{ width: CARD_WIDTH }}
                            className={`relative flex items-center gap-3 border border-themed rounded-lg p-4 pr-10 bg-hover transition cursor-pointer text-left select-none shrink-0${
                              isDragging ? " opacity-60" : ""
                            }`}
                          >
                            <span className="text-t3 shrink-0">{item.icon}</span>
                            <span
                              className="font-medium text-t2 truncate shrink-0"
                              style={{ width: LABEL_WIDTH }}
                            >
                              {item.id === "recreation" ? (
                                <>
                                  休閒歡樂
                                  <span className="inline-block rotate-[30deg] ml-[3px]">誠</span>
                                </>
                              ) : (
                                item.label
                              )}
                            </span>
                            <span
                              onPointerDown={(event) => handlePointerDown(event, item.id)}
                              title="拖曳以調整順序"
                              aria-hidden="true"
                              className="absolute inset-y-0 right-0 flex w-7 items-center justify-center text-t3 cursor-grab active:cursor-grabbing touch-none"
                            >
                              <DragHandleIcon />
                            </span>
                          </button>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          );

          if (!showHeadings) {
            return (
              <div
                key={category.id}
                data-category-id={category.id}
                style={boxStyle}
                className={isCatDragging ? "opacity-60" : undefined}
              >
                {rowsBlock}
              </div>
            );
          }

          return (
            <details
              key={category.id}
              data-category-id={category.id}
              open={!category.collapsed}
              onToggle={(event) => {
                const nowOpen = event.currentTarget.open;
                if (nowOpen === !category.collapsed) return;
                applyCategories(
                  catsRef.current.map((entry) =>
                    entry.id === category.id ? { ...entry, collapsed: !nowOpen } : entry
                  )
                );
              }}
              style={boxStyle}
              className={`flex flex-col gap-y-3 border-0! p-0!${isCatDragging ? " opacity-60" : ""}`}
            >
              <summary
                data-category-heading={category.id}
                className="flex flex-wrap cursor-pointer list-none items-center gap-2 rounded-lg px-1 py-1 select-none"
                style={
                  headingHighlighted ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined
                }
                onClick={(event) => {
                  // 分類拖曳後的那一次 click 不觸發收合
                  if (suppressSummaryClickRef.current) {
                    event.preventDefault();
                    suppressSummaryClickRef.current = false;
                  }
                }}
              >
                {/* 分類拖曳握把（比照卡片常駐）：置於標題列最左，點擊本身不觸發收合 */}
                <span
                  onPointerDown={(event) => handleCategoryPointerDown(event, category.id)}
                  onClick={(event) => event.preventDefault()}
                  title="拖曳以調整分類位置"
                  aria-hidden="true"
                  className="flex w-6 shrink-0 items-center justify-center text-t3 cursor-grab active:cursor-grabbing touch-none"
                >
                  <DragHandleIcon />
                </span>
                <DisclosureArrow />
                {editingId === category.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        skipBlurRef.current = true;
                        setEditingId(null);
                      }
                    }}
                    onBlur={() => {
                      if (skipBlurRef.current) {
                        skipBlurRef.current = false;
                        return;
                      }
                      commitRename();
                    }}
                    className="w-40 max-w-[50vw] rounded border border-themed bg-page px-2 py-0.5 text-sm font-medium text-t1 outline-none select-text"
                    aria-label={`分類名稱：${category.name}`}
                  />
                ) : (
                  <span
                    className={`font-medium text-t1 truncate min-w-0${editMode ? " cursor-text hover:text-t2" : ""}`}
                    onClick={
                      editMode
                        ? (event) => {
                            event.preventDefault();
                            startRename(category);
                          }
                        : undefined
                    }
                  >
                    {category.name}
                  </span>
                )}
                <span className="text-xs font-normal text-t3">{count} 張卡片</span>
                {editMode && (
                  <span
                    className="ml-auto flex items-center gap-1"
                    onClick={(event) => event.preventDefault()}
                  >
                    <select
                        value={category.columns === null ? "" : String(category.columns)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setColumns(category.id, event.target.value)}
                        title="每行最多張數：自由＝吃滿整行；數字＝分類寬度上限 N 張卡，每行 1~N 張、超過自動折行（仍可拖到行間隙另起一行）"
                        aria-label={`「${category.name}」每行最多張數`}
                        className="rounded border border-themed bg-page px-1 py-0.5 text-xs text-t2 cursor-pointer"
                      >
                        <option value="">自由</option>
                        {[1, 2, 3, 4, 5, 6].map((value) => (
                          <option key={value} value={value}>
                            最多 {value} 張
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => startRename(category)}
                        title="重新命名分類"
                        aria-label={`重新命名「${category.name}」`}
                        className="rounded p-1 text-t3 transition cursor-pointer hover:bg-hover hover:text-t2"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleDefaultCollapsed(category.id)}
                        title="切換此分類的預設收合狀態（變更時會立即套用到目前狀態）"
                        aria-label={`「${category.name}」目前${category.defaultCollapsed ? "預設收合" : "預設展開"}，按一下切換`}
                        className="rounded border border-themed px-2 py-0.5 text-xs text-t2 transition cursor-pointer hover:bg-hover"
                      >
                        {category.defaultCollapsed ? "預設收合" : "預設展開"}
                      </button>
                      {category.id !== UNCATEGORIZED_ID && (
                        <button
                          type="button"
                          onClick={() => setDeleteId(category.id)}
                          title="刪除分類（卡片退回未分類）"
                          aria-label={`刪除「${category.name}」`}
                          className="rounded p-1 text-t3 transition cursor-pointer hover:bg-hover hover:text-danger"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </span>
                )}
                {defaultCategoryNote && category.id === UNCATEGORIZED_ID && (
                  <span className="w-full pl-9 text-xs leading-relaxed">
                    {defaultCategoryNote}
                  </span>
                )}
              </summary>
              {rowsBlock}
            </details>
          );
        })}

        {/* 另起一行的放置指示線（絕對定位，不影響版面）；卡片落點限定分類框內時指示線也限定該框寬度 */}
        {dropHint?.type === "gap" && (
          <div
            aria-hidden="true"
            className="absolute h-0.5 rounded-full -translate-y-1/2 pointer-events-none"
            style={{
              top: dropHint.top,
              left: dropHint.left ?? 0,
              right: dropHint.right ?? 0,
              background: "var(--primary)",
            }}
          />
        )}
      </div>

      {/* 編輯模式：新增分類 */}
      {editMode && (
        <div className={AREA_WIDTH_CLASS}>
          <button
            type="button"
            onClick={addCategory}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
          >
            ＋ 新增分類
          </button>
        </div>
      )}

      {/* 刪除分類確認 modal：取代原生 confirm，樣式跟隨主題 */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
          onClick={() => setDeleteId(null)}
        >
          <div
            className="bg-card rounded-2xl p-6 w-full max-w-md space-y-4 shadow-lg animate-fade-in"
            role="alertdialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <h3 className="text-lg font-bold text-t1">刪除分類</h3>
              <p className="text-sm text-t2 mt-2">
                刪除「{deleteTarget.name}」後，其中的卡片會退回未分類。確定刪除？
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteId(null)}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="btn-danger rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
