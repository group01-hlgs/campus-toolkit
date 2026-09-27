import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { defaultSettings } from "@/types/settings";

const SETTINGS_COLLECTION = "settings";
const SETTINGS_DOC_ID = "system";
const CACHE_TTL_MS = 30_000;

let timeoutCache: { minutes: number; at: number } | null = null;
let enabledCache: { enabled: boolean; at: number } | null = null;
let siteNameCache: { name: string; at: number } | null = null;
let emailChangeCache: { allowed: boolean; at: number } | null = null;

/** 設定儲存後呼叫，讓閒置逾時與系統啟用狀態快取立即失效 */
export function invalidateSettingsCache(): void {
  timeoutCache = null;
  enabledCache = null;
  siteNameCache = null;
  emailChangeCache = null;
}

/**
 * 讀取 settings.systemEnabled（維護模式），供伺服器端強制執行。
 * 與閒置逾時共用 30 秒 in-process 快取；讀失敗時回退上次值或預設啟用。
 */
export async function isSystemEnabled(): Promise<boolean> {
  const now = Date.now();
  if (enabledCache && now - enabledCache.at < CACHE_TTL_MS) return enabledCache.enabled;

  try {
    const snap = await getAdminDb()
      .collection(SETTINGS_COLLECTION)
      .doc(SETTINGS_DOC_ID)
      .get();
    const raw = snap.exists
      ? (snap.data() as Record<string, unknown> | undefined)?.systemEnabled
      : undefined;
    const enabled =
      typeof raw === "boolean" ? raw : defaultSettings.systemEnabled;
    enabledCache = { enabled, at: now };
    return enabled;
  } catch (error) {
    console.error("System enabled settings read error:", error);
    if (enabledCache) return enabledCache.enabled;
    return defaultSettings.systemEnabled;
  }
}

/**
 * 讀取 settings.sessionTimeout（分鐘），供伺服器端閒置逾時檢查使用。
 * 以 30 秒 in-process 快取避免每個請求都打 Firestore；讀失敗時回退上次值或預設值。
 */
export async function getSessionTimeoutMinutes(): Promise<number> {
  const now = Date.now();
  if (timeoutCache && now - timeoutCache.at < CACHE_TTL_MS) return timeoutCache.minutes;

  try {
    const snap = await getAdminDb()
      .collection(SETTINGS_COLLECTION)
      .doc(SETTINGS_DOC_ID)
      .get();
    const raw = snap.exists
      ? (snap.data() as Record<string, unknown> | undefined)?.sessionTimeout
      : undefined;
    const minutes = Number(raw);
    const value =
      Number.isFinite(minutes) && minutes >= 1 ? minutes : defaultSettings.sessionTimeout;
    timeoutCache = { minutes: value, at: now };
    return value;
  } catch (error) {
    console.error("Session timeout settings read error:", error);
    if (timeoutCache) return timeoutCache.minutes;
    return defaultSettings.sessionTimeout;
  }
}

/**
 * 讀取 settings.emailChangeAllowed（是否開放使用者自行變更電子郵件地址）。
 * 與閒置逾時共用 30 秒 in-process 快取，避免每個請求都打 Firestore；
 * 讀失敗時回退上次值或預設值（預設開放）。
 */
export async function isEmailChangeAllowed(): Promise<boolean> {
  const now = Date.now();
  if (emailChangeCache && now - emailChangeCache.at < CACHE_TTL_MS) return emailChangeCache.allowed;

  try {
    const snap = await getAdminDb()
      .collection(SETTINGS_COLLECTION)
      .doc(SETTINGS_DOC_ID)
      .get();
    const raw = snap.exists
      ? (snap.data() as Record<string, unknown> | undefined)?.emailChangeAllowed
      : undefined;
    const allowed =
      typeof raw === "boolean" ? raw : defaultSettings.emailChangeAllowed;
    emailChangeCache = { allowed, at: now };
    return allowed;
  } catch (error) {
    console.error("Email change settings read error:", error);
    if (emailChangeCache) return emailChangeCache.allowed;
    return defaultSettings.emailChangeAllowed;
  }
}

/**
 * 取得信件／通知抬頭用的站名（優先學校全名，其次系統名稱）。
 * 與其他設定共用 30 秒快取，讀失敗回退預設名稱。
 */
export async function getSiteName(): Promise<string> {
  const now = Date.now();
  if (siteNameCache && now - siteNameCache.at < CACHE_TTL_MS) return siteNameCache.name;

  try {
    const snap = await getAdminDb()
      .collection(SETTINGS_COLLECTION)
      .doc(SETTINGS_DOC_ID)
      .get();
    const raw = snap.exists
      ? (snap.data() as Record<string, unknown> | undefined)
      : undefined;
    const schoolFullName = typeof raw?.schoolFullName === "string" ? raw.schoolFullName.trim() : "";
    const systemName = typeof raw?.systemName === "string" ? raw.systemName.trim() : "";
    const name = schoolFullName || systemName || "數位校園工具箱";
    siteNameCache = { name, at: now };
    return name;
  } catch (error) {
    console.error("Site name settings read error:", error);
    if (siteNameCache) return siteNameCache.name;
    return "數位校園工具箱";
  }
}
