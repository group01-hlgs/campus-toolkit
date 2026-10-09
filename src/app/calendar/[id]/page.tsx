"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchSettings } from "@/lib/settings-client";
import { defaultSettings } from "@/types/settings";
import type { CalendarEventItem } from "@/types/calendar";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatRange(item: CalendarEventItem): string {
  const s = new Date(item.startAt);
  if (item.allDayDate) return `全天（${s.getMonth() + 1}/${s.getDate()}）`;
  const base = `${s.getMonth() + 1}/${s.getDate()} ${pad2(s.getHours())}:${pad2(s.getMinutes())}`;
  if (typeof item.endAt !== "number" || item.endAt <= item.startAt) return base;
  const e = new Date(item.endAt);
  const sameDay =
    e.getFullYear() === s.getFullYear() &&
    e.getMonth() === s.getMonth() &&
    e.getDate() === s.getDate();
  return sameDay
    ? `${base} ~ ${pad2(e.getHours())}:${pad2(e.getMinutes())}`
    : `${base} ~ ${e.getMonth() + 1}/${e.getDate()} ${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
}

/**
 * 單筆行程內容頁（顯示位置行程列「跳出新頁」用，比照單則公告內容頁）。
 * 版面比照系統設定外殼（標題區域＋內容卡片），不提供返回功能頁與登出按鈕。
 * 權限由 API 端判定：公開行程（受眾含四種身分且非班級限定）**免登入可讀**；
 * 其餘行程須登入（401 → 請先登入）且依身分／班級過濾（403 → 無權限）。
 */
export default function CalendarEventDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const [settings, setSettings] = useState(defaultSettings);
  const [event, setEvent] = useState<CalendarEventItem | null>(null);
  const [error, setError] = useState("");
  const [needLogin, setNeedLogin] = useState(false);
  const [loading, setLoading] = useState(true);

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
      setError("查無此行程");
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/calendar/${id}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.status === 401) {
          setNeedLogin(true);
          setError(data?.message || "請先登入後再查看行程");
          return;
        }
        if (data?.success && data.event) {
          setEvent(data.event);
        } else {
          setError(data?.message || "查無此行程");
        }
      })
      .catch(() => {
        if (!cancelled) setError("載入行程失敗");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const category = event?.categoryName ? `｜行事曆類型：${event.categoryName}` : "";

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
        <h2 className="text-2xl font-bold text-t1">行程內容</h2>
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
            <p className="text-lg font-bold text-t1 mb-2">
              {needLogin ? "請先登入" : "無法顯示行程"}
            </p>
            <p className="text-sm text-t2">{error}</p>
            {needLogin && (
              <a
                href="/"
                className="btn-soft rounded-lg px-4 py-2 text-sm mt-4 inline-block cursor-pointer"
              >
                回首頁登入
              </a>
            )}
          </div>
        ) : event ? (
          <div className="border border-themed rounded-lg bg-card p-6">
            {/* 標題 */}
            <h3 className="text-lg font-bold text-t1 mb-2">
              {event.important && <span className="text-primary mr-1">★</span>}
              {event.title}
            </h3>

            {/* 資訊列 */}
            <p className="text-sm text-t3 mb-4">
              {formatRange(event)}
              {event.location ? `｜${event.location}` : ""}
              {category}
              {event.classScoped
                ? `｜${event.classCodes.join("、")}`
                : "｜全校"}
              {event.publishUnit ? `｜${event.publishUnit}` : ""}
            </p>

            {/* 內文 */}
            <div className="text-base text-t2 whitespace-pre-wrap leading-relaxed">
              {event.description || "（此行程沒有補充說明）"}
            </div>

            {/* 建立資訊 */}
            <p className="text-sm text-t3 mt-4 pt-4 border-t border-themed">
              建立者：{event.createdByName}
              {event.sourceModule !== "calendar" ? `｜來源：${event.sourceModule}` : ""}
              ｜最後更新：{new Date(event.updatedAt).toLocaleString("zh-TW")}
            </p>
          </div>
        ) : null}
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
