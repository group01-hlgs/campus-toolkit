"use client";

import { useEffect, useState } from "react";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import { fetchSettings } from "@/lib/settings-client";
import { defaultSettings } from "@/types/settings";

/**
 * 身分功能頁共用外殼：系統名稱／校名／學年度學期頁首 ＋ 內容 ＋ 廣告區 ＋ 版權區。
 * 與 RoleHome／RoleSettings／AccountSecurity 的頁面框架一致，
 * 供行事曆、公告等「直接渲染內容元件」的頁面補上標準 chrome。
 */
export default function RolePageShell({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState(defaultSettings);

  useEffect(() => {
    let cancelled = false;
    void fetchSettings()
      .then((data) => {
        if (!cancelled && data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
      })
      .catch(() => {
        // 讀不到設定時維持預設值顯示
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">
          {settings.academicYear} 學年度 第{settings.semester}學期
        </p>
      </div>

      {children}

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
