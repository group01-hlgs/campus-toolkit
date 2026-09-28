"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import HomepageCornerWrench from "@/components/HomepageCornerWrench";
import HomepageCornerChangE from "@/components/HomepageCornerChangE";
import HomepageCornerExam from "@/components/HomepageCornerExam";
import DraggableModuleGrid from "@/components/DraggableModuleGrid";
import { fetchSession, logout, UserSession } from "@/lib/session";

interface ModuleCard {
  id: string;
  icon: React.ReactNode;
  label: string;
  href: string;
}

const modules: ModuleCard[] = [
  {
    id: "roster",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
    label: "名冊管理",
    href: "/admin/roster",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    id: "settings",
    label: "系統設定",
    href: "/admin/settings",
  },
  {
    id: "account",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    label: "帳號與安全管理",
    href: "/admin/admins",
  },
  {
    id: "modules",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959V6a.75.75 0 01-.75.75H3.75A2.25 2.25 0 011.5 4.5v-.75c0-1.036.84-1.875 1.875-1.875h1.328c.045-.355.186-.676.401-.959.221-.29.349-.634.349-1.003C5.4 0 4.393-.84 3.375-.84S1.5 0 1.5 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959V4.5a.75.75 0 01-.75.75h-.75A2.25 2.25 0 010 3.75v-.75C0 1.964.84 1.125 1.875 1.125h1.328c.045-.355.186-.676.401-.959A2.25 2.25 0 013.375 0c1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.401.604-.401.959V4.5h-.75z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12.75v5.25a2.25 2.25 0 002.25 2.25h13.5a2.25 2.25 0 002.25-2.25v-5.25m-18-2.25h18M6 15.75h.008v.008H6v-.008zm3 0h.008v.008H9v-.008zm3 0h.008v.008H12v-.008zm3 0h.008v.008H15v-.008z" />
      </svg>
    ),
    label: "模組管理",
    href: "/admin/modules",
  },
];

export default function AdminPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [user, setUser] = useState<UserSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSession(true).then((session) => {
      if (cancelled) return;
      if (!session || session.role !== "admin") {
        router.push("/");
        return;
      }
      setUser(session);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const data = await res.json();
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

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-t3">載入中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      <HomepageCornerWrench />
      <HomepageCornerChangE />
      <HomepageCornerExam />
      {/* 標題區域 */}
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度</p>
      </div>

      {/* 功能標題 */}
      <div className="content-width mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">管理員功能首頁</h2>
        {(user.displayName || user.account) && (
          <p className="text-t2 mt-1">{user.displayName || user.account}，您好</p>
        )}
      </div>

      {/* 登出按鈕 */}
      <div className="content-width flex justify-end mb-4">
        <button
          onClick={handleLogout}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          登出
        </button>
      </div>

      <hr className="content-width border-themed mb-4" />

      {/* 提示文字 + 可拖曳排序的功能卡片（順序存入此瀏覽器的 localStorage） */}
      <DraggableModuleGrid items={modules} storageKey="campusCardOrder.admin" />

      <hr className="content-width border-themed mb-4" />

      {/* 底部登出 */}
      <div className="content-width mb-8">
        <button
          onClick={handleLogout}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          登出
        </button>
      </div>

      {/* 廣告區域 */}
      {settings.sponsorAdEnabled && (
        <div className="content-width">
          <AdSense />
        </div>
      )}

      {/* 版權宣告 */}
      <div className="content-width mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );
}
