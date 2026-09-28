"use client";

import { useEffect, useState } from "react";
import { Settings, defaultSettings } from "@/types/settings";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";

export default function NotFoundPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
      })
      .catch((err) => console.error("載入設定失敗:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      {/* 標題區域（與首頁一致） */}
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      <div className="w-full max-w-md mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">找不到這個頁面</h2>
        <p className="text-t3 text-sm mt-1">您造訪的網址不存在或已被移除</p>
      </div>

      <div className="w-full max-w-md flex justify-center mb-4">
        <a href="/" className="btn-theme rounded-lg px-4 py-2 text-sm">
          返回首頁
        </a>
      </div>

      <hr className="w-full max-w-md border-themed mb-4" />

      {/* 廣告區域 */}
      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-md mb-8">
          <AdSense />
        </div>
      )}

      {/* 版權宣告 */}
      <div className="w-full max-w-md mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );
}
