"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CalendarSurfaceItem } from "@/types/calendar";

/**
 * 公開行事曆視圖（4 模式：月／週／日／清單，預設月）。
 * 資料：GET /api/calendar/public（公開行程，區間查詢）；主題沿用全域 CSS 變數。
 * 週/日模式有 0–23 時間縱軸；全天行程顯示於頂部條帶。純展示，無提醒/編輯功能。
 */

type ViewMode = "month" | "week" | "day" | "list";

const MODE_LABELS: { key: ViewMode; label: string }[] = [
  { key: "month", label: "月" },
  { key: "week", label: "週" },
  { key: "day", label: "日" },
  { key: "list", label: "清單" },
];

const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const HOUR_H = 36; // 每小時列高（px）

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 週起始＝週日（日一二三四五六） */
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  return addDays(x, -x.getDay());
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatMD(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatHM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function isAllDay(ev: CalendarSurfaceItem): boolean {
  return Boolean(ev.allDayDate) || ev.allDay === true;
}

/** 行程佔哪些天（跨日含首尾） */
function eventDayKeys(ev: CalendarSurfaceItem): Set<string> {
  const set = new Set<string>();
  if (ev.allDayDate) {
    // 全天（含跨日 allDayDate 起訖由主程式以單日文件表達；多日以 startAt~endAt 擴充）
    set.add(ev.allDayDate);
  }
  const s = startOfDay(new Date(ev.startAt));
  const e = startOfDay(new Date(ev.endAt && ev.endAt >= ev.startAt ? ev.endAt : ev.startAt));
  for (let d = new Date(s); d.getTime() <= e.getTime(); d = addDays(d, 1)) {
    set.add(dayKey(d));
  }
  return set;
}

function computeRange(mode: ViewMode, cursor: Date): { from: number; to: number } {
  if (mode === "month") {
    const from = startOfMonth(cursor);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    return { from: from.getTime(), to: to.getTime() - 1 };
  }
  if (mode === "week") {
    const from = startOfWeek(cursor);
    const to = addDays(from, 7);
    return { from: from.getTime(), to: to.getTime() - 1 };
  }
  if (mode === "day") {
    const from = startOfDay(cursor);
    const to = addDays(from, 1);
    return { from: from.getTime(), to: to.getTime() - 1 };
  }
  // 清單＝本月
  const from = startOfMonth(cursor);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return { from: from.getTime(), to: to.getTime() - 1 };
}

function rangeTitle(mode: ViewMode, cursor: Date): string {
  const y = cursor.getFullYear();
  const m = cursor.getMonth() + 1;
  if (mode === "month" || mode === "list") return `${y} 年 ${m} 月`;
  if (mode === "week") {
    const from = startOfWeek(cursor);
    const to = addDays(from, 6);
    return `${formatMD(from)} – ${formatMD(to)}`;
  }
  return `${y} 年 ${m} 月${cursor.getDate()} 日`;
}

/** 事件標題圖示（★重要）＋標題（單行截斷） */
function EventChip({ ev, showTime = false }: { ev: CalendarSurfaceItem; showTime?: boolean }) {
  return (
    <a
      href={`/calendar/${ev.id}`}
      className="flex min-w-0 items-center gap-1 text-xs font-medium text-t1 hover:text-primary"
    >
      {ev.important && (
        <span className="text-primary shrink-0" aria-hidden="true">
          ★
        </span>
      )}
      {showTime && <span className="shrink-0 text-t2">{formatHM(ev.startAt)}</span>}
      <span className="truncate">{ev.title}</span>
    </a>
  );
}

export default function PublicCalendarView({
  initialItems,
  initialFrom,
  earliestFrom,
}: {
  initialItems: CalendarSurfaceItem[];
  initialFrom: number;
  /** 最早可瀏覽區間起點（管理員設定的可回溯月數；‹ 鉗制於此） */
  earliestFrom: number;
}) {
  const [mode, setMode] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [items, setItems] = useState<CalendarSurfaceItem[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const initialFromRef = useRef(initialFrom);

  const range = useMemo(() => computeRange(mode, cursor), [mode, cursor]);

  useEffect(() => {
    // 首次渲染：月模式且與 SSR 初始區間相同 → 直接沿用 initialItems
    if (range.from === initialFromRef.current) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/calendar/public?from=${range.from}&to=${range.to}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.success && Array.isArray(data.items)) {
          setItems(data.items);
        }
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  function shift(delta: number) {
    const x = new Date(cursor);
    if (mode === "month" || mode === "list") x.setMonth(x.getMonth() + delta);
    else if (mode === "week") x.setDate(x.getDate() + delta * 7);
    else x.setDate(x.getDate() + delta);
    // 回溯鉗制：往回不可越過管理員設定的最早可瀏覽月初
    if (computeRange(mode, x).from < earliestFrom) {
      setCursor(new Date(earliestFrom));
      return;
    }
    setCursor(x);
  }

  const canGoPrev = range.from > earliestFrom;

  const monthWeeks = useMemo(() => {
    if (mode !== "month") return [];
    const first = startOfMonth(cursor);
    const gridStart = startOfWeek(first);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
    const weeks: Date[][] = [];
    for (let i = 0; i < 6; i++) weeks.push(days.slice(i * 7, i * 7 + 7));
    return weeks;
  }, [mode, cursor]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarSurfaceItem[]>();
    for (const ev of items) {
      for (const key of eventDayKeys(ev)) {
        const list = map.get(key);
        if (list) list.push(ev);
        else map.set(key, [ev]);
      }
    }
    return map;
  }, [items]);

  const dayColumns = useMemo(() => {
    if (mode === "week") {
      const from = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, i) => addDays(from, i));
    }
    if (mode === "day") return [startOfDay(cursor)];
    return [];
  }, [mode, cursor]);

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => shift(-1)}
          disabled={!canGoPrev}
          className="px-2 py-1 rounded border border-themed text-t2 hover:text-t1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="上一段"
          title={canGoPrev ? "上一段" : "已到最早可瀏覽月份"}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setCursor(new Date())}
          className="px-2 py-1 rounded border border-themed text-sm text-t2 hover:text-t1 cursor-pointer"
        >
          今天
        </button>
        <button
          type="button"
          onClick={() => shift(1)}
          className="px-2 py-1 rounded border border-themed text-t2 hover:text-t1 cursor-pointer"
          aria-label="下一段"
        >
          ›
        </button>
        <span className="font-medium text-t1 text-sm sm:text-base">{rangeTitle(mode, cursor)}</span>
        {loading && <span className="text-xs text-t3">載入中…</span>}
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="檢視模式">
        {MODE_LABELS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            aria-pressed={mode === m.key}
            className={`px-2.5 py-1 text-sm rounded border cursor-pointer transition-colors ${
              mode === m.key
                ? "border-primary text-primary font-medium"
                : "border-themed text-t3 hover:text-t1"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );

  const card = (children: ReactNode) => (
    <div className="border border-themed rounded-lg bg-card p-3 sm:p-4">{children}</div>
  );

  // —— 月模式 ——
  if (mode === "month") {
    return (
      <div className="w-full">
        {toolbar}
        {card(
          <div className="grid grid-cols-7 gap-px">
            {WEEK_LABELS.map((label) => (
              <div key={label} className="text-center text-xs font-medium text-t2 py-1">
                {label}
              </div>
            ))}
            {monthWeeks.flat().map((d) => {
              const key = dayKey(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = key === dayKey(new Date());
              const dayEvents = itemsByDay.get(key) ?? [];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setCursor(d);
                    setMode("day");
                  }}
                  className={`min-h-[64px] sm:min-h-[84px] border border-themed rounded p-1 text-left align-top cursor-pointer hover:bg-surface transition ${
                    inMonth ? "bg-card" : "bg-page opacity-50"
                  } ${isToday ? "border-primary" : ""}`}
                  title={isToday ? "今天（點擊看當日）" : "查看當日"}
                >
                  <div className={`text-xs mb-0.5 ${isToday ? "text-primary font-bold" : "text-t2"}`}>
                    {d.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <EventChip key={ev.id} ev={ev} />
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-xs text-t3">+{dayEvents.length - 3} 則</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // —— 週／日模式（時間縱軸 0–23）——
  if (mode === "week" || mode === "day") {
    const gridHeight = 24 * HOUR_H;
    return (
      <div className="w-full">
        {toolbar}
        {card(
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              {/* 垂直捲動容器：表頭／全天／時間軸同容器，捲軸佔的寬度對齊三者一致（否則直線錯位） */}
              <div className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
                {/* 表頭＋全天條帶：垂直捲動時黏在頂端 */}
                <div className="sticky top-0 z-10 bg-card">
                  <div className="flex border-b border-themed">
                    <div className="w-10 shrink-0" />
                    {dayColumns.map((d) => {
                      const isToday = dayKey(d) === dayKey(new Date());
                      return (
                        <div
                          key={dayKey(d)}
                          className={`flex-1 text-center text-xs py-1 border-l border-themed ${
                            isToday ? "text-primary font-bold" : "text-t2"
                          }`}
                        >
                          {WEEK_LABELS[d.getDay()]} {formatMD(d)}
                        </div>
                      );
                    })}
                  </div>
                  {/* 全天條帶 */}
                  {(() => {
                    const allDayEvents = items.filter((ev) =>
                      isAllDay(ev) && dayColumns.some((d) => eventDayKeys(ev).has(dayKey(d)))
                    );
                    return (
                      <div className="flex border-b border-themed">
                        <div className="w-10 shrink-0 text-[10px] text-t3 text-center py-1">全天</div>
                        {dayColumns.map((d) => {
                          const key = dayKey(d);
                          const list = allDayEvents.filter((ev) => eventDayKeys(ev).has(key));
                          return (
                            <div key={key} className="flex-1 min-h-[24px] border-l border-themed px-1 py-0.5 space-y-0.5">
                              {list.map((ev) => (
                                <EventChip key={ev.id} ev={ev} />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
                {/* 時間縱軸＋事件層 */}
                <div className="flex">
                  <div className="w-10 shrink-0" style={{ height: gridHeight }}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="text-[10px] text-t3 text-right pr-1 -mt-1" style={{ height: HOUR_H }}>
                        {String(h).padStart(2, "0")}
                      </div>
                    ))}
                  </div>
                  {dayColumns.map((d) => {
                    const key = dayKey(d);
                    const timed = items.filter((ev) => !isAllDay(ev) && eventDayKeys(ev).has(key));
                    return (
                      <div key={key} className="flex-1 relative border-l border-themed" style={{ height: gridHeight }}>
                        {Array.from({ length: 24 }, (_, h) => (
                          <div key={h} className="border-b border-themed" style={{ height: HOUR_H }} />
                        ))}
                        {timed.map((ev) => {
                          const dayStart = startOfDay(d).getTime();
                          const s = Math.max(ev.startAt, dayStart);
                          const rawEnd = ev.endAt && ev.endAt > ev.startAt ? ev.endAt : ev.startAt + 3_600_000;
                          const e = Math.min(rawEnd, dayStart + 86_400_000);
                          const startMin = (s - dayStart) / 60_000;
                          const durMin = Math.max((e - s) / 60_000, 15);
                          const top = (startMin / 60) * HOUR_H;
                          const height = Math.max((durMin / 60) * HOUR_H, 18);
                          return (
                            <a
                              key={ev.id}
                              href={`/calendar/${ev.id}`}
                              className="absolute left-0.5 right-0.5 rounded border border-themed bg-surface px-1 py-0.5 overflow-hidden hover:border-primary transition"
                              style={{ top, height }}
                              title={`${formatHM(ev.startAt)} ${ev.title}`}
                            >
                              <div className="flex items-center gap-0.5 text-[11px] font-medium text-t1 min-w-0">
                                {ev.important && (
                                  <span className="text-primary shrink-0" aria-hidden="true">
                                    ★
                                  </span>
                                )}
                                <span className="shrink-0 text-t2">{formatHM(ev.startAt)}</span>
                                <span className="truncate">{ev.title}</span>
                              </div>
                            </a>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // —— 清單模式 ——
  const monthEvents = [...items].sort((a, b) => a.startAt - b.startAt);
  return (
    <div className="w-full">
      {toolbar}
      {card(
        monthEvents.length === 0 ? (
          <p className="text-center text-t3 py-6">本月沒有公開行程</p>
        ) : (
          <ul className="space-y-1.5">
            {monthEvents.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center gap-1.5 text-sm border-b border-themed pb-1.5 last:border-0 last:pb-0"
              >
                {ev.important && (
                  <span className="text-primary shrink-0" aria-hidden="true">
                    ★
                    <span className="sr-only">重要</span>
                  </span>
                )}
                <span className="shrink-0 text-t2">
                  {isAllDay(ev) ? formatMD(new Date(ev.startAt)) : `${formatMD(new Date(ev.startAt))} ${formatHM(ev.startAt)}`}
                  ｜
                </span>
                <a
                  href={`/calendar/${ev.id}`}
                  className="inline-flex min-w-0 flex-1 items-center font-medium text-t1 hover:text-primary"
                >
                  <span className="truncate">{ev.title}</span>
                </a>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
