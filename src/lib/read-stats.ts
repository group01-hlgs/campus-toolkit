import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * 端點級 Firestore 讀取統計（開發輔助）。
 *
 * 目的：回答「哪支 API／哪個操作燒掉 Firestore 讀取」——統計儀表板的專案級
 * 總量（Cloud Monitoring）無法定位來源，此模組在應用層旁路計數補足。
 *
 * 設計原則（對齊 docs/統計儀表板.md）：
 * - **不寫 Firestore**：僅進程內 Map 累加，儀表板讀取快照；統計本身零讀寫成本。
 * - **計費語意對齊** `docs/資料庫讀取規範.md`：查詢 N 筆＝N 讀、空查詢＝1、
 *   點查不存在＝0、count() 聚合＝1。
 * - **多實例**：serverless 各實例分開累計（與 rate limiter 相同立場），
 *   儀表板以 instanceId／startedAt 註明、冷啟動歸零。
 *
 * 歸屬方式：`ensureReadScope(label)` 以 AsyncLocalStorage.enterWith 建立
 * 「當前請求」範圍（enforceRateLimit 傳路徑、verifySession 傳頁面標籤），
 * 其後同一 async 鏈上的所有計數累加至該 label。
 *
 * 開關：dev 預設啟用；production 需 `READ_STATS=1`（firebase-admin.ts 判斷，
 * 關閉時不裝 Proxy、零開銷）。`READ_STATS_LOG=1` 時每筆輸出結構化 log
 * （App Hosting／Cloud Logging 可永久留存，同樣不花 Firestore）。
 */

interface ReadScope {
  label: string;
}

interface EndpointStat {
  label: string;
  requests: number;
  reads: number;
  writes: number;
  deletes: number;
  firstAt: number;
  lastAt: number;
}

export interface ReadStatsSnapshot {
  enabled: boolean;
  instanceId: string;
  startedAt: number;
  totals: { requests: number; reads: number; writes: number; deletes: number };
  byEndpoint: EndpointStat[];
  byCollection: Array<{ name: string; reads: number }>;
}

/** production 關閉、其他環境（dev/test）預設啟用；READ_STATS=1 可在 production 強制開啟、READ_STATS=0 關閉 */
export function isReadStatsEnabled(): boolean {
  if (process.env.READ_STATS === "0") return false;
  if (process.env.READ_STATS === "1") return true;
  return process.env.NODE_ENV !== "production";
}

function shouldLog(): boolean {
  return process.env.READ_STATS_LOG === "1";
}

const als = new AsyncLocalStorage<ReadScope>();
const INSTANCE_ID = randomUUID();
const STARTED_AT = Date.now();

const byEndpoint = new Map<string, EndpointStat>();
const byCollection = new Map<string, number>();
let totalRequests = 0;
let totalReads = 0;
let totalWrites = 0;
let totalDeletes = 0;

function endpointEntry(label: string): EndpointStat {
  let entry = byEndpoint.get(label);
  if (!entry) {
    const now = Date.now();
    entry = { label, requests: 0, reads: 0, writes: 0, deletes: 0, firstAt: now, lastAt: now };
    byEndpoint.set(label, entry);
  }
  return entry;
}

function currentLabel(): string {
  return als.getStore()?.label ?? "(背景)";
}

/**
 * 建立（或沿用）當前請求的讀取範圍。
 * 已在範圍內（同一請求已呼叫過）＝不覆蓋，保留最初建立時的 label。
 */
export function ensureReadScope(label: string): void {
  if (!isReadStatsEnabled()) return;
  if (als.getStore()) return;
  als.enterWith({ label });
  totalRequests += 1;
  endpointEntry(label).requests += 1;
}

/** 記錄 n 次文件讀取（呼叫端已算好計費語意的 n） */
export function recordReads(collection: string, n: number): void {
  if (!isReadStatsEnabled() || n <= 0) return;
  totalReads += n;
  byCollection.set(collection, (byCollection.get(collection) ?? 0) + n);
  const label = currentLabel();
  const entry = endpointEntry(label);
  entry.reads += n;
  entry.lastAt = Date.now();
  if (shouldLog()) {
    console.log(JSON.stringify({ t: "fs-read", label, collection, n, at: Date.now() }));
  }
}

/** 記錄 n 次文件寫入（set/update/create/add/batch 對應筆數） */
export function recordWrites(n: number): void {
  if (!isReadStatsEnabled() || n <= 0) return;
  totalWrites += n;
  const entry = endpointEntry(currentLabel());
  entry.writes += n;
  entry.lastAt = Date.now();
  if (shouldLog()) {
    console.log(JSON.stringify({ t: "fs-write", label: currentLabel(), n, at: Date.now() }));
  }
}

/** 記錄 n 次文件刪除 */
export function recordDeletes(n: number): void {
  if (!isReadStatsEnabled() || n <= 0) return;
  totalDeletes += n;
  const entry = endpointEntry(currentLabel());
  entry.deletes += n;
  entry.lastAt = Date.now();
  if (shouldLog()) {
    console.log(JSON.stringify({ t: "fs-delete", label: currentLabel(), n, at: Date.now() }));
  }
}

/** 儀表板快照：端點排行（依讀取數、上限 50）＋集合排行（上限 50）＋總計 */
export function getReadStatsSnapshot(): ReadStatsSnapshot {
  const enabled = isReadStatsEnabled();
  const endpoints = [...byEndpoint.values()]
    .sort((a, b) => b.reads - a.reads || b.writes - a.writes || a.label.localeCompare(b.label))
    .slice(0, 50);
  const collections = [...byCollection.entries()]
    .map(([name, reads]) => ({ name, reads }))
    .sort((a, b) => b.reads - a.reads || a.name.localeCompare(b.name))
    .slice(0, 50);
  return {
    enabled,
    instanceId: INSTANCE_ID,
    startedAt: STARTED_AT,
    totals: {
      requests: totalRequests,
      reads: totalReads,
      writes: totalWrites,
      deletes: totalDeletes,
    },
    byEndpoint: endpoints,
    byCollection: collections,
  };
}

/** 開發用：清空本實例統計 */
export function resetReadStats(): void {
  byEndpoint.clear();
  byCollection.clear();
  totalRequests = 0;
  totalReads = 0;
  totalWrites = 0;
  totalDeletes = 0;
}
