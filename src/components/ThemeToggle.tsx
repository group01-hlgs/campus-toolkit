"use client";

import { useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";

export default function ThemeToggle() {
  const { currentTheme, setTheme, availableThemes } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* 觸發按鈕 */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-4 right-4 z-40 w-9 h-9 rounded-full border shadow-lg flex items-center justify-center cursor-pointer transition-transform hover:scale-110"
        style={{
          backgroundColor: "var(--card)",
          borderColor: "var(--bd)",
          boxShadow: "var(--sh)",
        }}
        title="切換主題"
      >
        <svg
          className="w-4.5 h-4.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          style={{ color: "var(--t2)" }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z"
          />
        </svg>
      </button>

      {/* 抽屜背景 */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 transition-opacity"
          style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* 抽屜：外層固定滿版＋overflow-hidden（永遠 pointer-events-none），避免關閉時抽屜停在視窗外造成頁面水平空白 */}
      <div className="fixed inset-0 z-50 overflow-hidden" aria-hidden={!isOpen} style={{ pointerEvents: "none" }}>
        <div
          className={`absolute top-0 right-0 h-full transition-transform duration-300 ${
            isOpen ? "translate-x-0" : "translate-x-full"
          }`}
          style={{
            minWidth: "200px",
            maxWidth: "85vw",
            backgroundColor: "var(--card)",
            borderLeft: "1px solid var(--bd)",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
            pointerEvents: isOpen ? "auto" : "none",
          }}
        >
        {/* 標題 */}
        <div
          className="flex items-center justify-between p-4"
          style={{ borderBottom: "1px solid var(--bd)" }}
        >
          <span className="font-bold" style={{ color: "var(--t1)" }}>
            選擇主題
          </span>
          <button
            onClick={() => setIsOpen(false)}
            className="cursor-pointer"
            style={{ color: "var(--t3)" }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 主題列表 */}
        <div className="overflow-y-auto h-[calc(100%-140px)] p-2">
          {availableThemes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => {
                setTheme(theme.id);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors text-left ${
                currentTheme.id === theme.id ? "font-semibold" : ""
              }`}
              style={{
                backgroundColor:
                  currentTheme.id === theme.id ? "var(--bg2)" : "transparent",
                color: currentTheme.id === theme.id ? "var(--t1)" : "var(--t2)",
              }}
            >
              <div
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: theme.preview,
                  border: `2px solid ${
                    currentTheme.id === theme.id ? "var(--t1)" : "var(--bd2)"
                  }`,
                  boxShadow:
                    currentTheme.id === theme.id
                      ? `0 0 0 2px var(--bg), 0 0 0 3.5px var(--t1)`
                      : "none",
                }}
              />
              <span>{theme.name}</span>
              {currentTheme.id === theme.id && (
                <svg
                  className="w-4 h-4 ml-auto"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>

        {/* 底部說明 */}
        <div
          className="p-4 text-xs"
          style={{
            borderTop: "1px solid var(--bd)",
            color: "var(--t3)",
          }}
        >
          共 {availableThemes.length} 款內建主題
        </div>
        </div>
      </div>
    </>
  );
}
