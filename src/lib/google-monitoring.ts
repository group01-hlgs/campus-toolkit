import "server-only";
import { GoogleAuth } from "google-auth-library";
import { parseServiceAccount } from "@/lib/firebase-admin";

/**
 * Cloud Monitoring 共用元件（僅伺服器端）——統計儀表板的 Firestore 與 App Hosting 用量共用。
 *
 * 職責：服務帳號解析 → 存取權杖（記憶體快取 45 分鐘）→ `projects.timeSeries.list`
 * 呼叫與 Google API 錯誤解析，並提供缺權限／API 未啟用時的授權指引字串。
 * 指標語意（切日、額度表）留在各使用端（`usage-firebase`／`usage-apphosting`）。
 */

export const MONITORING_BASE = "https://monitoring.googleapis.com/v3";
const SCOPES = ["https://www.googleapis.com/auth/monitoring.read"];

export interface GoogleApiError {
  message: string;
  /** `error.details[].reason`（如 `SERVICE_DISABLED`、`ACCESS_NOT_GRANTED`） */
  reasons: string[];
}

/** 解析 Google API 錯誤回應（`{"error":{"code","message","status","details"}}`） */
export function parseGoogleError(body: string): GoogleApiError | null {
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

export interface MonitoringCredentials {
  clientEmail: string;
  privateKey: string;
  projectId: string;
}

export function resolveCredentials():
  | { ok: true; credentials: MonitoringCredentials }
  | { ok: false; message: string } {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "").trim();
  if (!raw) {
    return { ok: false, message: "尚未設定 FIREBASE_SERVICE_ACCOUNT_KEY，無法讀取用量。" };
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
    return {
      ok: false,
      message: `FIREBASE_SERVICE_ACCOUNT_KEY 解析失敗：${process.env.NODE_ENV === "production" ? "金鑰格式錯誤" : msg}`,
    };
  }
}

let tokenCache: { token: string; at: number } | null = null;

export async function getAccessToken(): Promise<string> {
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

export interface TimeSeriesPoint {
  startTime: string;
  value: number;
}

export type TimeSeriesResult =
  | { points: TimeSeriesPoint[] }
  | { error: { status: number; message: string; reasons: string[] } };

interface TimeSeriesResponse {
  timeSeries?: Array<{
    points?: Array<{
      interval?: { startTime?: string };
      value?: { int64Value?: string | number; doubleValue?: number };
    }>;
  }>;
}

/** 抓單一指標在區間內的合計點列（alignmentPeriod 內 ALIGN_SUM＋跨系列 REDUCE_SUM） */
export async function fetchTimeSeries(
  projectId: string,
  options: {
    filter: string;
    startTime: string;
    endTime: string;
    /** Google Duration 字串（如 "3600s"、"86400s"）；寫成純數字會回 400 */
    alignmentPeriod: string;
    perSeriesAligner: string;
    crossSeriesReducer?: string;
    pageSize?: string;
  }
): Promise<TimeSeriesResult> {
  const token = await getAccessToken();
  const url = new URL(`${MONITORING_BASE}/projects/${encodeURIComponent(projectId)}/timeSeries`);
  url.searchParams.set("filter", options.filter);
  url.searchParams.set("interval.startTime", options.startTime);
  url.searchParams.set("interval.endTime", options.endTime);
  url.searchParams.set("aggregation.alignmentPeriod", options.alignmentPeriod);
  url.searchParams.set("aggregation.perSeriesAligner", options.perSeriesAligner);
  // reducer 是 REDUCE_* 常數，寫成 "SUM" 會回 400
  if (options.crossSeriesReducer) url.searchParams.set("aggregation.crossSeriesReducer", options.crossSeriesReducer);
  url.searchParams.set("pageSize", options.pageSize ?? "256");

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
  const points: TimeSeriesPoint[] = [];
  for (const series of body.timeSeries ?? []) {
    for (const point of series.points ?? []) {
      const start = point.interval?.startTime;
      if (!start) continue;
      const rawValue = point.value?.int64Value ?? point.value?.doubleValue ?? 0;
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value === 0) continue;
      points.push({ startTime: start, value });
    }
  }
  return { points };
}

export const MONITORING_SETUP_HINT = `設定步驟：
1. 取得服務帳號信箱（FIREBASE_SERVICE_ACCOUNT_KEY JSON 內的 client_email）
2. 授予 Cloud Monitoring 檢視權限（下方指引已自動帶入專案與服務帳號）
3. 重新部署／重啟後再重新整理本頁
（Cloud Monitoring 指標資料通常有 1～2 分鐘延遲，剛部署時可能尚無資料。）`;

/** 依實際專案／服務帳號產生的授權指引（指令與 Console 路徑都可直接照做） */
export function monitoringPermissionHint(projectId: string, clientEmail: string): string {
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
export function monitoringApiDisabledHint(projectId: string): string {
  return `Cloud Monitoring API 未啟用。請執行：
gcloud services enable monitoring.googleapis.com --project=${projectId}

或在 Console 開啟 https://console.cloud.google.com/apis/library/monitoring.googleapis.com?project=${projectId} 按「啟用」。
啟用後約 1～2 分鐘生效，再重新整理本頁。`;
}
