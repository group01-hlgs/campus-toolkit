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
  enablePinned?: boolean;
  items?: AnnouncementSurfaceItem[];
}

type FontSize = "small" | "medium" | "large";

const FONT_SIZE_LABELS: Record<FontSize, string> = {
  small: "小",
  medium: "中",
  large: "大",
};

/** 字級對照：原尺寸為基準，小=+15%、中=+40%、大=+90% */
const FONT_SIZE_CLASSES: Record<FontSize, { heading: string; title: string; body: string; meta: string }> = {
  small: {
    heading: "text-base",
    title: "text-base",
    body: "text-sm",
    meta: "text-sm",
  },
  medium: {
    heading: "text-lg",
    title: "text-lg",
    body: "text-base",
    meta: "text-base",
  },
  large: {
    heading: "text-xl",
    title: "text-2xl",
    body: "text-xl",
    meta: "text-xl",
  },
};

const STORAGE_KEY = "announcement-font-size";

function readStoredFontSize(): FontSize {
  if (typeof window === "undefined") return "small";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "medium" || raw === "large" ? raw : "small";
}

/**
 * 系統公告顯示位置（5 處共用）：
 * 系統首頁登入表單上方、四種身分功能首頁（切換身分下拉選單下方、第一個登出按鈕上方）。
 * 顯示與否／方式（清單／「清單，置頂公告橫幅」／橫幅）／筆數由「系統公告」逐處設定。
 * 清單＝單行（日期｜分類｜標題 20 字內）；
 * 「清單，置頂公告橫幅」＝置頂三行卡片＋其餘單行；橫幅＝全部三行卡片。
 * 字級由使用者以標題旁「小／中／大」切換，存 localStorage。
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
  const [fontSize, setFontSize] = useState<FontSize>("small");
  const [enablePinned, setEnablePinned] = useState(true);

  useEffect(() => {
    setFontSize(readStoredFontSize());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/announcements/surface?surface=${surface}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SurfaceResponse | null) => {
        if (cancelled || !data?.success) return;
        setSetting(data.surface ?? null);
        setEnablePinned(data.enablePinned !== false);
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

  const sizes = FONT_SIZE_CLASSES[fontSize];

  function changeFontSize(size: FontSize) {
    setFontSize(size);
    try {
      window.localStorage.setItem(STORAGE_KEY, size);
    } catch {
      // localStorage 不可用時僅本次生效
    }
  }

  // 標題＋字級切換按鈕放在卡片「外面」，5 處顯示位置一致
  const heading = (
    <div className="flex items-center gap-3 mb-2">
      <h3 className={`${sizes.heading} font-bold text-t1`}>系統公告</h3>
      <div className="flex items-center gap-1" role="group" aria-label="公告字級">
        {(Object.keys(FONT_SIZE_LABELS) as FontSize[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => changeFontSize(key)}
            aria-pressed={fontSize === key}
            className={`px-2 py-0.5 text-sm rounded border cursor-pointer transition-colors ${
              fontSize === key
                ? "border-primary text-primary font-medium"
                : "border-themed text-t3 hover:text-t1"
            }`}
          >
            {FONT_SIZE_LABELS[key]}
          </button>
        ))}
      </div>
    </div>
  );

  // 橫幅（儲存值 marquee）：三行卡片——標題／內容摘要／公告資訊
  // 置頂原則關閉時：橫幅模式退化為清單（無置頂可強調）
  if (setting.method === "marquee" && enablePinned) {
    return (
      <section className={className} aria-label="系統公告">
        {heading}
        <div className="border border-themed rounded-lg bg-card p-4">
          <ul className="space-y-2.5">
            {items.map((item) => (
              <BannerRow key={item.id} item={item} sizes={sizes} />
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // 「清單，置頂公告橫幅」（儲存值 pinnedTop）：
  // 置頂公告＝三行卡片置頂，其餘＝單行清單（完全沒有置頂時全為單行）
  // 置頂原則關閉時：一律以清單樣式呈現
  if (setting.method === "pinnedTop" && enablePinned) {
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
                <BannerRow
                  key={item.id}
                  item={item}
                  showPinnedMark={false}
                  pinnedMarkOnMetaLine={true}
                  sizes={sizes}
                />
              ))}
            </ul>
          )}
          {restItems.length > 0 && (
            <ul className="space-y-1.5">
              {restItems.map((item) => (
                <ListRow key={item.id} item={item} sizes={sizes} />
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
            <ListRow key={item.id} item={item} sizes={sizes} />
          ))}
        </ul>
      </div>
    </section>
  );
}

interface FontSizeClasses {
  heading: string;
  title: string;
  body: string;
  meta: string;
}

/** 三行卡片（橫幅條目；置頂群組不重複標「置頂」） */
function BannerRow({
  item,
  showPinnedMark = true,
  pinnedMarkOnMetaLine = false,
  sizes,
}: {
  item: AnnouncementSurfaceItem;
  showPinnedMark?: boolean;
  /** true＝「置頂」標註改放在第 3 行（公告資訊）最前面 */
  pinnedMarkOnMetaLine?: boolean;
  sizes: FontSizeClasses;
}) {
  return (
    <li className="border-b border-themed pb-2 last:border-0 last:pb-0">
      <div className="flex items-center gap-1.5">
        {showPinnedMark && !pinnedMarkOnMetaLine && item.pinned && (
          <span className={`${sizes.meta} text-primary shrink-0`}>置頂</span>
        )}
        <a
          href={`/announcements/${item.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${sizes.title} font-medium text-t1 truncate hover:text-primary inline-flex items-center gap-1 min-w-0`}
        >
          <span className="truncate">{clipText(item.title, 20)}</span>
          <ExternalLinkIcon />
        </a>
      </div>
      <p className={`${sizes.body} text-t2 mt-0.5 truncate`}>{clipText(item.body, 40)}</p>
      <p className={`${sizes.meta} text-t3 mt-0.5`}>
        {pinnedMarkOnMetaLine && item.pinned && (
          <span className="text-primary font-medium mr-1">置頂</span>
        )}
        {item.categoryName}｜{item.authorName}｜
        {new Date(item.publishAt).toLocaleString("zh-TW")}
      </p>
    </li>
  );
}

/** 單行清單條目（日期｜分類｜標題 20 字內；置頂者標「置頂」） */
function ListRow({ item, sizes }: { item: AnnouncementSurfaceItem; sizes: FontSizeClasses }) {
  return (
    <li
      className={`flex items-center gap-1.5 ${sizes.meta} border-b border-themed pb-1.5 last:border-0 last:pb-0`}
    >
      {item.pinned && (
        <span className="text-primary font-medium shrink-0">置頂</span>
      )}
      <span className="truncate text-t2 min-w-0">
        {new Date(item.publishAt).toLocaleDateString("zh-TW")}｜{item.categoryName}｜
        <a
          href={`/announcements/${item.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-t1 hover:text-primary inline-flex items-center gap-1"
        >
          <span className="truncate">{clipText(item.title, 20)}</span>
          <ExternalLinkIcon />
        </a>
      </span>
    </li>
  );
}

/** 跳出新頁圖示（external-link） */
function ExternalLinkIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0 text-t3 hover:text-primary"
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
