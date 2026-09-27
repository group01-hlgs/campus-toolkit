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

export interface ModuleCardItem {
  /** 穩定識別碼：用於排序與 localStorage，日後改標籤也不會打亂已記住的版面 */
  id: string;
  icon: ReactNode;
  label: string;
  href: string;
}

const DEFAULT_HINT = "拖曳卡片可調整顯示順序，拖到行與行的間隙可另起一行，此瀏覽器會自動記住";

/** 標題可顯示的最大字數（以目前字級，一個中文字＝1em＝16px）；＋2px 縫隙避免字型進位誤差讓剛好12字被截斷 */
const LABEL_MAX_CHARS = 12;
const LABEL_WIDTH = `calc(${LABEL_MAX_CHARS}em + 2px)`; // 192px + 2px

/**
 * 卡片固定寬度（寫死）：左 padding 16 + 圖示 24 + 間距 12 + 標題 12字 192px ＋2px 縫隙
 * + 右側預留（拖曳握把 28 ＋間距 12）40 = 286px。
 */
const CARD_WIDTH = "286px";

/** 卡片區寬度：永遠佔瀏覽器視窗寬度的 80%，卡片固定 286px，超出一條橫列就自動往下折 */
const AREA_WIDTH_CLASS = "w-[80vw] min-w-[286px]";

/** 行與行的距離（px）：比卡片間距 16px 大，用來區隔「行」，同時也是拖到行間隙的判定範圍 */
const ROW_GAP_PX = 24;

/** 指標超出卡片區多少距離內仍算數（拖到頁面角落時不動作，避免誤建新行） */
const EDGE_MARGIN_PX = ROW_GAP_PX;

/** 拖曳中的放置提示：間隙＝另起一行（畫指示線），行內＝該行外框 */
type DropHint = { type: "gap"; top: number } | { type: "row"; row: number } | null;

/**
 * 放置目標：
 * - insert：插到指定行的第 index 張卡片之前（index 可等於該行長度＝加到行尾）
 * - newRow：在 (beforeRow, beforeIndex) 之前另起一行；落在同一行的折行處＝把該行從此切開
 */
type DropTarget =
  | { kind: "insert"; row: number; index: number }
  | { kind: "newRow"; beforeRow: number; beforeIndex: number };

/** 視覺上的「一條橫列」：同一行的卡片 top 相同；一行超出寬度折行後會產生多條橫列 */
interface CardLine {
  top: number;
  bottom: number;
  /** 此橫列所屬的模型行索引 */
  row: number;
  cards: { id: string; rect: DOMRect }[];
}

interface Geometry {
  grid: DOMRect;
  cardRects: Map<string, DOMRect>;
  lines: CardLine[];
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

/** 對齊目前的卡片清單：清掉已不存在的卡片、去重，新增的卡片補到最後一行末尾 */
function reconcileRows(source: string[][], ids: string[]): string[][] {
  const known = new Set(ids);
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const row of source) {
    const kept = row.filter((id) => known.has(id) && !seen.has(id));
    if (kept.length === 0) continue;
    for (const id of kept) seen.add(id);
    rows.push(kept);
  }
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    if (rows.length === 0) rows.push(missing);
    else rows[rows.length - 1] = [...rows[rows.length - 1], ...missing];
  }
  return rows;
}

function sameHint(a: DropHint, b: DropHint): boolean {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "row" && b.type === "row") return a.row === b.row;
  if (a.type === "gap" && b.type === "gap") return Math.abs(a.top - b.top) < 0.5;
  return false;
}

/**
 * 功能首頁的入口卡片網格：卡片分成「行」保存，行內超出視窗寬度就自動往下折。
 * 可拖曳調整順序、拖到行與行的間隙另起一行，版面存入 localStorage（每張卡片以 data-card-id 識別）。
 *
 * 實作要點：
 * - 版面模型是二維 string[][]（rows）；行的內容由使用者拖曳決定，視窗寬度只影響折行、不會重排行。
 * - 全程使用 Pointer Events，滑鼠與手指（觸控）走同一套邏輯；不依賴 HTML5 拖曳 API（其不支援觸控）。
 * - 指標捕捉掛在「不會被搬動」的網格容器上，拖曳中 React 重排子節點也不會中斷事件。
 * - 每次 pointermove 都重新量測：跨行搬移與另起一行都會改變列高，
 *   所以結構真的改變時用 flushSync 同步重繪，確保下一次 pointermove 量到的是最新版面。
 * - 卡片區固定佔瀏覽器寬度 80%（AREA_WIDTH_CLASS），卡片本身寫死 286px 不隨視窗縮放；
 *   行內用 flex-wrap 自動折行，畫面越寬每條橫列放得下越多張；小螢幕每行只剩 1 張時左右置中。
 * - 全部使用主題類別（border-themed／bg-hover／text-t1~t3／opacity），未寫死色票。
 */
export default function DraggableModuleGrid({
  items,
  storageKey,
  hint = DEFAULT_HINT,
  gridClassName = `${AREA_WIDTH_CLASS} relative flex flex-col gap-y-6 mb-8`,
}: {
  items: ModuleCardItem[];
  storageKey: string;
  hint?: string;
  gridClassName?: string;
}) {
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [rows, setRows] = useState<string[][]>(() => [items.map((item) => item.id)]);
  const rowsRef = useRef<string[][]>(rows);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item] as const)), [items]);

  // 載入此瀏覽器記住的版面（延後到掛載後執行，避免 SSR 與用戶端渲染不一致）
  useEffect(() => {
    let parsed: unknown;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      parsed = JSON.parse(raw);
    } catch {
      // 無法存取或資料毀損時維持預設版面
      return;
    }
    let restored: string[][] = [];
    if (Array.isArray(parsed) && parsed.every((entry) => Array.isArray(entry))) {
      // 二維格式：每行一個字串陣列
      restored = (parsed as unknown[][]).map((row) =>
        row.filter((value): value is string => typeof value === "string")
      );
    } else if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      // 舊版一維格式：全部視為同一行，排法與舊版 flex-wrap 完全相同，日後由使用者自行拖出分行
      restored = [parsed as string[]];
    } else {
      return;
    }
    const next = reconcileRows(restored, items.map((item) => item.id));
    if (next.length === 0) return;
    rowsRef.current = next;
    setRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // 卡片有增減時（例如功能改版）同步到版面：新卡片補到最後一行末尾
  useEffect(() => {
    const next = reconcileRows(rowsRef.current, items.map((item) => item.id));
    if (JSON.stringify(next) === JSON.stringify(rowsRef.current)) return;
    rowsRef.current = next;
    setRows(next);
  }, [items]);

  function persist() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(rowsRef.current));
    } catch {
      // 私隱模式或儲存空間不足時忽略
    }
  }

  function locateCard(id: string): { row: number; index: number } | null {
    const current = rowsRef.current;
    for (let row = 0; row < current.length; row++) {
      const index = current[row].indexOf(id);
      if (index >= 0) return { row, index };
    }
    return null;
  }

  /** 量測目前版面：所有卡片座標，以及依視覺橫列分組的資料（用來判定間隙與折行處） */
  function collectGeometry(): Geometry | null {
    const grid = gridRef.current;
    if (!grid) return null;
    const cardRects = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>("[data-card-id]").forEach((element) => {
      const id = element.dataset.cardId;
      if (id) cardRects.set(id, element.getBoundingClientRect());
    });
    const lines: CardLine[] = [];
    rowsRef.current.forEach((row, rowIndex) => {
      let current: CardLine | null = null;
      for (const id of row) {
        const rect = cardRects.get(id);
        if (!rect) continue;
        if (!current || Math.abs(rect.top - current.top) > 1) {
          current = { top: rect.top, bottom: rect.bottom, row: rowIndex, cards: [] };
          lines.push(current);
        }
        current.cards.push({ id, rect });
        current.top = Math.min(current.top, rect.top);
        current.bottom = Math.max(current.bottom, rect.bottom);
      }
    });
    return { grid: grid.getBoundingClientRect(), cardRects, lines };
  }

  /** 依放置目標算出新版面；沒有實際變化時回傳 null */
  function buildRows(
    draggedId: string,
    target: DropTarget
  ): { rows: string[][]; row: number } | null {
    const current = rowsRef.current;
    const from = locateCard(draggedId);
    if (!from) return null;

    // 先把拖曳卡片拿掉（必要時連同被清空的行一起移除），再依目標放回去
    const next = current.map((row) => row.slice());
    const [movedId] = next[from.row].splice(from.index, 1);
    const sourceCleared = next[from.row].length === 0;
    if (sourceCleared) next.splice(from.row, 1);
    if (next.length === 0) return null;

    let row: number;
    let index: number;
    if (target.kind === "insert") {
      // 目標行就是被清空的那一行＝放回原處，沒有變化
      if (sourceCleared && target.row === from.row) return null;
      row = target.row;
      index = target.index;
    } else {
      if (sourceCleared && target.beforeRow === from.row) return null;
      row = target.beforeRow;
      index = target.beforeIndex;
    }
    // 座標換算到「拿掉之後」的版面
    if (sourceCleared && from.row < row) row -= 1;
    if (!sourceCleared && row === from.row && index > from.index) index -= 1;
    row = Math.max(0, Math.min(row, next.length - 1));

    if (target.kind === "insert") {
      next[row].splice(Math.max(0, Math.min(index, next[row].length)), 0, movedId);
    } else if (index <= 0) {
      next.splice(row, 0, [movedId]);
    } else if (index >= next[row].length) {
      next.splice(row + 1, 0, [movedId]);
    } else {
      // 落在行的中間：把該行從此切開，新行放中間
      next.splice(row, 1, next[row].slice(0, index), [movedId], next[row].slice(index));
    }

    const cleaned = next.filter((entry) => entry.length > 0);
    if (cleaned.length === 0) return null;
    if (JSON.stringify(cleaned) === JSON.stringify(current)) return null;
    const landed = cleaned.findIndex((entry) => entry.includes(movedId));
    return { rows: cleaned, row: Math.max(0, landed) };
  }

  /** 套用放置：結構改變時同步重繪，讓緊接著的 pointermove 量到新版面 */
  function place(draggedId: string, target: DropTarget, hint: DropHint) {
    const result = buildRows(draggedId, target);
    if (!result) {
      if (!sameHint(dropHint, hint)) setDropHint(hint);
      return;
    }
    flushSync(() => {
      rowsRef.current = result.rows;
      setRows(result.rows);
      setDropHint(hint && hint.type === "row" ? { type: "row", row: result.row } : hint);
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLSpanElement>, id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
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
    const draggedId = dragIdRef.current;
    if (draggedId === null) return;
    movedRef.current = true;
    const geometry = collectGeometry();
    if (!geometry) return;
    const x = event.clientX;
    const y = event.clientY;
    const { grid, cardRects, lines } = geometry;

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
      place(draggedId, { kind: "insert", row: at.row, index }, { type: "row", row: at.row });
      return;
    }

    // 2) 指標在某條橫列範圍內（該列左右的空白）：插到該行最接近的位置
    const line = lines.find((entry) => y >= entry.top && y <= entry.bottom);
    if (line) {
      const rowIds = rowsRef.current[line.row] ?? [];
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
      place(draggedId, { kind: "insert", row: line.row, index }, { type: "row", row: line.row });
      return;
    }

    // 3) 指標在橫列之間的間隙：在該處另起一行（同一行的折行處＝把該行切開）
    const below = lines.findIndex((entry) => entry.top > y);
    let target: DropTarget;
    let top: number;
    if (below === -1) {
      // 最後一條橫列下方
      const last = lines[lines.length - 1];
      if (!last) return;
      const rowIds = rowsRef.current[last.row] ?? [];
      target = { kind: "newRow", beforeRow: last.row, beforeIndex: rowIds.length };
      top = last.bottom + ROW_GAP_PX / 2;
    } else {
      const nextLine = lines[below];
      const previousLine = below > 0 ? lines[below - 1] : null;
      const firstId = nextLine.cards[0]?.id;
      if (!firstId) return;
      const at = locateCard(firstId);
      if (!at) return;
      target = { kind: "newRow", beforeRow: at.row, beforeIndex: at.index };
      top = previousLine ? (previousLine.bottom + nextLine.top) / 2 : nextLine.top - ROW_GAP_PX / 2;
    }
    place(draggedId, target, { type: "gap", top: top - grid.top });
  }

  function handlePointerEnd() {
    if (dragIdRef.current === null) return;
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
    router.push(item.href);
  }

  return (
    <>
      {/* 拖曳提示 */}
      <div className={`${AREA_WIDTH_CLASS} mb-4`}>
        <p className="text-sm text-t3">{hint}</p>
      </div>

      <div
        ref={gridRef}
        className={`select-none ${gridClassName}`}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
      >
        {rows.map((row, rowIndex) => {
          const highlighted = dropHint?.type === "row" && dropHint.row === rowIndex;
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
                        {item.label}
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

        {/* 另起一行的放置指示線（絕對定位，不影響版面） */}
        {dropHint?.type === "gap" && (
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 h-0.5 rounded-full -translate-y-1/2 pointer-events-none"
            style={{ top: dropHint.top, background: "var(--primary)" }}
          />
        )}
      </div>
    </>
  );
}
