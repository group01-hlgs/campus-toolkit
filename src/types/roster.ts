/**
 * 身分名冊（四張表：學生、家長、教職員、管理員）共用定義：
 * 分頁、表單欄位、匯入檔案欄位、清單欄位。
 *
 * 名冊以學年度、學期為小週期；共同欄位（狀態、電子郵件、姓名、學年度、學期）
 * 定義於 RosterEntry，各表專屬欄位定義於 ROSTER_ENTRY_FIELDS。
 */

import {
  ACTIVE_STATUS,
  ADMIN_MODULES,
  AdminModule,
  AccountStatus,
  ROLE_LABELS,
  UserRole,
} from "@/types/users";

/** 名冊分頁＝四種身分（與帳號身分一致） */
export type RosterRole = UserRole;

export const ROSTER_ROLES: { value: RosterRole; label: string; tab: string }[] = [
  { value: "student", label: "學生", tab: "學生名冊" },
  { value: "parent", label: "家長", tab: "家長名冊" },
  { value: "staff", label: "教職員", tab: "教職員名冊" },
  { value: "admin", label: "管理員", tab: "管理員名冊" },
];

export function isRosterRole(value: unknown): value is RosterRole {
  return value === "student" || value === "parent" || value === "staff" || value === "admin";
}

export function rosterRoleLabel(value: unknown): string {
  return isRosterRole(value) ? ROLE_LABELS[value] : "";
}

/** 四張身分名冊的集合（每張＝一種身分，每「帳號 × 學年度 × 學期」最多一筆） */
export const ROSTER_COLLECTIONS: Record<UserRole, string> = {
  student: "rosterStudents",
  parent: "rosterParents",
  staff: "rosterStaff",
  admin: "rosterAdmins",
};

export function rosterCollection(role: UserRole): string {
  return ROSTER_COLLECTIONS[role];
}

/** 屬於「使用者帳號」的表單欄位（無學年度學期，寫入 users） */
export type AccountFieldKey = "email" | "account" | "password" | "name";

export const ACCOUNT_FIELD_KEYS: readonly AccountFieldKey[] = [
  "email",
  "account",
  "password",
  "name",
];

/** 各表專屬的名冊欄位鍵 */
export type EntryFieldKey =
  | "studentId"
  | "grade"
  | "studentName"
  | "classCode"
  | "className"
  | "seatNo"
  | "rollNo"
  | "studentEmail"
  | "relation"
  | "attribute"
  | "unit"
  | "title"
  | "modules";

/** 表單／匯入／清單共用的欄位鍵（password 只在表單與匯入出現，不會出現在清單） */
export type RosterFieldKey = AccountFieldKey | EntryFieldKey;

/** 各身分在名冊的專屬欄位（順序即表單與清單顯示順序） */
export const ROSTER_ENTRY_FIELDS: Record<UserRole, EntryFieldKey[]> = {
  student: ["studentId", "grade", "classCode", "className", "seatNo", "rollNo"],
  parent: [
    "studentName",
    "studentEmail",
    "studentId",
    "grade",
    "classCode",
    "className",
    "seatNo",
    "rollNo",
    "relation",
  ],
  staff: ["attribute", "unit", "title", "classCode", "className"],
  admin: ["attribute", "modules"],
};

/**
 * 身分名冊一條（四張表共用的文件形狀）。
 * doc id = `${uid}_${學年度}_${學期}`，關聯欄位 uid 連回使用者帳號。
 */
export interface RosterEntry {
  /** 連回使用者帳號文件（users 的 doc id） */
  uid: string;
  /** 狀態：有效／無效（擋該身分能否使用） */
  status: AccountStatus;
  /** 電子郵件地址（該期該身分的信箱，展示／搜尋） */
  email: string;
  /** 姓名（該期該身分的姓名，顯示以此為準） */
  name: string;
  /** 學年度（民國年） */
  academicYear: number;
  /** 學期：1=第1學期、2=第2學期 */
  semester: number;
  /** 學生姓名（家長表專屬：其子女姓名） */
  studentName?: string;
  studentEmail?: string;
  studentId?: string;
  grade?: string;
  classCode?: string;
  className?: string;
  seatNo?: string;
  rollNo?: string;
  relation?: string;
  attribute?: string;
  unit?: string;
  title?: string;
  modules?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface RosterFieldDef {
  key: RosterFieldKey;
  label: string;
  /** 表單必填（電子郵件必填、帳號可留空） */
  required?: boolean;
  /** 匯入檔案（.xlsx）標題列的別名，比對時忽略大小寫與前後空白 */
  aliases: string[];
}

const EMAIL_ALIASES = ["電子郵件地址", "電子郵件", "信箱", "email", "e-mail"];
const ACCOUNT_ALIASES = ["帳號", "account"];
const PASSWORD_ALIASES = ["密碼", "password"];
const NAME_ALIASES = ["姓名", "name"];

/** 各身分的表單欄位，順序即表單與匯入比對的順序（前四項為帳號欄位） */
export const ROSTER_FIELDS: Record<RosterRole, RosterFieldDef[]> = {
  student: [
    { key: "email", label: "電子郵件地址", required: true, aliases: EMAIL_ALIASES },
    { key: "account", label: "帳號", aliases: ACCOUNT_ALIASES },
    { key: "password", label: "密碼", aliases: PASSWORD_ALIASES },
    { key: "name", label: "姓名", required: true, aliases: NAME_ALIASES },
    { key: "studentId", label: "學號", required: true, aliases: ["學號", "studentid", "student id"] },
    { key: "grade", label: "年級", aliases: ["年級", "grade", "年"] },
    { key: "classCode", label: "班級代碼", aliases: ["班級代碼", "班級代號", "classcode", "class code"] },
    { key: "className", label: "班級名稱", aliases: ["班級名稱", "班級", "class", "classname"] },
    { key: "seatNo", label: "座號", aliases: ["座號", "seatno", "seat no"] },
    { key: "rollNo", label: "班號", aliases: ["班號", "rollno", "roll no", "number"] },
  ],
  parent: [
    { key: "email", label: "電子郵件地址", required: true, aliases: EMAIL_ALIASES },
    { key: "account", label: "帳號", aliases: ACCOUNT_ALIASES },
    { key: "password", label: "密碼", aliases: PASSWORD_ALIASES },
    { key: "name", label: "姓名", required: true, aliases: NAME_ALIASES },
    {
      key: "studentName",
      label: "學生姓名",
      aliases: ["學生姓名", "studentname", "student name"],
    },
    {
      key: "studentEmail",
      label: "學生電子郵件地址",
      aliases: ["學生電子郵件地址", "學生信箱", "學生email"],
    },
    { key: "studentId", label: "學號", aliases: ["學號", "studentid", "student id"] },
    { key: "grade", label: "年級", aliases: ["年級", "grade", "年"] },
    { key: "classCode", label: "班級代碼", aliases: ["班級代碼", "班級代號", "classcode"] },
    { key: "className", label: "班級名稱", aliases: ["班級名稱", "班級", "class"] },
    { key: "seatNo", label: "座號", aliases: ["座號", "seatno"] },
    { key: "rollNo", label: "班號", aliases: ["班號", "rollno", "number"] },
    { key: "relation", label: "關係", aliases: ["關係", "relation", "親屬關係"] },
  ],
  staff: [
    { key: "email", label: "電子郵件地址", required: true, aliases: EMAIL_ALIASES },
    { key: "account", label: "帳號", aliases: ACCOUNT_ALIASES },
    { key: "password", label: "密碼", aliases: PASSWORD_ALIASES },
    { key: "name", label: "姓名", required: true, aliases: NAME_ALIASES },
    { key: "attribute", label: "屬性", aliases: ["屬性", "attribute"] },
    { key: "unit", label: "單位", aliases: ["單位", "部門", "unit", "department"] },
    { key: "title", label: "職稱", aliases: ["職稱", "title"] },
    { key: "classCode", label: "班級代碼", aliases: ["班級代碼", "班級代號", "classcode"] },
    { key: "className", label: "班級名稱", aliases: ["班級名稱", "班級", "class"] },
  ],
  admin: [
    { key: "email", label: "電子郵件地址", required: true, aliases: EMAIL_ALIASES },
    { key: "account", label: "帳號", aliases: ACCOUNT_ALIASES },
    { key: "password", label: "密碼", aliases: PASSWORD_ALIASES },
    { key: "name", label: "姓名", required: true, aliases: NAME_ALIASES },
    { key: "attribute", label: "屬性", aliases: ["屬性", "attribute"] },
    {
      key: "modules",
      label: "指定功能模組",
      aliases: ["指定功能模組", "功能模組", "模組", "modules"],
    },
  ],
};

/** 資訊卡（帳號與安全頁）顯示的名冊欄位：依身分裁剪，與名冊表單欄位不完全相同 */
export interface RoleInfoField {
  key: RosterFieldKey;
  label: string;
  /** 有值才顯示（教職員班級名稱）；預設空值顯示破折號 */
  showOnlyWhenFilled?: boolean;
}

/** 以身分表單欄位定義組出資訊卡欄位（label 與名冊表單一致） */
function infoFields(role: RosterRole, keys: RosterFieldKey[]): RoleInfoField[] {
  return keys.map((key) => ({
    key,
    label: ROSTER_FIELDS[role].find((field) => field.key === key)?.label || key,
  }));
}

export const ROLE_INFO_FIELDS: Record<UserRole, RoleInfoField[]> = {
  // 學生：不顯示班級代碼、座號
  student: infoFields("student", ["studentId", "grade", "className", "rollNo"]),
  // 家長：不顯示班級代碼、座號；顯示學生姓名
  parent: infoFields("parent", [
    "studentName",
    "studentEmail",
    "studentId",
    "grade",
    "className",
    "rollNo",
    "relation",
  ]),
  // 教職員：不顯示班級代碼；班級名稱有值才顯示
  staff: [
    ...infoFields("staff", ["attribute", "unit", "title"]),
    {
      key: "className",
      label: ROSTER_FIELDS.staff.find((field) => field.key === "className")?.label || "班級名稱",
      showOnlyWhenFilled: true,
    },
  ],
  // 管理員：不顯示屬性、指定功能模組
  admin: [],
};

/** 帳號清單的表格欄位鍵（帳號／名冊欄位＋慣用身分） */
export type RosterColumnKey = RosterFieldKey | "preferredRole";

/** 帳號清單的表格欄位（不含密碼） */
export const ROSTER_COLUMNS: Record<RosterRole, { key: RosterColumnKey; label: string }[]> = {
  student: [
    { key: "name", label: "姓名" },
    { key: "email", label: "電子郵件地址" },
    { key: "account", label: "帳號" },
    { key: "studentId", label: "學號" },
    { key: "grade", label: "年級" },
    { key: "classCode", label: "班級代碼" },
    { key: "className", label: "班級名稱" },
    { key: "seatNo", label: "座號" },
    { key: "rollNo", label: "班號" },
  ],
  parent: [
    { key: "name", label: "姓名" },
    { key: "email", label: "電子郵件地址" },
    { key: "account", label: "帳號" },
    { key: "studentName", label: "學生姓名" },
    { key: "studentEmail", label: "學生電子郵件地址" },
    { key: "studentId", label: "學號" },
    { key: "grade", label: "年級" },
    { key: "classCode", label: "班級代碼" },
    { key: "className", label: "班級名稱" },
    { key: "seatNo", label: "座號" },
    { key: "rollNo", label: "班號" },
    { key: "relation", label: "關係" },
  ],
  staff: [
    { key: "name", label: "姓名" },
    { key: "email", label: "電子郵件地址" },
    { key: "account", label: "帳號" },
    { key: "attribute", label: "屬性" },
    { key: "unit", label: "單位" },
    { key: "title", label: "職稱" },
    { key: "classCode", label: "班級代碼" },
    { key: "className", label: "班級名稱" },
  ],
  admin: [
    { key: "name", label: "姓名" },
    { key: "email", label: "電子郵件地址" },
    { key: "account", label: "帳號" },
    { key: "attribute", label: "屬性" },
    { key: "modules", label: "指定功能模組" },
  ],
};

/** 匯入時每一列的原始輸入（欄位值一律是字串，空白代表未填） */
export type RosterInput = Partial<Record<RosterFieldKey, string>>;

/** 帳號清單一列（API 回傳格式，帳號欄位平鋪、不含密碼；名冊欄位為目前學年度學期） */
export interface RosterMember {
  uid: string;
  email: string;
  account: string;
  name: string;
  /** 帳號狀態：有效／無效（擋整個帳號能否登入） */
  status: AccountStatus;
  /** 名冊狀態：有效／無效（擋本期該身分能否使用） */
  rosterStatus: AccountStatus;
  /** 慣用身分：多身分共用帳號時登入預設進入的身分（未設定則登入時詢問） */
  preferredRole?: UserRole;
  /** 最後登入（由登入紀錄推導） */
  lastLogin?: number;
  loginCount?: number;
  studentName?: string;
  studentEmail?: string;
  studentId?: string;
  grade?: string;
  classCode?: string;
  className?: string;
  seatNo?: string;
  rollNo?: string;
  relation?: string;
  attribute?: string;
  unit?: string;
  title?: string;
  modules?: string[];
}

/** 可匯入 Excel 的身分（家長只提供表單建立，不提供檔案匯入） */
export const IMPORTABLE_ROLES: RosterRole[] = ["student", "staff", "admin"];

export function isImportableRole(role: RosterRole): boolean {
  return IMPORTABLE_ROLES.includes(role);
}

/** 管理員「指定功能模組」選項文字（用於清單顯示與匯入比對） */
export function adminModuleLabels(values: unknown): string {
  const list = Array.isArray(values) ? values : [];
  return list
    .map((value) => ADMIN_MODULES.find((item) => item.value === value)?.label || "")
    .filter(Boolean)
    .join("、");
}

/** 匯入檔案的格式說明（匯入失敗時列出所有可辨識的標題列） */
export function rosterImportHint(role: RosterRole): string {
  return ROSTER_FIELDS[role]
    .filter((field) => field.key !== "password")
    .map((field) => `${field.label}${field.required ? "（必填）" : ""}`)
    .join("、");
}

/** 頁面提示用：只列必填欄位，其他欄位可留空 */
export function rosterRequiredHint(role: RosterRole): string {
  return ROSTER_FIELDS[role]
    .filter((field) => field.required && field.key !== "password")
    .map((field) => field.label)
    .join("、");
}

/** 一列完全空白時視為空列，匯入時直接略過不回報錯誤 */
export function isEmptyRosterInput(input: RosterInput): boolean {
  return Object.values(input).every((value) => !String(value ?? "").trim());
}

/** 新建立的名冊條目預設狀態 */
export const ENTRY_DEFAULT_STATUS = ACTIVE_STATUS;
