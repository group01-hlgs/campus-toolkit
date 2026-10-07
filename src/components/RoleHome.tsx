"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { UserRole, ROLE_HOME, ROLE_LABELS } from "@/types/users";
import { fetchSession, logout } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import HomepageCornerWrench from "@/components/HomepageCornerWrench";
import HomepageCornerChangE from "@/components/HomepageCornerChangE";
import HomepageCornerExam from "@/components/HomepageCornerExam";
import DraggableModuleGrid from "@/components/DraggableModuleGrid";
import RoleSwitcher from "@/components/RoleSwitcher";
import ModuleIcon from "@/components/ModuleIcon";
import AnnouncementReminderBell from "@/components/AnnouncementReminderBell";
import { fetchSettings } from "@/lib/settings-client";

const accountModule = {
  icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  ),
  label: "帳號、身分與安全管理",
};

// 齒輪圖示與管理員首頁「系統設定」卡一致（主程式必有的子功能）
const settingsModule = {
  icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.044-.146.087-.22-.128-.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  label: "系統設定",
};

export default function RoleHome({ role }: { role: Exclude<UserRole, "admin"> }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [displayName, setDisplayName] = useState("");
  // 可見功能模組清單；null＝尚未載入（先顯示既有卡片，避免閃爍）
  const [visibleModules, setVisibleModules] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSession(true).then((session) => {
      if (cancelled) return;
      if (!session || session.role !== role) {
        router.push("/");
        return;
      }
      setDisplayName(session.displayName);
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
        // 目前身分可見的功能模組（提供功能 AND 顯示與否）
        if (data && Array.isArray(data.visibleModules)) {
          setVisibleModules(data.visibleModules);
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
  const accountHref = `${ROLE_HOME[role]}/account`;
  const settingsHref = `${ROLE_HOME[role]}/settings`;
  const announcementsHref = `${ROLE_HOME[role]}/announcements`;
  // 功能入口卡片：順序比照主程式管理員首頁
  // 「帳號、身分與安全管理」「公告」依功能模組「顯示與否」過濾
  // 個人「設定」頁為個人偏好、非功能模組入口，不套顯示開關
  const accountVisible =
    visibleModules === null || visibleModules.includes("account");
  const announcementsVisible =
    visibleModules === null || visibleModules.includes("announcements");
  const entryCards = [
    { ...settingsModule, id: "settings", href: settingsHref },
    ...(accountVisible ? [{ ...accountModule, id: "account", href: accountHref }] : []),
    ...(announcementsVisible
      ? [
          {
            icon: <ModuleIcon value="announcements" />,
            label: "公告",
            id: "announcements",
            href: announcementsHref,
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      <HomepageCornerWrench />
      <HomepageCornerChangE />
      <HomepageCornerExam />
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      <div className="content-width mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">{roleLabel}功能首頁</h2>
        {displayName && <p className="text-t2 mt-1">{displayName}，您好</p>}
        <RoleSwitcher role={role} />
      </div>

      <div className="content-width flex justify-end items-center gap-2 mb-4">
        {announcementsVisible && (
          <AnnouncementReminderBell role={role} href={announcementsHref} />
        )}
        <button onClick={handleLogout} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
          登出
        </button>
      </div>

      <hr className="content-width border-themed mb-4" />

      {/* 提示文字 + 可拖曳排序的功能卡片（順序存入此瀏覽器的 localStorage） */}
      <DraggableModuleGrid
        items={entryCards}
        storageKey={`campusCardOrder.${role}`}
      />

      <hr className="content-width border-themed mb-4" />

      <div className="content-width mb-8">
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
