"use client";

import { useRouter } from "next/navigation";

/**
 * 首頁左上角「休閒歡樂誠」入口（城堡圖示）：
 * 三顆既有遊戲按鈕的最上方，點擊進入 /recreation 功能首頁。
 */
export default function HomepageCornerCastle() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="休閒歡樂誠"
      title="休閒歡樂誠"
      onClick={() => router.push("/recreation")}
      className="fixed left-4 top-4 z-20 p-1 rounded border border-themed bg-card/80 hover:bg-surface transition-colors cursor-pointer"
    >
      <svg
        className="w-6 h-6 text-t2"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 21h18M4.5 21V9.75L6 6l2 2.25L12 4l4 4.25L18 6l1.5 3.75V21M9 21v-4.5h6V21M6 9.75V6m0 3.75h3V9.75H6zm9 0V9.75h3V9.75h-3z"
        />
      </svg>
    </button>
  );
}
