import "server-only";
import {
  MONITORING_BASE,
  MONITORING_SETUP_HINT,
  fetchTimeSeries,
  monitoringApiDisabledHint,
  monitoringPermissionHint,
  resolveCredentials,
} from "@/lib/google-monitoring";
import type { AppHostingUsage, QuotaMetric, UsageLink } from "@/types/usage";

/**
 * Firebase App Hosting 用量抓取（僅伺服器端）。
 *
 * App Hosting 由 Cloud Run（SSR 服務）、Cloud CDN（靜態快取）與 Cloud Build（部署建置）組成，
 * 本檔以同一個 `FIREBASE_SERVICE_ACCOUNT_KEY`（需 `roles/monitoring.viewer`）向 Cloud Monitoring
 * 取「本月累計」的計費關鍵指標，對照官方每月免費額度（超出後按量計費，Blaze）：
 *
 * - Cloud Run 請求數：`run.googleapis.com/request_count`（免費 200 萬／月）
 * - Cloud Run CPU 時間：`run.googleapis.com/container/cpu/allocation_time`（免費 180k vCPU-秒／月）
 * - Cloud Run 記憶體時間：`run.googleapis.com/container/memory/allocation_time`（免費 360k GiB-秒／月）
 * - Cloud Build 建置次數：`cloudbuild.googleapis.com/build/count`（免費額度以「建置分鐘」計 2,500 分鐘／月，
 *   次數無直接額度，故 limit=null 並附說明）
 *
 * 皆以「日」為對齊週期（86400s、ALIGN_SUM、REDUCE_SUM）抓回後再由程式累加成本月合計
 * ——與 Firestore 用量同一條驗證過的呼叫路徑；區間為 UTC 本月 1 日 ~ 目前。
 *
 * - 未設定服務帳號：回 `configured=false` ＋設定指引。
 * - 5 分鐘記憶體快取（失敗結果只快取 30 秒）。
 */

const CACHE_MS = 5 * 60_000;
const CACHE_FAIL_MS = 30_000;
const DAY_SECONDS = 86_400;

/** App Hosting 每月免費額度（見 Firebase「Understand App Hosting costs」官方文件） */
export const APP_HOSTING_FREE_LIMITS = {
  /** Cloud Run 請求數（次） */
  requests: 2_000_000,
  /** Cloud Run CPU 時間（vCPU-秒） */
  cpuSeconds: 180_000,
  /** Cloud Run 記憶體時間（GiB-秒） */
  memoryGibSeconds: 360_000,
} as const;

const METRICS = {
  requests: "run.googleapis.com/request_count",
  cpuSeconds: "run.googleapis.com/container/cpu/allocation_time",
  memoryGibSeconds: "run.googleapis.com/container/memory/allocation_time",
  builds: "cloudbuild.googleapis.com/build/count",
} as const;

/** 本月（UTC）1 日 00:00 的 ISO 時刻 */
function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function appHostingUsageLinks(projectId: string): UsageLink[] {
  const id = projectId || "_";
  return [
    {
      label: "Firebase 控制台・App Hosting（Usage 頁有 CDN 頻寬／請求／CPU 等圖表）",
      url: `https://console.firebase.google.com/project/${id}/apphosting`,
    },
    {
      label: "Google Cloud・Cloud Run 服務用量",
      url: `https://console.cloud.google.com/run/detail?project=${encodeURIComponent(id)}`,
    },
    {
      label: "Google Cloud・帳單（本月各產品用量與費用）",
      url: `https://console.cloud.google.com/billing?project=${encodeURIComponent(id)}`,
    },
  ];
}

let cache: { at: number; data: AppHostingUsage } | null = null;

/** 取得 App Hosting 本月用量（任何失敗都回結構化結果，不丟例外） */
export async function getAppHostingUsage(): Promise<AppHostingUsage> {
  const cached = cache;
  if (cached && Date.now() - cached.at < (cached.data.ok ? CACHE_MS : CACHE_FAIL_MS)) {
    return cached.data;
  }
  const data = await loadAppHostingUsage();
  cache = { at: Date.now(), data };
  return data;
}

function emptyUsage(partial?: Partial<AppHostingUsage>): AppHostingUsage {
  const now = new Date();
  return {
    ok: false,
    configured: false,
    message: null,
    hint: null,
    links: [],
    fetchedAt: now.toISOString(),
    period: { from: monthStartIso(now), to: now.toISOString() },
    metrics: [],
    ...partial,
  };
}

async function loadAppHostingUsage(): Promise<AppHostingUsage> {
  const resolved = resolveCredentials();
  if (!resolved.ok) {
    return emptyUsage({
      configured: false,
      message: resolved.message,
      hint: MONITORING_SETUP_HINT,
      links: appHostingUsageLinks((process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim()),
    });
  }

  const now = new Date();
  const startIso = monthStartIso(now);
  const endIso = now.toISOString();
  const projectId = resolved.credentials.projectId;
  const runFilter = (metricType: string) =>
    `metric.type = "${metricType}" AND resource.type = "cloud_run_revision"`;
  const buildFilter = `metric.type = "${METRICS.builds}" AND resource.type = "build"`;

  const queries: Array<{ key: string; filter: string }> = [
    { key: "requests", filter: runFilter(METRICS.requests) },
    { key: "cpuSeconds", filter: runFilter(METRICS.cpuSeconds) },
    { key: "memoryGibSeconds", filter: runFilter(METRICS.memoryGibSeconds) },
    { key: "builds", filter: buildFilter },
  ];

  try {
    const results = await Promise.all(
      queries.map((q) =>
        fetchTimeSeries(projectId, {
          filter: q.filter,
          startTime: startIso,
          endTime: endIso,
          alignmentPeriod: `${DAY_SECONDS}s`,
          perSeriesAligner: "ALIGN_SUM",
          crossSeriesReducer: "REDUCE_SUM",
        }).then((result) => ({ key: q.key, result }))
      )
    );

    const failure = results.find(
      (item): item is { key: string; result: { error: { status: number; message: string; reasons: string[] } } } =>
        "error" in item.result
    );
    if (failure) {
      const { status, message, reasons } = failure.result.error;
      const reasonText = reasons.length ? `（${reasons.join("、")}）` : "";
      const diagnostics = [
        "診斷資訊：",
        `- 端點：GET ${MONITORING_BASE}/projects/${projectId}/timeSeries`,
        `- 專案：${projectId}；服務帳號：${resolved.credentials.clientEmail}`,
        `- 區間：${startIso} ~ ${endIso}（UTC，本月）`,
        `- 參數：alignmentPeriod=${DAY_SECONDS}s、perSeriesAligner=ALIGN_SUM、crossSeriesReducer=REDUCE_SUM`,
        `- 指標：${Object.values(METRICS).join("、")}`,
        `- 失敗查詢：${failure.key}（${failure.result.error.message ? failure.result.error.message : status}）`,
        `- 回應：HTTP ${status}${message ? `：${message}` : ""}${reasonText}`,
      ].join("\n");
      if (status === 401 || status === 403) {
        const apiDisabled = reasons.includes("SERVICE_DISABLED");
        return emptyUsage({
          configured: true,
          message: apiDisabled
            ? `Cloud Monitoring API 未啟用${reasonText}，無法讀取 App Hosting 用量。`
            : `服務帳號缺少 Cloud Monitoring 權限${reasonText}（${status}），無法讀取 App Hosting 用量。`,
          hint: `${apiDisabled ? monitoringApiDisabledHint(projectId) : monitoringPermissionHint(projectId, resolved.credentials.clientEmail)}\n\n${diagnostics}`,
          links: appHostingUsageLinks(projectId),
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
        message: `讀取 App Hosting 用量失敗：Cloud Monitoring API 回 ${status}${message ? `：${message}` : ""}`,
        hint: `${guidance}\n\n${diagnostics}`,
        links: appHostingUsageLinks(projectId),
      });
    }

    // 本月合計：日對齊點列直接累加（點已由 REDUCE_SUM 合併全部 revision／instance）
    const totals = new Map<string, number>();
    for (const { key, result } of results) {
      if ("points" in result) {
        totals.set(key, result.points.reduce((sum, point) => sum + point.value, 0));
      }
    }
    const requests = totals.get("requests") ?? 0;
    const cpuSeconds = totals.get("cpuSeconds") ?? 0;
    const memoryGibSeconds = totals.get("memoryGibSeconds") ?? 0;
    const builds = totals.get("builds") ?? 0;

    const metrics: QuotaMetric[] = [
      {
        key: "requests",
        label: "Cloud Run 請求數（本月）",
        used: requests,
        limit: APP_HOSTING_FREE_LIMITS.requests,
        unit: "count",
      },
      {
        key: "cpu",
        label: "Cloud Run CPU 時間（本月）",
        used: cpuSeconds / 3600,
        limit: APP_HOSTING_FREE_LIMITS.cpuSeconds / 3600,
        unit: "hours",
      },
      {
        key: "memory",
        label: "Cloud Run 記憶體時間（本月）",
        used: memoryGibSeconds / 3600,
        limit: APP_HOSTING_FREE_LIMITS.memoryGibSeconds / 3600,
        unit: "gbHours",
      },
      {
        key: "builds",
        label: "Cloud Build 建置次數（本月，含失敗）",
        used: builds,
        limit: null,
        unit: "count",
      },
    ];

    return {
      ok: true,
      configured: true,
      message: null,
      hint: null,
      fetchedAt: new Date().toISOString(),
      period: { from: startIso, to: endIso },
      metrics,
      note: "Cloud Build 免費額度以「建置分鐘」計（2,500 分鐘／月），建置次數本身無額度；分鐘數與頻寬請見 Cloud Build／帳單頁。所有額度為帳號層級合計、UTC 每月重置。",
      links: appHostingUsageLinks(projectId),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return emptyUsage({
      configured: true,
      message: `讀取 App Hosting 用量失敗：${msg}`,
      hint: monitoringPermissionHint(projectId, resolved.credentials.clientEmail),
      links: appHostingUsageLinks(projectId),
    });
  }
}
