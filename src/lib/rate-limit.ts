import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/audit";

/**
 * 進程內 sliding-window rate limiter。
 * 注意：serverless 冷卻或多實例會重置／分割計數，屬簡易防護；
 * 若需跨實例請改用 Upstash 等外部儲存。以下至少確保：
 * ① IP 來源不信可偽造的 XFF 首段（見 audit.ts getClientIp）
 * ② 桶滿時逐筆淘汰最久未使用，絕不整表清空（避免登入等限流被重置）
 */

interface Bucket {
  hits: number[];
  lastSeen: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10000;

function prune(bucket: Bucket, now: number, windowMs: number): void {
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
}

function pruneAll(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.hits.length === 0) buckets.delete(key);
  }
  if (buckets.size < MAX_BUCKETS) return;
  // 仍滿：只淘汰最久未使用的個別桶，禁止 buckets.clear() 全清
  const overflow = buckets.size - MAX_BUCKETS + 1;
  const byOldest = [...buckets.entries()].sort(
    (a, b) => a[1].lastSeen - b[1].lastSeen
  );
  for (let i = 0; i < overflow && i < byOldest.length; i += 1) {
    buckets.delete(byOldest[i][0]);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  pruneAll(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [], lastSeen: now };
    buckets.set(key, bucket);
  }
  prune(bucket, now, windowMs);
  bucket.lastSeen = now;

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    const retryAfterMs = windowMs - (now - oldest);
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  bucket.hits.push(now);
  return {
    ok: true,
    remaining: limit - bucket.hits.length,
    retryAfterSec: 0,
  };
}

export function clientKey(request: NextRequest, suffix = ""): string {
  const ip = getClientIp(request) || "unknown";
  return suffix ? `${ip}:${suffix}` : ip;
}

export function tooManyRequests(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { success: false, message: "請求過於頻繁，請稍後再試" },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    }
  );
}

export function enforceRateLimit(
  request: NextRequest,
  bucketName: string,
  limit: number,
  windowMs: number,
  suffix = ""
): NextResponse | null {
  const result = checkRateLimit(
    `${bucketName}:${clientKey(request, suffix)}`,
    limit,
    windowMs
  );
  if (!result.ok) return tooManyRequests(result.retryAfterSec);
  return null;
}

/**
 * 帳號維度限流：以 role:account 為 key，不依賴 IP，
 * 即使 IP 無法取得或可偽造，仍能擋住針對單一帳號的爆破。
 * 注意：仍為進程內計數；跨實例的持久化防護見 login 路由的 Firestore failedAttempts／全域鎖定。
 */
export function enforceAccountRateLimit(
  bucketName: string,
  role: string,
  account: string,
  limit: number,
  windowMs: number
): NextResponse | null {
  const key = `${bucketName}:acct:${role}:${account.toLowerCase()}`;
  const result = checkRateLimit(key, limit, windowMs);
  if (!result.ok) return tooManyRequests(result.retryAfterSec);
  return null;
}

export const RATE = {
  LOGIN: { limit: 10, windowMs: 60_000 },
  LOGIN_ACCOUNT: { limit: 30, windowMs: 15 * 60_000 },
  GOOGLE: { limit: 10, windowMs: 60_000 },
  CHANGE_PASSWORD: { limit: 10, windowMs: 60_000 },
  /** 忘記密碼寄信：每 IP 每分鐘 5 次（每次請求都可能真的寄信） */
  FORGOT_PASSWORD: { limit: 5, windowMs: 60_000 },
  /** 同一電子郵件的節流（規格書 §九 pwd_reset_req 120s 的加強版） */
  FORGOT_PASSWORD_EMAIL: { limit: 3, windowMs: 10 * 60_000 },
  /** 重設密碼：驗證＋寫入 */
  RESET_PASSWORD: { limit: 10, windowMs: 60_000 },
  /** 重設連結驗證失敗次數（防 token 暴力猜測／亂試） */
  RESET_PASSWORD_FAIL: { limit: 10, windowMs: 15 * 60_000 },
  KEEPALIVE: { limit: 60, windowMs: 60_000 },
  LOGOUT: { limit: 30, windowMs: 60_000 },
  SETTINGS_GET: { limit: 60, windowMs: 60_000 },
  ADMIN_CREATE: { limit: 5, windowMs: 60 * 60_000 },
  ADMIN_CREATE_STATUS: { limit: 30, windowMs: 60_000 },
  ADMIN_LIST: { limit: 60, windowMs: 60_000 },
  ADMIN_MUTATE: { limit: 10, windowMs: 60 * 60_000 },
  ADMIN_ACTIVITY: { limit: 120, windowMs: 60_000 },
  LEADERBOARD_GET: { limit: 60, windowMs: 60_000 },
  LEADERBOARD_POST: { limit: 20, windowMs: 60_000 },
  /** 兩階段驗證：重發 Email OTP（本身另有同用戶 120 秒節流） */
  TWO_FA_RESEND: { limit: 5, windowMs: 10 * 60_000 },
  /** 兩階段驗證：驗證碼提交（同用戶失敗次數另計於 lib/two-factor.ts） */
  TWO_FA_VERIFY: { limit: 20, windowMs: 15 * 60_000 },
  TWO_FA_STATUS: { limit: 60, windowMs: 60_000 },
  /** 選擇登入身分（帳密／兩階段驗證已通過，非暴力猜測目標） */
  ROLE_CHOICE: { limit: 30, windowMs: 60_000 },
  /** 已登入後切換身分（沿用既有 session，無需重新驗證） */
  SWITCH_ROLE: { limit: 30, windowMs: 60_000 },
  /** 帳號與安全：讀取自身資料 */
  ACCOUNT_GET: { limit: 60, windowMs: 60_000 },
  /** 帳號與安全：電子郵件／帳號即時查重（輸入時 debounce 呼叫，故額度較寬） */
  ACCOUNT_CHECK: { limit: 60, windowMs: 60_000 },
  /** 帳號與安全：儲存信箱／帳號 */
  ACCOUNT_UPDATE: { limit: 10, windowMs: 60_000 },
  /** 帳號與安全：設定兩階段驗證方式／重新產生 TOTP 密鑰 */
  TWO_FACTOR_SET: { limit: 10, windowMs: 60_000 },
  /** 使用者帳號管理：讀取全帳號工作表 */
  ACCOUNTS_LIST: { limit: 60, windowMs: 60_000 },
  /** 使用者帳號管理：新增／更新／狀態／刪除（含 bcrypt，額度從嚴） */
  ACCOUNTS_MUTATE: { limit: 20, windowMs: 60_000 },
  /** 使用者帳號管理：批次作業（預覽與執行各計一次；執行依模式自動分批，每批各計一次） */
  ACCOUNTS_BATCH: { limit: 60, windowMs: 60 * 60_000 },
  /** 身分名冊管理：讀取該身分名冊清單 */
  ROSTER_LIST: { limit: 60, windowMs: 60_000 },
  /** 身分名冊管理：單筆新增／更新／刪除（每筆都要 bcrypt，額度從嚴） */
  ROSTER_MUTATE: { limit: 20, windowMs: 60_000 },
  /** 身分名冊管理：批次作業（預覽與執行各計一次，單批最多 900 列，新增模式每列都要 bcrypt） */
  ROSTER_BATCH: { limit: 10, windowMs: 60 * 60_000 },
  /** 身分名冊管理：讀取該期四種身分的啟用狀態 */
  ROLE_SETTINGS_GET: { limit: 60, windowMs: 60_000 },
  /** 身分名冊管理：啟用／停用身分（現行開關） */
  ROLE_SETTINGS_MUTATE: { limit: 30, windowMs: 60_000 },
  /** 學校基本設定：讀取單位層級設定 */
  SCHOOL_ORG_GET: { limit: 60, windowMs: 60_000 },
  /** 學校基本設定：儲存單位層級設定（整份覆寫，數量與變動較大） */
  SCHOOL_ORG_MUTATE: { limit: 20, windowMs: 60_000 },
  /** 學校基本設定：讀取校務基本資料 */
  SCHOOL_PROFILE_GET: { limit: 60, windowMs: 60_000 },
  /** 學校基本設定：儲存校務基本資料（整份覆寫） */
  SCHOOL_PROFILE_MUTATE: { limit: 20, windowMs: 60_000 },
  /** 學校基本設定：讀取年段班級設定 */
  SCHOOL_CLASSES_GET: { limit: 60, windowMs: 60_000 },
  /** 學校基本設定：儲存年段班級設定（整份覆寫，班級數量較多） */
  SCHOOL_CLASSES_MUTATE: { limit: 20, windowMs: 60_000 },
  /** 學校基本設定：讀取各式代碼表（清單較長） */
  SCHOOL_CODES_GET: { limit: 60, windowMs: 60_000 },
  /** 學校基本設定：儲存各式代碼表（整份覆寫，科別可達千筆） */
  SCHOOL_CODES_MUTATE: { limit: 20, windowMs: 60_000 },
  /** 功能模組管理：讀取選用模組的啟用狀態 */
  FEATURE_MODULES_GET: { limit: 60, windowMs: 60_000 },
  /** 功能模組管理：啟用／停用選用模組（僅超級管理員） */
  FEATURE_MODULES_MUTATE: { limit: 30, windowMs: 60_000 },
} as const;
