import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAdminDb } from "@/lib/firebase-admin";
import { hasAdminModule, requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { getCurrentPeriod } from "@/lib/settings-server";
import { normalizeAccount, normalizeEmail } from "@/lib/validation";
import { SchoolPeriod } from "@/types/settings";
import {
  ACCOUNT_BATCH_MODE_LABELS,
  ACTIVE_STATUS,
  ALL_ROLES,
  AccountBatchChange,
  AccountBatchMode,
  AccountBatchPreview,
  AccountBatchResult,
  AccountBatchRow,
  AccountStatus,
  ROLE_LABELS,
  USER_COLLECTION,
  UserRole,
  isUserRole,
  normalizeAccountStatus,
  statusLabel,
} from "@/types/users";
import {
  AccountInput,
  EntryFieldKey,
  ROSTER_ENTRY_FIELDS,
  ROSTER_ENTRY_FIELD_KEYS,
  RosterInput,
  RosterRole,
  rosterCollection,
  rosterEntryHeaderAliases,
  rosterRoleLabel,
} from "@/types/roster";
import {
  AccountFields,
  RosterData,
  RosterIndex,
  accountStatusGuard,
  buildAccountRecord,
  buildRosterEntry,
  checkRosterConflict,
  hashRosterPassword,
  rosterEntryId,
  syncEntryIdentity,
  validateAccountInput,
  validateRosterInput,
} from "@/lib/roster";

export const maxDuration = 300;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 900;
const DELETE_CHUNK = 400;

const MODES: AccountBatchMode[] = ["create", "update", "delete"];

type AccountColumnKey = "email" | "account" | "name" | "password" | "preferredRole" | "status";

/** 批次檔的欄位鍵：帳號欄位＋「身分」＋名冊專屬欄位（跨四種身分） */
type BatchFieldKey = AccountColumnKey | "role" | EntryFieldKey;

type BatchFields = Record<BatchFieldKey, string>;

const FIELD_HEADERS: { key: AccountColumnKey; aliases: string[] }[] = [
  { key: "email", aliases: ["電子郵件地址", "電子郵件", "信箱", "email", "e-mail", "mail"] },
  { key: "account", aliases: ["帳號", "账号", "使用者名稱", "account", "username"] },
  { key: "name", aliases: ["姓名", "名稱", "name"] },
  { key: "password", aliases: ["密碼", "密码", "password", "passwd"] },
  {
    key: "preferredRole",
    aliases: ["慣用身分", "预设身分", "預設身分", "preferredrole", "preferred role"],
  },
  { key: "status", aliases: ["狀態", "状态", "status"] },
];

/** 「身分」欄：填了才會在建立帳號的同時建立當期該身分名冊條目 */
const ROLE_HEADER: { key: "role"; aliases: string[] } = {
  key: "role",
  aliases: ["身分", "身份", "role"],
};

/** 名冊專屬欄位（學號、班級、屬性等）的標題別名，依「身分」欄決定讀哪些 */
const ROSTER_HEADERS: { key: EntryFieldKey; aliases: string[] }[] = ROSTER_ENTRY_FIELD_KEYS.map(
  (key) => ({ key, aliases: rosterEntryHeaderAliases(key) })
);

const ALL_HEADERS = [...FIELD_HEADERS, ROLE_HEADER, ...ROSTER_HEADERS];

const FIELD_KEYS: BatchFieldKey[] = ALL_HEADERS.map((field) => field.key);

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

const ROLE_HEADERS = new Map<string, UserRole>();
for (const role of ALL_ROLES) {
  ROLE_HEADERS.set(normalizeHeader(role), role);
  ROLE_HEADERS.set(normalizeHeader(ROLE_LABELS[role]), role);
}
ROLE_HEADERS.set(normalizeHeader("教師"), "staff");
ROLE_HEADERS.set(normalizeHeader("老師"), "staff");

function parseStatus(value: string): AccountStatus | null {
  const key = normalizeHeader(value);
  if (key === "有效" || key === "啟用" || key === "active") return "有效";
  if (key === "無效" || key === "停用" || key === "停權" || key === "disabled" || key === "inactive") {
    return "無效";
  }
  return null;
}

function emptyFields(): BatchFields {
  const row = {} as Record<BatchFieldKey, string>;
  for (const key of FIELD_KEYS) row[key] = "";
  return row;
}

function parseSpreadsheet(buffer: Buffer): { rows: BatchFields[] } | { error: string } {
  let sheetRows: Record<string, unknown>[];
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) return { error: "檔案內找不到工作表" };
    sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });
  } catch {
    return { error: "檔案無法讀取，請確認是 Excel 或 CSV 檔" };
  }

  const headerMap = new Map<string, BatchFieldKey>();
  for (const field of ALL_HEADERS) {
    for (const alias of field.aliases) headerMap.set(normalizeHeader(alias), field.key);
  }

  const matched = new Set<BatchFieldKey>();
  const rows: BatchFields[] = [];
  for (const raw of sheetRows) {
    const row = emptyFields();
    for (const [header, value] of Object.entries(raw)) {
      const key = headerMap.get(normalizeHeader(header));
      if (!key) continue;
      matched.add(key);
      row[key] = String(value ?? "").trim();
    }
    rows.push(row);
  }

  if (matched.size === 0) {
    return {
      error:
        "標題列無法辨識，第一列需為欄位名稱（電子郵件地址／帳號／姓名／密碼／慣用身分／狀態／身分）",
    };
  }
  return { rows };
}

interface AccountSnapshot {
  uid: string;
  email: string;
  account: string;
  name: string;
  status: AccountStatus;
  preferredRole: UserRole | null;
}

async function loadAccounts(): Promise<{
  index: RosterIndex;
  byUid: Map<string, AccountSnapshot>;
}> {
  const snapshot = await getAdminDb().collection(USER_COLLECTION).get();
  const index: RosterIndex = { emails: new Map(), accounts: new Map(), studentIds: new Map() };
  const byUid = new Map<string, AccountSnapshot>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const email = typeof data.email === "string" ? data.email : "";
    const account = typeof data.account === "string" ? data.account : "";
    if (email) index.emails.set(email, doc.id);
    if (account) index.accounts.set(account, doc.id);
    byUid.set(doc.id, {
      uid: doc.id,
      email,
      account,
      name: typeof data.name === "string" ? data.name : "",
      status: normalizeAccountStatus(data.status),
      preferredRole: isUserRole(data.preferredRole) ? data.preferredRole : null,
    });
  }
  return { index, byUid };
}

interface PlannedCreate {
  row: number;
  action: "create";
  key: string;
  account: AccountFields;
  password: string;
  preferredRole?: UserRole;
  /** 同時建立的身分（未填「身分」欄＝只建帳號） */
  role?: RosterRole;
  /** 該身分的名冊專屬欄位（已驗證） */
  roster?: RosterData;
  /** 預覽列的附加說明 */
  note?: string;
}

interface PlannedUpdate {
  row: number;
  action: "update";
  key: string;
  uid: string;
  patch: Record<string, unknown>;
  changes: AccountBatchChange[];
}

interface PlannedDelete {
  row: number;
  action: "delete";
  key: string;
  uid: string;
}

interface PlannedSkip {
  row: number;
  action: "skip";
  key: string;
  reason: string;
}

type PlannedRow = PlannedCreate | PlannedUpdate | PlannedDelete | PlannedSkip;

function rowKey(fields: BatchFields): string {
  return fields.email || fields.account || "（空白）";
}

function skipRow(row: number, fields: BatchFields, reason: string): PlannedSkip {
  return { row, action: "skip", key: rowKey(fields), reason };
}

/** 「身分」欄的辨識（空白＝不建立身分）；無法辨識回錯誤訊息 */
function parseRosterRole(value: string): { role?: RosterRole; error?: string } {
  if (!value) return {};
  const role = ROLE_HEADERS.get(normalizeHeader(value));
  if (!role) return { error: "身分無法辨識（學生／家長／教職員／管理員）" };
  return { role };
}

/**
 * 當期「該身分」名冊的學號索引（學號查重只在同身分內比對；
 * 家長的學號是其子女學號，故不跨表比對）。
 */
async function loadPeriodStudentIds(
  role: RosterRole,
  period: SchoolPeriod
): Promise<RosterIndex> {
  const index: RosterIndex = { emails: new Map(), accounts: new Map(), studentIds: new Map() };
  const snapshot = await getAdminDb()
    .collection(rosterCollection(role))
    .where("academicYear", "==", period.academicYear)
    .where("semester", "==", period.semester)
    .get();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const studentId = typeof data.studentId === "string" ? data.studentId : "";
    if (studentId) index.studentIds.set(studentId, typeof data.uid === "string" ? data.uid : doc.id);
  }
  return index;
}

function planCreate(
  row: number,
  fields: BatchFields,
  index: RosterIndex,
  period: SchoolPeriod | null,
  entryIndexes: Map<RosterRole, RosterIndex>
): PlannedRow {
  const input: AccountInput = {};
  if (fields.email) input.email = fields.email;
  if (fields.account) input.account = fields.account;
  if (fields.name) input.name = fields.name;
  if (fields.password) input.password = fields.password;

  const validation = validateAccountInput(input, { requirePassword: true });
  if (!validation.ok) return skipRow(row, fields, validation.message);

  let preferredRole: UserRole | undefined;
  if (fields.preferredRole) {
    const role = ROLE_HEADERS.get(normalizeHeader(fields.preferredRole));
    if (!role) return skipRow(row, fields, "慣用身分無法辨識（學生／家長／教職員／管理員）");
    preferredRole = role;
  }

  // 同時建立身分：填了「身分」欄才建立當期名冊條目，其名冊欄位一併驗證
  const rosterRole = parseRosterRole(fields.role);
  if (rosterRole.error) return skipRow(row, fields, rosterRole.error);
  let roster: RosterData | undefined;
  let note: string | undefined;
  if (rosterRole.role && period) {
    const entryIndex = entryIndexes.get(rosterRole.role) ?? null;
    const rosterInput: RosterInput = {};
    for (const key of ROSTER_ENTRY_FIELD_KEYS) {
      if (fields[key]) rosterInput[key] = fields[key];
    }
    const rosterValidation = validateRosterInput(rosterRole.role, {
      ...rosterInput,
      email: validation.account.email,
      account: validation.account.account,
      name: validation.account.name,
    });
    if (!rosterValidation.ok) return skipRow(row, fields, rosterValidation.message);

    // 學號查重：只與「當期同身分」名冊比對（含本檔前列已排入者）
    const studentId = typeof rosterValidation.roster.studentId === "string"
      ? rosterValidation.roster.studentId
      : "";
    if (studentId && entryIndex?.studentIds.has(studentId)) {
      return skipRow(row, fields, "此學號已被使用");
    }

    roster = rosterValidation.roster;
    note = `同時建立當期${rosterRoleLabel(rosterRole.role)}身分`;
    if (studentId && entryIndex) entryIndex.studentIds.set(studentId, `row:${row}`);
  }

  const conflict = checkRosterConflict(validation.account, roster ?? {}, index);
  if (conflict) return skipRow(row, fields, conflict);

  if (validation.account.email) index.emails.set(validation.account.email, `row:${row}`);
  if (validation.account.account) index.accounts.set(validation.account.account, `row:${row}`);

  return {
    row,
    action: "create",
    key: validation.account.account || validation.account.email,
    account: validation.account,
    password: validation.password as string,
    preferredRole,
    role: rosterRole.role,
    roster,
    note,
  };
}

/** 修改／刪除共用的辨識：電子郵件地址與帳號都填時必須指向同一帳號 */
function resolveUid(
  fields: BatchFields,
  index: RosterIndex
): { uid?: string; error?: string; key: string } {
  const key = rowKey(fields);
  const emailKey = fields.email ? normalizeEmail(fields.email) : "";
  const accountKey = fields.account ? normalizeAccount(fields.account) : "";
  if (!emailKey && !accountKey) {
    return { key, error: "請填寫電子郵件地址或帳號以辨識資料" };
  }
  const byEmail = emailKey ? index.emails.get(emailKey) : undefined;
  const byAccount = accountKey ? index.accounts.get(accountKey) : undefined;
  if (byEmail && byAccount && byEmail !== byAccount) {
    return { key, error: "電子郵件與帳號對應到不同帳號" };
  }
  const uid = byEmail ?? byAccount;
  if (!uid) return { key, error: "查無此帳號" };
  return { uid, key };
}

async function planUpdate(
  row: number,
  fields: BatchFields,
  index: RosterIndex,
  byUid: Map<string, AccountSnapshot>,
  seen: Set<string>,
  sessionUid: string
): Promise<PlannedRow> {
  const resolved = resolveUid(fields, index);
  if (!resolved.uid) return skipRow(row, fields, resolved.error ?? "查無此帳號");
  const uid = resolved.uid;
  if (seen.has(uid)) return skipRow(row, fields, "檔案中重複對應到同一帳號");
  const current = byUid.get(uid);
  if (!current) return skipRow(row, fields, "查無此帳號");
  if (fields.email && normalizeEmail(fields.email) !== current.email) {
    return skipRow(row, fields, "電子郵件地址與現有帳號不符（批次不支援修改電子郵件地址）");
  }

  const accountKey = fields.account ? normalizeAccount(fields.account) : "";
  const isAccountIdentity = accountKey === current.account;
  const changes: AccountBatchChange[] = [];
  const patch: Record<string, unknown> = {};

  const candidate: RosterInput = {
    email: current.email,
    name: fields.name || current.name,
    account: fields.account && !isAccountIdentity ? fields.account : current.account,
  };
  const validation = validateAccountInput(candidate, { requirePassword: false });
  if (!validation.ok) return skipRow(row, fields, validation.message);

  if (validation.account.name !== current.name) {
    changes.push({ label: "姓名", from: current.name, to: validation.account.name });
    patch.name = validation.account.name;
  }
  if (validation.account.account !== current.account) {
    const holder = index.accounts.get(validation.account.account);
    if (holder && holder !== uid) return skipRow(row, fields, "此帳號已被使用");
    changes.push({ label: "帳號", from: current.account, to: validation.account.account });
    patch.account = validation.account.account;
  }

  if (fields.status) {
    const status = parseStatus(fields.status);
    if (!status) return skipRow(row, fields, "狀態無法辨識（有效／停用）");
    if (status !== current.status) {
      changes.push({ label: "狀態", from: statusLabel(current.status), to: statusLabel(status) });
      patch.status = status;
      if (status !== ACTIVE_STATUS) {
        const guard = await accountStatusGuard(uid, sessionUid);
        if (guard) return skipRow(row, fields, guard);
      }
    }
  }

  if (fields.preferredRole) {
    const role = ROLE_HEADERS.get(normalizeHeader(fields.preferredRole));
    if (!role) return skipRow(row, fields, "慣用身分無法辨識（學生／家長／教職員／管理員）");
    if (role !== current.preferredRole) {
      changes.push({
        label: "慣用身分",
        from: current.preferredRole ? ROLE_LABELS[current.preferredRole] : "未設定",
        to: ROLE_LABELS[role],
      });
      patch.preferredRole = role;
    }
  }

  if (changes.length === 0) return skipRow(row, fields, "沒有需要更新的欄位");
  seen.add(uid);
  return { row, action: "update", key: resolved.key, uid, patch, changes };
}

async function planDelete(
  row: number,
  fields: BatchFields,
  index: RosterIndex,
  seen: Set<string>,
  sessionUid: string
): Promise<PlannedRow> {
  const resolved = resolveUid(fields, index);
  if (!resolved.uid) return skipRow(row, fields, resolved.error ?? "查無此帳號");
  const uid = resolved.uid;
  if (seen.has(uid)) return skipRow(row, fields, "檔案中重複對應到同一帳號");
  const guard = await accountStatusGuard(uid, sessionUid);
  if (guard) return skipRow(row, fields, "無法刪除自己或最後一位有效管理員");
  seen.add(uid);
  return { row, action: "delete", key: resolved.key, uid };
}

function buildPreview(mode: AccountBatchMode, planned: PlannedRow[]): AccountBatchPreview {
  const rows: AccountBatchRow[] = planned.map((item) => {
    if (item.action === "skip") {
      return { row: item.row, key: item.key, action: "skip", reason: item.reason };
    }
    if (item.action === "update") {
      return { row: item.row, key: item.key, action: "update", changes: item.changes };
    }
    const note = item.action === "create" ? item.note : undefined;
    return {
      row: item.row,
      key: item.key,
      action: item.action,
      ...(note ? { note } : {}),
    };
  });
  const count = (action: PlannedRow["action"]) =>
    planned.filter((item) => item.action === action).length;
  const rostered = planned.filter(
    (item) => item.action === "create" && item.roster
  ).length;
  return {
    mode,
    total: planned.length,
    created: count("create"),
    updated: count("update"),
    deleted: count("delete"),
    skipped: count("skip"),
    ...(rostered > 0 ? { rostered } : {}),
    rows,
  };
}

/**
 * 執行計畫：建立帳號的同時寫入當期身分名冊條目（有「身分」者）。
 * period 由呼叫端一次取得，整批寫入同一學期。
 */
async function executePlan(
  planned: PlannedRow[],
  period: SchoolPeriod | null
): Promise<AccountBatchResult> {
  const db = getAdminDb();
  const users = db.collection(USER_COLLECTION);
  const skipped: { row: number; reason: string }[] = [];
  let created = 0;
  let updated = 0;
  let rostered = 0;
  const deleteUids: string[] = [];

  for (const item of planned) {
    if (item.action === "skip") {
      skipped.push({ row: item.row, reason: item.reason });
    } else if (item.action === "create") {
      const record = buildAccountRecord(
        item.account,
        await hashRosterPassword(item.password),
        item.preferredRole
      );
      const docRef = await users.add(record);
      created += 1;
      if (item.role && item.roster && period) {
        await db
          .collection(rosterCollection(item.role))
          .doc(rosterEntryId(docRef.id, period))
          .set(
            buildRosterEntry(docRef.id, item.role, period, item.roster, {
              email: item.account.email,
              name: item.account.name,
            })
          );
        rostered += 1;
      }
    } else if (item.action === "update") {
      await users.doc(item.uid).update(item.patch);
      if (typeof item.patch.name === "string") {
        await syncEntryIdentity(item.uid, await getCurrentPeriod(), { name: item.patch.name });
      }
      updated += 1;
    } else {
      deleteUids.push(item.uid);
    }
  }

  if (deleteUids.length > 0) {
    const targets = new Set(deleteUids);
    const collections = ["rosterStudents", "rosterParents", "rosterStaff", "rosterAdmins"];
    const snapshots = await Promise.all(
      collections.map((name) => db.collection(name).get())
    );
    const refs = deleteUids.map((uid) => users.doc(uid));
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        if (targets.has(String(doc.data().uid ?? ""))) refs.push(doc.ref);
      }
    }
    for (let i = 0; i < refs.length; i += DELETE_CHUNK) {
      const batch = db.batch();
      for (const ref of refs.slice(i, i + DELETE_CHUNK)) batch.delete(ref);
      await batch.commit();
    }
  }

  return { created, updated, deleted: deleteUids.length, rostered, skipped };
}

export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "accounts-batch",
      RATE.ACCOUNTS_BATCH.limit,
      RATE.ACCOUNTS_BATCH.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("users");
    if (denial) return toAuthResponse(denial);

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    const modeRaw = formData.get("mode");
    const mode =
      typeof modeRaw === "string" && (MODES as string[]).includes(modeRaw)
        ? (modeRaw as AccountBatchMode)
        : null;
    if (!mode) {
      return NextResponse.json({ success: false, message: "批次作業模式無效" }, { status: 400 });
    }
    const dryRun = formData.get("dryRun") === "true";

    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ success: false, message: "請選擇要上傳的檔案" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { success: false, message: "檔案超過 5MB，請拆成多個檔案分批處理" },
        { status: 400 }
      );
    }

    const parsed = parseSpreadsheet(Buffer.from(await file.arrayBuffer()));
    if ("error" in parsed) {
      return NextResponse.json({ success: false, message: parsed.error }, { status: 400 });
    }

    const dataRows = parsed.rows
      .map((fields, index) => ({ row: index + 2, fields }))
      .filter(({ fields }) => Object.values(fields).some((value) => value !== ""));

    if (dataRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "檔案中沒有資料列" },
        { status: 400 }
      );
    }
    if (dataRows.length > MAX_ROWS) {
      return NextResponse.json(
        {
          success: false,
          message: `單次最多處理 ${MAX_ROWS} 列，此檔有 ${dataRows.length} 列，請分批處理`,
        },
        { status: 400 }
      );
    }

    const { index, byUid } = await loadAccounts();

    // 新增模式：先取當期學期，並載入檔案內出現身分的學號索引（同身分內查重）
    let period: SchoolPeriod | null = null;
    const entryIndexes = new Map<RosterRole, RosterIndex>();
    if (mode === "create") {
      const wantedRoles = new Set<RosterRole>();
      for (const { fields } of dataRows) {
        const parsedRole = parseRosterRole(fields.role);
        if (parsedRole.role) wantedRoles.add(parsedRole.role);
      }
      // 名冊寫入屬「身分名冊管理」權限：未被指派者整批不建立身分（直接回報，避免逐列略過）
      if (wantedRoles.size > 0 && !(await hasAdminModule(session, "roster"))) {
        return NextResponse.json(
          {
            success: false,
            message: "需具備「身分名冊管理」權限才能同時建立身分，請移除「身分」欄後重試",
          },
          { status: 403 }
        );
      }
      period = await getCurrentPeriod();
      for (const role of wantedRoles) {
        if (ROSTER_ENTRY_FIELDS[role].includes("studentId")) {
          entryIndexes.set(role, await loadPeriodStudentIds(role, period));
        }
      }
    }

    const seen = new Set<string>();
    const planned: PlannedRow[] = [];
    for (const { row, fields } of dataRows) {
      if (mode === "create") {
        planned.push(planCreate(row, fields, index, period, entryIndexes));
      } else if (mode === "update") {
        planned.push(await planUpdate(row, fields, index, byUid, seen, session.uid));
      } else {
        planned.push(await planDelete(row, fields, index, seen, session.uid));
      }
    }

    if (dryRun) {
      return NextResponse.json({ success: true, dryRun: true, preview: buildPreview(mode, planned) });
    }

    const result = await executePlan(planned, mode === "create" ? period : null);
    const label = ACCOUNT_BATCH_MODE_LABELS[mode];
    const rosterNote = (result.rostered ?? 0) > 0 ? `、同時建立身分 ${result.rostered} 筆` : "";
    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "account_batch",
      ip: getClientIp(request),
      details: `批次${label}：新增 ${result.created} 筆${rosterNote}、更新 ${result.updated} 筆、刪除 ${result.deleted} 筆、略過 ${result.skipped.length} 筆`,
    });

    return NextResponse.json({
      success: true,
      dryRun: false,
      result,
      message: `批次作業完成：新增 ${result.created} 筆${rosterNote}、更新 ${result.updated} 筆、刪除 ${result.deleted} 筆、略過 ${result.skipped.length} 筆`,
    });
  } catch (error) {
    console.error("Account batch error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}
