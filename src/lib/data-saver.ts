"use client";

import { useEffect, useState } from "react";
import { Settings, defaultSettings } from "@/types/settings";

export interface DataSaverState {
  /** 已併入預設值的系統設定（含省流開關與頁首／頁尾需要的欄位） */
  settings: Settings;
  /** 設定是否已判定（讀取失敗亦視為已判定，fail-open＝不影響既有行為） */
  ready: boolean;
  /** 省流開關是否啟用 */
  saverOn: boolean;
}

/**
 * 讀取系統設定並判斷「省流開關」。
 * 列表頁在 ready 之前不得載入列表，否則省流模式下會白打一發請求。
 */
export function useDataSaver(): DataSaverState {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
      })
      .catch((error) => console.error("載入設定失敗:", error))
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { settings, ready, saverOn: ready && settings.dataSaverEnabled };
}
