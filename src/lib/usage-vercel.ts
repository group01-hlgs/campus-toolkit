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
 * - 未設定 `VERCEL_TEAM_ID` 而首次查詢失敗時，會先查 `/v2/user`（defaultTeamId）
 *   與 `/v2/teams`，把帳號可用的團隊逐個帶入 `teamId` 重試（個人帳號的計費明細
 *   掛在其 Hobby 團隊上，不帶 teamId 常回 404 costs_not_found）。
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

interface UserInfo {
  id: string | null;
  username: string | null;
  /** 帳號的預設團隊（個人帳號也算團隊，計費明細掛在團隊上） */
  defaultTeamId: string | null;
  status: number | null;
}

/** 查詢帳號資訊（`/v2/user`），失敗回 status、欄位皆 null */
async function fetchUser(token: string): Promise<UserInfo> {
  try {
    const res = await fetch(USER_API, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return { id: null, username: null, defaultTeamId: null, status: res.status };
    const json = (await res.json()) as {
      user?: { id?: unknown; username?: unknown; defaultTeamId?: unknown };
    };
    const u = json?.user;
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      id: str(u?.id),
      username: str(u?.username),
      defaultTeamId: str(u?.defaultTeamId),
      status: res.status,
    };
  } catch {
    return { id: null, username: null, defaultTeamId: null, status: null };
  }
}

interface TeamInfo {
  id: string;
  slug: string;
  name: string;
  plan: string | null;
}

/** 列出可操作的團隊（含個人 Hobby 團隊），失敗回空陣列 */
async function fetchTeams(token: string): Promise<{ teams: TeamInfo[]; status: number | null }> {
  for (const path of ["/v2/teams", "/v1/teams"]) {
    try {
      const res = await fetch(`https://api.vercel.com${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) {
        if (path === "/v1/teams") return { teams: [], status: res.status };
        continue;
      }
      const json = (await res.json()) as {
        teams?: { id?: unknown; slug?: unknown; name?: unknown; billing?: { plan?: unknown } }[];
      };
      const teams: TeamInfo[] = (Array.isArray(json?.teams) ? json.teams : [])
        .map((t) => ({
          id: typeof t?.id === "string" ? t.id : "",
          slug: typeof t?.slug === "string" ? t.slug : "",
          name: typeof t?.name === "string" ? t.name : "",
          plan: typeof t?.billing?.plan === "string" ? t.billing.plan : null,
        }))
        .filter((t) => t.id);
      return { teams, status: res.status };
    } catch {
      if (path === "/v1/teams") return { teams: [], status: null };
    }
  }
  return { teams: [], status: null };
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

  const period = { from: fromIso, to: toIso };
  const diagnostics: string[] = [
    "診斷資訊：",
    `- 端點：GET ${API_BASE.replace("https://api.vercel.com", "")}（FOCUS JSONL）`,
    `- 查詢區間：${fromIso} ~ ${toIso}（UTC）`,
    `- VERCEL_TOKEN：已設定（${maskToken(token)}）`,
    `- VERCEL_TEAM_ID：${teamId ? `已設定（${teamId}）` : "未設定"}`,
  ];

  const makeUrl = (apply?: (u: URL) => void): URL => {
    const u = new URL(API_BASE);
    u.searchParams.set("from", fromIso);
    u.searchParams.set("to", toIso);
    apply?.(u);
    return u;
  };

  /** 嘗試對象：env 的 teamId；未設定時先不帶，再依 discovery 結果逐個試 */
  interface Candidate {
    label: string;
    /** 成功時建議寫入 VERCEL_TEAM_ID 的值 */
    suggest: string | null;
    apply: (u: URL) => void;
  }
  const candidates: Candidate[] = teamId
    ? [{ label: `teamId=${teamId}`, suggest: null, apply: (u) => u.searchParams.set("teamId", teamId) }]
    : [{ label: "未帶 teamId", suggest: null, apply: () => {} }];

  const failures: { label: string; error: ApiError }[] = [];
  let outcome = await fetchCharges(makeUrl(candidates[0].apply), token);
  let used = candidates[0];
  let usageUrl: string | null = null;

  // 首次失敗（且 token 本身有效）→ 找出正確的團隊 scope 再逐個重試
  if (!outcome.ok && !teamId && !outcome.error.invalidToken) {
    failures.push({ label: candidates[0].label, error: outcome.error });

    const user = await fetchUser(token);
    if (user.id || user.username) {
      diagnostics.push(
        `- 帳號：${user.username ?? "?"}（id ${user.id ?? "?"}，defaultTeamId ${user.defaultTeamId ?? "無"}）`
      );
      if (user.defaultTeamId) {
        candidates.push({
          label: `defaultTeamId=${user.defaultTeamId}`,
          suggest: user.defaultTeamId,
          apply: (u) => u.searchParams.set("teamId", user.defaultTeamId as string),
        });
      }
    } else {
      diagnostics.push(`- /v2/user：失敗（${user.status ? `HTTP ${user.status}` : "連線錯誤"}）`);
    }

    const { teams, status } = await fetchTeams(token);
    if (teams.length) {
      diagnostics.push(
        `- /v2/teams：${teams
          .map((t) => `${t.slug || t.name}(${t.id}${t.plan ? `，${t.plan}` : ""})`)
          .join("、")}`
      );
      const preferred = [...teams].sort((a, b) => Number(b.plan === "hobby") - Number(a.plan === "hobby"));
      for (const t of preferred) {
        if (candidates.some((c) => c.label.includes(t.id))) continue;
        candidates.push({
          label: `teamId=${t.id}（${t.slug || t.name}）`,
          suggest: t.id,
          apply: (u) => u.searchParams.set("teamId", t.id),
        });
      }
      const first = preferred[0];
      if (first?.slug) usageUrl = `https://vercel.com/${first.slug}/~/usage`;
    } else {
      diagnostics.push(`- /v2/teams：失敗（${status ? `HTTP ${status}` : "連線錯誤"}）`);
    }

    for (const candidate of candidates.slice(1, 5)) {
      const retry = await fetchCharges(makeUrl(candidate.apply), token);
      if (retry.ok) {
        outcome = retry;
        used = candidate;
        break;
      }
      failures.push({ label: candidate.label, error: retry.error });
    }
  }

  if (!outcome.ok) {
    if (!failures.length) failures.push({ label: used.label, error: outcome.error });
    const primary = failures[failures.length - 1].error;
    const invalidToken = failures.some((f) => f.error.invalidToken);
    const noCosts = failures.every((f) => f.error.detail.includes("costs_not_found"));
    const needsSetup = invalidToken || failures.some((f) => f.error.status === 401 || f.error.status === 403);
    diagnostics.push(
      ...failures.map((f) => `- ${f.label} → HTTP ${f.error.status}：${f.error.detail}`),
      `- 狀態：${failures.map((f) => f.error.status).join(" → ")}`
    );
    const guidance = invalidToken
      ? TOKEN_GUIDANCE
      : noCosts
        ? `此帳號在 Vercel 查無計費明細（costs_not_found）：計費 API 只回覆有帳單資料的帳號，免費 Hobby 個人帳號通常沒有帳單明細，因此無法以 API 讀取用量。${usageUrl ? `用量請到 Vercel 控制台查看：${usageUrl}` : "用量請到 Vercel 控制台的 Usage 頁人工查看。"}`
        : statusGuidance(primary.status);
    return emptyUsage({
      configured: true,
      plan,
      period,
      message: `讀取 Vercel 用量失敗（HTTP ${primary.status}）：${primary.detail}`,
      hint: `${guidance}\n\n${diagnostics.join("\n")}${needsSetup ? `\n\n${SETUP_HINT}` : ""}`,
    });
  }

  const charges = parseCharges(outcome.text);
  const metrics = aggregate(charges, plan);
  const notes: string[] = [];
  if (used.suggest) {
    notes.push(`已自動以 ${used.label} 查詢（未設定 VERCEL_TEAM_ID）；建議設定 VERCEL_TEAM_ID=${used.suggest} 固定查詢對象。`);
  }
  if (charges.length === 0) {
    notes.push("查詢成功，但此區間沒有任何計費明細——免費（Hobby）帳號通常沒有帳單資料，下列用量皆為 0。");
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
