"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ReminderSummary {
  count: number;
  titles: string[];
}

/**
 * 首頁公告提醒鈴鐺（期 C）：
 * 讀取個人仍有效的提醒，有內容時顯示數量徽章；點擊進入公告頁。
 * 非系統推播——使用者打開首頁時才會更新。
 * 管理員於「公告管理設定」關閉個人提醒時不渲染（待設定回應後才顯示，避免閃現）。
 */
export default function AnnouncementReminderBell({
  role,
  href,
}: {
  role: string;
  href: string;
}) {
  const [summary, setSummary] = useState<ReminderSummary | null>(null);
  // null＝尚未取得開關值；false＝管理員已停用個人提醒（不顯示鈴鐺）
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/announcements/reminders", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data?.success) {
          // 查詢失敗／未取得開關：維持顯示（fail-open）
          setEnabled(true);
          return;
        }
        setEnabled(data.remindersEnabled !== false);
        if (data.remindersEnabled === false) return;
        const items = Array.isArray(data.items) ? data.items : [];
        setSummary({
          count: items.length,
          titles: items.slice(0, 5).map((item: { title?: string }) => item.title || ""),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setEnabled(true);
        setSummary({ count: 0, titles: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  // 開關值未確定前先不渲染：停用時不會先閃現再消失
  if (enabled !== true) return null;

  const count = summary?.count ?? 0;
  const tip =
    count > 0
      ? `公告提醒 ${count} 則：\n${summary?.titles.join("\n")}`
      : "目前沒有公告提醒";

  return (
    <Link
      href={href}
      title={tip}
      aria-label={count > 0 ? `公告提醒，${count} 則` : "公告提醒"}
      className="relative inline-flex items-center justify-center w-10 h-10 rounded-full border border-themed text-t2 hover:text-t1 hover:border-t1"
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-danger text-white text-xs flex items-center justify-center">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
