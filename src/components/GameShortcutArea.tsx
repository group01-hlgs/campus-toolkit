"use client";

import { useEffect, useState, type ComponentType } from "react";
import HomepageCornerWrench from "@/components/HomepageCornerWrench";
import HomepageCornerChangE from "@/components/HomepageCornerChangE";
import HomepageCornerExam from "@/components/HomepageCornerExam";
import { readGameShortcutOrder, type GameKey } from "@/lib/game-shortcuts";

const GAME_COMPONENTS: Record<GameKey, ComponentType<{ launcherTop?: number }>> = {
  wrench: HomepageCornerWrench,
  changE: HomepageCornerChangE,
  exam: HomepageCornerExam,
};

/** 第一個遊戲按鈕的上緣（城堡圖示下方） */
const LAUNCHER_BASE_TOP = 52;
/** 按鈕間距 */
const LAUNCHER_STEP = 36;

/**
 * 各身分功能首頁左上角的「遊戲快捷區」：
 * 依 /recreation「快捷區」分類記住的順序顯示浮動遊戲按鈕（同瀏覽器共用 localStorage）。
 * 快捷區可為空；未設定過時顯示全部既有遊戲。
 */
export default function GameShortcutArea() {
  // null＝尚未讀取（避免 SSR 與用戶端首次渲染不一致）
  const [order, setOrder] = useState<GameKey[] | null>(null);

  useEffect(() => {
    const sync = () => setOrder(readGameShortcutOrder());
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  if (!order) return null;

  return (
    <>
      {order.map((key, index) => {
        const Game = GAME_COMPONENTS[key];
        return <Game key={key} launcherTop={LAUNCHER_BASE_TOP + index * LAUNCHER_STEP} />;
      })}
    </>
  );
}
