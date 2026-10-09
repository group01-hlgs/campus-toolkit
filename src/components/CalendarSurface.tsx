"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
 * 顯示與否由「行事曆 › 設定管理 › 顯示位置」逐處設定；
 * 顯示方式目前統一處理——單一行、顯示尚未結束的第 1 則行程。
 */
export default function CalendarSurface({
  surface,
  className = "",
}: {
  surface: CalendarSurfaceKey;
  className?: string;
}) {
  const [setting, setSetting] = useState<CalendarSurfaceSetting | null>(null);
  const [items, setItems] = useState<CalendarSurfaceItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/calendar/surface?surface=${surface}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SurfaceResponse | null) => {
        if (cancelled || !data?.success) return;
        setSetting(data.surface ?? null);
        setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        // 讀取失敗＝不顯示，不打擾登入／首頁
      });
    return () => {
      cancelled = true;
    };
  }, [surface]);

  if (!setting || !setting.enabled || items.length === 0) return null;

  const item = items[0];
  const href = surface === "login" ? null : `${ROLE_HOME[surface]}/calendar`;

  return (
    <section className={className} aria-label="行程">
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-base font-bold text-t1">近期行程</h3>
        {href && (
          <Link
            href={href}
            className="ml-auto text-sm text-primary hover:underline shrink-0"
            title="查看全部行程"
          >
            全部行程 ›
          </Link>
        )}
      </div>
      <div className="border border-themed rounded-lg bg-card p-4">
        <ul>
          <li className="flex items-center gap-1.5 text-sm border-b border-themed pb-1.5 last:border-0 last:pb-0">
            {item.important && (
              <span className="text-primary shrink-0" aria-hidden="true">
                ★
                <span className="sr-only">重要</span>
              </span>
            )}
            <span className="truncate text-t2 min-w-0">
              {dateLabel(item)}｜{item.categoryName}｜
              {href ? (
                <Link
                  href={href}
                  className="font-medium text-t1 hover:text-primary inline-flex min-w-0"
                >
                  <span className="truncate">{item.title}</span>
                </Link>
              ) : (
                <span className="font-medium text-t1">{item.title}</span>
              )}
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}
