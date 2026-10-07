"use client";

import { useEffect, useState } from "react";
import type {
  AnnouncementSurface as AnnouncementSurfaceKey,
  AnnouncementSurfaceItem,
  AnnouncementSurfaceSetting,
} from "@/types/announcements";

interface SurfaceResponse {
  success?: boolean;
  surface?: AnnouncementSurfaceSetting;
  items?: AnnouncementSurfaceItem[];
}

/** 依字數截斷（超出加 ...）；空白整併成單行，供單行／摘要顯示 */
function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max).join("")}...` : chars.join("");
}

/**
 * 系統公告顯示位置（5 處共用）：
 * 系統首頁登入表單上方、四種身分功能首頁（切換身分下拉選單下方、第一個登出按鈕上方）。
 * 顯示與否／方式（清單・橫幅）／筆數由「系統公告管理」逐處設定。
 * 清單＝單行（日期｜分類｜標題 20 字內）；橫幅＝三行（標題 20 字內／摘要 40 字內／公告資訊）。
 */
export default function AnnouncementSurface({
  surface,
  className = "",
}: {
  surface: AnnouncementSurfaceKey;
  className?: string;
}) {
  const [setting, setSetting] = useState<AnnouncementSurfaceSetting | null>(null);
  const [items, setItems] = useState<AnnouncementSurfaceItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/announcements/surface?surface=${surface}`, { cache: "no-store" })
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

  // 標題固定放在卡片「外面」（卡片只包公告條目），5 處顯示位置一致
  const heading = <h3 className="text-sm font-bold text-t1 mb-2">系統公告</h3>;

  // 橫幅（儲存值 marquee）：三行卡片——標題／內容摘要／公告資訊
  if (setting.method === "marquee") {
    return (
      <section className={className} aria-label="系統公告">
        {heading}
        <div className="border border-themed rounded-lg bg-card p-4">
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item.id} className="border-b border-themed pb-2 last:border-0 last:pb-0">
                <div className="flex items-center gap-1.5">
                  {item.pinned && (
                    <span className="text-xs text-success shrink-0">置頂</span>
                  )}
                  <span className="text-sm font-medium text-t1 truncate">
                    {clip(item.title, 20)}
                  </span>
                </div>
                <p className="text-xs text-t2 mt-0.5 truncate">{clip(item.body, 40)}</p>
                <p className="text-xs text-t3 mt-0.5">
                  {item.categoryName}｜{item.authorName}｜
                  {new Date(item.publishAt).toLocaleString("zh-TW")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // 清單（儲存值 list）：單行——日期｜分類｜標題（20 字內）
  return (
    <section className={className} aria-label="系統公告">
      {heading}
      <div className="border border-themed rounded-lg bg-card p-4">
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-1.5 text-xs border-b border-themed pb-1.5 last:border-0 last:pb-0"
            >
              {item.pinned && (
                <span className="text-success font-medium shrink-0">置頂</span>
              )}
              <span className="truncate text-t2 min-w-0">
                {new Date(item.publishAt).toLocaleDateString("zh-TW")}｜{item.categoryName}｜
                <span className="font-medium text-t1">{clip(item.title, 20)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
