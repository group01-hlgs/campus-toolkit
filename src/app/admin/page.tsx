"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import HomepageCornerWrench from "@/components/HomepageCornerWrench";
import HomepageCornerChangE from "@/components/HomepageCornerChangE";
import HomepageCornerExam from "@/components/HomepageCornerExam";
import HomepageCornerCastle from "@/components/HomepageCornerCastle";
import DraggableModuleGrid from "@/components/DraggableModuleGrid";
import ModuleIcon from "@/components/ModuleIcon";
import RoleSwitcher from "@/components/RoleSwitcher";
import AnnouncementSurface from "@/components/AnnouncementSurface";
import CalendarSurface from "@/components/CalendarSurface";
import { fetchSession, logout, UserSession } from "@/lib/session";
import { MODULES } from "@/types/modules";
import versionData from "@/version.json";
import { fetchSettings } from "@/lib/settings-client";

/** 主程式版本與建置日期（供管理員確認目前版本，僅管理頁顯示） */
const versionLabel = `主程式版本 ${versionData.version}（${versionData.date.replace(/-/g, ".")}）`;

interface ModuleCard {
  id: string;
  icon: React.ReactNode;
  label: string;
  href: string;
}

/** 功能模組入口卡片：由模組註冊表（types/modules.ts）派生——僅列出已建入口（href 非空）的模組，
 * 尚未建頁的模組（如稽核紀錄）不顯示；顯示與否再依 session.adminModules 過濾（見下方 fail-closed 邏輯）。 */
const moduleCards: ModuleCard[] = MODULES.filter((item) => item.href !== "").map((item) => ({
  id: item.value,
  icon: <ModuleIcon value={item.value} />,
  label: item.label,
  href: item.href,
}));

/** 個人功能：每個帳號都有，不需管理權限，管理員首頁一律顯示 */
const personalCard: ModuleCard = {
  id: "account",
  icon: <ModuleIcon value="account" />,
  label: "帳號、身分與安全管理",
  href: "/admin/admins",
};

/** 學生個人資料不需管理權限；四種身分都可使用，仍依模組顯示開關過濾 */
const personalInfoCard: ModuleCard = {
  id: "personalInfo",
  icon: <ModuleIcon value="personalInfo" />,
  label: "學生個人資料",
  href: "/admin/personal-info",
};

export default function AdminPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [user, setUser] = useState<UserSession | null>(null);
  // 可見功能模組清單；null＝尚未載入（過濾前先維持原顯示，避免閃爍）
  const [visibleModules, setVisibleModules] = useState<string[] | null>(null);

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
        const data = await fetchSettings();
        if (cancelled) return;
        if (data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
        // 目前身分可見的功能模組（提供功能 AND 顯示與否）：卡片過濾用
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

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-t3">載入中...</p>
      </div>
    );
  }

  // 管理員恆全權（政策修改書決議二）：adminModules 載入後即為全量清單；
  // 讀不到權限＝不顯示管理模組卡（fail-closed）。個人卡對已登入管理員一律顯示。
  const gatedModules =
    user.adminModules == null
      ? []
      : user.role === "admin"
        ? // 有管理員條目（adminModules 非空）＝全開；空陣列＝無條目，fail-closed 不顯示
          user.adminModules.length > 0
          ? moduleCards
          : []
        : moduleCards.filter((item) => {
            if (!user.adminModules!.includes(item.id)) return false;
            if (visibleModules === null) return true;
            return visibleModules.includes(item.id);
          });
  const personalVisible = true;
  const personalInfoVisible =
    user.adminModules == null || user.adminModules.length === 0
      ? visibleModules === null || visibleModules.includes("personalInfo")
      : true;
  // 休閒歡樂誠：首頁左上角城堡浮動按鈕（依功能入口開關顯示；管理員恆可見）。
  // 卡片由 moduleCards 派生（MODULES 的 href=/recreation），不另加手刻卡避免重複。
  const recreationVisible = visibleModules === null || visibleModules.includes("recreation");
  const visibleModulesCards = [
    ...gatedModules,
    ...(personalVisible ? [personalCard] : []),
    ...(personalInfoVisible ? [personalInfoCard] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      {recreationVisible && (
        <>
          <HomepageCornerCastle />
          <HomepageCornerWrench />
          <HomepageCornerChangE />
          <HomepageCornerExam />
        </>
      )}
      {/* 標題區域（版本號僅管理員可見：獨立一行置中，顯示在系統名稱上方） */}
      <div className="text-center mb-2">
        <p className="text-xs text-t3 mb-1" title={versionLabel}>
          {versionLabel}
        </p>
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      {/* 功能標題 */}
      <div className="content-width mt-4 mb-2 text-center">
        <p className="mb-2 inline-flex rounded border border-warning/60 bg-warning/10 px-3 py-1 text-xs text-warning">
          功能建構中，陸續開放
        </p>
        <h2 className="text-2xl font-bold text-t1">管理員功能首頁</h2>
        {(user.displayName || user.account) && (
          <p className="text-t2 mt-1">{user.displayName || user.account}，您好</p>
        )}
        <RoleSwitcher role="admin" />
      </div>

      {/* 系統公告：切換身分下拉選單下方、第一個登出按鈕上方 */}
      <AnnouncementSurface surface="admin" className="content-width mb-3" />

      {/* 行程（單一行、尚未結束的第 1 則） */}
      <CalendarSurface surface="admin" className="content-width mb-3" />

      {/* 登出按鈕 */}
      <div className="content-width flex justify-end mb-2.5">
        <button
          onClick={handleLogout}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          登出
        </button>
      </div>

      {/* 全域 hr 有 margin: 1rem 0，清掉上間距，與上方登出按鈕維持既有間距 */}
      <hr className="content-width border-themed mb-4 mt-0" />

      {/* 提示文字 + 可拖曳排序的功能卡片（順序存入此瀏覽器的 localStorage）；
          「行事曆」排在「系統公告」下方（使用者自行拖曳過則以拖曳結果為準） */}
      <DraggableModuleGrid
        items={visibleModulesCards}
        storageKey="campusCardOrder.admin"
        anchorAfter={{ calendar: "announcements" }}
      />

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
