"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { fetchSession, logout } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import DraggableModuleGrid from "@/components/DraggableModuleGrid";
import AnnouncementSurface from "@/components/AnnouncementSurface";
import CalendarSurface from "@/components/CalendarSurface";
import { fetchSettings } from "@/lib/settings-client";

/**
 * 休閒歡樂誠功能首頁（/recreation）：
 * 架構與排版比照各身分功能首頁；內容區暫空，由日後小遊戲卡片陸續進駐。
 * 入口：首頁與各功能首頁左上角城堡圖示、各首頁「休閒歡樂誠」卡。
 */
export default function RecreationHomePage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [displayName, setDisplayName] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSession(true).then((session) => {
      if (cancelled) return;
      if (session) {
        setLoggedIn(true);
        setDisplayName(session.displayName);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const data = await fetchSettings();
        if (cancelled) return;
        if (data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
      } catch (error) {
        console.error("載入設定失敗:", error);
      }
    }
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogout() {
    void logout();
    router.push("/");
  }

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      <div className="content-width mt-4 mb-2 text-center">
        <p className="mb-2 inline-flex rounded border border-warning/60 bg-warning/10 px-3 py-1 text-xs text-warning">
          功能建構中，陸續開放
        </p>
        <h2 className="text-2xl font-bold text-primary">
          休閒歡樂<span className="inline-block rotate-[30deg] ml-[3px]">誠</span>
        </h2>
        {displayName && <p className="text-t2 mt-1">{displayName}，您好</p>}
      </div>

      {/* 系統公告與行程：與其他功能首頁同一擺位（顯示位置由管理端設定） */}
      <AnnouncementSurface surface="login" className="content-width mb-3" />
      <CalendarSurface surface="login" className="content-width mb-3" />

      <div className="content-width flex justify-end items-center gap-2 mb-4">
        <button onClick={() => router.push("/")} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
          返回首頁
        </button>
        {loggedIn && (
          <button onClick={handleLogout} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
            登出
          </button>
        )}
      </div>

      <hr className="content-width border-themed mb-4" />

      {/* 內容區：暫空，架構比照各身分功能首頁（可拖曳排序的卡片區） */}
      <DraggableModuleGrid items={[]} storageKey="campusCardOrder.recreation" />

      <hr className="content-width border-themed mb-4" />

      <div className="content-width mb-8">
        <button onClick={() => router.push("/")} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
          返回首頁
        </button>
      </div>

      {settings.sponsorAdEnabled && (
        <div className="content-width">
          <AdSense />
        </div>
      )}

      <div className="content-width mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );
}
