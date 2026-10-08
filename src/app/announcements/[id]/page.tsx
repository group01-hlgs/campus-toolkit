"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchSettings } from "@/lib/settings-client";
import { defaultSettings } from "@/types/settings";
import Copyright from "@/components/Copyright";

interface AnnouncementDetail {
  id: string;
  title: string;
  body: string;
  categoryId: string;
  categoryName: string;
  authorName: string;
  publishAt: number;
  expireAt?: number;
  pinned: boolean;
  isPublic: boolean;
  classScoped: boolean;
}

type FontSize = "small" | "medium" | "large";

const FONT_SIZE_LABELS: Record<FontSize, string> = {
  small: "小",
  medium: "中",
  large: "大",
};

const FONT_SIZE_CLASSES: Record<FontSize, { title: string; body: string; meta: string }> = {
  small: {
    title: "text-base",
    body: "text-sm",
    meta: "text-sm",
  },
  medium: {
    title: "text-lg",
    body: "text-base",
    meta: "text-base",
  },
  large: {
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
 * 單則公告內容頁（顯示位置「跳出新頁」用）。
 * 版面比照系統設定外殼（標題區域＋內容卡片），但不提供返回功能頁與登出按鈕。
 * 權限由 API 端繼承顯示位置的閱讀規則（公開不需登入；其餘依身分／班級）。
 */
export default function AnnouncementDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const [settings, setSettings] = useState(defaultSettings);
  const [announcement, setAnnouncement] = useState<AnnouncementDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fontSize, setFontSize] = useState<FontSize>("small");

  useEffect(() => {
    setFontSize(readStoredFontSize());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((data) => {
        if (cancelled || !data?.success || !data.settings) return;
        setSettings({ ...defaultSettings, ...data.settings });
      })
      .catch(() => {
        // 設定讀失敗不擋內容
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!id) {
      setError("查無此公告");
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/announcements/${id}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.success && data.announcement) {
          setAnnouncement(data.announcement);
        } else {
          setError(data?.message || "查無此公告");
        }
      })
      .catch(() => {
        if (!cancelled) setError("載入公告失敗");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function changeFontSize(size: FontSize) {
    setFontSize(size);
    try {
      window.localStorage.setItem(STORAGE_KEY, size);
    } catch {
      // localStorage 不可用時僅本次生效
    }
  }

  const sizes = FONT_SIZE_CLASSES[fontSize];

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      {/* 標題區域（比照系統設定外殼） */}
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">
          {settings.academicYear} 學年度 第{settings.semester}學期
        </p>
      </div>

      {/* 功能標題 */}
      <div className="w-full max-w-4xl mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">公告內容</h2>
      </div>

      <hr className="w-full max-w-4xl border-themed mb-4" />

      {/* 內容卡片 */}
      <div className="w-full max-w-4xl mb-8">
        {loading ? (
          <div className="border border-themed rounded-lg bg-card p-8 text-center">
            <p className="text-t3">載入中...</p>
          </div>
        ) : error ? (
          <div className="border border-themed rounded-lg bg-card p-8 text-center">
            <p className="text-lg font-bold text-t1 mb-2">無法顯示公告</p>
            <p className="text-sm text-t2">{error}</p>
          </div>
        ) : announcement ? (
          <div className="border border-themed rounded-lg bg-card p-6">
            {/* 字級切換 */}
            <div className="flex items-center justify-between gap-3 mb-4">
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
              {announcement.pinned && (
                <span className="text-sm text-primary border border-current rounded px-2 py-0.5">
                  置頂
                </span>
              )}
            </div>

            {/* 標題 */}
            <h3 className={`${sizes.title} font-bold text-t1 mb-2`}>{announcement.title}</h3>

            {/* 資訊列 */}
            <p className={`${sizes.meta} text-t3 mb-4`}>
              {announcement.categoryName}｜{announcement.authorName}
              {announcement.classScoped ? "｜班級公告" : "｜校級"}
              ｜{new Date(announcement.publishAt).toLocaleString("zh-TW")}
            </p>

            {/* 內文 */}
            <div
              className={`${sizes.body} text-t2 whitespace-pre-wrap leading-relaxed`}
            >
              {announcement.body}
            </div>

            {/* 到期資訊 */}
            {announcement.expireAt && (
              <p className={`${sizes.meta} text-t3 mt-4 pt-4 border-t border-themed`}>
                到期時間：{new Date(announcement.expireAt).toLocaleString("zh-TW")}
              </p>
            )}
          </div>
        ) : null}
      </div>

      <hr className="w-full max-w-4xl border-themed mb-4" />

      {/* 版權宣告 */}
      <div className="w-full max-w-4xl mt-auto mb-8">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );
}
