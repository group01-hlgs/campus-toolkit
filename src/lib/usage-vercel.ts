import "server-only";
import type { QuotaMetric, QuotaUnit, VercelUsage } from "@/types/usage";

/**
 * Vercel 用量抓取（僅伺服器端，`VERCEL_TOKEN` 不外流）。
 *
 * 資料來源：`GET https://api.vercel.com/v1/billing/charges`（FOCUS v1.3 JSONL，
 * 逐行一筆 charge）。以 `ChargeCategory = Usage` 的 `ConsumedQuantity` 依
 * `ServiceName` 聚合，再對照方案免費額度表（常數，見 Vercel 官方 plans／limits 文件）。
 *
 * - 未設定 `VERCEL_TOKEN`：回 `configured=false` ＋設定指引（頁面顯示引導卡）。
 * - 5 分鐘記憶體快取：避免每次瀏覽都打 Vercel API（Vercel API 亦有速率限制）。
 */

const CACHE_MS = 5 * 60_000;
/** 失敗／未設定結果只短暫快取：設定好環境變數後不用等 5 分鐘 */
const CACHE_FAIL_MS = 30_000;
const API_BASE = "https://api.vercel.com/v1/billing/charges";

/** 免費額度表：值為正規化後的數量（見 normalizeUnit／convert 的單位家族） */
interface QuotaSpec {
  key: string;
  label: string;
  /** ServiceName 比對用（正規化後比對或包含） */
  aliases: string[];
  limit: { hobby: number | null; pro: number | null };
  /** 額度的正規化單位 */
  unit: QuotaUnit;
  /** 額度說明（顯示於標籤下方） */
  note: string;
}

const SPECS: readonly QuotaSpec[] = [
  {
    key: "fastDataTransfer",
    label: "Fast Data Transfer（對外傳輸）",
    aliases: ["fastdatatransfer", "bandwidth", "datatransfer", "fastdatatransferout"],
    limit: { hobby: 100 * 1e9, pro: 1000 * 1e9 },
    unit: "bytes",
    note: "每月",
  },
  {
    key: "fastOriginTransfer",
    label: "Fast Origin Transfer（回源傳輸）",
    aliases: ["fastorigintransfer", "origintransfer"],
    limit: { hobby: 10 * 1e9, pro: null },
    unit: "bytes",
    note: "每月",
  },
  {
    key: "cdnRequests",
    label: "CDN Requests（邊緣請求）",
    aliases: ["cdnrequests", "edgerequests", "requests"],
    limit: { hobby: 1_000_000, pro: 10_000_000 },
    unit: "count",
    note: "每月",
  },
  {
    key: "functionInvocations",
    label: "Function Invocations（函式呼叫）",
    aliases: ["functioninvocations", "invocations"],
    limit: { hobby: 1_000_000, pro: null },
    unit: "count",
    note: "每月",
  },
  {
    key: "activeCpu",
    label: "Active CPU（運算時間）",
    aliases: ["activecpu", "cpuduration", "cpu"],
    limit: { hobby: 4, pro: null },
    unit: "hours",
    note: "每月",
  },
  {
    key: "provisionedMemory",
    label: "Provisioned Memory（記憶體配置）",
    aliases: ["provisionedmemory", "gbhrs", "gbhours", "memory"],
    limit: { hobby: 360, pro: null },
    unit: "gbHours",
    note: "每月",
  },
];

const PLAN_HINT = `額度表：
- Hobby（免費）：Fast Data Transfer 100 GB、Fast Origin Transfer 10 GB、CDN Requests 100 萬、Function Invocations 100 萬、Active CPU 4 CPU-hrs、Provisioned Memory 360 GB-hrs（每月）
- Pro：Fast Data Transfer 1 TB、Edge Requests 1,000 萬，其餘按量計費
（方案若非 Hobby，請設定環境變數 VERCEL_PLAN=hobby 或 pro 對照正確額度。）`;

const SETUP_HINT = `設定步驟：
1. 建立 Token：先找到「帳號設定」的齒輪圖示（畫面右上角帳號選單 → Settings），這是帳號層級的設定，不是全站設定、也不是專案的 Settings → 左側選單 Tokens → Create Token（建議選 Team scope、期限 Never expire）
2. 將 token 存入環境變數 VERCEL_TOKEN（Vercel 專案 Environment Variables 或本機 .env.local）
3. 團隊專案另需 VERCEL_TEAM_ID（團隊首頁網址 team_xxx；個人專案可不設）
4. 重新部署／重啟後再重新整理本頁
${PLAN_HINT}`;

/** 單位字串 → 正規化（單位家族） */
function normalizeUnit(raw: string): string | null {
  const unit = raw.toLowerCase().replace(/[\s_\-./]/g, "");
  if (unit === "") return null;
  if (["b", "byte", "bytes"].includes(unit)) return "bytes";
  if (unit === "kb") return "kb";
  if (unit === "kib") return "kib";
  if (unit === "mb") return "mb";
  if (unit === "mib") return "mib";
  if (unit === "gb") return "gb";
  if (unit === "gib") return "gib";
  if (unit === "tb") return "tb";
  if (unit === "tib") return "tib";
  if (["h", "hr", "hrs", "hour", "hours", "cpuhr", "cpuhrs", "cpuhour", "cpuhours"].includes(unit)) return "hours";
  if (["gbhr", "gbhrs", "gbhour", "gbhours"].includes(unit)) return "gbHours";
  if (["count", "counts", "request", "requests", "invocation", "invocations", "event", "events", "unit", "units", "call", "calls"].includes(unit)) return "count";
  return null;
}

/** 以十進位（GB）／二進位（GiB）換算到 bytes，額度表以十進位 GB 計 */
const BYTE_FACTORS: Record<string, number> = {
  bytes: 1,
  kb: 1e3,
  kib: 2 ** 10,
  mb: 1e6,
  mib: 2 ** 20,
  gb: 1e9,
  gib: 2 ** 30,
  tb: 1e12,
  tib: 2 ** 40,
};

/** 單位換算；家族不同或無法辨識時回 null */
function convert(value: number, fromRaw: string, to: QuotaUnit): number | null {
  const from = normalizeUnit(fromRaw);
  if (!from) return null;
  if (to === "bytes" && from in BYTE_FACTORS) return value * BYTE_FACTORS[from];
  if (to === "hours" && from === "hours") return value;
  if (to === "gbHours" && from === "gbHours") return value;
  if (to === "count" && from === "count") return value;
  return null;
}

function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface Charge {
  ServiceName?: string;
  ConsumedQuantity?: number | string | null;
  ConsumedUnit?: string | null;
  ChargeCategory?: string | null;
}

function parseCharges(text: string): Charge[] {
  const out: Charge[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try {
      const item = JSON.parse(trimmed) as Charge;
      if (item && typeof item === "object") out.push(item);
    } catch {
      // 單行毀損直接略過（JSONL 流可能被截斷）
    }
  }
  return out;
}

function emptyUsage(partial?: Partial<VercelUsage>): VercelUsage {
  return {
    ok: false,
    configured: false,
    message: null,
    hint: null,
    fetchedAt: new Date().toISOString(),
    plan: "hobby",
    period: { from: "", to: "" },
    metrics: [],
    ...partial,
  };
}

let cache: { at: number; data: VercelUsage } | null = null;

/** 取得 Vercel 本月用量（5 分鐘記憶體快取；任何失敗都回結構化結果，不丟例外） */
export async function getVercelUsage(): Promise<VercelUsage> {
  const cached = cache;
  if (cached && Date.now() - cached.at < (cached.data.ok ? CACHE_MS : CACHE_FAIL_MS)) {
    return cached.data;
  }

  const data = await loadVercelUsage();
  cache = { at: Date.now(), data };
  return data;
}

async function loadVercelUsage(): Promise<VercelUsage> {
  const token = (process.env.VERCEL_TOKEN || "").trim();
  const planRaw = (process.env.VERCEL_PLAN || "hobby").trim().toLowerCase();
  const plan = planRaw === "pro" ? "pro" : "hobby";
  if (!token) {
    return emptyUsage({
      configured: false,
      plan,
      message: "尚未設定 Vercel Token，無法讀取 Vercel 用量。",
      hint: SETUP_HINT,
    });
  }

  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const teamId = (process.env.VERCEL_TEAM_ID || "").trim();

  const url = new URL(API_BASE);
  url.searchParams.set("from", from.toISOString());
  url.searchParams.set("to", to.toISOString());
  if (teamId) url.searchParams.set("teamId", teamId);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = res.status === 401 || res.status === 403
        ? "Token 無效或權限不足（Token 需可讀取帳單用量）"
        : `Vercel API 回 ${res.status}`;
      return emptyUsage({
        configured: true,
        plan,
        period: { from: from.toISOString(), to: to.toISOString() },
        message: `讀取 Vercel 用量失敗：${detail}。`,
        hint: `若 ${res.status === 401 || res.status === 403 ? "Token 已失效或權限不足，請重新建立 Token" : "持續失敗，請稍後再試"}。\n${SETUP_HINT}`,
      });
    }

    const charges = parseCharges(await res.text());
    const metrics = aggregate(charges, plan);
    return {
      ok: true,
      configured: true,
      message: null,
      hint: null,
      fetchedAt: new Date().toISOString(),
      plan,
      period: { from: from.toISOString(), to: to.toISOString() },
      metrics,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return emptyUsage({
      configured: true,
      plan,
      period: { from: from.toISOString(), to: to.toISOString() },
      message: `讀取 Vercel 用量失敗：${process.env.NODE_ENV === "production" ? "連線 Vercel API 錯誤" : detail}`,
      hint: SETUP_HINT,
    });
  }
}

/** 聚合 Usage charge：依 ServiceName 分組，對照額度表換算，未匹配者列為無額度項目 */
function aggregate(charges: Charge[], plan: "hobby" | "pro"): QuotaMetric[] {
  const totals = new Map<string, { quantity: number; unit: string }>();
  for (const charge of charges) {
    if (charge.ChargeCategory && charge.ChargeCategory !== "Usage") continue;
    const name = typeof charge.ServiceName === "string" ? charge.ServiceName.trim() : "";
    const quantity = Number(charge.ConsumedQuantity);
    if (!name || !Number.isFinite(quantity)) continue;
    const unit = typeof charge.ConsumedUnit === "string" ? charge.ConsumedUnit : "";
    const current = totals.get(name);
    if (current) {
      current.quantity += quantity;
    } else {
      totals.set(name, { quantity, unit });
    }
  }

  const metrics: QuotaMetric[] = [];
  const matched = new Set<string>();

  for (const spec of SPECS) {
    const hit = [...totals.entries()].find(([name]) => {
      if (matched.has(name)) return false;
      const norm = normName(name);
      return spec.aliases.some((alias) => norm === alias || norm.includes(alias));
    });
    const limitValue = spec.limit[plan];
    if (!hit) {
      metrics.push({
        key: spec.key,
        label: spec.label,
        used: 0,
        limit: limitValue,
        unit: spec.unit,
      });
      continue;
    }
    const [name, { quantity, unit }] = hit;
    matched.add(name);
    const converted = unit ? convert(quantity, unit, spec.unit) : null;
    metrics.push({
      key: spec.key,
      label: spec.label,
      used: converted ?? quantity,
      limit: limitValue,
      unit: converted === null && unit ? "raw" : spec.unit,
      rawUnit: converted === null && unit ? unit : undefined,
    });
  }

  // 未匹配到額度表的資源：照實列出（僅供參考，不設額度）
  for (const [name, { quantity, unit }] of totals) {
    if (matched.has(name) || quantity <= 0) continue;
    const normalized = unit ? normalizeUnit(unit) : null;
    const isByteUnit = normalized !== null && normalized in BYTE_FACTORS;
    const asQuotaUnit = isByteUnit
      ? "bytes"
      : normalized === "hours"
        ? "hours"
        : normalized === "gbHours"
          ? "gbHours"
          : normalized === "count"
            ? "count"
            : "raw";
    const converted = asQuotaUnit === "raw" ? null : convert(quantity, unit, asQuotaUnit as QuotaUnit);
    metrics.push({
      key: `other_${normName(name)}`,
      label: name,
      used: converted ?? quantity,
      limit: null,
      unit: (converted === null ? "raw" : asQuotaUnit) as QuotaUnit,
      rawUnit: converted === null ? unit || undefined : undefined,
    });
  }

  return metrics;
}
