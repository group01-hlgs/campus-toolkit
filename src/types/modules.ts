/**
 * 管理端「權限單位」註冊表（單一來源）。
 *
 * ⚠️ 這裡定義的是管理端的**權限模組**（名冊「指定功能模組」勾的那些），
 * 不是產品層級的功能模組——產品層級（內建／選用、啟用狀態）見 `types/feature-modules.ts`，
 * 本表同時是內建功能模組卡（`types/feature-modules.ts` 的 `ADMIN_FEATURE_MODULES`）的來源。
 *
 * 系統內所有「權限模組」的定義都集中在這裡：
 * - `types/users.ts` 由本表派生 `ADMIN_MODULES`（全部）、`BASE_ADMIN_MODULES`（核心＝scope core）、
 *   `SUPER_ONLY_ADMIN_MODULES`（僅超級＝scope superOnly），進而決定名冊「指定功能模組」的可指派清單、
 *   `adminModulesOf` 的授予結果與 `requireAdminModule` 的 API 守門；
 * - 管理員首頁卡片由本表「有入口路由（href 非空）」的項目派生；
 * - 這些權限單位在「功能模組管理」頁（`/admin/modules`）各列為一張內建模組卡
 *   （產品層級的展示見 `types/feature-modules.ts`）。
 *
 * 欄位約定（每個模組的鍵都要齊，聯合型別才能安全取值）：
 * - `href`：入口路由，空字串＝尚未建頁（如僅 API 已上線的稽核紀錄）；
 * - `children`：子功能入口，空陣列＝無子功能；
 * - `scope`：core＝核心（不需指派、每位管理員皆有）；assignable＝可指派；superOnly＝僅超級管理員
 *   （含學校基本設定、功能模組管理與統計儀表板——入口卡片、頁面與 API 皆只對超級開放）；
 * - `status`：built＝已上線；apiOnly＝API 已上線、頁面未建；planned＝規劃中。
 */

/** 權限單位的分類（帳號／校務資料／系統，供日後依類檢視權限時使用） */
export const MODULE_CATEGORIES = ["帳號與權限", "校務資料", "系統與紀錄"] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

/** 權限範圍：核心＝人人具備；可指派＝由超級指派；僅超級＝不開放指派 */
export type ModuleScope = "core" | "assignable" | "superOnly";

/** 實作狀態：已上線／API 已上線頁面未建／規劃中 */
export type ModuleStatus = "built" | "apiOnly" | "planned";

/** 模組底下的子功能入口 */
export interface ModuleChild {
  label: string;
  href: string;
}

export interface ModuleMeta {
  /** 權限代碼（＝`requireAdminModule` 的引數、名冊 `modules` 陣列存的值） */
  value: string;
  /** 中文名稱（同時是名冊匯入時可辨識的標籤） */
  label: string;
  category: ModuleCategory;
  description: string;
  scope: ModuleScope;
  status: ModuleStatus;
  href: string;
  children: readonly ModuleChild[];
}

export const MODULES = [
  {
    value: "users",
    label: "使用者帳號管理",
    category: "帳號與權限",
    description: "建立與管理登入帳號、密碼與兩階段驗證，並把帳號對應到各身分名冊。",
    scope: "assignable",
    status: "built",
    href: "/admin/accounts",
    children: [],
  },
  {
    value: "roster",
    label: "身分名冊管理",
    category: "帳號與權限",
    description: "維護各學期學生、家長、教職員與管理員名冊，並指派管理員的功能模組。",
    scope: "assignable",
    status: "built",
    href: "/admin/roster",
    children: [],
  },
  {
    value: "settings",
    label: "系統設定",
    category: "系統與紀錄",
    description: "設定系統名稱、學年學期與介面等全域項目（可寫入者僅超級管理員）。",
    scope: "core",
    status: "built",
    href: "/admin/settings",
    children: [],
  },
  {
    value: "schoolSettings",
    label: "學校基本設定",
    category: "校務資料",
    description: "維護校務基本資料、單位層級、年段班級與各式代碼表。",
    scope: "superOnly",
    status: "built",
    href: "/admin/school-settings",
    children: [
      { label: "校務基本資料", href: "/admin/school-settings/profile" },
      { label: "單位層級設定", href: "/admin/school-settings/org" },
      { label: "年段班級設定", href: "/admin/school-settings/classes" },
      { label: "各式代碼表", href: "/admin/school-settings/codes" },
    ],
  },
  {
    value: "classes",
    label: "班級管理",
    category: "校務資料",
    description: "檢視各年級班級清單與每班學生人數（班級結構於學校基本設定維護）。",
    scope: "assignable",
    status: "built",
    href: "/admin/classes",
    children: [],
  },
  {
    value: "activity",
    label: "稽核紀錄",
    category: "系統與紀錄",
    description: "檢視管理端操作的稽核紀錄（API 已上線，查詢頁面建置中）。",
    scope: "assignable",
    status: "apiOnly",
    href: "",
    children: [],
  },
  {
    value: "modules",
    label: "功能模組管理",
    category: "系統與紀錄",
    description: "管理各功能模組的總開關，以及對四種身分的啟用狀態。",
    scope: "superOnly",
    status: "built",
    href: "/admin/modules",
    children: [],
  },
  {
    value: "stats",
    label: "統計儀表板",
    category: "系統與紀錄",
    description: "檢視 Vercel 與 Firebase（Firestore）的用量，對照免費額度與近期趨勢。",
    scope: "superOnly",
    status: "built",
    href: "/admin/stats",
    children: [],
  },
] as const satisfies readonly ModuleMeta[];

/** 模組代碼的聯合型別（＝`users.ts` 的 `AdminModule`） */
export type ModuleValue = (typeof MODULES)[number]["value"];

/** 某一分類下的模組（分類頁分區塊用） */
export function modulesInCategory(category: ModuleCategory): readonly ModuleMeta[] {
  return MODULES.filter((item) => item.category === category);
}

/** 依代碼查模組中繼資料（未知代碼回 undefined） */
export function moduleMeta(value: string): ModuleMeta | undefined {
  return MODULES.find((item) => item.value === value);
}
