export type UserRole = "student" | "parent" | "staff" | "admin";

/** 四種身分的固定順序（查找、顯示、選擇清單共用） */
export const ALL_ROLES: UserRole[] = ["student", "parent", "staff", "admin"];

/** 使用者帳號唯一集合（1 張表、無週期、永久） */
export const USER_COLLECTION = "users";

export const ROLE_HOME: Record<UserRole, string> = {
  student: "/student",
  parent: "/parent",
  staff: "/staff",
  admin: "/admin",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  student: "學生",
  parent: "家長",
  staff: "教職員",
  admin: "管理員",
};

export function isUserRole(value: unknown): value is UserRole {
  return value === "student" || value === "parent" || value === "staff" || value === "admin";
}

/**
 * 兩階段驗證方式（存於使用者帳號 `twoFactor` 欄位）。
 * 選項文字與舊 GAS 站 account.html 一致：關閉 / 登入通知 / 電子郵件驗證碼 / 驗證碼APP。
 */
export const TWO_FACTOR_METHODS = [
  { value: "off", label: "關閉 - 高風險" },
  { value: "email_notify", label: "電子郵件發送登入通知 - 中風險" },
  { value: "email_otp", label: "電子郵件驗證碼 - 低風險" },
  { value: "totp", label: "驗證碼APP - 低風險" },
] as const;

export type TwoFactorMethod = (typeof TWO_FACTOR_METHODS)[number]["value"];

export const DEFAULT_TWO_FACTOR: TwoFactorMethod = "off";

export function isTwoFactorMethod(value: unknown): value is TwoFactorMethod {
  return (
    typeof value === "string" &&
    TWO_FACTOR_METHODS.some((method) => method.value === value)
  );
}

/** 顯示用標籤；未知值一律視為「關閉」（fail-safe，不會誤觸驗證） */
export function twoFactorLabel(value: unknown): string {
  const method = isTwoFactorMethod(value) ? value : DEFAULT_TWO_FACTOR;
  return TWO_FACTOR_METHODS.find((item) => item.value === method)?.label || TWO_FACTOR_METHODS[0].label;
}

/** 需要第二階段驗證才建立 session 的方式（登入通知不阻擋登入） */
export function requiresSecondFactor(value: unknown): value is "email_otp" | "totp" {
  return value === "email_otp" || value === "totp";
}

/**
 * 狀態（帳號層＝是否可登入；名冊層＝該期該身分是否可用），兩層共用同一組值。
 * 有效＝正常；無效／停權＝不可用，差別只在清單標示與操作用語。
 */
export type AccountStatus = "有效" | "無效" | "停權";

export const ACCOUNT_STATUSES: AccountStatus[] = ["有效", "無效", "停權"];

/** 可用的狀態 */
export const ACTIVE_STATUS: AccountStatus = "有效";

export function isAccountStatus(value: unknown): value is AccountStatus {
  return value === "有效" || value === "無效" || value === "停權";
}

/** 是否為「有效」狀態（名冊條目、帳號文件共用） */
export function isActiveStatus(value: unknown): boolean {
  return value === ACTIVE_STATUS;
}

/**
 * 使用者帳號是否有效（可登入）。
 * 有 status 以 status 為準；無 status 的文件視為有效（僅剛建立尚未寫入的瞬間）。
 */
export function isAccountActive(
  data: Record<string, unknown> | null | undefined
): boolean {
  if (!data) return false;
  if (typeof data.status === "string") return data.status === ACTIVE_STATUS;
  return true;
}

/** 最後登入時間：由登入紀錄推導（登入紀錄依序累加，最後一筆即最新） */
export function lastLoginOf(data: Record<string, unknown> | null | undefined): number {
  const records = data && Array.isArray(data.loginRecords) ? data.loginRecords : [];
  const last = records[records.length - 1];
  return typeof last === "number" ? last : 0;
}

/**
 * 管理員可指定的功能模組（超級＝全開；一般＝僅被指定的模組）。
 * 模組決定：首頁卡片是否顯示、對應 API 是否放行（requireAdminModule）。
 * 注意：個人頁「帳號、身分與安全管理」不是模組——每個帳號都用得到，管理員首頁固定顯示。
 */
export const ADMIN_MODULES = [
  { value: "users", label: "使用者帳號管理" },
  { value: "roster", label: "身分名冊管理" },
  { value: "settings", label: "系統設定" },
  { value: "activity", label: "稽核紀錄" },
] as const;

export type AdminModule = (typeof ADMIN_MODULES)[number]["value"];

export const ADMIN_MODULE_VALUES: AdminModule[] = ADMIN_MODULES.map((item) => item.value);

export function isAdminModule(value: unknown): value is AdminModule {
  return typeof value === "string" && ADMIN_MODULE_VALUES.includes(value as AdminModule);
}

/**
 * 改版前的模組代碼／標籤 → 現行模組（僅舊資料與舊輸入相容）。
 * - `roles`（身分管理）已併入「身分名冊管理」，舊管理員的指派不會因此失權。
 * - 舊 `使用者帳號管理`（代碼 `roster`）改版後對應「身分名冊管理」；
 *   如該管理員也要用帳號工作表，請在名冊管理頁補勾「使用者帳號管理」。
 * - 舊 `account`（個人頁「帳號、身分與安全管理」）不再對應任何模組：
 *   個人頁不需權限，人人可見，故不授予管理工作。
 */
const LEGACY_ADMIN_MODULES: Record<string, AdminModule> = {
  roles: "roster",
  身分管理: "roster",
};

/** 解析一個模組代碼或標籤（含舊值），無法辨識回 undefined */
export function resolveAdminModule(token: string): AdminModule | undefined {
  if (isAdminModule(token)) return token;
  const byLabel = ADMIN_MODULES.find((item) => item.label === token)?.value;
  if (byLabel) return byLabel;
  return LEGACY_ADMIN_MODULES[token];
}

/** 管理員屬性：超級＝全開；一般＝僅指定功能模組 */
export type AdminAttribute = "超級" | "一般";
export const ADMIN_ATTRIBUTES: AdminAttribute[] = ["超級", "一般"];

export function isAdminAttribute(value: unknown): value is AdminAttribute {
  return value === "超級" || value === "一般";
}

/** 教職員屬性 */
export type StaffAttribute = "行政" | "教師";
export const STAFF_ATTRIBUTES: StaffAttribute[] = ["行政", "教師"];

export function isStaffAttribute(value: unknown): value is StaffAttribute {
  return value === "行政" || value === "教師";
}

/**
 * 使用者帳號（`users` 集合文件）：1 張表、無週期、永久。
 * 回答「這個人能否登入、怎麼登入」；兩階段驗證設置於此層。
 * 班級、學號等名冊資料不在此，存於四張身分名冊（隨學年度、學期變動）。
 */
export interface AccountRecord {
  /** 電子郵件地址：必填、全站唯一（登入識別＋2FA 收信） */
  email: string;
  /** 帳號：選填、全站唯一（登入識別） */
  account: string;
  /** 密碼雜湊（bcrypt）：密碼只在這一層，名冊不存密碼 */
  passwordHash: string;
  /** 姓名（帳號層預設值；顯示以當期名冊姓名為準） */
  name: string;
  /** 狀態：有效／無效／停權（決定能否登入，缺省＝有效） */
  status?: AccountStatus;
  /** 慣用身分：多身分時登入預設進入的身分；未設定＝登入時詢問 */
  preferredRole?: UserRole;
  /** 兩階段驗證方式，缺省視為 off */
  twoFactor?: TwoFactorMethod;
  /** TOTP Base32 密鑰（twoFactor=totp 時使用） */
  totpSecret?: string;
  /** Email OTP：只存 sha256(uid:code)，有效期限與寄送節流 */
  otpHash?: string;
  otpExpiresAt?: number;
  otpSentAt?: number;
  /** TOTP 防重放：90 秒內同一組驗證碼不可重複使用 */
  totpLastCode?: string;
  totpLastUsedAt?: number;
  /** 登入紀錄（epoch ms，依序累加，最多 50 筆；最後登入＝最後一筆） */
  loginRecords: number[];
  /** 最後一次登入方式（登入方式） */
  lastLoginMethod: string;
  /** 登入次數 */
  loginCount: number;
  /** CSS 主題 ID */
  cssThemeId: string;
  /** 已安裝主題清單（JSON 陣列字串） */
  installedThemes: string;
  /** 鎖定至（epoch ms），0 表示未鎖定 */
  lockedUntil: number;
  /** 觸發鎖定時的來源 IP（綁定鎖定，防跨 IP 鎖號 DoS；空字串＝全域鎖定） */
  lockIp?: string;
  /** 連續登入失敗次數 */
  failedAttempts: number;
  /** 每次重設密碼 +1，使舊 JWT 全數失效 */
  tokenVersion: number;
  createdAt: number;
}

/**
 * 「使用者帳號管理」工作表的一列（API 回傳格式，不含密碼）。
 * 具備身分＝該帳號於「當期」四張身分名冊中存在條目（不論條目狀態）。
 */
export interface AccountSummary {
  uid: string;
  email: string;
  account: string;
  name: string;
  status: AccountStatus;
  /** 慣用身分（未設定＝登入時詢問） */
  preferredRole?: UserRole;
  /** 兩階段驗證方式原值（顯示請用 twoFactorLabel） */
  twoFactor?: TwoFactorMethod;
  lastLogin?: number;
  loginCount?: number;
  /** 具備身分（當期名冊有條目者，順序 ALL_ROLES） */
  roles: UserRole[];
}
