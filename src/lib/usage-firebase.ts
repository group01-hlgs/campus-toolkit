import "server-only";
import {
  MONITORING_BASE,
  MONITORING_SETUP_HINT,
  fetchTimeSeries,
  monitoringApiDisabledHint,
  monitoringPermissionHint,
  resolveCredentials,
} from "@/lib/google-monitoring";
import type { FirebaseUsage, FirestoreDayUsage, UsageLink } from "@/types/usage";

/**
 * Firebase（Firestore）用量抓取（僅伺服器端）。
 *
 * 資料來源：Cloud Monitoring `projects.timeSeries.list`，指標
 * `firestore.googleapis.com/document/{read,write,delete}_count`（皆為 delta 指標，
 * 以小時桶 ALIGN_SUM 聚合，程式再依「太平洋時間」切成日曆日——Firestore 免費額度
 * 於太平洋時間每日午夜重置）。
 *
 * 權限：`FIREBASE_SERVICE_ACCOUNT_KEY` 的服務帳號需具 `roles/monitoring.viewer`
 * （見頁面顯示的 gcloud 指引）；認證與呼叫細節見 `src/lib/google-monitoring.ts`。
 *
 * - 未設定服務帳號：回 `configured=false` ＋設定指引。
 * - 5 分鐘記憶體快取（失敗結果只快取 30 秒）。
 */

const CACHE_MS = 5 * 60_000;
const CACHE_FAIL_MS = 30_000;
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

const SETUP_HINT = MONITORING_SETUP_HINT;

/**
 * 官方用量頁連結（失敗／未設定時給管理人員自行查看額度）。
 * 網址皆取自 Firebase／GCP 官方文件的 Console 連結，專案 id 未知時用 `_`（Console 會讓你選專案）。
 */
function firebaseUsageLinks(projectId: string): UsageLink[] {
  const id = projectId || "_";
  return [
    {
      label: "Firebase 控制台・Firestore 用量（讀／寫／刪，太平洋日重置）",
      url: `https://console.firebase.google.com/project/${id}/firestore/usage`,
    },
    { label: "Firebase 控制台・用量與帳單", url: `https://console.firebase.google.com/project/${id}/usage` },
    {
      label: "Google Cloud・專案 Firestore 用量",
      url: `https://console.cloud.google.com/firestore/project-usage?project=${encodeURIComponent(id)}`,
    },
  ];
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
    links: [],
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
    return emptyUsage({
      configured: false,
      message: resolved.message,
      hint: SETUP_HINT,
      links: firebaseUsageLinks((process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim()),
    });
  }

  const now = new Date();
  const dayKeys = recentDayKeys(TREND_DAYS, now);
  const startTime = startOfPacificDay(new Date(now.getTime() - (TREND_DAYS - 1) * 24 * 3600_000)).toISOString();
  const endTime = now.toISOString();
  const projectId = resolved.credentials.projectId;

  try {
    const results = await Promise.all(
      (Object.values(METRICS) as string[]).map((metricType) =>
        fetchTimeSeries(projectId, {
          filter: `metric.type = "${metricType}" AND resource.type = "firestore_instance"`,
          startTime,
          endTime,
          alignmentPeriod: `${HOUR_SECONDS}s`,
          perSeriesAligner: "ALIGN_SUM",
          crossSeriesReducer: "REDUCE_SUM",
        })
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
          hint: `${apiDisabled ? monitoringApiDisabledHint(projectId) : monitoringPermissionHint(projectId, resolved.credentials.clientEmail)}\n\n${diagnostics}`,
          links: firebaseUsageLinks(projectId),
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
        links: firebaseUsageLinks(projectId),
      });
    }

    // 點列（小時桶）依太平洋日曆日歸戶
    const dailyMaps = results.map((result) => {
      const map = new Map<string, number>();
      if ("points" in result) {
        for (const point of result.points) {
          const key = pacificDateKey(new Date(point.startTime));
          map.set(key, (map.get(key) ?? 0) + point.value);
        }
      }
      return map;
    });
    const [reads, writes, deletes] = dailyMaps;
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
      hint: monitoringPermissionHint(projectId, resolved.credentials.clientEmail),
      links: firebaseUsageLinks(projectId),
    });
  }
}
