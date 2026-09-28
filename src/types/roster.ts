/**
 * 名冊管理（/admin/roster）共用定義：身分分頁、表單欄位、匯入檔案欄位。
 * 涵蓋學生／教職員／管理員三個身分；家長名冊不在此頁維護。
 */

export type RosterRole = "student" | "staff" | "admin";

export const ROSTER_ROLES: { value: RosterRole; label: string; tab: string }[] = [
  { value: "student", label: "學生", tab: "學生名冊" },
  { value: "staff", label: "教職員", tab: "教職員名冊" },
  { value: "admin", label: "管理員", tab: "管理員名冊" },
];

export function isRosterRole(value: unknown): value is RosterRole {
  return value === "student" || value === "staff" || value === "admin";
}

export function rosterRoleLabel(value: unknown): string {
  return ROSTER_ROLES.find((role) => role.value === value)?.label || "";
}

/** 表單／匯入共用的欄位鍵（password 只在表單與匯入出現，不會出現在清單） */
export type RosterFieldKey =
  | "email"
  | "account"
  | "password"
  | "name"
  | "studentId"
  | "grade"
  | "className"
  | "classNumber"
  | "title"
  | "attribute";

export interface RosterFieldDef {
  key: RosterFieldKey;
  label: string;
  /** 表單必填（電子郵件與帳號屬「至少一項」規則，不標 required） */
  required?: boolean;
  /** 匯入檔案（.xlsx）標題列的別名，比對時忽略大小寫與前後空白 */
  aliases: string[];
}

/** 各身分的表單欄位，順序即表單與匯入比對的順序 */
export const ROSTER_FIELDS: Record<RosterRole, RosterFieldDef[]> = {
  student: [
    { key: "email", label: "電子郵件地址", aliases: ["電子郵件地址", "電子郵件", "信箱", "email", "e-mail"] },
    { key: "account", label: "帳號", aliases: ["帳號", "account"] },
    { key: "password", label: "密碼", aliases: ["密碼", "password"] },
    { key: "name", label: "姓名", required: true, aliases: ["姓名", "name"] },
    { key: "studentId", label: "學號", required: true, aliases: ["學號", "studentid", "student id"] },
    { key: "grade", label: "年級", aliases: ["年級", "grade", "年"] },
    { key: "className", label: "班級", aliases: ["班級", "class"] },
    { key: "classNumber", label: "班號", aliases: ["班號", "座號", "number"] },
  ],
  staff: [
    { key: "email", label: "電子郵件地址", aliases: ["電子郵件地址", "電子郵件", "信箱", "email", "e-mail"] },
    { key: "account", label: "帳號", aliases: ["帳號", "account"] },
    { key: "password", label: "密碼", aliases: ["密碼", "password"] },
    { key: "name", label: "姓名", required: true, aliases: ["姓名", "name"] },
    { key: "className", label: "班級", aliases: ["班級", "class"] },
    { key: "title", label: "職稱", aliases: ["職稱", "title"] },
    { key: "attribute", label: "屬性", aliases: ["屬性", "attribute"] },
  ],
  admin: [
    { key: "email", label: "電子郵件地址", aliases: ["電子郵件地址", "電子郵件", "信箱", "email", "e-mail"] },
    { key: "account", label: "帳號", aliases: ["帳號", "account"] },
    { key: "password", label: "密碼", aliases: ["密碼", "password"] },
    { key: "name", label: "姓名", required: true, aliases: ["姓名", "name"] },
  ],
};

/** 名冊清單的表格欄位（不含密碼） */
export const ROSTER_COLUMNS: Record<RosterRole, { key: RosterFieldKey; label: string }[]> = {
  student: [
    { key: "name", label: "姓名" },
    { key: "email", label: "電子郵件地址" },
    { key: "account", label: "帳號" },
    { key: "studentId", label: "學號" },
    { key: "grade", label: "年級" },
    { key: "className", label: "班級" },
    { key: "classNumber", label: "班號" },
  ],
  staff: [
    { key: "name", label: "姓名" },
    { key: "email", label: "電子郵件地址" },
    { key: "account", label: "帳號" },
    { key: "className", label: "班級" },
    { key: "title", label: "職稱" },
    { key: "attribute", label: "屬性" },
  ],
  admin: [
    { key: "name", label: "姓名" },
    { key: "email", label: "電子郵件地址" },
    { key: "account", label: "帳號" },
  ],
};

/** 匯入時每一列的原始輸入（欄位值一律是字串，空白代表未填） */
export type RosterInput = Partial<Record<RosterFieldKey, string>>;

/** 名冊清單一列（API 回傳格式，角色欄位平鋪、不含密碼） */
export interface RosterMember {
  uid: string;
  email: string;
  account: string;
  name: string;
  lastLogin?: number;
  loginCount?: number;
  studentId?: string;
  grade?: string;
  className?: string;
  classNumber?: string;
  title?: string;
  attribute?: string;
}

/** 匯入檔案的格式說明（頁面上直接顯示，讓使用者對得上範例檔） */
export function rosterImportHint(role: RosterRole): string {
  return ROSTER_FIELDS[role]
    .map((field) => `${field.label}${field.required ? "（必填）" : ""}`)
    .join("、");
}

/** 一列完全空白時視為空列，匯入時直接略過不回報錯誤 */
export function isEmptyRosterInput(input: RosterInput): boolean {
  return Object.values(input).every((value) => !String(value ?? "").trim());
}
