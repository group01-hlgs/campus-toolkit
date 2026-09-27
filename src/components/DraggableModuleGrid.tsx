"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export interface ModuleCardItem {
  /** 穩定識別碼：用於排序與 localStorage，日後改標籤也不會打亂已記住的順序 */
  id: string;
  icon: ReactNode;
  label: string;
  href: string;
}

const DEFAULT_HINT = "拖曳卡片可調整顯示順序，此瀏覽器會自動記住";

/** 標題可顯示的最大字數（以目前字級，一個中文字＝1em＝16px）；＋2px 縫隙避免字型進位誤差讓剛好12字被截斷 */
const LABEL_MAX_CHARS = 12;
const LABEL_WIDTH = `calc(${LABEL_MAX_CHARS}em + 2px)`; // 192px + 2px

/**
 * 卡片固定寬度（寫死）：左 padding 16 + 圖示 24 + 間距 12 + 標題 12字 192px ＋2px 縫隙
 * + 右側預留（拖曳握把 28 ＋間距 12）40 = 286px。
 */
const CARD_WIDTH = "286px";

/** 卡片區寬度：永遠佔瀏覽器視窗寬度的 80%，卡片固定 286px 並自動換行（畫面越寬每行放得下越多張） */
const AREA_WIDTH_CLASS = "w-[80vw] min-w-[286px]";

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

/**
 * 功能首頁的入口卡片網格，可拖曳調整順序並存入 localStorage（每張卡片以 data-card-id 識別）。
 *
 * 實作要點：
 * - 全程使用 Pointer Events，滑鼠與手指（觸控）走同一套邏輯；不依賴 HTML5 拖曳 API（其不支援觸控）。
 * - 指標捕捉掛在「不會被搬動」的網格容器上，拖曳中 React 重排子節點也不會中斷事件。
 * - 拖曳開始時記下各格位座標，之後的 pointermove 只比對座標決定換位，
 *   不需重讀可能尚未重繪的 DOM，故不需 flushSync 強制同步繪製。
 * - 卡片區固定佔瀏覽器寬度 80%（AREA_WIDTH_CLASS），卡片本身寫死 286px 不隨視窗縮放；
 *   容器用 flex-wrap 自動換行，畫面越寬每行放得下越多張（響應式的是視窗與每行張數）。
 * - 全部使用主題類別（border-themed／bg-hover／text-t1~t3／opacity），未寫死色票。
 */
export default function DraggableModuleGrid({
  items,
  storageKey,
  hint = DEFAULT_HINT,
  // 卡片區固定佔瀏覽器寬度 80%；卡片固定 286px，flex-wrap 依可用寬度自動換行（每行張數隨視窗增減）
  gridClassName = `${AREA_WIDTH_CLASS} flex flex-wrap gap-4 mb-8`,
}: {
  items: ModuleCardItem[];
  storageKey: string;
  hint?: string;
  gridClassName?: string;
}) {
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const slotRectsRef = useRef<DOMRect[]>([]);
  const [order, setOrder] = useState<string[]>(() => items.map((item) => item.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const orderRef = useRef<string[]>(order);
  const dragIdRef = useRef<string | null>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);

  // 載入此瀏覽器記住的順序（延後到掛載後執行，避免 SSR 與用戶端渲染不一致）
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const ids = parsed.filter((value): value is string => typeof value === "string");
      if (ids.length === 0) return;
      orderRef.current = ids;
      setOrder(ids);
    } catch {
      // 資料毀損或無法存取時維持預設順序
    }
  }, [storageKey]);

  // 目前顯示順序：先依記住的順序，未記錄／新增的卡片排在後面
  const orderedItems = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item] as const));
    const result: ModuleCardItem[] = [];
    const seen = new Set<string>();
    for (const id of order) {
      const item = byId.get(id);
      if (item && !seen.has(id)) {
        result.push(item);
        seen.add(id);
      }
    }
    for (const item of items) {
      if (!seen.has(item.id)) {
        result.push(item);
        seen.add(item.id);
      }
    }
    return result;
  }, [items, order]);

  /** 顯示順序的 id 列表：記住的順序中仍存在的卡片，加上尚未排過序的新卡片（並清掉已移除卡片的殘留） */
  function displayIds(): string[] {
    const known = new Set(items.map((item) => item.id));
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const id of orderRef.current) {
      if (known.has(id) && !seen.has(id)) {
        ids.push(id);
        seen.add(id);
      }
    }
    for (const item of items) {
      if (!seen.has(item.id)) {
        ids.push(item.id);
        seen.add(item.id);
      }
    }
    return ids;
  }

  /** 把卡片移到指定格位（0 起算，格位＝畫面位置） */
  function moveToSlot(draggedId: string, slotIndex: number) {
    const ids = displayIds();
    if (slotIndex < 0 || slotIndex >= ids.length) return;
    const from = ids.indexOf(draggedId);
    if (from < 0 || from === slotIndex) return;
    ids.splice(from, 1);
    ids.splice(slotIndex, 0, draggedId);
    orderRef.current = ids;
    setOrder(ids);
  }

  function persist() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(orderRef.current));
    } catch {
      // 私隱模式或儲存空間不足時忽略
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLSpanElement>, id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    movedRef.current = false;
    dragIdRef.current = id;
    setDragId(id);
    const grid = gridRef.current;
    if (!grid) return;
    // 拖曳開始時各格位的座標：格位在拖曳中不會位移（卡片只在格位間換位），
    // 因此後續只需比對座標，不必重讀 DOM。
    slotRectsRef.current = [...grid.querySelectorAll<HTMLElement>("[data-card-id]")].map((el) =>
      el.getBoundingClientRect()
    );
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
    const slot = slotRectsRef.current.findIndex(
      (rect) =>
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
    );
    if (slot >= 0) moveToSlot(draggedId, slot);
  }

  function handlePointerEnd() {
    if (dragIdRef.current === null) return;
    // 拖曳後的這一次 click 不導頁（下一次 pointerdown 會重設）
    suppressClickRef.current = movedRef.current;
    persist();
    dragIdRef.current = null;
    setDragId(null);
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
      {/* 拖曳提示（GAS 原版文案） */}
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
        {orderedItems.map((item) => {
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
    </>
  );
}
