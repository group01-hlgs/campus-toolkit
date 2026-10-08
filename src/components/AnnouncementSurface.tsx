"use client";

import { useEffect, useState } from "react";
import { clipText } from "@/types/announcements";
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
 * 顯示與否／方式（清單／「清單，置頂公告橫幅」／橫幅）／筆數由「系統公告」逐處設定。
 * 清單＝單行（日期｜分類｜標題 20 字內）；
 * 「清單，置頂公告橫幅」＝置頂三行卡片＋其餘單行；橫幅＝全部三行卡片。
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
  const heading = <h3 className="text-2xl font-bold text-t1 mb-2">系統公告</h3>;

  // 橫幅（儲存值 marquee）：三行卡片——標題／內容摘要／公告資訊
  if (setting.method === "marquee") {
    return (
      <section className={className} aria-label="系統公告">
        {heading}
        <div className="border border-themed rounded-lg bg-card p-4">
          <ul className="space-y-2.5">
            {items.map((item) => (
              <BannerRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // 「清單，置頂公告橫幅」（儲存值 pinnedTop）：
  // 置頂公告＝三行卡片置頂，其餘＝單行清單（完全沒有置頂時全為單行）
  if (setting.method === "pinnedTop") {
    const pinnedItems = items.filter((item) => item.pinned);
    const restItems = items.filter((item) => !item.pinned);
    return (
      <section className={className} aria-label="系統公告">
        {heading}
        <div className="border border-themed rounded-lg bg-card p-4 space-y-2.5">
          {pinnedItems.length > 0 && (
            <ul
              className={`space-y-2.5 ${
                restItems.length > 0 ? "border-b border-themed pb-2.5" : ""
              }`}
            >
              {pinnedItems.map((item) => (
                <BannerRow key={item.id} item={item} showPinnedMark={false} />
              ))}
            </ul>
          )}
          {restItems.length > 0 && (
            <ul className="space-y-1.5">
              {restItems.map((item) => (
                <ListRow key={item.id} item={item} />
              ))}
            </ul>
          )}
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
            <ListRow key={item.id} item={item} />
          ))}
        </ul>
      </div>
    </section>
  );
}

/** 三行卡片（橫幅條目；置頂群組不重複標「置頂」） */
function BannerRow({
  item,
  showPinnedMark = true,
}: {
  item: AnnouncementSurfaceItem;
  showPinnedMark?: boolean;
}) {
  return (
    <li className="border-b border-themed pb-2 last:border-0 last:pb-0">
      <div className="flex items-center gap-1.5">
        {showPinnedMark && item.pinned && (
          <span className="text-lg text-primary shrink-0">置頂</span>
        )}
        <span className="text-3xl font-medium text-t1 truncate">
          {clipText(item.title, 20)}
        </span>
      </div>
      <p className="text-2xl text-t2 mt-0.5 truncate">{clipText(item.body, 40)}</p>
      <p className="text-2xl text-t3 mt-0.5">
        {item.categoryName}｜{item.authorName}｜
        {new Date(item.publishAt).toLocaleString("zh-TW")}
      </p>
    </li>
  );
}

/** 單行清單條目（日期｜分類｜標題 20 字內；置頂者標「置頂」） */
function ListRow({ item }: { item: AnnouncementSurfaceItem }) {
  return (
    <li className="flex items-center gap-1.5 text-2xl border-b border-themed pb-1.5 last:border-0 last:pb-0">
      {item.pinned && (
        <span className="text-primary font-medium shrink-0">置頂</span>
      )}
      <span className="truncate text-t2 min-w-0">
        {new Date(item.publishAt).toLocaleDateString("zh-TW")}｜{item.categoryName}｜
        <span className="font-medium text-t1">{clipText(item.title, 20)}</span>
      </span>
    </li>
  );
}
