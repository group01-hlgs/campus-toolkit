export type UserRole = "student" | "parent" | "staff" | "admin";

/** 四種身分的固定順序（查找、顯示、選擇清單共用） */
export const ALL_ROLES: UserRole[] = ["student", "parent", "staff", "admin"];

export const ROLE_COLLECTIONS: Record<UserRole, string> = {
  student: "students",
  parent: "parents",
  staff: "staff",
  admin: "admins",
};

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
 * 兩階段驗證方式（存於使用者文件 `twoFactor` 欄位）。
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
 * 帳號狀態（所有身分的使用者帳號共用同一組欄位）。
 * 有效＝正常帳號；無效／停權＝停用帳號，一律無法登入，差別只在清單標示與操作用語。
 */
export type AccountStatus = "有效" | "無效" | "停權";

export const ACCOUNT_STATUSES: AccountStatus[] = ["有效", "無效", "停權"];

/** 可登入的狀態 */
export const ACTIVE_STATUS: AccountStatus = "有效";

export function isAccountStatus(value: unknown): value is AccountStatus {
  return value === "有效" || value === "無效" || value === "停權";
}

/**
 * 帳號是否有效（可登入）。
 * 有 status 以 status 為準；沒有 status 的舊資料回頭看 active（active === false 視為停用）。
 */
export function isAccountActive(
  data: Record<string, unknown> | null | undefined
): boolean {
  if (!data) return false;
  if (typeof data.status === "string") return data.status === ACTIVE_STATUS;
  return data.active !== false;
}

/**
 * 使用者帳號文件（students／parents／staff／admins 四種身分共用同一組欄位）。
 * 班級、學號等名冊資料不在此，存於 roster 集合（隨學年度、學期變動）。
 */
export interface AccountRecord {
  email: string;
  account: string;
  /** 密碼雜湊（bcrypt） */
  passwordHash: string;
  /** 姓名 */
  name: string;
  /** 狀態：有效／無效／停權（缺省＝有效） */
  status?: AccountStatus;
  /**
   * 慣用身分：同一組帳號／信箱同時存在於多個身分時，登入預設進入的身分。
   * 可填其他身分（跨文件生效）；未設定或無效值＝登入時詢問。
   */
  preferredRole?: UserRole;
  /** 兩階段驗證方式，缺省視為 off */
  twoFactor?: TwoFactorMethod;
  /** TOTP Base32 密鑰（twoFactor=totp 時使用） */
  totpSecret?: string;
  /** Email OTP：只存 sha256(code + uid)，有效期限與寄送節流 */
  otpHash?: string;
  otpExpiresAt?: number;
  otpSentAt?: number;
  /** TOTP 防重放：90 秒內同一組驗證碼不可重複使用 */
  totpLastCode?: string;
  totpLastUsedAt?: number;
  /** 登入紀錄（epoch ms，新→舊，最多 50 筆） */
  loginRecords: number[];
  /** 最後一次登入時間（epoch ms），0 表示無紀錄 */
  lastLogin: number;
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
  /** 觸發鎖定時的來源 IP（綁定鎖定，防跨 IP 鎖號 DoS） */
  lockIp?: string;
  /** 連續登入失敗次數 */
  failedAttempts: number;
  /** 每次重設密碼 +1，使舊 JWT 全數失效 */
  tokenVersion: number;
  createdAt: number;
}

/** 向後相容的舊名稱：帳號文件已全面統一為 AccountRecord */
export type BaseUserRecord = AccountRecord;
/** 向後相容的舊名稱：管理員與其他身分欄位一致（姓名用 name，不再有 displayName） */
export type AdminRecord = AccountRecord;
/** 家長帳號文件 */
export type ParentRecord = AccountRecord;

export const ROLE_SPECIFIC_FIELDS: Record<
  UserRole,
  { key: string; label: string }[]
> = {
  // 學生／家長／教職員的這些欄位存於 roster 集合（身分名冊，隨學年度、學期變動）
  student: [
    { key: "studentId", label: "學號" },
    { key: "grade", label: "年級" },
    { key: "className", label: "班級" },
    { key: "classNumber", label: "班號" },
  ],
  parent: [
    { key: "studentName", label: "學生姓名" },
    { key: "studentId", label: "學號" },
    { key: "className", label: "班級" },
    { key: "classNumber", label: "班號" },
  ],
  staff: [
    { key: "className", label: "班級" },
    { key: "title", label: "職稱" },
    { key: "attribute", label: "屬性" },
  ],
  // 管理員無角色專屬欄位（僅顯示姓名、電子郵件、帳號）
  admin: [],
};
