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
 * - 失敗時解析 Vercel 回應體的 `error.code`／`error.message`，連同狀態碼、
 *   端點、區間、環境變數狀態列於 `hint` 的「診斷資訊」，方便直接定位原因。
 * - 未設定 `VERCEL_TEAM_ID` 而首次查詢失敗時，會改以 `/v2/user` 取得帳號 id
 *   再查一次（個人帳號的計費明細可能掛在帳號 id 上）。
 * - 5 分鐘記憶體快取：避免每次瀏覽都打 Vercel API（Vercel API 亦有速率限制）。
 */

const CACHE_MS = 5 * 60_000;
/** 失敗／未設定結果只短暫快取：設定好環境變數後不用等 5 分鐘 */
const CACHE_FAIL_MS = 30_000;
const API_BASE = "https://api.vercel.com/v1/billing/charges";
const USER_API = "https://api.vercel.com/v2/user";

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
1. 建立 Token：先找到「帳號設定」的齒輪圖示（畫面右上角帳號選單 → Settings），這是帳號層級的設定，不是全站設定、也不是專案的 Settings → 左側選單 Tokens → Create Token（Scope 選 Full Account——用量屬帳號／團隊層級，選單一專案讀不到；期限建議 No Expiration）
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
    note: null,
    fetchedAt: new Date().toISOString(),
    plan: "hobby",
    period: { from: "", to: "" },
    metrics: [],
    ...partial,
  };
}

/** token 僅顯示前綴（供診斷確認環境變數讀得到，不外洩完整值） */
function maskToken(token: string): string {
  return `${token.slice(0, 7)}…（已隱藏）`;
}

interface ApiError {
  status: number;
  detail: string;
  /** Vercel 回 `invalidToken: true`（token 無效，與角色權限不足分開處理） */
  invalidToken: boolean;
}

/** 讀失敗回應的狀態碼與可讀訊息（Vercel 回 `{"error":{"code","message"}}`，也可能純文字） */
async function readApiError(res: Response): Promise<ApiError> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    // 回應體讀不出來就只用狀態碼
  }
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    const err = parsed?.error;
    if (typeof err === "string" && err.trim()) {
      return { status: res.status, detail: err.trim(), invalidToken: false };
    }
    if (err && typeof err === "object") {
      const e = err as { code?: unknown; message?: unknown; payload?: unknown; invalidToken?: unknown };
      const parts = [e.code, e.message]
        .map((p) => (typeof p === "string" ? p.trim() : ""))
        .filter(Boolean);
      if (e.payload && typeof e.payload === "object") {
        const msg = (e.payload as { message?: unknown }).message;
        if (typeof msg === "string" && msg.trim()) parts.push(msg.trim());
      }
      if (parts.length) {
        return { status: res.status, detail: parts.join("："), invalidToken: e.invalidToken === true };
      }
    }
  } catch {
    // 非 JSON 回應
  }
  return { status: res.status, detail: snippet || `HTTP ${res.status}`, invalidToken: false };
}

/** token 無效（Vercel 回 `invalidToken`）或 401 時的補救方向 */
const TOKEN_GUIDANCE =
  "Token 無效、已過期或被撤銷：請到帳號設定的齒輪 → Tokens 重新建立（Scope: Full Account、期限 No Expiration），更新 VERCEL_TOKEN 後重新部署。";

/** 依狀態碼給補救方向（診斷資訊另列於 hint） */
function statusGuidance(status: number): string {
  switch (status) {
    case 401:
      return TOKEN_GUIDANCE;
    case 403:
      return "Token 權限不足：Scope 需為 Full Account，且帳號需具備該團隊的 Owner／Member／Billing 等可讀取帳單的角色。";
    case 404:
      return "Vercel 未對此帳戶回傳計費明細：本端點僅供團隊帳戶讀取，個人免費（Hobby）帳號通常沒有帳單資料。若此帳號屬於團隊，請設定 VERCEL_TEAM_ID（團隊首頁網址 team_xxx）後重新部署；若屬個人帳號，Vercel 用量區塊可能無法顯示。";
    case 400:
      return "查詢參數不被接受：請依 Vercel 回傳訊息檢查 VERCEL_TEAM_ID 與查詢區間。";
    case 429:
      return "已達 Vercel API 速率限制：請稍後再試（本頁伺服端每 5 分鐘快取一次）。";
    default:
      return "請稍後再試；若持續失敗，請附上下方診斷資訊回報。";
  }
}

async function fetchCharges(
  url: URL,
  token: string
): Promise<{ ok: true; text: string } | { ok: false; error: ApiError }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.ok) return { ok: true, text: await res.text() };
  return { ok: false, error: await readApiError(res) };
}

/** 查詢帳號 id（個人帳號可能需要帶在 teamId 上），失敗回 null */
async function fetchUserId(token: string): Promise<{ id: string | null; status: number | null }> {
  try {
    const res = await fetch(USER_API, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return { id: null, status: res.status };
    const json = (await res.json()) as { user?: { id?: unknown } };
    const id = json?.user?.id;
    return { id: typeof id === "string" && id ? id : null, status: res.status };
  } catch {
    return { id: null, status: null };
  }
}

let cache: { at: number; data: VercelUsage } | null = null;

/** 取得 Vercel 本月用量（5 分鐘記憶體快取；任何失敗都回結構化結果，不丟例外） */
export async function getVercelUsage(): Promise<VercelUsage> {
  const cached = cache;
  if (cached && Date.now() - cached.at < (cached.data.ok ? CACHE_MS : CACHE_FAIL_MS)) {
    return cached.data;
  }

  const data = await loadVercelUsage().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    return emptyUsage({
      configured: true,
      message: `讀取 Vercel 用量失敗：${process.env.NODE_ENV === "production" ? "連線 Vercel API 錯誤" : detail}`,
      hint: SETUP_HINT,
    });
  });
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
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const teamId = (process.env.VERCEL_TEAM_ID || "").trim();

  const url = new URL(API_BASE);
  url.searchParams.set("from", fromIso);
  url.searchParams.set("to", toIso);
  if (teamId) url.searchParams.set("teamId", teamId);

  const period = { from: fromIso, to: toIso };
  const diagnostics: string[] = [
    "診斷資訊：",
    `- 端點：GET ${API_BASE.replace("https://api.vercel.com", "")}（FOCUS JSONL）`,
    `- 查詢區間：${fromIso} ~ ${toIso}（UTC）`,
    `- VERCEL_TOKEN：已設定（${maskToken(token)}）`,
    `- VERCEL_TEAM_ID：${teamId ? `已設定（${teamId}）` : "未設定"}`,
  ];

  const failures: { label: string; error: ApiError }[] = [];
  let usedTeamId = teamId;
  let outcome = await fetchCharges(url, token);
  let userIdNote: string | null = null;

  if (!outcome.ok) {
    failures.push({ label: teamId ? `帶 teamId=${teamId}` : "未帶 teamId", error: outcome.error });

    // 未設定 VERCEL_TEAM_ID 時，個人帳號可能仍需帶帳號 id 才讀得到 → 再試一次
    // （token 本身無效時不必白打一次 /v2/user）
    if (!teamId && !outcome.error.invalidToken) {
      const user = await fetchUserId(token);
      if (user.id) {
        const retry = new URL(url.toString());
        retry.searchParams.set("teamId", user.id);
        const second = await fetchCharges(retry, token);
        if (second.ok) {
          outcome = second;
          usedTeamId = user.id;
          userIdNote = `已自動帶入帳號 id ${user.id} 查詢（未設定 VERCEL_TEAM_ID）。`;
        } else {
          failures.push({ label: `帶 teamId=${user.id}`, error: second.error });
        }
      } else {
        diagnostics.push(`- /v2/user 取得帳號 id：失敗（${user.status ? `HTTP ${user.status}` : "連線錯誤"}）`);
      }
    }
  }

  if (!outcome.ok) {
    const primary = failures[failures.length - 1].error;
    const invalidToken = failures.some((f) => f.error.invalidToken);
    const needsSetup = invalidToken || failures.some((f) => f.error.status === 401 || f.error.status === 403);
    diagnostics.push(
      ...failures.map((f) => `- ${f.label} → HTTP ${f.error.status}：${f.error.detail}`),
      `- 狀態：${failures.map((f) => f.error.status).join(" → ")}`
    );
    return emptyUsage({
      configured: true,
      plan,
      period,
      message: `讀取 Vercel 用量失敗（HTTP ${primary.status}）：${primary.detail}`,
      hint: `${invalidToken ? TOKEN_GUIDANCE : statusGuidance(primary.status)}\n\n${diagnostics.join("\n")}${needsSetup ? `\n\n${SETUP_HINT}` : ""}`,
    });
  }

  const charges = parseCharges(outcome.text);
  const metrics = aggregate(charges, plan);
  const notes: string[] = [];
  if (userIdNote) notes.push(userIdNote);
  if (charges.length === 0) {
    notes.push("查詢成功，但此區間沒有任何計費明細——個人免費（Hobby）帳號通常沒有帳單資料，下列用量皆為 0。");
  }
  return {
    ok: true,
    configured: true,
    message: null,
    hint: null,
    note: notes.length ? notes.join("\n") : null,
    fetchedAt: new Date().toISOString(),
    plan,
    period,
    metrics,
  };
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
