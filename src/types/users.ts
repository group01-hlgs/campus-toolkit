export type UserRole = "student" | "parent" | "staff" | "admin";

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

export interface BaseUserRecord {
  email: string;
  account: string;
  passwordHash: string;
  name: string;
  loginRecords: number[];
  lastLoginMethod: string;
  loginCount: number;
  cssThemeId: string;
  installedThemes: string;
  lockedUntil: number;
  /** 觸發鎖定時的來源 IP（綁定鎖定，防跨 IP 鎖號 DoS） */
  lockIp?: string;
  failedAttempts: number;
  createdAt: number;
  /** 建立時所屬學年度（民國年）與學期，供日後依學年／學期彙整（舊資料可能缺漏） */
  academicYear?: number;
  semester?: number;
}

export interface StudentRecord extends BaseUserRecord {
  studentId: string;
  /** 年級（舊資料可能沒有此欄位，缺省視為未填） */
  grade?: string;
  className: string;
  classNumber: string;
}

export interface ParentRecord extends BaseUserRecord {
  studentName: string;
  studentId: string;
  className: string;
  classNumber: string;
}

export interface StaffRecord extends BaseUserRecord {
  className: string;
  title: string;
  attribute: string;
}

export type RoleRecord = StudentRecord | ParentRecord | StaffRecord;

/** 管理員文件（admins collection）欄位總覽，帳號與安全管理頁對應讀取 */
export interface AdminRecord {
  email: string;
  account: string;
  passwordHash: string;
  displayName: string;
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
  loginRecords: number[];
  lastLogin: number;
  lastLoginMethod: string;
  loginCount: number;
  cssThemeId: string;
  installedThemes: string;
  lockedUntil: number;
  lockIp?: string;
  failedAttempts: number;
  tokenVersion: number;
  createdAt: number;
  /** 建立時所屬學年度（民國年）與學期，供日後依學年／學期彙整（舊資料可能缺漏） */
  academicYear?: number;
  semester?: number;
}

export const ROLE_SPECIFIC_FIELDS: Record<
  UserRole,
  { key: string; label: string }[]
> = {
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
