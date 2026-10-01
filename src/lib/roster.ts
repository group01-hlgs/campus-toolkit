import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { hashPassword } from "@/lib/auth";
import {
  ACCOUNT_FORMAT_MESSAGE,
  ACCOUNT_IDENTIFIER_REQUIRED_MESSAGE,
  EMAIL_FORMAT_MESSAGE,
  isStrongPassword,
  normalizeAccount,
  normalizeEmail,
  PASSWORD_REQUIREMENT_MESSAGE,
} from "@/lib/validation";
import {
  AccountRecord,
  AccountStatus,
  ACTIVE_STATUS,
  AdminModule,
  ADMIN_MODULE_VALUES,
  resolveAdminModule,
  USER_COLLECTION,
  UserRole,
  isAccountActive,
  isAccountStatus,
  isStaffAttribute,
  isUserRole,
  lastLoginOf,
  normalizeAccountStatus,
  resolveStaffAttribute,
  STAFF_ATTRIBUTES,
} from "@/types/users";
import { SchoolPeriod } from "@/types/settings";
import { getCurrentPeriod } from "@/lib/settings-server";
import {
  ACCOUNT_FIELD_KEYS,
  AccountInput,
  ENTRY_DEFAULT_STATUS,
  ROSTER_ENTRY_FIELDS,
  RosterEntry,
  RosterFieldKey,
  RosterInput,
  RosterMember,
  RosterRole,
  rosterCollection,
} from "@/types/roster";

export type { RosterMember };

/** 使用者帳號的欄位（無學年度學期） */
export interface AccountFields {
  email: string;
  account: string;
  name: string;
}

/** 名冊專屬欄位（隨學年度、學期變動），鍵見 ROSTER_ENTRY_FIELDS */
export type RosterData = Partial<Record<RosterFieldKey, string | string[]>>;

export type RosterValidation =
  | { ok: true; account: AccountFields; roster: RosterData }
  | { ok: false; message: string };

const MAX_TEXT = 64;
const MAX_SHORT = 32;

function text(value: unknown, max = MAX_SHORT): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** 名冊文件 id：每「帳號 × 學年度 × 學期」唯一，方便直接更新與讀取 */
export function rosterEntryId(uid: string, period: SchoolPeriod): string {
  return `${uid}_${period.academicYear}_${period.semester}`;
}

/**
 * 「指定功能模組」正規化：接受逗號／頓號分隔的代碼或標籤，
 * 回傳合法代碼去重清單（輸入無效時回空陣列，由驗證決定是否報錯）。
 */
function normalizeModules(value: unknown): string[] {
  if (Array.isArray(value)) {
    const resolved = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => resolveAdminModule(item))
      .filter((item): item is AdminModule => Boolean(item));
    return ADMIN_MODULE_VALUES.filter((module) => resolved.includes(module));
  }
  if (typeof value !== "string") return [];
  const tokens = value
    .split(/[,、;；\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const modules: string[] = [];
  for (const token of tokens) {
    const module = resolveAdminModule(token);
    if (module && !modules.includes(module)) modules.push(module);
  }
  return ADMIN_MODULE_VALUES.filter((module) => modules.includes(module));
}

/**
 * 驗證並正規化一列資料，拆成「使用者帳號」與「名冊專屬欄位」兩段。
 * 帳號規則：電子郵件與帳號至少填一個（登入識別，另一欄可留空）、姓名必填；
 * 密碼與帳號管理屬「使用者帳號管理」，名冊不處理。
 * 名冊規則：學生學號必填；管理員屬性必填、指定功能模組選填（未指定＝無可用功能模組）。
 */
export function validateRosterInput(role: RosterRole, input: RosterInput): RosterValidation {
  const name = text(input.name, MAX_TEXT);
  if (!name) return { ok: false, message: "請填寫姓名" };

  const rawEmail = text(input.email, MAX_TEXT);
  const rawAccount = text(input.account, MAX_TEXT);
  if (!rawEmail && !rawAccount) {
    return { ok: false, message: ACCOUNT_IDENTIFIER_REQUIRED_MESSAGE };
  }

  const email = rawEmail ? normalizeEmail(rawEmail) || "" : "";
  if (rawEmail && !email) return { ok: false, message: EMAIL_FORMAT_MESSAGE };

  const account = rawAccount ? normalizeAccount(rawAccount) || "" : "";
  if (rawAccount && !account) return { ok: false, message: ACCOUNT_FORMAT_MESSAGE };

  const accountFields: AccountFields = { email, account, name };
  const roster: Record<string, unknown> = {};

  for (const key of ROSTER_ENTRY_FIELDS[role]) {
    if (key === "modules") {
      roster.modules = normalizeModules(input.modules);
      continue;
    }
    roster[key] = text(input[key], MAX_TEXT);
  }

  if (role === "student" && !roster.studentId) {
    return { ok: false, message: "請填寫學號" };
  }

  if (role === "admin") {
    const attribute = text(input.attribute, MAX_SHORT);
    if (attribute !== "一般" && attribute !== "超級") {
      return { ok: false, message: "請選擇管理員屬性（一般／超級）" };
    }
    roster.attribute = attribute;
    // 指定功能模組選填：一般管理員未指定＝該帳號暫無可用功能模組；超級管理員固定全開
    const modules = normalizeModules(input.modules);
    roster.modules = attribute === "超級" ? ADMIN_MODULE_VALUES.slice() : modules;
  }

  if (role === "staff") {
    const attribute = resolveStaffAttribute(text(input.attribute, MAX_SHORT));
    if (attribute && !isStaffAttribute(attribute)) {
      return {
        ok: false,
        message: `教職員屬性僅支援「${STAFF_ATTRIBUTES.join("」「")}」`,
      };
    }
    roster.attribute = attribute;
  }

  return { ok: true, account: accountFields, roster: roster as RosterData };
}

export type AccountValidation =
  | { ok: true; account: AccountFields; password: string | null }
  | { ok: false; message: string };

/**
 * 驗證「使用者帳號管理」工作表的帳號輸入（無名冊欄位）。
 * 建立時密碼必填；更新時密碼留空代表不變更。
 */
export function validateAccountInput(
  input: AccountInput,
  options: { requirePassword: boolean }
): AccountValidation {
  const name = text(input.name, MAX_TEXT);
  if (!name) return { ok: false, message: "請填寫姓名" };

  const rawEmail = text(input.email, MAX_TEXT);
  const rawAccount = text(input.account, MAX_TEXT);
  if (!rawEmail && !rawAccount) {
    return { ok: false, message: ACCOUNT_IDENTIFIER_REQUIRED_MESSAGE };
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

  return { ok: true, account: { email, account, name }, password };
}

/** 查重索引：email/account 依使用者帳號；學號依「當期」的該身分名冊 */
export interface RosterIndex {
  emails: Map<string, string>;
  accounts: Map<string, string>;
  studentIds: Map<string, string>;
}

/** 只查 email／account 的帳號查重索引（工作表新增帳號用） */
export async function loadAccountIndex(excludeUid = ""): Promise<RosterIndex> {
  const index: RosterIndex = {
    emails: new Map(),
    accounts: new Map(),
    studentIds: new Map(),
  };
  const usersSnapshot = await getAdminDb().collection(USER_COLLECTION).get();
  for (const doc of usersSnapshot.docs) {
    if (doc.id === excludeUid) continue;
    const data = doc.data();
    const email = typeof data.email === "string" ? data.email : "";
    const account = typeof data.account === "string" ? data.account : "";
    if (email) index.emails.set(email, doc.id);
    if (account) index.accounts.set(account, doc.id);
  }
  return index;
}

/**
 * 以電子郵件或帳號找出現有使用者帳號（綁定既有帳號用）；查無回 null。
 */
export async function findAccountByKey(key: string): Promise<{
  uid: string;
  email: string;
  account: string;
  name: string;
  status: AccountStatus;
} | null> {
  const db = getAdminDb();
  const raw = text(key, MAX_TEXT);
  if (!raw) return null;

  const fields: ("email" | "account")[] = raw.includes("@") ? ["email", "account"] : ["account", "email"];
  for (const field of fields) {
    const value = field === "email" ? normalizeEmail(raw) : normalizeAccount(raw);
    if (!value) continue;
    const snap = await db.collection(USER_COLLECTION).where(field, "==", value).limit(1).get();
    const doc = snap.docs[0];
    if (!doc) continue;
    const data = doc.data();
    return {
      uid: doc.id,
      email: typeof data.email === "string" ? data.email : "",
      account: typeof data.account === "string" ? data.account : "",
      name: typeof data.name === "string" ? data.name : "",
      status: normalizeAccountStatus(data.status),
    };
  }
  return null;
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

  const usersSnapshot = await getAdminDb().collection(USER_COLLECTION).get();
  for (const doc of usersSnapshot.docs) {
    if (doc.id === excludeUid) continue;
    const data = doc.data();
    const email = typeof data.email === "string" ? data.email : "";
    const account = typeof data.account === "string" ? data.account : "";
    if (email) index.emails.set(email, doc.id);
    if (account) index.accounts.set(account, doc.id);
  }

  if (ROSTER_ENTRY_FIELDS[role].includes("studentId")) {
    const entries = await getAdminDb()
      .collection(rosterCollection(role))
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
  const studentId =
    typeof roster.studentId === "string" ? roster.studentId : "";
  if (studentId && index.studentIds.has(studentId)) return "此學號已被使用";
  return null;
}

/** 組出「使用者帳號」文件：四種身分共用同一張 users 表（名冊欄位於名冊四表） */
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
    lastLoginMethod: "",
    loginCount: 0,
    cssThemeId: "",
    installedThemes: "[]",
    lockedUntil: 0,
    lockIp: "",
    failedAttempts: 0,
    tokenVersion: 1,
    createdAt: now,
  };
  if (isUserRole(preferredRole)) record.preferredRole = preferredRole;
  return record;
}

/**
 * 組出一條名冊資料（寫入前呼叫）：
 * 共同欄位（狀態、電子郵件、姓名、學年度、學期）＋該身分的專屬欄位。
 */
export function buildRosterEntry(
  uid: string,
  role: RosterRole,
  period: SchoolPeriod,
  roster: RosterData,
  identity: { email: string; name: string; status?: AccountStatus }
): RosterEntry {
  const now = Date.now();
  const data: Record<string, unknown> = {
    uid,
    status: identity.status || ENTRY_DEFAULT_STATUS,
    email: identity.email,
    name: identity.name,
    academicYear: period.academicYear,
    semester: period.semester,
    createdAt: now,
    updatedAt: now,
  };
  for (const key of ROSTER_ENTRY_FIELDS[role]) {
    const value = roster[key];
    data[key] = typeof value === "undefined" ? "" : value;
  }
  if (role === "admin" && !Array.isArray(data.modules)) {
    data.modules = ADMIN_MODULE_VALUES.slice();
  }
  return data as unknown as RosterEntry;
}

/** 讀取某帳號在指定學年度學期的身分名冊條目（無則回 null） */
export async function getRosterEntry(
  uid: string,
  role: RosterRole,
  period: SchoolPeriod
): Promise<Record<string, unknown> | null> {
  const snap = await getAdminDb()
    .collection(rosterCollection(role))
    .doc(rosterEntryId(uid, period))
    .get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return data.uid === uid ? data : null;
}

/** 讀取指定身分在指定學年度學期的名冊，以 uid 為鍵 */
export async function loadPeriodEntries(
  period: SchoolPeriod,
  role: RosterRole
): Promise<Map<string, Record<string, unknown>>> {
  const snapshot = await getAdminDb()
    .collection(rosterCollection(role))
    .where("academicYear", "==", period.academicYear)
    .where("semester", "==", period.semester)
    .get();
  const map = new Map<string, Record<string, unknown>>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const uid = typeof data.uid === "string" ? data.uid : "";
    if (uid) map.set(uid, data);
  }
  return map;
}

/** 條目是否可用（狀態＝有效；缺 status 視為有效） */
export function isActiveEntry(entry: Record<string, unknown> | null | undefined): boolean {
  if (!entry) return false;
  if (typeof entry.status === "string") return isAccountStatus(entry.status) && entry.status === ACTIVE_STATUS;
  return true;
}

/** 名冊條目的狀態（有效／無效；缺 status 視為有效） */
export function entryStatus(entry: Record<string, unknown> | null | undefined): AccountStatus {
  return entry ? normalizeAccountStatus(entry.status) : ACTIVE_STATUS;
}

/**
 * 該帳號在當期可用（有效）的身分清單，順序固定 ALL_ROLES。
 * 登入候選、慣用身分可選範圍都由此決定。
 */
export async function getActiveRoles(
  uid: string,
  period: SchoolPeriod,
  roles: readonly UserRole[]
): Promise<UserRole[]> {
  const entries = await Promise.all(
    roles.map((role) => getRosterEntry(uid, role, period))
  );
  return roles.filter((_, index) => isActiveEntry(entries[index]));
}

/**
 * 稱謂：名冊姓名（該期該身分）＞帳號姓名＞電子郵件。
 * 登入、切換身分時都以此決定 session 的 displayName。
 */
export function resolveDisplayName(
  account: Record<string, unknown> | null | undefined,
  entry: Record<string, unknown> | null | undefined
): string {
  const entryName = entry && typeof entry.name === "string" ? entry.name.trim() : "";
  if (entryName) return entryName;
  const accountName = account && typeof account.name === "string" ? account.name.trim() : "";
  if (accountName) return accountName;
  const email = account && typeof account.email === "string" ? account.email : "";
  return email;
}

/**
 * 更新帳號識別欄位時，同步當期各名冊條目的電子郵件／姓名（展示欄位）。
 * 只更新確實存在的條目，歷史學期不受影響。
 */
export async function syncEntryIdentity(
  uid: string,
  period: SchoolPeriod,
  patch: { email?: string; name?: string }
): Promise<void> {
  const db = getAdminDb();
  const roles: RosterRole[] = ["student", "parent", "staff", "admin"];
  const refs = roles.map((role) =>
    db.collection(rosterCollection(role)).doc(rosterEntryId(uid, period))
  );
  const snaps = await Promise.all(refs.map((ref) => ref.get()));
  const updates = snaps
    .filter((snap) => snap.exists)
    .map((snap) => {
      const data: Record<string, unknown> = { updatedAt: Date.now() };
      if (typeof patch.email === "string") data.email = patch.email;
      if (typeof patch.name === "string") data.name = patch.name;
      return snap.ref.update(data);
    });
  await Promise.all(updates);
}

/** 使用者帳號文件 → 帳號清單的帳號段（不含密碼） */
function accountStatus(account: Record<string, unknown> | null): AccountStatus {
  return account ? normalizeAccountStatus(account.status) : ACTIVE_STATUS;
}

/** 使用者帳號＋當期名冊條目 → 帳號清單一列（不含密碼；名冊欄位取自目前學年度學期） */
export function toRosterMember(
  role: RosterRole,
  uid: string,
  account: Record<string, unknown> | null,
  entry: Record<string, unknown> | null
): RosterMember {
  const str = (source: Record<string, unknown> | null, key: string) =>
    source && typeof source[key] === "string" ? (source[key] as string) : "";

  const member: RosterMember = {
    uid,
    email: str(account, "email"),
    account: str(account, "account"),
    name: str(entry, "name") || str(account, "name"),
    status: accountStatus(account),
    rosterStatus: entryStatus(entry),
  };
  if (account) {
    const lastLogin = lastLoginOf(account);
    if (lastLogin) member.lastLogin = lastLogin;
    if (typeof account.loginCount === "number") member.loginCount = account.loginCount;
    if (isUserRole(account.preferredRole)) member.preferredRole = account.preferredRole;
  }

  const target = member as unknown as Record<string, string | string[] | undefined>;
  for (const key of ROSTER_ENTRY_FIELDS[role]) {
    if (key === "modules") {
      // 舊代碼（如 `roles`）一併對應到現行模組，清單顯示與表單預勾才會正確
      const modules = entry && Array.isArray(entry.modules) ? entry.modules : [];
      const resolved = modules
        .filter((item): item is string => typeof item === "string")
        .map((item) => resolveAdminModule(item))
        .filter((item): item is AdminModule => Boolean(item));
      if (resolved.length > 0) target.modules = resolved as string[];
      continue;
    }
    const value = key === "attribute" && role === "staff"
      ? resolveStaffAttribute(str(entry, key))
      : str(entry, key);
    if (value) target[key] = value;
  }
  return member;
}

/** 密碼雜湊（匯入／表單共用；costFactor 固定 12，不接受外部指定） */
export async function hashRosterPassword(plain: string): Promise<string> {
  return hashPassword(plain, 12);
}

/** 表單／匯入的帳號欄位判定（無學年度學期的欄位寫入 users） */
export function isAccountFieldKey(key: RosterFieldKey): boolean {
  return (ACCOUNT_FIELD_KEYS as readonly string[]).includes(key);
}

/**
 * 當期「其他有效管理員」人數：名冊條目有效 ＋ 使用者帳號有效。
 * 用於擋停用／刪除最後一位管理員，避免把自己鎖在門外。
 */
export async function countOtherActiveAdmins(excludeUid: string): Promise<number> {
  const db = getAdminDb();
  const period = await getCurrentPeriod();
  const snapshot = await db
    .collection(rosterCollection("admin"))
    .where("academicYear", "==", period.academicYear)
    .where("semester", "==", period.semester)
    .get();

  const uids = snapshot.docs
    .map((doc) => doc.data())
    .filter((data) => isActiveEntry(data) && typeof data.uid === "string" && data.uid !== excludeUid)
    .map((data) => data.uid as string);
  if (uids.length === 0) return 0;

  const docs = await db.getAll(
    ...uids.map((uid) => db.collection(USER_COLLECTION).doc(uid))
  );
  return docs.filter((doc) => doc.exists && isAccountActive(doc.data())).length;
}

/**
 * 狀態變更／刪除的守門：本人、以及「仍是有效管理員且只剩他一位」。
 * 回傳擋下訊息，null＝放行（訊息用語由呼叫端依情境調整）。
 */
export async function accountStatusGuard(uid: string, sessionUid: string): Promise<string | null> {
  if (uid === sessionUid) return "無法停用自己使用的帳號";
  const period = await getCurrentPeriod();
  const entry = await getRosterEntry(uid, "admin", period);
  if (isActiveEntry(entry) && (await countOtherActiveAdmins(uid)) === 0) {
    return "無法停用最後一位有效管理員";
  }
  return null;
}

/** 帳號可用的模組權限（超級＝全開；含改版前 `roles` 等舊值的相容對應） */
export function adminModulesOf(entry: Record<string, unknown> | null | undefined): AdminModule[] {
  if (!entry) return [];
  if (entry.attribute === "超級") return ADMIN_MODULE_VALUES.slice();
  const modules = Array.isArray(entry.modules) ? entry.modules : [];
  const resolved = modules
    .filter((item): item is string => typeof item === "string")
    .map((item) => resolveAdminModule(item))
    .filter((item): item is AdminModule => Boolean(item));
  return ADMIN_MODULE_VALUES.filter((module) => resolved.includes(module));
}
