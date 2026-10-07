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

/**
 * 系統公告顯示位置（5 處共用）：
 * 系統首頁登入表單上方、四種身分功能首頁（切換身分下拉選單下方、第一個登出按鈕上方）。
 * 顯示與否／方式（指定筆數清單・橫幅跑馬燈）／筆數由「系統公告管理」逐處設定。
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

  if (setting.method === "marquee") {
    const doubled = [...items, ...items];
    return (
      <section className={className} aria-label="系統公告">
        {heading}
        <div className="border border-themed rounded-lg bg-card px-4 py-2">
          <div className="announcement-marquee flex-1 overflow-hidden">
            <div className="announcement-marquee-track">
              {doubled.map((item, index) => (
                <span key={`${item.id}-${index}`} className="text-sm text-t1">
                  {item.pinned ? "📌 " : ""}
                  {item.title}
                  <span className="text-t3">
                    （{new Date(item.publishAt).toLocaleDateString("zh-TW")}）
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={className} aria-label="系統公告">
      {heading}
      <div className="border border-themed rounded-lg bg-card p-4">
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.id} className="border-b border-themed pb-2 last:border-0 last:pb-0">
              <div className="flex items-start gap-1.5">
                {item.pinned && (
                  <span className="text-xs text-success shrink-0">置頂</span>
                )}
                <span className="text-sm font-medium text-t1">{item.title}</span>
              </div>
              <p className="text-xs text-t2 mt-0.5 line-clamp-2 whitespace-pre-wrap">{item.body}</p>
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
