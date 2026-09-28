import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireRole, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { ROLE_COLLECTIONS } from "@/types/users";
import {
  isEmptyRosterInput,
  isRosterRole,
  ROSTER_FIELDS,
  rosterImportHint,
  rosterRoleLabel,
  RosterFieldKey,
  RosterInput,
  RosterRole,
} from "@/types/roster";
import {
  buildRosterRecord,
  checkRosterConflict,
  hashRosterPassword,
  loadRosterIndex,
  validateRosterInput,
} from "@/lib/roster";

/** 每列都要跑一次 bcrypt（成本 12 約 0.23 秒）＋ Firestore 寫入，900 列約 250 秒，與函式執行上限一起控管 */
export const maxDuration = 300;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 900;

interface SkippedRow {
  row: number;
  reason: string;
}

/** 標題列正規化：忽略大小寫與所有空白（"Student ID" === "studentid"） */
function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function buildAliasMap(role: RosterRole): Map<string, RosterFieldKey> {
  const map = new Map<string, RosterFieldKey>();
  for (const field of ROSTER_FIELDS[role]) {
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

export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "roster-import",
      RATE.ROSTER_IMPORT.limit,
      RATE.ROSTER_IMPORT.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    const roleValue = formData.get("role");
    const role = isRosterRole(roleValue) ? roleValue : null;
    if (!role) {
      return NextResponse.json({ success: false, message: "帳號身分無效" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ success: false, message: "請選擇要匯入的檔案" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { success: false, message: "檔案超過 5MB，請拆成多個檔案分批匯入" },
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
          message: `單次最多匯入 ${MAX_ROWS} 列，此檔有 ${dataRows.length} 列，請分批匯入`,
        },
        { status: 400 }
      );
    }

    const collection = getAdminDb().collection(ROLE_COLLECTIONS[role]);
    const index = await loadRosterIndex(role);
    const skipped: SkippedRow[] = [];
    let created = 0;

    for (const { row, input } of dataRows) {
      const result = validateRosterInput(role, input, { requirePassword: true });
      if (!result.ok) {
        skipped.push({ row, reason: result.message });
        continue;
      }

      const conflict = checkRosterConflict(result.fields, index);
      if (conflict) {
        skipped.push({ row, reason: conflict });
        continue;
      }

      const record = buildRosterRecord(
        role,
        result.fields,
        await hashRosterPassword(result.password as string)
      );
      await collection.add(record);
      // 寫入後立刻併入索引，擋掉同一份檔案內重複的信箱／帳號／學號
      if (result.fields.email) index.emails.set(result.fields.email, String(created));
      if (result.fields.account) index.accounts.set(result.fields.account, String(created));
      if (result.fields.studentId) index.studentIds.set(result.fields.studentId, String(created));
      created += 1;
    }

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_imported",
      ip: getClientIp(request),
      details: `匯入${rosterRoleLabel(role)} ${created} 筆，略過 ${skipped.length} 筆`,
    });

    return NextResponse.json({
      success: true,
      created,
      skipped,
      message: `匯入完成：新增 ${created} 筆，略過 ${skipped.length} 筆`,
    });
  } catch (error) {
    console.error("Roster import error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}
