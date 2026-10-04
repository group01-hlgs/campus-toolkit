/**
 * 各式代碼表（settings/schoolCodes）：系統的基礎資料庫，
 * 維護高級中等學校類型、群別、科別三份清單；
 * 其中群別／科別供「年段班級設定」中高級中等學校班級選用（代碼下拉、名稱帶入）。
 *
 * 「學校基本設定」schoolSettings（僅超級管理員）底下的子功能，
 * 因此本文件只由超級管理員維護；同一個 Firestore 的各分支共用。
 */
import {
  OFFICIAL_DEPARTMENTS,
  OFFICIAL_GROUPS,
  OFFICIAL_SCHOOL_TYPES,
} from "@/data/schoolCodesSeed";

export const CODES_DOC_ID = "schoolCodes";
export const CODES_VOC_CODE_MAX = 20;
export const CODES_VOC_NAME_MAX = 40;
export const CODES_MAX_SCHOOL_TYPES = 50;
export const CODES_MAX_GROUPS = 200;
export const CODES_MAX_DEPARTMENTS = 1000;

/** 一筆代碼：代碼（識別用）＋名稱（顯示用） */
export type VocCodeRow = { code: string; name: string };

/** 各式代碼表設定（三份清單結構相同，只是用途不同） */
export type SchoolCodesSetting = {
  schoolTypes: VocCodeRow[];
  groups: VocCodeRow[];
  departments: VocCodeRow[];
};

export type CodesValidation =
  | { ok: true; value: SchoolCodesSetting }
  | { ok: false; message: string };

/** 內建預設＝官方代碼表（文件不存在時回這裡） */
export function defaultSchoolCodes(): SchoolCodesSetting {
  return {
    schoolTypes: OFFICIAL_SCHOOL_TYPES.map((item) => ({ ...item })),
    groups: OFFICIAL_GROUPS.map((item) => ({ ...item })),
    departments: OFFICIAL_DEPARTMENTS.map((item) => ({ ...item })),
  };
}

/** 欄位清洗：字串去頭尾空白、代碼／名稱留白該筆丟棄、代碼＋名稱完全重複只留第一筆 */
function cleanRows(raw: unknown, cap: number): VocCodeRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: VocCodeRow[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (rows.length >= cap) break;
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!code || !name) continue;
    if (code.length > CODES_VOC_CODE_MAX || name.length > CODES_VOC_NAME_MAX) continue;
    const key = `${code}\u0000${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ code, name });
  }
  return rows;
}

/**
 * 讀回代碼表：文件不存在回內建官方清單；存在則逐筆清洗（讀回不驗證、不擋畫面）。
 * 舊文件缺少某一欄（如加設 `schoolTypes` 之前存的）→ 該欄補內建官方清單；
 * 明確給空陣列則尊重（該清單就是空的）。
 */
export function readSchoolCodes(raw: unknown): SchoolCodesSetting {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultSchoolCodes();
  const record = raw as Record<string, unknown>;
  const hasAny =
    Array.isArray(record.schoolTypes) ||
    Array.isArray(record.groups) ||
    Array.isArray(record.departments);
  if (!hasAny) return defaultSchoolCodes();
  const seed = defaultSchoolCodes();
  return {
    schoolTypes: Array.isArray(record.schoolTypes)
      ? cleanRows(record.schoolTypes, CODES_MAX_SCHOOL_TYPES)
      : seed.schoolTypes,
    groups: Array.isArray(record.groups)
      ? cleanRows(record.groups, CODES_MAX_GROUPS)
      : seed.groups,
    departments: Array.isArray(record.departments)
      ? cleanRows(record.departments, CODES_MAX_DEPARTMENTS)
      : seed.departments,
  };
}

/** 逐筆驗證一份清單；失敗回第一個錯誤訊息 */
function checkList(
  raw: unknown,
  label: string,
  cap: number
): { ok: true; value: VocCodeRow[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: `${label}清單格式錯誤` };
  if (raw.length > cap) return { ok: false, message: `${label}最多 ${cap} 筆` };

  const rows: VocCodeRow[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, message: `第 ${index + 1} 筆${label}格式錯誤` };
    }
    const record = item as Record<string, unknown>;
    if (typeof record.code !== "string" || typeof record.name !== "string") {
      return { ok: false, message: `第 ${index + 1} 筆${label}的代碼與名稱都必須是文字` };
    }
    const code = record.code.trim();
    const name = record.name.trim();
    if (!code) return { ok: false, message: `第 ${index + 1} 筆${label}未填代碼` };
    if (code.length > CODES_VOC_CODE_MAX) {
      return { ok: false, message: `${label}代碼「${code}」超過 ${CODES_VOC_CODE_MAX} 個字` };
    }
    if (!name) return { ok: false, message: `${label}代碼「${code}」未填名稱` };
    if (name.length > CODES_VOC_NAME_MAX) {
      return { ok: false, message: `${label}名稱「${name}」超過 ${CODES_VOC_NAME_MAX} 個字` };
    }
    const key = `${code}\u0000${name}`;
    if (seen.has(key)) {
      return { ok: false, message: `${label}「${code} ${name}」重複，請移除多餘的列` };
    }
    seen.add(key);
    rows.push({ code, name });
  }
  return { ok: true, value: rows };
}

/** 儲存前驗證：三份清單逐筆檢查，不過即整份不寫入 */
export function validateSchoolCodes(raw: unknown): CodesValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "無效的代碼表內容" };
  }
  const record = raw as Record<string, unknown>;
  const schoolTypes = checkList(record.schoolTypes, "高級中等學校類型", CODES_MAX_SCHOOL_TYPES);
  if (!schoolTypes.ok) return schoolTypes;
  const groups = checkList(record.groups, "群別", CODES_MAX_GROUPS);
  if (!groups.ok) return groups;
  const departments = checkList(record.departments, "科別", CODES_MAX_DEPARTMENTS);
  if (!departments.ok) return departments;
  return {
    ok: true,
    value: {
      schoolTypes: schoolTypes.value,
      groups: groups.value,
      departments: departments.value,
    },
  };
}
