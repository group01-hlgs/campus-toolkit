"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { logout } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";

/**
 * 「班級管理」共用外殼（標題、權限閘門、頁尾），版面比照「學校基本設定」：
 * 標題區域、功能標題、返回／登出按鈕、分隔線、內容、頁尾與版權宣告。
 * 本模組為可指派模組（classes），頁面層以 adminModules 擋一次、
 * API 端以 requireAdminModule("classes") 再擋一次；
 * 內容頁（班級總覽…）都包在這個 layout 裡，共用同一套版面。
 */
export default function ClassesLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  // 可用模組清單（同「使用者帳號管理」的 fail-closed：讀不到＝視為無權限）
  const [adminModules, setAdminModules] = useState<string[] | null>(null);
  const allowed = adminModules !== null && adminModules.includes("classes");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const modules = data?.user?.adminModules;
        setAdminModules(Array.isArray(modules) ? modules.filter((m) => typeof m === "string") : []);
      })
      .catch(() => {
        if (!cancelled) setAdminModules([]);
      });

    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
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
        <h2 className="text-2xl font-bold text-t1">班級管理</h2>
        <p className="text-sm text-t3 mt-1">
          當期各年級班級與每班學生人數，班級名稱旁的箭頭可查看該班學生名單；班級結構維護於「學校基本設定
          → 年段班級設定」。
        </p>
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

      {/* 內容：班級總覽等內容頁 */}
      {allowed ? (
        children
      ) : (
        <div className="w-full max-w-4xl border border-themed rounded-lg p-8 bg-card text-center space-y-2 mb-8">
          <p className="text-lg font-bold text-t1">權限不足</p>
          <p className="text-sm text-t2">
            「班級管理」未被指派給此帳號，請洽超級管理員在名冊或帳號頁指派。
          </p>
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
