import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { defaultSettings, DEFAULT_SYSTEM_NAME, detectPeriod, SchoolPeriod } from "@/types/settings";

export const SETTINGS_COLLECTION = "settings";
export const SETTINGS_DOC_ID = "system";
const CACHE_TTL_MS = 30_000;

let timeoutCache: { minutes: number; at: number } | null = null;
let enabledCache: { enabled: boolean; at: number } | null = null;
let identityCache: {
  systemName: string;
  schoolFullName: string;
  schoolShortName: string;
  at: number;
} | null = null;
let emailChangeCache: { allowed: boolean; at: number } | null = null;
let periodCache: { value: SchoolPeriod; at: number } | null = null;

/** 設定儲存後呼叫，讓閒置逾時與系統啟用狀態快取立即失效 */
export function invalidateSettingsCache(): void {
  timeoutCache = null;
  enabledCache = null;
  identityCache = null;
  emailChangeCache = null;
  periodCache = null;
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
 * 讀取識別名稱用的三個欄位：系統（程式）自命名、學校全稱、學校簡稱。
 * 與其他設定共用 30 秒快取，讀失敗回退上次值或空字串。
 */
async function readIdentity(): Promise<{
  systemName: string;
  schoolFullName: string;
  schoolShortName: string;
}> {
  const now = Date.now();
  if (identityCache && now - identityCache.at < CACHE_TTL_MS) return identityCache;

  try {
    const snap = await getAdminDb()
      .collection(SETTINGS_COLLECTION)
      .doc(SETTINGS_DOC_ID)
      .get();
    const raw = snap.exists
      ? (snap.data() as Record<string, unknown> | undefined)
      : undefined;
    const schoolFullName = typeof raw?.schoolFullName === "string" ? raw.schoolFullName.trim() : "";
    const schoolShortName = typeof raw?.schoolShortName === "string" ? raw.schoolShortName.trim() : "";
    const systemName = typeof raw?.systemName === "string" ? raw.systemName.trim() : "";
    identityCache = { systemName, schoolFullName, schoolShortName, at: now };
    return identityCache;
  } catch (error) {
    console.error("Identity settings read error:", error);
    return identityCache ?? { systemName: "", schoolFullName: "", schoolShortName: "" };
  }
}

/**
 * 目前學年度與學期（settings.system 的 academicYear／semester）。
 * 身分名冊（roster 集合）寫入與讀取都以這個期間為準，與其他設定共用 30 秒快取；
 * 欄位缺漏或讀失敗時回退依日期推算的值。
 */
export async function getCurrentPeriod(): Promise<SchoolPeriod> {
  const now = Date.now();
  if (periodCache && now - periodCache.at < CACHE_TTL_MS) return periodCache.value;

  try {
    const snap = await getAdminDb()
      .collection(SETTINGS_COLLECTION)
      .doc(SETTINGS_DOC_ID)
      .get();
    const raw = snap.exists ? (snap.data() as Record<string, unknown> | undefined) : undefined;
    const fallback = detectPeriod();
    const academicYear = Number(raw?.academicYear);
    const semester = Number(raw?.semester);
    const value: SchoolPeriod = {
      academicYear:
        Number.isFinite(academicYear) && academicYear > 0 ? academicYear : fallback.academicYear,
      semester: semester === 1 || semester === 2 ? semester : fallback.semester,
    };
    periodCache = { value, at: now };
    return value;
  } catch (error) {
    console.error("Current period settings read error:", error);
    if (periodCache) return periodCache.value;
    return detectPeriod();
  }
}

/**
 * 驗證碼APP（TOTP）的發行者名稱，顯示為「系統名稱-學校簡稱：帳號」。
 * 學校簡稱未填時退用學校全稱，兩者都沒填時只顯示系統名稱。
 */
export async function getTotpIssuer(): Promise<string> {
  const { systemName, schoolFullName, schoolShortName } = await readIdentity();
  const system = systemName || DEFAULT_SYSTEM_NAME;
  const school = schoolShortName || schoolFullName;
  return school ? `${system}-${school}` : system;
}

/**
 * 取得信件抬頭用的識別名稱：
 * systemName 一律有值（未自命名時用預設系統名稱），schoolFullName 可為空。
 * 信件以「系統名稱｜學校名稱」併列，讓收件人知道信件來自哪一個程式系統。
 */
export async function getMailIdentity(): Promise<{
  systemName: string;
  schoolFullName: string;
}> {
  const { systemName, schoolFullName } = await readIdentity();
  return { systemName: systemName || DEFAULT_SYSTEM_NAME, schoolFullName };
}
