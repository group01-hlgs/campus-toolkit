"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { fetchSession, logout } from "@/lib/session";
import { fetchSettings } from "@/lib/settings-client";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";

interface AdminSectionShellProps {
  /** 模組代碼（比對 session.adminModules；超級專屬模組同樣看清單是否含它） */
  moduleKey: string;
  /** 功能標題（頁面區塊大標） */
  title: string;
  /** 標題下的說明文字 */
  description: string;
  /** 權限不足時的說明（顯示於「權限不足」卡片） */
  deniedMessage: string;
  children: ReactNode;
}

/**
 * 管理端子區塊共用外殼（標題、權限閘門、頁尾）：
 * 「統計儀表板」「功能模組管理」「班級管理」「學校基本設定」四個 layout 共用，
 * 權限與設定兩發請求都在此取得：
 * - session 走 fetchSession(force)：與同畫面其他呼叫去重（in-flight 共用），
 *   進區塊仍重取一次，權限變更即時反映；
 * - 設定走 fetchSettings：30 秒模組層快取，跨區塊重進不再重打。
 */
export default function AdminSectionShell({
  moduleKey,
  title,
  description,
  deniedMessage,
  children,
}: AdminSectionShellProps) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  // 可用模組清單（同「使用者帳號管理」的 fail-closed：讀不到＝視為無權限）
  const [adminModules, setAdminModules] = useState<string[] | null>(null);
  const allowed = adminModules !== null && adminModules.includes(moduleKey);

  useEffect(() => {
    let cancelled = false;

    fetchSession(true)
      .then((session) => {
        if (cancelled) return;
        setAdminModules(session?.adminModules ?? []);
      })
      .catch(() => {
        if (!cancelled) setAdminModules([]);
      });

    fetchSettings()
      .then((data) => {
        if (cancelled || !data?.success || !data.settings) return;
        setSettings({ ...defaultSettings, ...data.settings });
      })
      .catch((error: unknown) => console.error("載入設定失敗:", error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleBack() {
    router.push("/admin");
  }

  function handleLogout() {
    void logout();
    router.push("/");
  }

  // 權限清單尚未解析前先顯示載入中，避免閃過畫面
  if (loading || adminModules === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-t3">載入中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      {/* 標題區域 */}
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      {/* 功能標題 */}
      <div className="w-full max-w-4xl mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">{title}</h2>
        <p className="text-sm text-t3 mt-1">{description}</p>
      </div>

      {/* 操作按鈕 */}
      <div className="w-full max-w-4xl flex justify-end gap-3 mb-4">
        <button
          onClick={handleBack}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回功能首頁
        </button>
        <button
          onClick={handleLogout}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          登出
        </button>
      </div>

      <hr className="w-full max-w-4xl border-themed mb-4" />

      {/* 內容：各子功能頁 */}
      {allowed ? (
        children
      ) : (
        <div className="w-full max-w-4xl border border-themed rounded-lg p-8 bg-card text-center space-y-2 mb-8">
          <p className="text-lg font-bold text-t1">權限不足</p>
          <p className="text-sm text-t2">{deniedMessage}</p>
        </div>
      )}

      <hr className="w-full max-w-4xl border-themed mb-4" />

      {/* 底部操作按鈕 */}
      <div className="w-full max-w-4xl flex justify-start gap-3 mb-8">
        <button
          onClick={handleBack}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回功能首頁
        </button>
        <button
          onClick={handleLogout}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          登出
        </button>
      </div>

      {/* 廣告區域 */}
      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-4xl">
          <AdSense />
        </div>
      )}

      {/* 版權宣告 */}
      <div className="w-full max-w-4xl mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );
}
