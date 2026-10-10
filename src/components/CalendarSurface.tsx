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
 * 版面：標題「行事曆」右側＝翻頁箭頭（2 則以上才出現，水平左右排列；
 * 一次只顯示 1 條，標題連到「單筆行程內容頁」`/calendar/[id]`，跳出新頁）
 * ＋「進入行事曆」入口 SVG（＝行事曆功能首頁，各身分為 `${ROLE_HOME[身分]}/calendar`，
 * 系統首頁未登入連回首頁 `/`）；翻到盡頭再按該方向箭頭時，箭頭符號不變、
 * 只改為「前往行事曆」連結（另一方向仍可折返）。
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
  const [entryDir, setEntryDir] = useState<"prev" | "next" | null>(null);

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

  function goPrev() {
    if (index > 0) {
      setIndex(index - 1);
      setEntryDir(null);
    } else {
      setEntryDir("prev");
    }
  }

  function goNext() {
    if (index < items.length - 1) {
      setIndex(index + 1);
      setEntryDir(null);
    } else {
      setEntryDir("next");
    }
  }

  return (
    <section className={className} aria-label="行事曆">
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-base font-bold text-t1">行事曆</h3>
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          {paged && (
            entryDir === "prev" ? (
              <EntryLink href={entryHref} direction="prev" />
            ) : (
              <button
                type="button"
                onClick={goPrev}
                title="上一則行程"
                aria-label="上一則行程"
                className="p-1 rounded text-t2 hover:text-primary hover:bg-surface cursor-pointer"
              >
                <ArrowIcon direction="prev" />
              </button>
            )
          )}
          {paged && (
            entryDir === "next" ? (
              <EntryLink href={entryHref} direction="next" />
            ) : (
              <button
                type="button"
                onClick={goNext}
                title="下一則行程"
                aria-label="下一則行程"
                className="p-1 rounded text-t2 hover:text-primary hover:bg-surface cursor-pointer"
              >
                <ArrowIcon direction="next" />
              </button>
            )
          )}
          {/* 完整行事曆入口：僅在有實際頁面時顯示（登入頁無頁可開，不出死按鈕） */}
          {calendarHref && (
            <Link
              href={calendarHref}
              title="進入行事曆"
              aria-label="進入行事曆"
              className="p-1 text-t2 hover:text-primary transition"
            >
              <ModuleIcon value="calendar" className="w-5 h-5" />
            </Link>
          )}
        </div>
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
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}

/** 左／右翻頁箭頭 SVG（盡頭時符號不變，僅改為行事曆連結） */
function ArrowIcon({ direction }: { direction: "prev" | "next" }) {
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
        d={direction === "prev" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"}
      />
    </svg>
  );
}

/**
 * 翻到盡頭後，該方向箭頭改為「前往行事曆」連結——
 * 圖示與一般箭頭完全相同（符號一致），僅容器由 button 換成 Link。
 */
function EntryLink({ href, direction }: { href: string; direction: "prev" | "next" }) {
  return (
    <Link
      href={href}
      title="前往行事曆（查看更多行程）"
      aria-label="前往行事曆（查看更多行程）"
      className="p-1 rounded text-primary hover:bg-surface"
    >
      <ArrowIcon direction={direction} />
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
