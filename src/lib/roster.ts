import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { hashPassword } from "@/lib/auth";
import {
  ACCOUNT_EMAIL_REQUIRED_MESSAGE,
  ACCOUNT_FORMAT_MESSAGE,
  EMAIL_FORMAT_MESSAGE,
  isStrongPassword,
  normalizeAccount,
  normalizeEmail,
  PASSWORD_REQUIREMENT_MESSAGE,
} from "@/lib/validation";
import { ROLE_COLLECTIONS, AdminRecord, StaffRecord, StudentRecord } from "@/types/users";
import {
  ROSTER_FIELDS,
  RosterInput,
  RosterMember,
  RosterRole,
} from "@/types/roster";

export type { RosterMember };

/** 通過驗證、可直接寫入 Firestore 的欄位（password 另行雜湊） */
export interface RosterFields {
  email: string;
  account: string;
  name: string;
  studentId?: string;
  grade?: string;
  className?: string;
  classNumber?: string;
  title?: string;
  attribute?: string;
}

export type RosterValidation =
  | { ok: true; fields: RosterFields; password: string | null }
  | { ok: false; message: string };

const MAX_TEXT = 64;
const MAX_SHORT = 32;

function text(value: unknown, max = MAX_SHORT): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * 驗證並正規化一列帳號資料。
 * 規則與帳號與安全管理一致：電子郵件與帳號至少保留一項；姓名必填；
 * 密碼在建立時必填、更新時留空代表不變更，兩者都要過強度規則。
 */
export function validateRosterInput(
  role: RosterRole,
  input: RosterInput,
  options: { requirePassword: boolean }
): RosterValidation {
  const name = text(input.name, MAX_TEXT);
  if (!name) return { ok: false, message: "請填寫姓名" };

  const rawEmail = text(input.email, MAX_TEXT);
  const rawAccount = text(input.account, MAX_TEXT);
  if (!rawEmail && !rawAccount) {
    return { ok: false, message: ACCOUNT_EMAIL_REQUIRED_MESSAGE };
  }

  const email = rawEmail ? normalizeEmail(rawEmail) || "" : "";
  if (rawEmail && !email) return { ok: false, message: EMAIL_FORMAT_MESSAGE };

  const account = rawAccount ? normalizeAccount(rawAccount) || "" : "";
  if (rawAccount && !account) return { ok: false, message: ACCOUNT_FORMAT_MESSAGE };

  const rawPassword = typeof input.password === "string" ? input.password : "";
  let password: string | null = null;
  if (rawPassword) {
    if (!isStrongPassword(rawPassword)) {
      return { ok: false, message: PASSWORD_REQUIREMENT_MESSAGE };
    }
    password = rawPassword;
  } else if (options.requirePassword) {
    return { ok: false, message: `請填寫密碼，${PASSWORD_REQUIREMENT_MESSAGE}` };
  }

  const fields: RosterFields = { email, account, name };

  if (role === "student") {
    const studentId = text(input.studentId);
    if (!studentId) return { ok: false, message: "請填寫學號" };
    fields.studentId = studentId;
    fields.grade = text(input.grade);
    fields.className = text(input.className);
    fields.classNumber = text(input.classNumber);
  }

  if (role === "staff") {
    fields.className = text(input.className);
    fields.title = text(input.title);
    fields.attribute = text(input.attribute);
  }

  return { ok: true, fields, password };
}

/** 同身分內的查重索引（建立／更新／匯入共用，避免每列都打一次 Firestore） */
export interface RosterIndex {
  emails: Map<string, string>;
  accounts: Map<string, string>;
  studentIds: Map<string, string>;
}

export async function loadRosterIndex(
  role: RosterRole,
  excludeUid = ""
): Promise<RosterIndex> {
  const snapshot = await getAdminDb().collection(ROLE_COLLECTIONS[role]).get();
  const index: RosterIndex = {
    emails: new Map(),
    accounts: new Map(),
    studentIds: new Map(),
  };
  for (const doc of snapshot.docs) {
    if (doc.id === excludeUid) continue;
    const data = doc.data();
    const email = typeof data.email === "string" ? data.email : "";
    const account = typeof data.account === "string" ? data.account : "";
    const studentId = typeof data.studentId === "string" ? data.studentId : "";
    if (email) index.emails.set(email, doc.id);
    if (account) index.accounts.set(account, doc.id);
    if (studentId) index.studentIds.set(studentId, doc.id);
  }
  return index;
}

/** 回傳衝突訊息（無衝突回 null） */
export function checkRosterConflict(
  fields: RosterFields,
  index: RosterIndex
): string | null {
  if (fields.email && index.emails.has(fields.email)) return "此電子郵件已被使用";
  if (fields.account && index.accounts.has(fields.account)) return "此帳號已被使用";
  if (fields.studentId && index.studentIds.has(fields.studentId)) return "此學號已被使用";
  return null;
}

/** 依身分組出完整使用者文件（預設值與種子帳號／既有建立流程一致） */
export function buildRosterRecord(
  role: RosterRole,
  fields: RosterFields,
  passwordHash: string
): Record<string, unknown> {
  const now = Date.now();

  if (role === "admin") {
    const admin: AdminRecord = {
      email: fields.email,
      account: fields.account,
      passwordHash,
      displayName: fields.name,
      loginRecords: [],
      lastLogin: 0,
      lastLoginMethod: "",
      loginCount: 0,
      cssThemeId: "",
      installedThemes: "[]",
      lockedUntil: 0,
      failedAttempts: 0,
      tokenVersion: 1,
      createdAt: now,
    };
    return { ...admin };
  }

  const base = {
    email: fields.email,
    account: fields.account,
    passwordHash,
    name: fields.name,
    loginRecords: [] as number[],
    lastLoginMethod: "",
    loginCount: 0,
    cssThemeId: "",
    installedThemes: "[]",
    lockedUntil: 0,
    failedAttempts: 0,
    createdAt: now,
  };

  if (role === "student") {
    const student: StudentRecord = {
      ...base,
      studentId: fields.studentId || "",
      grade: fields.grade || "",
      className: fields.className || "",
      classNumber: fields.classNumber || "",
    };
    return { ...student };
  }

  const staff: StaffRecord = {
    ...base,
    className: fields.className || "",
    title: fields.title || "",
    attribute: fields.attribute || "",
  };
  return { ...staff };
}

/** 清單列轉成 API 回傳格式（不含密碼與稽核欄位） */
export function toRosterMember(role: RosterRole, uid: string, data: Record<string, unknown>): RosterMember {
  const str = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : "");
  const member: RosterMember = {
    uid,
    email: str("email"),
    account: str("account"),
    name: role === "admin" ? str("displayName") : str("name"),
  };
  if (typeof data.lastLogin === "number") member.lastLogin = data.lastLogin;
  if (typeof data.loginCount === "number") member.loginCount = data.loginCount;

  for (const key of ["studentId", "grade", "className", "classNumber", "title", "attribute"] as const) {
    const value = str(key);
    if (value) member[key] = value;
  }
  return member;
}

/** 轉成匯入／表單使用的輸入物件（欄位值一律為字串） */
export function toRosterInput(role: RosterRole, member: Record<string, unknown>): RosterInput {
  const input: RosterInput = {};
  for (const field of ROSTER_FIELDS[role]) {
    if (field.key === "password") continue;
    const key = field.key === "name" && role === "admin" ? "displayName" : field.key;
    const value = member[key];
    if (typeof value === "string") input[field.key] = value;
  }
  return input;
}

/** 密碼雜湊（匯入批次共用；costFactor 固定 12，不接受外部指定） */
export async function hashRosterPassword(plain: string): Promise<string> {
  return hashPassword(plain, 12);
}
