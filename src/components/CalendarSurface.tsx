"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ModuleIcon from "@/components/ModuleIcon";
import type {
  CalendarSurface as CalendarSurfaceKey,
  CalendarSurfaceItem,
  CalendarSurfaceSetting,
} from "@/types/calendar";
import { ROLE_HOME } from "@/types/users";

interface SurfaceResponse {
  success?: boolean;
  surface?: CalendarSurfaceSetting;
  items?: CalendarSurfaceItem[];
}

function dateLabel(item: CalendarSurfaceItem): string {
  const d = new Date(item.startAt);
  if (item.allDayDate) return d.toLocaleDateString("zh-TW");
  return d.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 行程顯示位置（5 處共用）：
 * 系統首頁登入表單上方、四種身分功能首頁（切換身分下拉選單下方、第一個登出按鈕上方）。
 * 顯示與否與可翻頁則數由「行事曆 › 設定管理 › 顯示位置」逐處設定（筆數預設 5，省流量）。
 *
 * 版面：標題「行事曆」右側固定放「進入行事曆」入口 SVG（＝行事曆功能首頁，
 * 各身分為 `${ROLE_HOME[身分]}/calendar`，系統首頁未登入回首頁 `/`）；
 * 有 2 則以上尚未結束的行程（含今天）時，行程列右側加上下箭頭逐則翻頁
 * （一次只顯示 1 條，標題連到「單筆行程內容頁」`/calendar/[id]`，跳出新頁）；
 * 翻到盡頭再按該方向的箭頭時，該箭頭改為「前往行事曆」連結（另一方向仍可折返）。
 * 行動版（<sm）日期｜類型與標題各佔一行，避免標題被截斷；
 * 沒有行程時只顯示入口，不整塊隱藏（API 異常時同樣只顯示入口）。
 */
export default function CalendarSurface({
  surface,
  className = "",
}: {
  surface: CalendarSurfaceKey;
  className?: string;
}) {
  const [setting, setSetting] = useState<CalendarSurfaceSetting | null>(null);
  const [failed, setFailed] = useState(false);
  const [items, setItems] = useState<CalendarSurfaceItem[]>([]);
  // 目前顯示第幾則（0＝最近）；entryDir＝已按到盡頭、該方向箭頭改為行事曆連結
  const [index, setIndex] = useState(0);
  const [entryDir, setEntryDir] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/calendar/surface?surface=${surface}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SurfaceResponse | null) => {
        if (cancelled) return;
        if (!data?.success) {
          setFailed(true);
          return;
        }
        setSetting(data.surface ?? null);
        setItems(Array.isArray(data.items) ? data.items : []);
        setIndex(0);
        setEntryDir(null);
      })
      .catch(() => {
        // 讀取失敗＝只顯示入口，不打擾登入／首頁
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [surface]);

  // 顯示位置被關閉 → 整塊不出現；載入中（尚未有結果）→ 先不出現，避免關閉時閃一下
  if (setting && !setting.enabled) return null;
  if (!setting && !failed) return null;

  const item = items[Math.min(index, items.length - 1)];
  // 入口：登入後的首頁進各自行事曆；系統首頁（未登入）進回首頁（登入後才能看完整行事曆）
  const calendarHref = surface === "login" ? null : `${ROLE_HOME[surface]}/calendar`;
  const entryHref = calendarHref ?? "/";
  // 2 則以上才出現翻頁箭頭（單則維持原樣，無箭頭可翻）
  const paged = items.length >= 2;

  function goUp() {
    if (index > 0) {
      setIndex(index - 1);
      setEntryDir(null);
    } else {
      setEntryDir("up");
    }
  }

  function goDown() {
    if (index < items.length - 1) {
      setIndex(index + 1);
      setEntryDir(null);
    } else {
      setEntryDir("down");
    }
  }

  return (
    <section className={className} aria-label="行事曆">
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-base font-bold text-t1">行事曆</h3>
        <Link
          href={entryHref}
          title={calendarHref ? "進入行事曆" : "登入後開啟行事曆"}
          aria-label={calendarHref ? "進入行事曆" : "登入後開啟行事曆"}
          className="ml-auto shrink-0 p-1 text-t2 hover:text-primary transition"
        >
          <ModuleIcon value="calendar" className="w-5 h-5" />
        </Link>
      </div>
      {item && (
        <div className="border border-themed rounded-lg bg-card p-4">
          <ul>
            <li className="flex items-center gap-1.5 text-sm border-b border-themed pb-1.5 last:border-0 last:pb-0">
              {item.important && (
                <span className="text-primary shrink-0" aria-hidden="true">
                  ★
                  <span className="sr-only">重要</span>
                </span>
              )}
              {/* 行動版：日期｜類型與標題各一行（標題不被截斷）；sm 以上併回單行 */}
              <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-1.5">
                <span className="block shrink-0 text-t2 sm:inline">
                  {dateLabel(item)}｜{item.categoryName}
                  <span className="hidden sm:inline">｜</span>
                </span>
                <a
                  href={`/calendar/${item.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="查看行程內容（新視窗）"
                  className="inline-flex min-w-0 max-w-full items-center font-medium text-t1 hover:text-primary"
                >
                  <span className="truncate">{item.title}</span>
                  <ExternalLinkIcon />
                </a>
              </div>
              {paged && (
                <div className="flex flex-col shrink-0 gap-0.5 self-center">
                  {entryDir === "up" ? (
                    <EntryLink href={entryHref} direction="up" />
                  ) : (
                    <button
                      type="button"
                      onClick={goUp}
                      title="上一則行程"
                      aria-label="上一則行程"
                      className="p-1 rounded text-t2 hover:text-primary hover:bg-surface cursor-pointer"
                    >
                      <ArrowIcon direction="up" />
                    </button>
                  )}
                  {entryDir === "down" ? (
                    <EntryLink href={entryHref} direction="down" />
                  ) : (
                    <button
                      type="button"
                      onClick={goDown}
                      title="下一則行程"
                      aria-label="下一則行程"
                      className="p-1 rounded text-t2 hover:text-primary hover:bg-surface cursor-pointer"
                    >
                      <ArrowIcon direction="down" />
                    </button>
                  )}
                </div>
              )}
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}

/** 上／下翻頁箭頭 SVG */
function ArrowIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={direction === "up" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
      />
    </svg>
  );
}

/** 翻到盡頭後，該方向箭頭改為「前往行事曆」連結（外框與箭頭同尺寸） */
function EntryLink({ href, direction }: { href: string; direction: "up" | "down" }) {
  return (
    <Link
      href={href}
      title="前往行事曆（查看更多行程）"
      aria-label="前往行事曆（查看更多行程）"
      className="p-1 rounded text-primary hover:bg-surface"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={
            direction === "up"
              ? "M5 15l7-7 7 7M12 8v13" // 上箭頭＋豎線：向上離開
              : "M19 9l-7 7-7-7M12 16V3" // 下箭頭＋豎線：向下離開
          }
        />
      </svg>
    </Link>
  );
}

/** 跳出新頁圖示（external-link，比照公告顯示位置） */
function ExternalLinkIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0 text-t3 hover:text-primary ml-0.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}
