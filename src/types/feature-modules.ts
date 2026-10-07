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
 *
 * **身分可用性分兩層**：
 * - **提供功能**（`provides`）：產品層級、**唯讀**——由模組作者在本註冊表決定
 *   「這模組有沒有做給該身分用」，管理頁只能檢視、不能改。
 *   **預設所有模組四身分皆「提供」**（可由模組作者日後收窄）。
 * - **顯示與否**：運維層級，存於 `settings/system.featureModuleRoles`
 *   （`Record<模組代碼, Record<身分, boolean>>`）——有提供但暫時不開放進入／顯示。
 *   規則：`provides[role] === false` → 顯示強制為否（「未提供」）；
 *   `provides === true` → 顯示開關生效，**缺省＝顯示**（欄位不存在＝啟用，fail-safe）。
 * - **超級管理員完全不受限制**：`role === "admin"` 且超級屬性時，
 *   所有模組一律可見（不看 provides、不看顯示開關）。
 * 本頁目前只維護設定資料，各身分端的實際攔截隨模組上線進度接上
 * （首頁卡片已依顯示與否過濾；API 維持「指定功能模組」守門，不因顯示關閉而額外阻擋）。
 * 變更歷史另記錄於稽核紀錄（`feature_module_updated`／`feature_module_role_updated`）。
 */

import { MODULES, type ModuleStatus } from "./modules";
import { ALL_ROLES, SUPER_ONLY_ADMIN_MODULES, type UserRole } from "./users";

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

/** 模組作者與版本資訊（產品層級靜態資料，隨主程式或模組提供） */
export interface FeatureModuleAuthor {
  author: string;
  /** 作者資訊連結（如 GitHub） */
  authorUrl: string;
  version: string;
  /** 版本（發布）日期，格式自由（如 `2026-10-10 08:00`） */
  releasedAt: string;
}

/** 目前全站模組共用的佔位作者資訊（日後各模組可各自覆寫） */
export const DEFAULT_MODULE_AUTHOR: FeatureModuleAuthor = {
  author: "張家誠",
  authorUrl: "https://github.com/takan003",
  version: "1.0",
  releasedAt: "2026-10-10 08:00",
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
  /** 作者與版本資訊（唯讀展示） */
  author: FeatureModuleAuthor;
  /**
   * 提供功能（**唯讀**，由模組作者決定）：
   * 該模組有沒有做給該身分用。false → 管理頁顯示「未提供」、顯示開關無效。
   */
  provides: Record<UserRole, boolean>;
}

/** 管理端權限單位的實作狀態 → 功能模組狀態（built＝已上線、apiOnly＝開發中） */
const PERMISSION_STATUS: Record<ModuleStatus, FeatureModuleStatus> = {
  built: "live",
  apiOnly: "building",
  planned: "planned",
};

/** 個人帳號安全：四身分皆提供 */
const PROVIDES_ALL = {
  student: true,
  parent: true,
  staff: true,
  admin: true,
} as const satisfies Record<UserRole, boolean>;

/**
 * 超級專屬功能模組代碼（由 `types/modules.ts` 的 superOnly 派生）。
 * 超級管理員對**所有**模組完全不受「提供功能／顯示與否」限制（見 isFeatureModuleVisible）；
 * 此清單僅供文件與管理頁說明引用。
 */
export const SUPER_ONLY_FEATURE_MODULE_VALUES: readonly string[] = SUPER_ONLY_ADMIN_MODULES;

/**
 * 內建的管理端功能模組：個人卡片「帳號、身分與安全管理」
 * ＋管理端權限單位（types/modules.ts 的 MODULES，含尚未建頁的稽核紀錄）。
 * 新增管理端功能時會自動出現在這裡，不需要另外維護。
 * 提供功能預設四身分皆「是」（可由模組作者日後收窄）。
 */
const ADMIN_FEATURE_MODULES: readonly FeatureModuleMeta[] = [
  {
    value: "account",
    label: "帳號、身分與安全管理",
    kind: "builtin",
    status: "live",
    description: "維護自己的個人資料、密碼與兩階段驗證等帳號安全設定。",
    href: "/admin/admins",
    author: DEFAULT_MODULE_AUTHOR,
    provides: PROVIDES_ALL,
  },
  ...MODULES.map((item) => ({
    value: item.value as string,
    label: item.label,
    kind: "builtin" as const,
    status: PERMISSION_STATUS[item.status],
    description: item.description,
    href: item.href,
    author: DEFAULT_MODULE_AUTHOR,
    provides: PROVIDES_ALL,
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
    author: DEFAULT_MODULE_AUTHOR,
    provides: PROVIDES_ALL,
  },
  {
    value: "calendar",
    label: "行事曆功能模組",
    kind: "builtin",
    status: "planned",
    description: "校務行事曆與各類日程的建立、發佈與檢視。",
    href: "",
    author: DEFAULT_MODULE_AUTHOR,
    provides: PROVIDES_ALL,
  },
  {
    value: "spaceBooking",
    label: "學校空間預約模組",
    kind: "optional",
    status: "planned",
    description: "教室、場地等學校空間的預約、審核與使用紀錄。",
    href: "",
    author: DEFAULT_MODULE_AUTHOR,
    provides: PROVIDES_ALL,
  },
  {
    value: "examRegistration",
    label: "升學與模擬考報名模組",
    kind: "optional",
    status: "planned",
    description: "升學相關考試與模擬考的報名、造冊與名單管理。",
    href: "",
    author: DEFAULT_MODULE_AUTHOR,
    provides: PROVIDES_ALL,
  },
  {
    value: "selfLearning",
    label: "自主學習模組",
    kind: "optional",
    status: "planned",
    description: "自主學習計畫的申請、歷程記錄與審查。",
    href: "",
    author: DEFAULT_MODULE_AUTHOR,
    provides: PROVIDES_ALL,
  },
  {
    value: "learningPortfolio",
    label: "學習歷程模組",
    kind: "optional",
    status: "planned",
    description: "學習歷程檔案的收集、整理與提交。",
    href: "",
    author: DEFAULT_MODULE_AUTHOR,
    provides: PROVIDES_ALL,
  },
  {
    value: "attendance",
    label: "線上點名模組",
    kind: "optional",
    status: "planned",
    description: "課堂點名、缺曠紀錄與出缺統計。",
    href: "",
    author: DEFAULT_MODULE_AUTHOR,
    provides: PROVIDES_ALL,
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

/** `settings/system` 上存「模組 × 身分」顯示開關的欄位名（語意＝顯示與否，非提供功能） */
export const FEATURE_MODULE_ROLES_FIELD = "featureModuleRoles";

/** 單一模組對四種身分的顯示開關（僅 applies於 provides＝true 的身分） */
export type FeatureModuleRoleSwitches = Record<UserRole, boolean>;

/** 全部功能模組 × 四種身分的顯示開關（鍵＝模組代碼） */
export type FeatureModuleRolesMap = Record<string, FeatureModuleRoleSwitches>;

/**
 * 讀回「模組 × 身分」顯示開關：以註冊表為準逐模組、逐身分解析。
 * - `provides[role] === false` → 強制 false（未提供，顯示開關無效）；
 * - `provides === true` → 只有明確存著 `false` 才視為關閉；
 *   欄位不存在、該模組未存或值毀損＝一律視為顯示（fail-safe：預設開啟）。
 */
export function readFeatureModuleRoles(raw: unknown): FeatureModuleRolesMap {
  const out: FeatureModuleRolesMap = {};
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  for (const item of FEATURE_MODULES) {
    const row = data ? data[item.value] : undefined;
    const rowData = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
    const switches = {} as FeatureModuleRoleSwitches;
    for (const role of ALL_ROLES) {
      if (!item.provides[role]) {
        switches[role] = false;
        continue;
      }
      switches[role] = !(rowData && rowData[role] === false);
    }
    out[item.value] = switches;
  }
  return out;
}

/** 該模組是否有提供給該身分（唯讀，產品層級） */
export function isFeatureModuleProvided(value: string, role: UserRole): boolean {
  const meta = featureModuleMeta(value);
  return meta ? meta.provides[role] === true : false;
}

/**
 * 該模組對該身分是否可見。
 * - **超級管理員（role=admin 且 isSuper）完全不受限制**：一律 true（不看 provides、不看顯示開關）；
 * - 其他：provides＝false → false；provides＝true → 顯示開關 !== false（缺省＝可見）。
 */
export function isFeatureModuleVisible(
  value: string,
  role: UserRole,
  display: FeatureModuleRoleSwitches | undefined,
  options?: { isSuper?: boolean }
): boolean {
  if (options?.isSuper === true && role === "admin") return true;
  const meta = featureModuleMeta(value);
  if (!meta || !meta.provides[role]) return false;
  return display?.[role] !== false;
}

/** 某身分可見的功能模組代碼清單（供首頁卡片過濾） */
export function visibleFeatureModuleValues(
  role: UserRole,
  rolesMap: FeatureModuleRolesMap,
  options?: { isSuper?: boolean }
): string[] {
  return FEATURE_MODULES.filter((item) =>
    isFeatureModuleVisible(item.value, role, rolesMap[item.value], options)
  ).map((item) => item.value);
}
