/**
 * 「統計儀表板」（`/admin/stats`）的用量資料型別——前端頁面與 API 共用。
 *
 * 資料來源（皆由伺服器端取得，金鑰不外流）：
 * - App Hosting：Cloud Monitoring `projects.timeSeries.list`，取 Cloud Run 請求／CPU／記憶體
 *   與 Cloud Build 建置次數的本月累計（App Hosting＝Cloud Run＋Cloud CDN＋Cloud Build）；
 * - Firebase：Cloud Monitoring `projects.timeSeries.list`，回 Firestore 讀／寫／刪除次數。
 *
 * 約定：
 * - `ok=false` 時仍回結構（頁面顯示說明與設定指引，不整頁報錯）；
 * - `configured=false` 代表環境變數未設定（尚未接上資料來源），
 *   `configured=true` 且 `ok=false` 代表已設定但抓取失敗（多為權限或 API 問題）；
 * - 額度 `limit=null` 代表該方案無免費額度或單位無法換算，前端顯示「額度未知」。
 */

/** 額度計量單位 */
export type QuotaUnit = "count" | "hours" | "gbHours";

/** 一項資源的「已用 vs 額度」 */
export interface QuotaMetric {
  /** 資源代碼（頁面 keys 用） */
  key: string;
  label: string;
  /** 已用量 */
  used: number;
  limit: number | null;
  unit: QuotaUnit;
}

/** 官方用量頁連結（失敗／未設定時提供給管理人員自行查看） */
export interface UsageLink {
  label: string;
  url: string;
}

/** 各資料來源共用的區塊狀態 */
export interface UsageSection {
  ok: boolean;
  /** 是否已設定可抓取資料的環境變數 */
  configured: boolean;
  /** 顯示給使用者的說明（未設定原因／失敗原因，production 不含細節） */
  message: string | null;
  /** 設定或補救指引（多行文字，直接顯示） */
  hint: string | null;
  /** 資料抓取時間（ISO 8601） */
  fetchedAt: string;
  /** 成功時的補充說明（如「查無明細」「以帳號 id 查詢」），頁面以提示條顯示 */
  note?: string | null;
  /** 官方用量頁連結（失敗／未設定時顯示，供管理人員自行查看額度） */
  links?: UsageLink[];
}

/** App Hosting 本月（UTC 計費週期）用量 */
export interface AppHostingUsage extends UsageSection {
  /** 查詢區間（UTC ISO，本月 1 日 ~ 目前） */
  period: { from: string; to: string };
  metrics: QuotaMetric[];
}

/** Firestore 單日用量（日期為太平洋時間的日曆日，額度於該日午夜重置） */
export interface FirestoreDayUsage {
  date: string;
  reads: number;
  writes: number;
  deletes: number;
}

/** Firebase（Firestore）今日與近 7 日用量 */
export interface FirebaseUsage extends UsageSection {
  today: Omit<FirestoreDayUsage, "date">;
  /** 免費額度（每日） */
  limits: { reads: number; writes: number; deletes: number };
  /** 近 7 日（由舊到新，含今日） */
  daily: FirestoreDayUsage[];
}

/** 端點級讀取統計（read-stats，本實例進程內累計；不寫 Firestore） */
export interface ReadStatsEndpoint {
  label: string;
  requests: number;
  reads: number;
  writes: number;
  deletes: number;
}

export interface ReadStatsSection {
  /** READ_STATS 開關是否啟用（dev 預設開；production 需 READ_STATS=1） */
  enabled: boolean;
  /** 本實例識別碼（serverless 各實例分開累計；冷啟動歸零） */
  instanceId: string;
  /** 本實例啟動時間（epoch ms） */
  startedAt: number;
  totals: { requests: number; reads: number; writes: number; deletes: number };
  /** 端點排行（依讀取數、上限 50） */
  byEndpoint: ReadStatsEndpoint[];
  /** 集合排行（依讀取數、上限 50） */
  byCollection: Array<{ name: string; reads: number }>;
}

/** `GET /api/admin/stats` 回應 */
export interface StatsResponse {
  success: boolean;
  appHosting: AppHostingUsage;
  firebase: FirebaseUsage;
  readStats?: ReadStatsSection;
}
