"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { logout } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import DraggableModuleGrid from "@/components/DraggableModuleGrid";
import AnnouncementSurface from "@/components/AnnouncementSurface";
import CalendarSurface from "@/components/CalendarSurface";
import { fetchSettings } from "@/lib/settings-client";

/**
 * 休閒歡樂誠功能首頁（/recreation）：
 * 版面與樣式比照「學校基本設定」功能首頁，僅內容顯示區保留本頁內容
 * （系統公告、行程與可拖曳排序的卡片區，暫空待日後小遊戲卡片進駐）。
 * 入口：首頁與各功能首頁左上角城堡圖示、各首頁「休閒歡樂誠」卡。
 */
export default function RecreationHomePage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);

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

  function handleBack() {
    router.push("/");
  }

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

      {/* 功能標題（版面與樣式比照「學校基本設定」功能首頁） */}
      <div className="content-width mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">
          休閒歡樂<span className="inline-block rotate-[30deg] ml-[3px]">誠</span>
        </h2>
        <p className="text-sm text-t3 mt-1">功能建構中，陸續開放。</p>
      </div>

      {/* 操作按鈕 */}
      <div className="content-width flex justify-end gap-3 mb-4">
        <button onClick={handleBack} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
          返回首頁
        </button>
        <button onClick={handleLogout} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
          登出
        </button>
      </div>

      <hr className="content-width border-themed mb-4" />

      {/* 內容顯示區：系統公告、行程與可拖曳排序的卡片區 */}
      <AnnouncementSurface surface="login" className="content-width mb-3" />
      <CalendarSurface surface="login" className="content-width mb-3" />
      <DraggableModuleGrid items={[]} storageKey="campusCardOrder.recreation" />

      <hr className="content-width border-themed mb-4" />

      {/* 底部操作按鈕 */}
      <div className="content-width flex justify-start gap-3 mb-8">
        <button onClick={handleBack} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
          返回首頁
        </button>
        <button onClick={handleLogout} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
          登出
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
