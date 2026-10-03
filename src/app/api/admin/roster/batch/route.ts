import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { getCurrentPeriod } from "@/lib/settings-server";
import { normalizeAccount, normalizeEmail } from "@/lib/validation";
import { ADMIN_MODULES, USER_COLLECTION } from "@/types/users";
import { SchoolPeriod } from "@/types/settings";
import {
  ROSTER_BATCH_MODE_LABELS,
  ROSTER_ENTRY_FIELDS,
  ROSTER_FIELDS,
  RosterBatchChange,
  RosterBatchMode,
  RosterBatchPreview,
  RosterBatchResult,
  RosterBatchRow,
  RosterBatchStrategy,
  RosterFieldKey,
  RosterInput,
  RosterRole,
  isEmptyRosterInput,
  isImportableRole,
  isRosterBatchStrategy,
  isRosterRole,
  rosterCollection,
  rosterImportFields,
  rosterImportHint,
  rosterRoleLabel,
} from "@/types/roster";
import {
  RosterData,
  RosterIndex,
  buildRosterEntry,
  countOtherActiveAdmins,
  loadPeriodEntries,
  rosterEntryId,
  storedAdminModules,
  validateRosterInput,
} from "@/lib/roster";

/** Firestore 寫入與 900 列上限一起控管 */
export const maxDuration = 300;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 900;

const MODES: RosterBatchMode[] = ["create", "update", "delete"];

/** 標題列正規化：忽略大小寫與所有空白（"Student ID" === "studentid"） */
function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function buildAliasMap(role: RosterRole): Map<string, RosterFieldKey> {
  const map = new Map<string, RosterFieldKey>();
  // 匯入只認電子郵件、姓名與該身分的名冊欄位；帳號與密碼屬使用者帳號，不屬名冊
  for (const field of rosterImportFields(role)) {
    map.set(normalizeHeader(field.label), field.key);
    for (const alias of field.aliases) map.set(normalizeHeader(alias), field.key);
  }
  return map;
}

/** 解析試算表 → 逐列輸入（回傳的 row 是工作表實際列號，第 1 列為標題） */
function parseSpreadsheet(
  buffer: Buffer,
  role: RosterRole
): { rows: RosterInput[] } | { error: string } {
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

  const aliasMap = buildAliasMap(role);
  const matchedKeys = new Set<RosterFieldKey>();
  const rows: RosterInput[] = [];

  for (const raw of sheetRows) {
    const input: RosterInput = {};
    for (const [header, value] of Object.entries(raw)) {
      const key = aliasMap.get(normalizeHeader(header));
      if (!key) continue;
      matchedKeys.add(key);
      input[key] = String(value ?? "").trim();
    }
    rows.push(input);
  }

  if (matchedKeys.size === 0) {
    return {
      error: `標題列無法辨識，需要的欄位：${rosterImportHint(role)}`,
    };
  }

  return { rows };
}

interface AccountSnapshot {
  uid: string;
  email: string;
  account: string;
  name: string;
}

interface BatchContext {
  /** email／account → uid（名冊批次的辨識索引） */
  index: RosterIndex;
  byUid: Map<string, AccountSnapshot>;
  /** 目前學年度學期的該身分名冊條目（以 uid 為鍵） */
  entries: Map<string, Record<string, unknown>>;
}

async function loadBatchContext(
  role: RosterRole,
  period: SchoolPeriod
): Promise<BatchContext> {
  const db = getAdminDb();
  // 名冊批次以電子郵件地址或帳號辨識既有帳號（密碼屬使用者帳號管理，本流程不碰）
  const index: RosterIndex = { emails: new Map(), accounts: new Map(), studentIds: new Map() };
  const byUid = new Map<string, AccountSnapshot>();

  const usersSnapshot = await db.collection(USER_COLLECTION).get();
  for (const doc of usersSnapshot.docs) {
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
    });
  }

  const entries = await loadPeriodEntries(period, role);
  return { index, byUid, entries };
}

interface PlannedCreate {
  row: number;
  action: "create";
  key: string;
  uid: string;
  email: string;
  account: string;
  name: string;
  roster: RosterData;
}

interface PlannedUpdate {
  row: number;
  action: "update";
  key: string;
  uid: string;
  entryPatch: Record<string, unknown>;
  changes: RosterBatchChange[];
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

/** 辨識鍵（預覽清單顯示）：電子郵件地址優先，否則帳號 */
function rowKey(input: RosterInput): string {
  return input.email || input.account || "（空白）";
}

function skipRow(row: number, input: RosterInput, reason: string): PlannedSkip {
  return { row, action: "skip", key: rowKey(input), reason };
}

function fieldLabel(role: RosterRole, key: RosterFieldKey): string {
  return ROSTER_FIELDS[role].find((field) => field.key === key)?.label || key;
}

/** 「指定功能模組」的比較／顯示文字（舊代碼一併對應到現行模組） */
function modulesText(codes: string[]): string {
  return codes
    .map((code) => ADMIN_MODULES.find((item) => item.value === code)?.label || "")
    .filter(Boolean)
    .join("、");
}

/**
 * 批次新增：只在「既有帳號」上建立本期名冊條目，不建立帳號、不處理密碼。
 * 辨識鍵＝電子郵件地址或帳號（至少一個，兩者都填須指向同一帳號）；
 * 帳號（uid）＋學年度＋學期才是名冊的唯一鍵；其餘欄位重複一律放行（管理員事後修改）。
 * 追加模式遇同一學期已有條目則略過；覆蓋模式先清空同一學期條目，故同一列可直接重建。
 */
function planCreate(
  role: RosterRole,
  row: number,
  input: RosterInput,
  context: BatchContext,
  seen: Set<string>,
  strategy: RosterBatchStrategy
): PlannedRow {
  const resolved = resolveUid(input, context.index);
  if (!resolved.uid) return skipRow(row, input, resolved.error ?? "查無此帳號");
  const uid = resolved.uid;
  if (seen.has(uid)) return skipRow(row, input, "檔案中重複對應到同一名冊資料");

  const current = context.byUid.get(uid);
  if (!current) return skipRow(row, input, "查無此帳號");
  // 追加模式：同一學期已有條目就略過；覆蓋模式先清空，同一列照常重建
  if (strategy === "append" && context.entries.has(uid)) {
    return skipRow(row, input, `此帳號本期已具備${rosterRoleLabel(role)}身分`);
  }

  // 帳號欄位一律以既有帳號為準（檔案只用來辨識，不改帳號層）；姓名必填，未填＝該列略過
  const validation = validateRosterInput(role, {
    ...input,
    email: current.email,
    account: current.account,
    name: input.name,
  });
  if (!validation.ok) return skipRow(row, input, validation.message);

  seen.add(uid);
  return {
    row,
    action: "create",
    key: current.email || current.account,
    uid,
    email: current.email,
    account: current.account,
    name: validation.account.name,
    roster: validation.roster,
  };
}

/** 修改／刪除／新增共用的辨識：電子郵件地址與帳號都填時必須指向同一帳號 */
function resolveUid(
  input: RosterInput,
  index: RosterIndex
): { uid?: string; error?: string; key: string } {
  const key = rowKey(input);
  const emailKey = input.email ? normalizeEmail(input.email) : "";
  const accountKey = input.account ? normalizeAccount(input.account) : "";
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

function planUpdate(
  role: RosterRole,
  row: number,
  input: RosterInput,
  context: BatchContext,
  seen: Set<string>
): PlannedRow {
  const resolved = resolveUid(input, context.index);
  if (!resolved.uid) return skipRow(row, input, resolved.error ?? "查無此帳號");
  const uid = resolved.uid;
  if (seen.has(uid)) return skipRow(row, input, "檔案中重複對應到同一名冊資料");

  const current = context.byUid.get(uid);
  const entry = context.entries.get(uid);
  if (!current || !entry) return skipRow(row, input, "本期無此身分名冊資料");

  // 電子郵件與帳號是辨識鍵，批次不修改；姓名與其他欄位皆可留空（空白＝不修改）
  const fileName = input.name ? input.name.trim() : "";

  // 以現有資料為底，檔案中非空白的欄位覆蓋（空白＝不修改）
  const merged: Record<string, unknown> = {
    email: current.email,
    account: current.account,
    name: fileName || current.name,
  };
  for (const key of ROSTER_ENTRY_FIELDS[role]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      merged[key] = value;
      continue;
    }
    const prev = entry[key];
    merged[key] = key === "modules" && Array.isArray(prev) ? prev.join(",") : String(prev ?? "");
  }

  const validation = validateRosterInput(role, merged as RosterInput);
  if (!validation.ok) return skipRow(row, input, validation.message);

  const roster = validation.roster;

  const changes: RosterBatchChange[] = [];
  const entryPatch: Record<string, unknown> = {};

  const prevName = typeof entry.name === "string" ? entry.name : String(entry.name ?? "");
  if (fileName && fileName !== prevName) {
    changes.push({ label: fieldLabel(role, "name"), from: prevName, to: fileName });
    entryPatch.name = fileName;
  }

  for (const key of ROSTER_ENTRY_FIELDS[role]) {
    const nextModules =
      key === "modules" && Array.isArray(roster.modules) ? (roster.modules as string[]) : null;
    // 比對「實際存的」模組（不套用超級＝全開），空白欄位沿用原值才不會誤報變更
    const prevModules = key === "modules" ? storedAdminModules(entry) : null;
    const label = fieldLabel(role, key);
    if (nextModules && prevModules) {
      const nextText = modulesText(nextModules);
      const prevText = modulesText(prevModules);
      if (nextText === prevText) continue;
      changes.push({ label, from: prevText, to: nextText });
      entryPatch[key] = nextModules;
      continue;
    }
    const nextValue = typeof roster[key] === "string" ? (roster[key] as string) : "";
    const prevValue =
      typeof entry[key] === "string" ? (entry[key] as string) : entry[key] == null ? "" : String(entry[key]);
    if (nextValue === prevValue) continue;
    changes.push({ label, from: prevValue, to: nextValue });
    entryPatch[key] = nextValue;
  }

  if (changes.length === 0) return skipRow(row, input, "沒有需要更新的欄位");
  seen.add(uid);
  return {
    row,
    action: "update",
    key: resolved.key,
    uid,
    entryPatch: { ...entryPatch, updatedAt: Date.now() },
    changes,
  };
}

async function planDelete(
  role: RosterRole,
  row: number,
  input: RosterInput,
  context: BatchContext,
  seen: Set<string>,
  sessionUid: string
): Promise<PlannedRow> {
  const resolved = resolveUid(input, context.index);
  if (!resolved.uid) return skipRow(row, input, resolved.error ?? "查無此帳號");
  const uid = resolved.uid;
  if (seen.has(uid)) return skipRow(row, input, "檔案中重複對應到同一名冊資料");
  if (!context.entries.has(uid)) return skipRow(row, input, "本期無此身分名冊資料");

  if (role === "admin") {
    if (uid === sessionUid) return skipRow(row, input, "無法刪除自己的管理員身分");
    if ((await countOtherActiveAdmins(uid)) === 0) {
      return skipRow(row, input, "無法刪除最後一位有效管理員");
    }
  }

  seen.add(uid);
  return { row, action: "delete", key: resolved.key, uid };
}

function buildPreview(
  mode: RosterBatchMode,
  strategy: RosterBatchStrategy,
  cleared: number,
  planned: PlannedRow[]
): RosterBatchPreview {
  const rows: RosterBatchRow[] = planned.map((item) => {
    if (item.action === "skip") {
      return { row: item.row, key: item.key, action: "skip", reason: item.reason };
    }
    if (item.action === "update") {
      return { row: item.row, key: item.key, action: "update", changes: item.changes };
    }
    return { row: item.row, key: item.key, action: item.action };
  });
  const count = (action: PlannedRow["action"]) =>
    planned.filter((item) => item.action === action).length;
  return {
    mode,
    strategy,
    cleared,
    total: planned.length,
    created: count("create"),
    updated: count("update"),
    deleted: count("delete"),
    skipped: count("skip"),
    rows,
  };
}

/**
 * 覆蓋模式要先行刪除的 uid：本期該身分的全部條目。
 * 管理員身分保留兩道防呆（自己的管理員身分、最後一位有效管理員），
 * 檔案包含該人時仍會在下一輪以檔案資料覆寫重建。
 */
async function planReplaceDeletions(
  role: RosterRole,
  context: BatchContext,
  sessionUid: string
): Promise<string[]> {
  const uids = [...context.entries.keys()];
  if (role !== "admin" || uids.length === 0) return uids;

  const keep = new Set<string>([sessionUid]);
  for (const uid of uids) {
    if (keep.has(uid)) continue;
    if ((await countOtherActiveAdmins(uid)) === 0) keep.add(uid);
  }
  return uids.filter((uid) => !keep.has(uid));
}

async function executePlan(
  planned: PlannedRow[],
  role: RosterRole,
  period: SchoolPeriod,
  clearUids: string[]
): Promise<RosterBatchResult> {
  const db = getAdminDb();
  const entries = db.collection(rosterCollection(role));
  const skipped: { row: number; reason: string }[] = [];
  let cleared = 0;
  let created = 0;
  let updated = 0;
  let deleted = 0;

  // 覆蓋：先清空同一學期既有條目，再依計畫建立
  for (const uid of clearUids) {
    await entries.doc(rosterEntryId(uid, period)).delete();
    cleared += 1;
  }

  for (const item of planned) {
    if (item.action === "skip") {
      skipped.push({ row: item.row, reason: item.reason });
    } else if (item.action === "create") {
      // 只建立名冊條目：帳號與密碼一律不動
      await entries
        .doc(rosterEntryId(item.uid, period))
        .set(
          buildRosterEntry(item.uid, role, period, item.roster, {
            email: item.email,
            account: item.account,
            name: item.name,
          })
        );
      created += 1;
    } else if (item.action === "update") {
      await entries.doc(rosterEntryId(item.uid, period)).update(item.entryPatch);
      updated += 1;
    } else {
      await entries.doc(rosterEntryId(item.uid, period)).delete();
      deleted += 1;
    }
  }

  return { cleared, created, updated, deleted, skipped };
}

export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "roster-batch",
      RATE.ROSTER_BATCH.limit,
      RATE.ROSTER_BATCH.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("roster");
    if (denial) return toAuthResponse(denial);

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    const modeRaw = formData.get("mode");
    const mode =
      typeof modeRaw === "string" && (MODES as string[]).includes(modeRaw)
        ? (modeRaw as RosterBatchMode)
        : null;
    if (!mode) {
      return NextResponse.json({ success: false, message: "批次作業模式無效" }, { status: 400 });
    }
    const dryRun = formData.get("dryRun") === "true";

    // 寫入策略：僅「新增」模式有意義，缺省＝追加（其餘模式一律忽略）
    const strategyRaw = formData.get("strategy");
    const strategy: RosterBatchStrategy =
      mode === "create" && isRosterBatchStrategy(strategyRaw) ? strategyRaw : "append";

    const roleValue = formData.get("role");
    const role = isRosterRole(roleValue) ? roleValue : null;
    if (!role) {
      return NextResponse.json({ success: false, message: "帳號身分無效" }, { status: 400 });
    }
    if (mode === "create" && !isImportableRole(role)) {
      return NextResponse.json(
        { success: false, message: `${rosterRoleLabel(role)}不提供檔案匯入，請使用表單建立` },
        { status: 400 }
      );
    }

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

    const parsed = parseSpreadsheet(Buffer.from(await file.arrayBuffer()), role);
    if ("error" in parsed) {
      return NextResponse.json({ success: false, message: parsed.error }, { status: 400 });
    }

    const dataRows = parsed.rows
      .map((input, index) => ({ row: index + 2, input }))
      .filter(({ input }) => !isEmptyRosterInput(input));

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

    const period = await getCurrentPeriod();
    const context = await loadBatchContext(role, period);
    const seen = new Set<string>();
    const planned: PlannedRow[] = [];
    for (const { row, input } of dataRows) {
      if (mode === "create") {
        planned.push(planCreate(role, row, input, context, seen, strategy));
      } else if (mode === "update") {
        planned.push(planUpdate(role, row, input, context, seen));
      } else {
        planned.push(await planDelete(role, row, input, context, seen, session.uid));
      }
    }

    // 覆蓋：先算出要清空的既有條目（管理員身分有防呆保留）
    const clearUids =
      mode === "create" && strategy === "replace"
        ? await planReplaceDeletions(role, context, session.uid)
        : [];

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        preview: buildPreview(mode, strategy, clearUids.length, planned),
      });
    }

    // 覆蓋會刪掉檔案以外的資料：有任何略過列就要求先修正，避免清空後建不出來
    const blocked = planned.find(
      (item): item is PlannedSkip => item.action === "skip"
    );
    if (clearUids.length > 0 && blocked) {
      return NextResponse.json(
        {
          success: false,
          message: `覆蓋模式不允許略過列（第 ${blocked.row} 列：${blocked.reason}），請修正檔案後重新上傳`,
        },
        { status: 400 }
      );
    }

    const result = await executePlan(planned, role, period, clearUids);
    const label = ROSTER_BATCH_MODE_LABELS[mode];
    const clearedText = result.cleared > 0 ? `覆蓋刪除 ${result.cleared} 筆、` : "";
    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_batch",
      ip: getClientIp(request),
      details: `${rosterRoleLabel(role)}批次${label}：${clearedText}新增 ${result.created} 筆、更新 ${result.updated} 筆、刪除 ${result.deleted} 筆、略過 ${result.skipped.length} 筆`,
    });

    return NextResponse.json({
      success: true,
      dryRun: false,
      result,
      message: `批次作業完成：${clearedText}新增 ${result.created} 筆、更新 ${result.updated} 筆、刪除 ${result.deleted} 筆、略過 ${result.skipped.length} 筆`,
    });
  } catch (error) {
    console.error("Roster batch error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}
