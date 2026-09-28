import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { defaultSettings, DEFAULT_SYSTEM_NAME } from "@/types/settings";

const SETTINGS_COLLECTION = "settings";
const SETTINGS_DOC_ID = "system";
const CACHE_TTL_MS = 30_000;

let timeoutCache: { minutes: number; at: number } | null = null;
let enabledCache: { enabled: boolean; at: number } | null = null;
let identityCache: { systemName: string; schoolFullName: string; at: number } | null = null;
let emailChangeCache: { allowed: boolean; at: number } | null = null;

/** è¨­å??²å?å¾Œå‘¼?«ï?è®“é?ç½®é€¾æ??‡ç³»çµ±å??¨ç??‹å¿«?–ç??³å¤±??*/
export function invalidateSettingsCache(): void {
  timeoutCache = null;
  enabledCache = null;
  identityCache = null;
  emailChangeCache = null;
}

/**
 * è®€??settings.systemEnabledï¼ˆç¶­è­·æ¨¡å¼ï?ï¼Œä?ä¼ºæ??¨ç«¯å¼·åˆ¶?·è???
 * ?‡é?ç½®é€¾æ??±ç”¨ 30 ç§?in-process å¿«å?ï¼›è?å¤±æ??‚å??€ä¸Šæ¬¡?¼æ??è¨­?Ÿç”¨??
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
 * è®€??settings.sessionTimeoutï¼ˆå??˜ï?ï¼Œä?ä¼ºæ??¨ç«¯?’ç½®?¾æ?æª¢æŸ¥ä½¿ç”¨??
 * ä»?30 ç§?in-process å¿«å??¿å?æ¯å€‹è?æ±‚éƒ½??Firestoreï¼›è?å¤±æ??‚å??€ä¸Šæ¬¡?¼æ??è¨­?¼ã€?
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
 * è®€??settings.emailChangeAllowedï¼ˆæ˜¯?¦é??¾ä½¿?¨è€…è‡ªè¡Œè??´é›»å­éƒµä»¶åœ°?€ï¼‰ã€?
 * ?‡é?ç½®é€¾æ??±ç”¨ 30 ç§?in-process å¿«å?ï¼Œé¿?æ??‹è?æ±‚éƒ½??Firestoreï¼?
 * è®€å¤±æ??‚å??€ä¸Šæ¬¡?¼æ??è¨­?¼ï??è¨­?‹æ”¾ï¼‰ã€?
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
 * è®€?–ä¿¡ä»¶æŠ¬?­ç”¨?„å…©?‹å?ç¨±ï?ç³»çµ±ï¼ˆç?å¼ï??ªå‘½?è?å­¸æ ¡?¨ç¨±??
 * ?‡å…¶ä»–è¨­å®šå…±??30 ç§’å¿«?–ï?è®€å¤±æ??é€€ä¸Šæ¬¡?¼æ?ç©ºå?ä¸²ã€?
 */
async function readIdentity(): Promise<{ systemName: string; schoolFullName: string }> {
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
    const systemName = typeof raw?.systemName === "string" ? raw.systemName.trim() : "";
    identityCache = { systemName, schoolFullName, at: now };
    return identityCache;
  } catch (error) {
    console.error("Site name settings read error:", error);
    return identityCache ?? { systemName: "", schoolFullName: "" };
  }
}

/**
 * ?–å?ä¿¡ä»¶ï¼é€šçŸ¥?¬é ­?¨ç?ç«™å?ï¼ˆå„ª?ˆå­¸?¡å…¨?ï??¶æ¬¡ç³»çµ±?ç¨±ï¼‰ã€?
 * ?‡å…¶ä»–è¨­å®šå…±??30 ç§’å¿«?–ï?è®€å¤±æ??é€€?è¨­?ç¨±??
 */
export async function getSiteName(): Promise<string> {
  const { systemName, schoolFullName } = await readIdentity();
  return schoolFullName || systemName || DEFAULT_SYSTEM_NAME;
}

/**
 * ?–å?ä¿¡ä»¶?¬é ­?¨ç?è­˜åˆ¥?ç¨±ï¼?
 * systemName ä¸€å¾‹æ??¼ï??ªè‡ª?½å??‚ç”¨?è¨­ç³»çµ±?ç¨±ï¼‰ï?schoolFullName ?¯ç‚ºç©ºã€?
 * ä¿¡ä»¶ä»¥ã€Œç³»çµ±å?ç¨±ï?å­¸æ ¡?ç¨±?ä½µ?—ï?è®“æ”¶ä»¶äºº?¥é?ä¿¡ä»¶ä¾†è‡ª?ªä??‹ç?å¼ç³»çµ±ã€?
 */
export async function getMailIdentity(): Promise<{
  systemName: string;
  schoolFullName: string;
}> {
  const { systemName, schoolFullName } = await readIdentity();
  return { systemName: systemName || DEFAULT_SYSTEM_NAME, schoolFullName };
}
