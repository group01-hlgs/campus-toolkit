import "server-only";
import { GoogleAuth } from "google-auth-library";
import { parseServiceAccount } from "@/lib/firebase-admin";
import type { FirebaseUsage, FirestoreDayUsage } from "@/types/usage";

/**
 * Firebase（Firestore）用量抓取（僅伺服器端）。
 *
 * 資料來源：Cloud Monitoring `projects.timeSeries.list`，指標
 * `firestore.googleapis.com/document/{read,write,delete}_count`（皆為 delta 指標，
 * 以小時桶 ALIGN_SUM 聚合，程式再依「太平洋時間」切成日曆日——Firestore 免費額度
 * 於太平洋時間每日午夜重置）。
 *
 * 權限：`FIREBASE_SERVICE_ACCOUNT_KEY` 的服務帳號需具 `roles/monitoring.viewer`
 * （見頁面顯示的 gcloud 指引）。
 *
 * - 未設定服務帳號：回 `configured=false` ＋設定指引。
 * - 5 分鐘記憶體快取（失敗結果只快取 30 秒）。
 */

const MONITORING_BASE = "https://monitoring.googleapis.com/v3";
const CACHE_MS = 5 * 60_000;
const CACHE_FAIL_MS = 30_000;
const SCOPES = ["https://www.googleapis.com/auth/monitoring.read"];
const TZ = "America/Los_Angeles";
const HOUR_SECONDS = 3600;
const TREND_DAYS = 7;

/** Firestore 每日免費額度（見 Firebase 定價文件） */
export const FIRESTORE_FREE_LIMITS = {
  reads: 50_000,
  writes: 20_000,
  deletes: 20_000,
} as const;

const METRICS = {
  reads: "firestore.googleapis.com/document/read_count",
  writes: "firestore.googleapis.com/document/write_count",
  deletes: "firestore.googleapis.com/document/delete_count",
} as const;

const SETUP_HINT = `設定步驟：
1. 取得服務帳號信箱（FIREBASE_SERVICE_ACCOUNT_KEY JSON 內的 client_email）
2. 授予 Cloud Monitoring 檢視權限（下方指引已自動帶入專案與服務帳號）
3. 重新部署／重啟後再重新整理本頁
（Cloud Monitoring 指標資料通常有 1～2 分鐘延遲，剛部署時可能尚無資料。）`;

/** 依實際專案／服務帳號產生的授權指引（指令與 Console 路徑都可直接照做） */
function permissionHint(projectId: string, clientEmail: string): string {
  return `服務帳號缺少 Cloud Monitoring 權限。兩種授予方式（任選其一）：

【方式一·Google Cloud Console】
1. 開啟 https://console.cloud.google.com/iam-admin/iam?project=${projectId}
   （是 Google Cloud Console 的「IAM」頁，不是 Firebase Console 的服務帳號頁——後者的角色清單只有 Firebase 相關角色）
2. 找到 ${clientEmail} → 按鉛筆（編輯）→ 「新增角色」
3. 搜尋框輸入 Monitoring Viewer（角色 ID：roles/monitoring.viewer，位於 Monitoring／Cloud Monitoring 分類下；
   Console 顯示名稱是 Monitoring Viewer，不是「Cloud Monitoring Viewer」）→ 選取 → 儲存
4. 若搜尋不到或無法儲存，代表你的帳號不是專案 Owner（授予角色需 Owner），請找專案 Owner 代為授予

【方式二·gcloud】
gcloud projects add-iam-policy-binding ${projectId} \\
  --member="serviceAccount:${clientEmail}" \\
  --role="roles/monitoring.viewer"

授予後約 1～2 分鐘生效，再重新整理本頁。`;
}

/** Cloud Monitoring API 未啟用的指引 */
function apiDisabledHint(projectId: string): string {
  return `Cloud Monitoring API 未啟用。請執行：
gcloud services enable monitoring.googleapis.com --project=${projectId}

或在 Console 開啟 https://console.cloud.google.com/apis/library/monitoring.googleapis.com?project=${projectId} 按「啟用」。
啟用後約 1～2 分鐘生效，再重新整理本頁。`;
}

// ---------------------------------------------------------------------------
// 太平洋時間日曆日工具（額度以太平洋午夜重置）
// ---------------------------------------------------------------------------

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

/** 指定時刻所屬的太平洋日曆日 00:00（UTC 時刻） */
function startOfPacificDay(date: Date): Date {
  let offset = timeZoneOffsetMs(date, TZ);
  const build = (): Date => {
    const local = new Date(date.getTime() + offset);
    const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    return new Date(startLocal - offset);
  };
  let result = build();
  // 跨日光節約時以「當日實際 offset」重算一次，避免午夜落在 1 小時誤差
  const secondOffset = timeZoneOffsetMs(result, TZ);
  if (secondOffset !== offset) {
    offset = secondOffset;
    result = build();
  }
  return result;
}

/** 指定時刻的太平洋日曆日（"YYYY-MM-DD"） */
function pacificDateKey(date: Date): string {
  const local = new Date(date.getTime() + timeZoneOffsetMs(date, TZ));
  return local.toISOString().slice(0, 10);
}

/** 近 N 個太平洋日曆日（由舊到新，含今日） */
function recentDayKeys(count: number, now: Date): string[] {
  const today = startOfPacificDay(now);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    keys.push(pacificDateKey(new Date(today.getTime() - i * 24 * 3600_000)));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Cloud Monitoring 呼叫
// ---------------------------------------------------------------------------

interface TimeSeriesResponse {
  timeSeries?: Array<{
    points?: Array<{
      interval?: { startTime?: string };
      value?: { int64Value?: string | number; doubleValue?: number };
    }>;
  }>;
}

/** 解析 Google API 錯誤回應（`{"error":{"code","message","status","details"}}`） */
interface GoogleApiError {
  message: string;
  /** `error.details[].reason`（如 `SERVICE_DISABLED`、`ACCESS_NOT_GRANTED`） */
  reasons: string[];
}

function parseGoogleError(body: string): GoogleApiError | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown; status?: unknown; details?: { reason?: unknown }[] };
    };
    const err = parsed?.error;
    if (!err || typeof err !== "object") return null;
    const text = [err.status, err.message]
      .map((p) => (typeof p === "string" && p.trim() ? p.trim() : ""))
      .filter(Boolean)
      .join("：");
    const reasons = (Array.isArray(err.details) ? err.details : [])
      .map((d) => (typeof d?.reason === "string" ? d.reason : ""))
      .filter(Boolean);
    if (!text && !reasons.length) return null;
    return { message: text, reasons };
  } catch {
    return null;
  }
}

let tokenCache: { token: string; at: number } | null = null;

interface Credentials {
  clientEmail: string;
  privateKey: string;
  projectId: string;
}

function resolveCredentials(): { ok: true; credentials: Credentials } | { ok: false; message: string } {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "").trim();
  if (!raw) {
    return { ok: false, message: "尚未設定 FIREBASE_SERVICE_ACCOUNT_KEY，無法讀取 Firestore 用量。" };
  }
  try {
    const sa = parseServiceAccount(raw) as unknown as Record<string, unknown>;
    const pick = (...keys: string[]): string => {
      for (const key of keys) {
        const value = sa[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    };
    const clientEmail = pick("client_email", "clientEmail");
    const privateKey = pick("private_key", "privateKey");
    const projectId = pick("project_id", "projectId") || (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
    if (!clientEmail || !privateKey || !projectId) {
      return { ok: false, message: "FIREBASE_SERVICE_ACCOUNT_KEY 缺少必要欄位（client_email／private_key／project_id）。" };
    }
    return { ok: true, credentials: { clientEmail, privateKey, projectId } };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `FIREBASE_SERVICE_ACCOUNT_KEY 解析失敗：${process.env.NODE_ENV === "production" ? "金鑰格式錯誤" : msg}` };
  }
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < 45 * 60_000) return tokenCache.token;
  const resolved = resolveCredentials();
  if (!resolved.ok) throw new Error(resolved.message);
  const auth = new GoogleAuth({
    credentials: {
      client_email: resolved.credentials.clientEmail,
      private_key: resolved.credentials.privateKey,
      project_id: resolved.credentials.projectId,
    },
    scopes: SCOPES,
  });
  const client = await auth.getClient();
  const result = await client.getAccessToken();
  const token = typeof result === "string" ? result : result.token;
  if (!token) throw new Error("無法取得 Cloud Monitoring 存取權杖");
  tokenCache = { token, at: Date.now() };
  return token;
}

/** 抓單一指標在區間內的每小時合計，回 `日期 → 次數` */
async function fetchDailyCounts(
  projectId: string,
  metricType: string,
  startTime: string,
  endTime: string
): Promise<
  { daily: Map<string, number> } | { error: { status: number; message: string; reasons: string[] } }
> {
  const token = await getAccessToken();
  const url = new URL(`${MONITORING_BASE}/projects/${encodeURIComponent(projectId)}/timeSeries`);
  url.searchParams.set("filter", `metric.type = "${metricType}" AND resource.type = "firestore_instance"`);
  url.searchParams.set("interval.startTime", startTime);
  url.searchParams.set("interval.endTime", endTime);
  // 時期須為 Google Duration 字串（"3600s"），寫成 "3600" 會回 400
  url.searchParams.set("aggregation.alignmentPeriod", `${HOUR_SECONDS}s`);
  url.searchParams.set("aggregation.perSeriesAligner", "ALIGN_SUM");
  // reducer 是 REDUCE_* 常數，寫成 "SUM" 會回 400
  url.searchParams.set("aggregation.crossSeriesReducer", "REDUCE_SUM");
  url.searchParams.set("pageSize", "256");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const parsed = parseGoogleError(body);
    return {
      error: {
        status: res.status,
        message: parsed?.message || body.slice(0, 300),
        reasons: parsed?.reasons ?? [],
      },
    };
  }
  const body = (await res.json()) as TimeSeriesResponse;
  const daily = new Map<string, number>();
  for (const series of body.timeSeries ?? []) {
    for (const point of series.points ?? []) {
      const start = point.interval?.startTime;
      if (!start) continue;
      const rawValue = point.value?.int64Value ?? point.value?.doubleValue ?? 0;
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value === 0) continue;
      const key = pacificDateKey(new Date(start));
      daily.set(key, (daily.get(key) ?? 0) + value);
    }
  }
  return { daily };
}

// ---------------------------------------------------------------------------
// 對外介面
// ---------------------------------------------------------------------------

let cache: { at: number; data: FirebaseUsage } | null = null;

/** 取得 Firestore 今日與近 7 日用量（任何失敗都回結構化結果，不丟例外） */
export async function getFirebaseUsage(): Promise<FirebaseUsage> {
  const cached = cache;
  if (cached && Date.now() - cached.at < (cached.data.ok ? CACHE_MS : CACHE_FAIL_MS)) {
    return cached.data;
  }
  const data = await loadFirebaseUsage();
  cache = { at: Date.now(), data };
  return data;
}

function emptyUsage(partial?: Partial<FirebaseUsage>): FirebaseUsage {
  return {
    ok: false,
    configured: false,
    message: null,
    hint: null,
    fetchedAt: new Date().toISOString(),
    today: { reads: 0, writes: 0, deletes: 0 },
    limits: { ...FIRESTORE_FREE_LIMITS },
    daily: [],
    ...partial,
  };
}

async function loadFirebaseUsage(): Promise<FirebaseUsage> {
  const resolved = resolveCredentials();
  if (!resolved.ok) {
    return emptyUsage({ configured: false, message: resolved.message, hint: SETUP_HINT });
  }

  const now = new Date();
  const dayKeys = recentDayKeys(TREND_DAYS, now);
  const startTime = startOfPacificDay(new Date(now.getTime() - (TREND_DAYS - 1) * 24 * 3600_000)).toISOString();
  const endTime = now.toISOString();
  const projectId = resolved.credentials.projectId;

  try {
    const results = await Promise.all(
      (Object.values(METRICS) as string[]).map((metricType) =>
        fetchDailyCounts(projectId, metricType, startTime, endTime)
      )
    );

    const failure = results.find(
      (result): result is { error: { status: number; message: string; reasons: string[] } } => "error" in result
    );
    if (failure) {
      const { status, message, reasons } = failure.error;
      const reasonText = reasons.length ? `（${reasons.join("、")}）` : "";
      const diagnostics = [
        "診斷資訊：",
        `- 端點：GET ${MONITORING_BASE}/projects/${projectId}/timeSeries`,
        `- 專案：${projectId}；服務帳號：${resolved.credentials.clientEmail}`,
        `- 區間：${startTime} ~ ${endTime}（UTC）`,
        `- 參數：alignmentPeriod=${HOUR_SECONDS}s、perSeriesAligner=ALIGN_SUM、crossSeriesReducer=REDUCE_SUM`,
        `- 指標：${Object.values(METRICS).join("、")}`,
        `- 回應：HTTP ${status}${message ? `：${message}` : ""}${reasonText}`,
      ].join("\n");
      if (status === 401 || status === 403) {
        const apiDisabled = reasons.includes("SERVICE_DISABLED");
        return emptyUsage({
          configured: true,
          message: apiDisabled
            ? `Cloud Monitoring API 未啟用${reasonText}，無法讀取 Firestore 用量。`
            : `服務帳號缺少 Cloud Monitoring 權限${reasonText}（${status}），無法讀取 Firestore 用量。`,
          hint: `${apiDisabled ? apiDisabledHint(projectId) : permissionHint(projectId, resolved.credentials.clientEmail)}\n\n${diagnostics}`,
        });
      }
      const guidance =
        status === 404
          ? "找不到專案或 Cloud Monitoring API 未啟用：請在 Google Cloud Console 啟用 Cloud Monitoring API（gcloud services enable monitoring.googleapis.com），並確認 FIREBASE_SERVICE_ACCOUNT_KEY 內的 project_id 正確。"
          : status === 429
            ? "已達 Cloud Monitoring API 速率限制，請稍後再試（本頁伺服端每 5 分鐘快取一次）。"
            : status === 400
              ? "查詢參數被拒（400）：請附上下方回應訊息回報，並確認 Cloud Monitoring API 已啟用。"
              : "請稍後再試；若持續失敗，請附上下方診斷資訊回報。";
      return emptyUsage({
        configured: true,
        message: `讀取 Firestore 用量失敗：Cloud Monitoring API 回 ${status}${message ? `：${message}` : ""}`,
        hint: `${guidance}\n\n${diagnostics}`,
      });
    }

    const [reads, writes, deletes] = results.map((result) => ("daily" in result ? result.daily : new Map<string, number>()));
    const daily: FirestoreDayUsage[] = dayKeys.map((date) => ({
      date,
      reads: reads.get(date) ?? 0,
      writes: writes.get(date) ?? 0,
      deletes: deletes.get(date) ?? 0,
    }));
    const todayKey = dayKeys[dayKeys.length - 1];
    const today = daily.find((item) => item.date === todayKey) ?? { reads: 0, writes: 0, deletes: 0 };

    return {
      ok: true,
      configured: true,
      message: null,
      hint: null,
      fetchedAt: new Date().toISOString(),
      today: { reads: today.reads, writes: today.writes, deletes: today.deletes },
      limits: { ...FIRESTORE_FREE_LIMITS },
      daily,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return emptyUsage({
      configured: true,
      message: `讀取 Firestore 用量失敗：${msg}`,
      hint: permissionHint(projectId, resolved.credentials.clientEmail),
    });
  }
}
