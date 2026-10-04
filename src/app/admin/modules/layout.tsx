"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { logout } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";

/**
 * 「功能模組管理」共用外殼（標題、權限閘門、頁尾）。
 * 本頁展示產品層級的功能模組（內建／選用列表、總開關與各身分開關），
 * 「功能模組管理」是超級專屬權限模組（modules 為 scope＝superOnly，
 * 一般管理員的 adminModules 不含它，卡片、頁面與 API 皆只對超級開放；
 * 頁面層仍擋一次，寫入 API 另以 requireAdminModule("modules")＋isSuperAdmin 把關）。
 */
export default function ModulesLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  // 可用模組清單（同「使用者帳號管理」的 fail-closed：讀不到＝視為無權限）
  const [adminModules, setAdminModules] = useState<string[] | null>(null);
  // 超級專屬模組：僅超級管理員的權限清單含它，其他人顯示權限不足
  const allowed = adminModules !== null && adminModules.includes("modules");

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
        <h2 className="text-2xl font-bold text-t1">功能模組管理</h2>
        <p className="text-sm text-t3 mt-1">
          系統的功能模組架構：內建與選用的分類、選用模組的總開關，以及每個模組對四種身分的開關。
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

      {/* 內容：內建／選用功能模組列表 */}
      {allowed ? (
        children
      ) : (
        <div className="w-full max-w-4xl border border-themed rounded-lg p-8 bg-card text-center space-y-2 mb-8">
          <p className="text-lg font-bold text-t1">權限不足</p>
          <p className="text-sm text-t2">
            「功能模組管理」僅超級管理員可使用。若顯示此訊息但您具超級屬性，代表權限資料讀取失敗，請重新整理。
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
