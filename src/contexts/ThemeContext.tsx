"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Theme, ThemeId } from "@/types/theme";
import { builtinThemes, defaultTheme, getThemeById } from "@/lib/themes";
import {
  ensureMarketTheme,
  fetchAccountThemePrefs,
  listInstalledThemes,
  readStoredTheme,
  saveAccountThemeId,
} from "@/lib/theme-store";

const STORAGE_KEY = "campusToolkitTheme";
const FORCED_THEME_KEY = "campusToolkitForcedTheme";

interface ThemeContextType {
  currentTheme: Theme;
  setTheme: (id: ThemeId | string) => void;
  forcedTheme: ThemeId | null;
  setForcedTheme: (id: ThemeId | null) => void;
  availableThemes: Theme[];
  /** 重新收集可用主題（主題編輯器儲存／刪除後呼叫） */
  refreshAvailableThemes: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  currentTheme: defaultTheme,
  setTheme: () => {},
  forcedTheme: null,
  setForcedTheme: () => {},
  availableThemes: builtinThemes,
  refreshAvailableThemes: () => {},
});

/** 主題解析（協議 §3）：內建主題優先，其後為已安裝的 market:/custom: 主題 */
function resolveTheme(id: string): Theme | null {
  return getThemeById(id) ?? readStoredTheme(id);
}

/** 收集可用主題：內建＋已安裝（安裝資料損毀者自動略過） */
function collectAvailableThemes(): Theme[] {
  const installed: Theme[] = [];
  for (const record of listInstalledThemes()) {
    const theme = readStoredTheme(record.id);
    if (theme) installed.push(theme);
  }
  return [...builtinThemes, ...installed];
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(defaultTheme);
  const [forcedTheme, setForcedThemeState] = useState<ThemeId | null>(null);
  const [availableThemes, setAvailableThemes] = useState<Theme[]>(builtinThemes);

  function applyTheme(theme: Theme) {
    const root = document.documentElement;
    // 基底：先套預設主題全量 token，避免切換到部分覆寫主題（如市集主題）時殘留舊值
    for (const [key, value] of Object.entries(defaultTheme.colors)) {
      root.style.setProperty(key, value);
    }
    for (const [key, value] of Object.entries(theme.colors)) {
      root.style.setProperty(key, value);
    }
    root.setAttribute("data-theme", theme.id);
    root.style.colorScheme = isDarkColor(theme.colors["--bg"] ?? "#ffffff") ? "dark" : "light";
  }

  /** 解析並套用；market: 主題本機缺貨時自動向內容端點取回（Step 10/11） */
  async function applyResolved(id: string): Promise<Theme> {
    const theme = resolveTheme(id) ?? (await ensureMarketTheme(id)) ?? defaultTheme;
    setCurrentTheme(theme);
    applyTheme(theme);
    return theme;
  }

  useEffect(() => {
    // 讀取強制主題（Admin 設定）
    const forced = localStorage.getItem(FORCED_THEME_KEY);
    if (forced) {
      setForcedThemeState(forced as ThemeId);
    }

    setAvailableThemes(collectAvailableThemes());

    // 解析主題優先級：強制 > 帳號 > localStorage > 預設（協議 §3）
    const userTheme = localStorage.getItem("campusUserTheme");
    const savedTheme = localStorage.getItem(STORAGE_KEY);
    const localId = forced || userTheme || savedTheme || defaultTheme.id;
    void applyResolved(localId);

    // 帳號同步（Step 11）：取回帳號 themeId 與已安裝清單，補齊本機缺貨的市集主題
    let cancelled = false;
    void (async () => {
      const prefs = await fetchAccountThemePrefs();
      if (cancelled || !prefs) return;

      const missing = prefs.installedThemes
        .filter((record) => record.id.startsWith("market:") && !readStoredTheme(record.id))
        .slice(0, 10);
      for (const record of missing) {
        await ensureMarketTheme(record.id);
      }
      if (missing.length > 0) {
        setAvailableThemes(collectAvailableThemes());
      }

      // 帳號主題優先於本機快取（無強制主題時）
      if (!forced && prefs.cssThemeId) {
        const appliedId = forced || localStorage.getItem(STORAGE_KEY) || defaultTheme.id;
        if (prefs.cssThemeId !== appliedId) {
          localStorage.setItem(STORAGE_KEY, prefs.cssThemeId);
          await applyResolved(prefs.cssThemeId);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isDarkColor(hex: string): boolean {
    const c = hex.replace("#", "");
    if (c.length < 6) return false;
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
  }

  function setTheme(id: ThemeId | string) {
    void (async () => {
      const theme = await applyResolved(id);
      // 如果有強制主題，不儲存到 localStorage、不同步帳號
      if (!forcedTheme) {
        localStorage.setItem(STORAGE_KEY, theme.id);
        void saveAccountThemeId(theme.id);
      }
    })();
  }

  function setForcedTheme(id: ThemeId | null) {
    setForcedThemeState(id);
    if (id) {
      localStorage.setItem(FORCED_THEME_KEY, id);
      void applyResolved(id);
    } else {
      localStorage.removeItem(FORCED_THEME_KEY);
      // 恢復到原本的主題
      const savedTheme = localStorage.getItem(STORAGE_KEY) || defaultTheme.id;
      void applyResolved(savedTheme);
    }
  }

  function refreshAvailableThemes() {
    setAvailableThemes(collectAvailableThemes());
  }

  return (
    <ThemeContext.Provider
      value={{
        currentTheme,
        setTheme,
        forcedTheme,
        setForcedTheme,
        availableThemes,
        refreshAvailableThemes,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
