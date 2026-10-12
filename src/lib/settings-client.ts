"use client";

/**
 * `/api/settings` 的前端共用讀寫（模組層）：
 * - 快取依「目前 session 身分」分槽（未登入＝"anon"），30 秒內同身分重複請求
 *   直接吃快取；身分一變（登入／登出／切換／選身分）key 自然不符 → 強制重抓，
 *   避免舊身分的 visibleModules 在新身分頁殘留（入口卡鬼魂）或反向全數消失。
 * - 同身分內併入 in-flight 去重，避免同畫面多處呼叫重複打網路。
 * - 任何回應自帶的 `cacheEpoch` 一律採用（伺服器真相），
 *   供 list-store 判斷手上的清單是否已過期。
 *
 * 變更設定後（admin/settings 的 PUT）或身分切換（RoleSwitcher）呼叫
 * `invalidateSettings()` 捨棄全部分槽，強制下次讀回最新值。
 */

import { Settings } from "@/types/settings";
import { getCachedSession } from "@/lib/session";

const TTL_MS = 30_000;

/**
 * 快取分槽的 key＝目前 session 身分（未登入＝"anon"）。
 * 回應中的 visibleModules 是伺服器依「當時身分」算的；身分一變
 * （登入／登出／切換／選身分），key 自然不符 → 強制重抓，
 * 避免舊身分的可見清單在新身分頁殘留（入口卡鬼魂）或反向全數消失。
 */
function roleKey(): string {
  return getCachedSession()?.role ?? "anon";
}

export interface SettingsResponse {
  success?: boolean;
  /** 已併入預設值前的原始設定（各頁自行以 defaultSettings 補預設值） */
  settings?: Partial<Settings>;
  manageable?: boolean;
  /** 目前身分可見的功能模組代碼（提供功能 AND 顯示與否；未登入＝空陣列） */
  visibleModules?: string[];
  /** 清單快取的跨實例失效旗標（number；缺漏表示尚未取得） */
  cacheEpoch?: number;
}

let cache = new Map<string, { data: SettingsResponse; at: number }>();
let inFlight = new Map<string, Promise<SettingsResponse>>();
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

/** 讀取系統設定（依身分分槽的 30 秒快取＋同身分去重；force＝捨棄快取重新取得） */
export async function fetchSettings(options?: { force?: boolean }): Promise<SettingsResponse> {
  const force = options?.force === true;
  const key = roleKey();
  const pending = inFlight.get(key);
  if (pending) return pending;
  if (!force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  }

  const promise = (async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = (res.ok ? await res.json().catch(() => null) : null) as
        | SettingsResponse
        | null;
      if (data && typeof data === "object") {
        cache.set(key, { data, at: Date.now() });
        adoptCacheEpoch(data.cacheEpoch);
        return data;
      }
      // 失敗但有舊快取：退回舊值（維持既有 fail-open 行為）
      return cache.get(key)?.data ?? {};
    } catch {
      return cache.get(key)?.data ?? {};
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** 捨棄全部身分的設定快取（設定被寫入或身分切換後呼叫；新值由下次 fetchSettings 取得） */
export function invalidateSettings(): void {
  cache.clear();
}
