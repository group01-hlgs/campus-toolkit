"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { logout } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import DraggableModuleGrid, { type ModuleCardItem } from "@/components/DraggableModuleGrid";
import HomepageCornerWrench from "@/components/HomepageCornerWrench";
import HomepageCornerChangE from "@/components/HomepageCornerChangE";
import HomepageCornerExam from "@/components/HomepageCornerExam";
import { fetchSettings } from "@/lib/settings-client";

type GameKey = "wrench" | "changE" | "exam";

/** 遊戲卡片圖示（與首頁左上角浮動按鈕一致） */
function WrenchIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function ExamIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 15 2 2 4-4" />
    </svg>
  );
}

/**
 * 休閒歡樂誠功能首頁（/recreation）：
 * 版面與樣式比照「學校基本設定」功能首頁，僅內容顯示區保留本頁內容
 * （目前為 3 個既有小遊戲的卡片，可拖曳排序；點卡片開啟遊戲視窗）。
 * 本頁不顯示系統公告與行事曆的指定顯示區。
 * 入口：首頁與各功能首頁左上角城堡圖示、各首頁「休閒歡樂誠」卡。
 */
export default function RecreationHomePage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [launch, setLaunch] = useState<{ game: GameKey; seq: number } | null>(null);

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

  function launchGame(game: GameKey) {
    setLaunch((prev) => ({ game, seq: (prev?.seq ?? 0) + 1 }));
  }

  const gameCards: ModuleCardItem[] = [
    {
      id: "wrench",
      icon: <WrenchIcon />,
      label: "維護工具",
      href: "",
      onClick: () => launchGame("wrench"),
    },
    {
      id: "changE",
      icon: <MoonIcon />,
      label: "嫦娥奔月",
      href: "",
      onClick: () => launchGame("changE"),
    },
    {
      id: "exam",
      icon: <ExamIcon />,
      label: "學測滿級分",
      href: "",
      onClick: () => launchGame("exam"),
    },
  ];

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

      {/* 內容顯示區：3 個既有小遊戲的卡片（可拖曳排序） */}
      <DraggableModuleGrid items={gameCards} storageKey="campusCardOrder.recreation" />

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

      {/* 遊戲視窗（由上方卡片開啟，不顯示左上角浮動按鈕） */}
      <HomepageCornerWrench
        hideLauncher
        openSignal={launch?.game === "wrench" ? launch.seq : 0}
      />
      <HomepageCornerChangE
        hideLauncher
        openSignal={launch?.game === "changE" ? launch.seq : 0}
      />
      <HomepageCornerExam
        hideLauncher
        openSignal={launch?.game === "exam" ? launch.seq : 0}
      />

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
