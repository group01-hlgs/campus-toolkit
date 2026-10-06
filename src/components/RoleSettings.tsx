"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { ROLE_HOME, ROLE_LABELS, UserRole } from "@/types/users";
import { fetchSession, logout } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import { fetchSettings } from "@/lib/settings-client";

/**
 * 各身分的「系統設定」功能頁（學生／家長／教職員）。
 * 版型比照「帳號、身分與安全管理」（AccountSecurity）：標題區 → 頁首按鈕組 → 分隔線
 * → 功能卡 → 分隔線 → 底部按鈕組 → 廣告區 → 版權宣告。
 * 目前是尚未開放任何設定項目的空頁面，日後新增設定項目時於功能卡內擴充即可。
 */
export default function RoleSettings({
  role,
}: {
  role: Exclude<UserRole, "admin">;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  useEffect(() => {
    let cancelled = false;
    fetchSession(true).then((session) => {
      if (cancelled) return;
      if (!session || session.role !== role) {
        router.push("/");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router, role]);

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
    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogout() {
    void logout();
    router.push("/");
  }

  const roleLabel = ROLE_LABELS[role];
  const backHref = ROLE_HOME[role];
  // 返回功能首頁／登出按鈕組：頁首與功能卡下方各擺一組（與帳號、身分與安全管理一致）
  const actionButtons = (
    <>
      <button
        onClick={() => router.push(backHref)}
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
    </>
  );

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">
          {settings.systemName || "數位校園工具箱"}
        </h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      <div className="w-full max-w-2xl mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">系統設定</h2>
        <p className="text-t3 text-sm mt-1">{roleLabel}</p>
      </div>

      <div className="w-full max-w-2xl flex justify-end gap-2 mb-4">{actionButtons}</div>

      <hr className="w-full max-w-2xl border-themed mb-4" />

      {/* 系統設定卡：目前為空頁面，尚未提供任何設定項目 */}
      <div className="w-full max-w-2xl border border-themed rounded-lg p-6 mb-4">
        <h3 className="font-bold text-t1 mb-4">系統設定</h3>
        <div className="flex flex-col items-center justify-center text-center py-10">
          <span className="text-t3 mb-3" aria-hidden="true">
            <svg
              className="w-10 h-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.044-.146.087-.22-.128-.332-.183.582-.495.644-.869l.214-1.281z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </span>
          <p className="text-t2 font-medium mb-1">尚無可使用的設定項目</p>
          <p className="text-xs text-t3">此功能仍在建置中，日後開放的設定項目會顯示在這裡。</p>
        </div>
      </div>

      <hr className="w-full max-w-2xl border-themed mb-4" />
      <div className="w-full max-w-2xl flex justify-start gap-2 mb-4">{actionButtons}</div>

      {/* 廣告區域 */}
      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-2xl mt-8">
          <AdSense />
        </div>
      )}

      <div className="w-full max-w-2xl mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );
}
