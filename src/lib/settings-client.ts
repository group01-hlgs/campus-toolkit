"use client";

/**
 * `/api/settings` 的前端共用讀寫（模組層）：
 * - 同時間只發一發請求（in-flight 共用），30 秒內重複請求直接吃快取。
 *   伺服端 readSystemDoc 本就有 30 秒快取，這裡再省掉的是網路與渲染往返。
 * - 任何回應自帶的 `cacheEpoch` 一律採用（伺服器真相），
 *   供 list-store 判斷手上的清單是否已過期。
 *
 * 變更設定後（admin/settings 的 PUT）呼叫 `invalidateSettings()` 捨棄快取，
 * 強制下次讀回最新值（回應的 cacheEpoch 也會一併採用）。
 */

import { Settings } from "@/types/settings";

const TTL_MS = 30_000;

export interface SettingsResponse {
  success?: boolean;
  /** 已併入預設值前的原始設定（各頁自行以 defaultSettings 補預設值） */
  settings?: Partial<Settings>;
  manageable?: boolean;
  /** 清單快取的跨實例失效旗標（number；缺漏表示尚未取得） */
  cacheEpoch?: number;
}

let cache: { data: SettingsResponse; at: number } | null = null;
let inFlight: Promise<SettingsResponse> | null = null;
let epoch: number | null = null;

/** 採用伺服器宣告的目前 epoch（任何形式的回應都可呼叫） */
export function adoptCacheEpoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    epoch = value;
  }
  return epoch;
}

/** 目前已知的 epoch（null＝尚未取得，list-store 會因此拒絕命中） */
export function getCacheEpoch(): number | null {
  return epoch;
}

/** 讀取系統設定（30 秒快取＋同請求去重；force＝捨棄快取重新取得） */
export async function fetchSettings(options?: { force?: boolean }): Promise<SettingsResponse> {
  const force = options?.force === true;
  if (inFlight) return inFlight;
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;

  inFlight = (async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = (res.ok ? await res.json().catch(() => null) : null) as
        | SettingsResponse
        | null;
      if (data && typeof data === "object") {
        cache = { data, at: Date.now() };
        adoptCacheEpoch(data.cacheEpoch);
        return data;
      }
      // 失敗但有舊快取：退回舊值（維持既有 fail-open 行為）
      return cache?.data ?? {};
    } catch {
      return cache?.data ?? {};
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** 捨棄設定快取（設定被寫入後呼叫；新值由下次 fetchSettings 取得） */
export function invalidateSettings(): void {
  cache = null;
}
