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
import {
  ROLE_COLLECTIONS,
  AccountRecord,
  AccountStatus,
  ACTIVE_STATUS,
  isAccountStatus,
  isUserRole,
  UserRole,
} from "@/types/users";
import { SchoolPeriod } from "@/types/settings";
import {
  ROSTER_ENTRY_FIELDS,
  RosterEntry,
  RosterEntryRole,
  RosterFieldKey,
  RosterInput,
  RosterMember,
  RosterRole,
} from "@/types/roster";

export type { RosterMember };

/** 身分名冊存放的集合：每「身分 × 學年度 × 學期」一條，與使用者帳號分開放 */
export const ROSTER_COLLECTION = "roster";

/** 使用者帳號的欄位（無學年度學期） */
export interface AccountFields {
  email: string;
  account: string;
  name: string;
}

/** 身分名冊的欄位（隨學年度、學期變動），鍵見 ROSTER_ENTRY_FIELDS */
export type RosterData = Partial<Record<RosterFieldKey, string>>;

export type RosterValidation =
  | { ok: true; account: AccountFields; roster: RosterData; password: string | null }
  | { ok: false; message: string };

const MAX_TEXT = 64;
const MAX_SHORT = 32;

function text(value: unknown, max = MAX_SHORT): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** 該身分在身分名冊的條目身分（四種身分都進名冊；管理員條目只有學年度學期標記） */
export function entryRoleOf(role: UserRole): RosterEntryRole {
  if (role === "student" || role === "staff" || role === "parent" || role === "admin") {
    return role;
  }
  return "admin";
}

export function isEntryRole(value: unknown): value is RosterEntryRole {
  return value === "student" || value === "staff" || value === "parent";
}

/**
 * 驗證並正規化一列資料，拆成「使用者帳號」與「身分名冊」兩段。
 * 帳號規則：電子郵件必填（多身分以電子郵件偵測）、帳號可留空、姓名必填；
 * 密碼建立時必填、更新時留空代表不變更，兩者都要過強度規則。
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
  if (!rawEmail) return { ok: false, message: ACCOUNT_EMAIL_REQUIRED_MESSAGE };

  const email = normalizeEmail(rawEmail) || "";
  if (!email) return { ok: false, message: EMAIL_FORMAT_MESSAGE };

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

  const accountFields: AccountFields = { email, account, name };
  const roster: RosterData = {};

  const entryRole = entryRoleOf(role);
  for (const key of ROSTER_ENTRY_FIELDS[entryRole]) {
    roster[key] = text(input[key], MAX_TEXT);
  }
  if (role === "student" && !roster.studentId) {
    return { ok: false, message: "請填寫學號" };
  }

  return { ok: true, account: accountFields, roster, password };
}

/** 查重索引：email/account 依帳號集合，學號依「目前學年度學期」的身分名冊 */
export interface RosterIndex {
  emails: Map<string, string>;
  accounts: Map<string, string>;
  studentIds: Map<string, string>;
}

export async function loadRosterIndex(
  role: RosterRole,
  period: SchoolPeriod,
  excludeUid = ""
): Promise<RosterIndex> {
  const index: RosterIndex = {
    emails: new Map(),
    accounts: new Map(),
    studentIds: new Map(),
  };

  const snapshot = await getAdminDb().collection(ROLE_COLLECTIONS[role]).get();
  for (const doc of snapshot.docs) {
    if (doc.id === excludeUid) continue;
    const data = doc.data();
    const email = typeof data.email === "string" ? data.email : "";
    const account = typeof data.account === "string" ? data.account : "";
    if (email) index.emails.set(email, doc.id);
    if (account) index.accounts.set(account, doc.id);
  }

  const entryRole = entryRoleOf(role);
  if (ROSTER_ENTRY_FIELDS[entryRole].includes("studentId")) {
    const entries = await getAdminDb()
      .collection(ROSTER_COLLECTION)
      .where("role", "==", entryRole)
      .where("academicYear", "==", period.academicYear)
      .where("semester", "==", period.semester)
      .get();
    for (const doc of entries.docs) {
      const data = doc.data();
      const uid = typeof data.uid === "string" ? data.uid : "";
      if (uid === excludeUid) continue;
      const studentId = typeof data.studentId === "string" ? data.studentId : "";
      if (studentId) index.studentIds.set(studentId, uid);
    }
  }

  return index;
}

/** 回傳衝突訊息（無衝突回 null） */
export function checkRosterConflict(
  account: AccountFields,
  roster: RosterData,
  index: RosterIndex
): string | null {
  if (account.email && index.emails.has(account.email)) return "此電子郵件已被使用";
  if (account.account && index.accounts.has(account.account)) return "此帳號已被使用";
  if (roster.studentId && index.studentIds.has(roster.studentId)) return "此學號已被使用";
  return null;
}

/** 組出「使用者帳號」文件：四種身分共用同一組欄位（名冊欄位存於 roster 集合） */
export function buildAccountRecord(
  account: AccountFields,
  passwordHash: string,
  preferredRole?: UserRole | ""
): AccountRecord {
  const now = Date.now();
  const record: AccountRecord = {
    email: account.email,
    account: account.account,
    passwordHash,
    name: account.name,
    status: ACTIVE_STATUS,
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
  if (isUserRole(preferredRole)) record.preferredRole = preferredRole;
  return record;
}

/** 身分名冊文件 id：每「帳號 × 學年度 × 學期」唯一，方便直接更新與讀取 */
export function rosterEntryId(uid: string, period: SchoolPeriod): string {
  return `${uid}_${period.academicYear}_${period.semester}`;
}

/** 組出一條身分名冊資料（寫入前呼叫；缺欄位補空字串，避免讀取端缺 key） */
export function buildRosterEntry(
  uid: string,
  role: RosterEntryRole,
  period: SchoolPeriod,
  roster: RosterData
): RosterEntry {
  const now = Date.now();
  const data: Record<string, unknown> = {
    uid,
    role,
    academicYear: period.academicYear,
    semester: period.semester,
    createdAt: now,
    updatedAt: now,
  };
  for (const key of ROSTER_ENTRY_FIELDS[role]) {
    data[key] = typeof roster[key] === "string" ? (roster[key] as string) : "";
  }
  return data as unknown as RosterEntry;
}

/** 讀取某帳號在指定學年度學期的身分名冊條目（無則回 null） */
export async function getRosterEntry(
  uid: string,
  role: RosterEntryRole,
  period: SchoolPeriod
): Promise<Record<string, unknown> | null> {
  const snap = await getAdminDb()
    .collection(ROSTER_COLLECTION)
    .doc(rosterEntryId(uid, period))
    .get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return data.role === role ? data : null;
}

/** 讀取指定學年度學期的全部身分名冊，以 uid 為鍵 */
export async function loadPeriodEntries(
  period: SchoolPeriod,
  role?: RosterEntryRole
): Promise<Map<string, Record<string, unknown>>> {
  const collection = getAdminDb().collection(ROSTER_COLLECTION);
  const query = role
    ? collection
        .where("academicYear", "==", period.academicYear)
        .where("semester", "==", period.semester)
        .where("role", "==", role)
    : collection
        .where("academicYear", "==", period.academicYear)
        .where("semester", "==", period.semester);

  const snapshot = await query.get();
  const map = new Map<string, Record<string, unknown>>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const uid = typeof data.uid === "string" ? data.uid : "";
    if (uid) map.set(uid, data);
  }
  return map;
}

/** 帳號文件 → 狀態（有效／無效／停權）；還沒有 status 的舊資料以 active 過渡 */
function accountStatus(account: Record<string, unknown>): AccountStatus {
  if (isAccountStatus(account.status)) return account.status;
  return account.active === false ? "無效" : "有效";
}

/** 帳號文件＋名冊條目 → 帳號清單一列（不含密碼；名冊欄位取自目前學年度學期） */
export function toRosterMember(
  role: RosterRole,
  uid: string,
  account: Record<string, unknown>,
  entry: Record<string, unknown> | null
): RosterMember {
  const str = (source: Record<string, unknown> | null, key: string) =>
    source && typeof source[key] === "string" ? (source[key] as string) : "";

  const member: RosterMember = {
    uid,
    email: str(account, "email"),
    account: str(account, "account"),
    // 舊管理員文件用 displayName，遷移後統一為 name
    name: str(account, "name") || str(account, "displayName"),
    status: accountStatus(account),
  };
  if (typeof account.lastLogin === "number") member.lastLogin = account.lastLogin;
  if (typeof account.loginCount === "number") member.loginCount = account.loginCount;
  if (isUserRole(account.preferredRole)) member.preferredRole = account.preferredRole;

  const entryRole = entryRoleOf(role);
  const target = member as unknown as Record<string, string | boolean | undefined>;
  for (const key of ROSTER_ENTRY_FIELDS[entryRole]) {
    const value = str(entry, key);
    if (value) target[key] = value;
  }
  return member;
}

/** 密碼雜湊（匯入批次共用；costFactor 固定 12，不接受外部指定） */
export async function hashRosterPassword(plain: string): Promise<string> {
  return hashPassword(plain, 12);
}
