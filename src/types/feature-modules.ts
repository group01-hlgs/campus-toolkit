/**
 * 「功能模組」＝產品層級的模組註冊表——回答「這套系統有哪些功能模組、
 * 哪些是內建、哪些是選用、現在做到哪裡」。
 *
 * 分層（兩張註冊表不可混用）：
 * - 本檔（feature-modules）＝產品層級的功能模組，入口頁 `/admin/modules`；
 *   內建模組＝隨主程式提供、一律啟用（沒有「主程式功能模組」這層大項目，
 *   帳號、身分與安全管理、使用者帳號管理、身分名冊管理…本身各是一張內建模組卡）。
 * - `types/modules.ts`（ADMIN_MODULES）＝管理端的「權限單位」，由名冊「指定功能模組」指派；
 *   內建的管理端模組卡（`ADMIN_FEATURE_MODULES`）直接由它派生，勿另抄一份清單。
 *
 * 啟用狀態（選用模組）存於 `settings/system` 的 `featureModulesEnabled` 欄位
 * （與身分開關 `roleEnabled` 同一文件、同一套覆寫保留策略），
 * 僅超級管理員可在功能模組管理頁切換；內建模組恒為啟用、不入此欄位。
 * 欄位不存在＝選用模組一律未啟用（fail-safe：未經允許不啟用）。
 * 變更歷史另記錄於稽核紀錄（`feature_module_updated`）。
 */

import { MODULES, type ModuleStatus } from "./modules";

/** 內建（隨主程式提供、一律啟用）／選用（由超級管理員決定是否啟用） */
export type FeatureModuleKind = "builtin" | "optional";

/** 實作狀態：已上線／開發中／規劃中（未上線的模組不可啟用、也沒有入口） */
export type FeatureModuleStatus = "live" | "building" | "planned";

export const FEATURE_MODULE_STATUS_LABELS: Record<FeatureModuleStatus, string> = {
  live: "已上線",
  building: "開發中",
  planned: "規劃中",
};

export const FEATURE_MODULE_KIND_LABELS: Record<FeatureModuleKind, string> = {
  builtin: "內建",
  optional: "選用",
};

export interface FeatureModuleMeta {
  /** 模組代碼（選用模組啟用狀態欄位 `featureModulesEnabled` 的鍵） */
  value: string;
  label: string;
  kind: FeatureModuleKind;
  status: FeatureModuleStatus;
  description: string;
  /** 模組入口路由（""＝尚未建頁） */
  href: string;
}

/** 管理端權限單位的實作狀態 → 功能模組狀態（built＝已上線、apiOnly＝開發中） */
const PERMISSION_STATUS: Record<ModuleStatus, FeatureModuleStatus> = {
  built: "live",
  apiOnly: "building",
  planned: "planned",
};

/**
 * 內建的管理端功能模組：個人卡片「帳號、身分與安全管理」
 * ＋管理端權限單位（types/modules.ts 的 MODULES，含尚未建頁的稽核紀錄）。
 * 新增管理端功能時會自動出現在這裡，不需要另外維護。
 */
const ADMIN_FEATURE_MODULES: readonly FeatureModuleMeta[] = [
  {
    value: "account",
    label: "帳號、身分與安全管理",
    kind: "builtin",
    status: "live",
    description: "維護自己的個人資料、密碼與兩階段驗證等帳號安全設定。",
    href: "/admin/admins",
  },
  ...MODULES.map((item) => ({
    value: item.value as string,
    label: item.label,
    kind: "builtin" as const,
    status: PERMISSION_STATUS[item.status],
    description: item.description,
    href: item.href,
  })),
];

/** 新增功能模組時在這裡加一列（內建排前面，選用模組排在後面） */
export const FEATURE_MODULES: readonly FeatureModuleMeta[] = [
  ...ADMIN_FEATURE_MODULES,
  {
    value: "announcements",
    label: "公告功能模組",
    kind: "builtin",
    status: "planned",
    description: "發佈與管理校園公告，可依身分與班級設定可見範圍。",
    href: "",
  },
  {
    value: "calendar",
    label: "行事曆功能模組",
    kind: "builtin",
    status: "planned",
    description: "校務行事曆與各類日程的建立、發佈與檢視。",
    href: "",
  },
  {
    value: "spaceBooking",
    label: "學校空間預約模組",
    kind: "optional",
    status: "planned",
    description: "教室、場地等學校空間的預約、審核與使用紀錄。",
    href: "",
  },
  {
    value: "examRegistration",
    label: "升學與模擬考報名模組",
    kind: "optional",
    status: "planned",
    description: "升學相關考試與模擬考的報名、造冊與名單管理。",
    href: "",
  },
  {
    value: "selfLearning",
    label: "自主學習模組",
    kind: "optional",
    status: "planned",
    description: "自主學習計畫的申請、歷程記錄與審查。",
    href: "",
  },
  {
    value: "learningPortfolio",
    label: "學習歷程模組",
    kind: "optional",
    status: "planned",
    description: "學習歷程檔案的收集、整理與提交。",
    href: "",
  },
  {
    value: "attendance",
    label: "線上點名模組",
    kind: "optional",
    status: "planned",
    description: "課堂點名、缺曠紀錄與出缺統計。",
    href: "",
  },
];

/** `settings/system` 上存選用模組啟用狀態的欄位名 */
export const FEATURE_MODULES_FIELD = "featureModulesEnabled";

/** 選用模組的啟用狀態（內建模組不在其中，恒為啟用） */
export type FeatureModulesEnabledMap = Record<string, boolean>;

/** 依代碼查功能模組（未知代碼回 undefined） */
export function featureModuleMeta(value: string): FeatureModuleMeta | undefined {
  return FEATURE_MODULES.find((item) => item.value === value);
}

/** 某一種歸屬（內建／選用）的功能模組 */
export function featureModulesOfKind(kind: FeatureModuleKind): readonly FeatureModuleMeta[] {
  return FEATURE_MODULES.filter((item) => item.kind === kind);
}

/** 可否切換啟用狀態：僅「選用且已上線」的模組可啟用（伺服器端同步把關） */
export function isTogglableFeatureModule(meta: FeatureModuleMeta): boolean {
  return meta.kind === "optional" && meta.status === "live";
}

/**
 * 讀回選用模組的啟用狀態：僅承認布林值；
 * 欄位不存在或值毀損＝該模組視為未啟用（fail-safe：未經允許不啟用）。
 */
export function readFeatureModulesEnabled(raw: unknown): FeatureModulesEnabledMap {
  const out: FeatureModulesEnabledMap = {};
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  for (const item of FEATURE_MODULES) {
    if (item.kind !== "optional") continue;
    out[item.value] = data ? data[item.value] === true : false;
  }
  return out;
}
