"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchSettings } from "@/lib/settings-client";
import { defaultSettings } from "@/types/settings";
import { ROLE_HOME, type UserRole } from "@/types/users";
import { fetchSession } from "@/lib/session";
import { clipText, type AnnouncementArchiveItem } from "@/types/announcements";
import ListPagination, { paginate, totalPagesOf } from "@/components/ListPagination";
import PinIcon from "@/components/PinIcon";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";

const DEFAULT_PAGE_SIZE = 10;

interface ArchiveResponse {
  success?: boolean;
  message?: string;
  items?: AnnouncementArchiveItem[];
}

/**
 * 公告專頁（`/announcements`）：5 處顯示位置共用的「全部公告」入口。
 * 顯示位置只按設定筆數展示新公告與置頂公告，本頁不分設定筆數、
 * 回可閱讀的全部公告（未登入＝公開公告；登入者依身分／班級；管理員全部）。
 * 資料一次取回（伺服器 `ARCHIVE_LIMIT` 有界查詢）後，由共用分頁元件純前端切片，
 * 翻頁不增加任何 Firestore 讀取。
 */
export default function AnnouncementArchivePage() {
  const [settings, setSettings] = useState(defaultSettings);
  const [items, setItems] = useState<AnnouncementArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [homeHref, setHomeHref] = useState("/");

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((data) => {
        if (cancelled || !data?.success || !data.settings) return;
        setSettings({ ...defaultSettings, ...data.settings });
      })
      .catch(() => {
        // 設定讀失敗不擋清單
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSession(true)
      .then((session) => {
        if (cancelled || !session) return;
        setHomeHref(ROLE_HOME[session.role as UserRole] ?? "/");
      })
      .catch(() => {
        // 未登入＝留在系統首頁
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/announcements/archive", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: ArchiveResponse) => {
        if (cancelled) return;
        if (data?.success && Array.isArray(data.items)) {
          setItems(data.items);
        } else {
          setError(data?.message || "載入公告失敗");
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
  }, []);

  const totalPages = totalPagesOf(items.length, pageSize);
  const currentPage = Math.min(page, totalPages);
  const paged = paginate(items, currentPage, pageSize);

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      {/* 標題區域（比照單則公告頁） */}
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">
          {settings.academicYear} 學年度 第{settings.semester}學期
        </p>
      </div>

      {/* 功能標題 */}
      <div className="w-full max-w-4xl mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">全部公告</h2>
        <p className="text-sm text-t3 mt-1">
          顯示可閱讀的全部公告，置頂排在最前；點標題查看完整內容。
        </p>
        <Link
          href={homeHref}
          className="mt-2 inline-block btn-soft rounded px-3 py-1 text-xs"
        >
          ← 返回首頁
        </Link>
      </div>

      <hr className="w-full max-w-4xl border-themed mb-4" />

      {/* 清單卡片 */}
      <div className="w-full max-w-4xl mb-4">
        {loading ? (
          <div className="border border-themed rounded-lg bg-card p-8 text-center">
            <p className="text-t3">載入中...</p>
          </div>
        ) : error ? (
          <div className="border border-themed rounded-lg bg-card p-8 text-center">
            <p className="text-lg font-bold text-t1 mb-2">無法顯示公告</p>
            <p className="text-sm text-t2">{error}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="border border-themed rounded-lg bg-card p-8 text-center">
            <p className="text-t3">目前沒有公告</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {paged.map((item) => (
              <li key={item.id} className="border border-themed rounded-lg bg-card p-4">
                <Link href={`/announcements/${item.id}`} className="block group">
                  <p className="text-xs text-t3 mb-1 flex flex-wrap items-center gap-1.5">
                    {item.pinned && <PinIcon className="text-primary" />}
                    <span>{new Date(item.publishAt).toLocaleDateString("zh-TW")}</span>
                    <span aria-hidden="true">｜</span>
                    <span>{item.categoryName}</span>
                    <span aria-hidden="true">｜</span>
                    <span>{item.authorName}</span>
                    {item.classScoped && (
                      <>
                        <span aria-hidden="true">｜</span>
                        <span>班級公告</span>
                      </>
                    )}
                  </p>
                  <p className="text-base font-bold text-t1 group-hover:text-primary">
                    {item.title}
                  </p>
                  <p className="text-sm text-t2 mt-0.5 line-clamp-2">{clipText(item.body, 60)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 通用分頁列（純前端切片） */}
      <div className="w-full max-w-4xl mb-8">
        <ListPagination
          total={items.length}
          page={currentPage}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          idPrefix="archive"
        />
      </div>

      <hr className="w-full max-w-4xl border-themed mb-4" />

      {/* 廣告區域 */}
      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-4xl mb-4">
          <AdSense />
        </div>
      )}

      {/* 版權宣告 */}
      <div className="w-full max-w-4xl mt-auto mb-8">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );
}
