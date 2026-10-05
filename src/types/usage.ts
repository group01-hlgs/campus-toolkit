/**
 * 「統計儀表板」（`/admin/stats`）的用量資料型別——前端頁面與 API 共用。
 *
 * 資料來源（皆由伺服器端取得，金鑰不外流）：
 * - Vercel：REST API `GET /v1/billing/charges`（FOCUS JSONL），回本月各資源消耗量；
 * - Firebase：Cloud Monitoring `projects.timeSeries.list`，回 Firestore 讀／寫／刪除次數。
 *
 * 約定：
 * - `ok=false` 時仍回結構（頁面顯示說明與設定指引，不整頁報錯）；
 * - `configured=false` 代表環境變數未設定（尚未接上資料來源），
 *   `configured=true` 且 `ok=false` 代表已設定但抓取失敗（多為權限或 API 問題）；
 * - 額度 `limit=null` 代表該方案無免費額度或單位無法換算，前端顯示「額度未知」。
 */

/** 額度計量單位（`raw`＝無法辨識的原始單位，值與單位一起顯示） */
export type QuotaUnit = "bytes" | "count" | "hours" | "gbHours" | "raw";

/** 一項資源的「已用 vs 額度」 */
export interface QuotaMetric {
  /** 資源代碼（頁面 keys 用） */
  key: string;
  label: string;
  /** 已用量（`unit` 為 `raw` 時此值為 Vercel 原始數值） */
  used: number;
  limit: number | null;
  unit: QuotaUnit;
  /** `unit === "raw"` 時的原始單位字串 */
  rawUnit?: string;
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
}

/** Vercel 本月（計費週期）用量 */
export interface VercelUsage extends UsageSection {
  /** 方案（hobby／pro） */
  plan: string;
  /** 查詢區間（UTC ISO） */
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

/** `GET /api/admin/stats` 回應 */
export interface StatsResponse {
  success: boolean;
  vercel: VercelUsage;
  firebase: FirebaseUsage;
}
