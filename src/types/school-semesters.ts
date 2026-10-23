/**
 * 學期起訖設定（學年度、學年度起訖、學期、學期起訖）。
 *
 * 屬「學校基本設定」模組（schoolSettings，超級專屬）的子功能
 * `schoolSettings.semesters`（危險區）：
 * 學年度與學期是全站的期間基準（名冊、個資、公告、行事曆…皆以其為資料鍵），
 * 起訖日期供行事曆與對外展示參考。
 *
 * 資料存於 `settings/system` 文件：學年度（academicYear）與學期（semester）
 * 本來就在該文件，起訖日期為同文件的新增欄位。因此本功能的 API 使用
 * **merge 部分更新**（只寫本表單的白名單欄位），不可整份覆寫
 * ——整份覆寫會連帶抹掉系統設定的其他欄位（與 PUT /api/settings 行為不同）。
 *
 * 本檔不可 import `server-only`，前端表單與 API 伺服器端共用這裡的驗證。
 */
import { detectPeriod } from "@/types/settings";

/** 學年度（民國年）輸入上下限 */
export const ACADEMIC_YEAR_MIN = 1;
export const ACADEMIC_YEAR_MAX = 999;

/** 起訖日期欄位上限（YYYY-MM-DD 為 10 字） */
export const SEMESTER_DATE_MAX = 10;

/** 學期固定兩學期 */
export const SEMESTER_OPTIONS = [
  { value: 1, label: "第1學期" },
  { value: 2, label: "第2學期" },
] as const;

/** 本功能寫入 settings/system 的欄位白名單（merge 部分更新只動這些欄位） */
export const SEMESTER_SETTINGS_FIELDS = [
  "academicYear",
  "semester",
  "academicYearStart",
  "academicYearEnd",
  "semesterStart",
  "semesterEnd",
  "winterStart",
  "winterEnd",
  "summerStart",
  "summerEnd",
] as const;

export interface SemesterSettings {
  /** 學年度（民國年），如 115 */
  academicYear: number;
  /** 學期：1=第1學期、2=第2學期 */
  semester: number;
  /** 學年度起日（YYYY-MM-DD，可留空） */
  academicYearStart: string;
  /** 學年度訖日（YYYY-MM-DD，可留空） */
  academicYearEnd: string;
  /** 學期起日（YYYY-MM-DD，可留空） */
  semesterStart: string;
  /** 學期訖日（YYYY-MM-DD，可留空） */
  semesterEnd: string;
  /** 寒假起日（YYYY-MM-DD，可留空） */
  winterStart: string;
  /** 寒假訖日（YYYY-MM-DD，可留空） */
  winterEnd: string;
  /** 暑假起日（YYYY-MM-DD，可留空） */
  summerStart: string;
  /** 暑假訖日（YYYY-MM-DD，可留空） */
  summerEnd: string;
}

/** 預設值：學年度／學期沿用全站推算，起訖日期留空 */
export function defaultSemesterSettings(): SemesterSettings {
  const period = detectPeriod();
  return {
    academicYear: period.academicYear,
    semester: period.semester,
    academicYearStart: "",
    academicYearEnd: "",
    semesterStart: "",
    semesterEnd: "",
    winterStart: "",
    winterEnd: "",
    summerStart: "",
    summerEnd: "",
  };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 讀回日期欄位（寬容）：非合法 YYYY-MM-DD 一律歸零為空字串 */
function readDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return DATE_PATTERN.test(trimmed) ? trimmed : "";
}

function readYear(value: unknown): number {
  const year = Number(value);
  if (!Number.isInteger(year)) return defaultSemesterSettings().academicYear;
  return Math.min(ACADEMIC_YEAR_MAX, Math.max(ACADEMIC_YEAR_MIN, year));
}

function readSemester(value: unknown): number {
  const semester = Number(value);
  return semester === 2 ? 2 : 1;
}

/**
 * 讀回學期起訖設定（寬容）：只把型別與範圍修到安全值，
 * 語意問題（起日大於訖日…）交由驗證回報，避免資料毀損時整份作廢。
 */
export function readSemesterSettings(raw: unknown): SemesterSettings {
  if (!raw || typeof raw !== "object") return defaultSemesterSettings();
  const data = raw as Record<string, unknown>;
  const fallback = defaultSemesterSettings();
  return {
    academicYear: data.academicYear === undefined ? fallback.academicYear : readYear(data.academicYear),
    semester: data.semester === undefined ? fallback.semester : readSemester(data.semester),
    academicYearStart: readDate(data.academicYearStart),
    academicYearEnd: readDate(data.academicYearEnd),
    semesterStart: readDate(data.semesterStart),
    semesterEnd: readDate(data.semesterEnd),
    winterStart: readDate(data.winterStart),
    winterEnd: readDate(data.winterEnd),
    summerStart: readDate(data.summerStart),
    summerEnd: readDate(data.summerEnd),
  };
}

export type SemesterSettingsValidation =
  | { ok: true; value: SemesterSettings }
  | { ok: false; message: string };

/** 驗證單一日期欄位：空字串或合法日期；回錯誤訊息或 null */
function validateDateField(raw: unknown, label: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return `${label}格式不正確`;
  const value = raw.trim();
  if (!value) return null;
  if (!DATE_PATTERN.test(value)) {
    return `${label}格式不正確，請使用日期選擇器`;
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return `${label}不是有效的日期`;
  }
  // Date 會把 2026-02-31 等溢出日自動進位，比對字元還原檢查
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() + 1 !== month ||
    parsed.getDate() !== day
  ) {
    return `${label}不是有效的日期`;
  }
  return null;
}

/** 驗證起訖對：兩邊都填時起日不得晚於訖日 */
function validateRange(
  startRaw: unknown,
  endRaw: unknown,
  startLabel: string,
  endLabel: string
): string | null {
  const start = typeof startRaw === "string" ? startRaw.trim() : "";
  const end = typeof endRaw === "string" ? endRaw.trim() : "";
  if (!start || !end) return null;
  if (start > end) {
    return `${startLabel}不得晚於${endLabel}`;
  }
  return null;
}

/** 完整驗證（API 與表單共用），任一項目不過即回錯誤訊息 */
export function validateSemesterSettings(raw: unknown): SemesterSettingsValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "無效的學期起訖設定內容" };
  }
  const data = raw as Record<string, unknown>;

  const year = Number(data.academicYear);
  if (!Number.isInteger(year) || year < ACADEMIC_YEAR_MIN || year > ACADEMIC_YEAR_MAX) {
    return {
      ok: false,
      message: `學年度需為 ${ACADEMIC_YEAR_MIN} 至 ${ACADEMIC_YEAR_MAX} 的整數（民國年）`,
    };
  }

  const semester = Number(data.semester);
  if (semester !== 1 && semester !== 2) {
    return { ok: false, message: "學期僅能選擇第1學期或第2學期" };
  }

  const dateFields: [unknown, string][] = [
    [data.academicYearStart, "學年度起日"],
    [data.academicYearEnd, "學年度訖日"],
    [data.semesterStart, "學期起日"],
    [data.semesterEnd, "學期訖日"],
    [data.winterStart, "寒假起日"],
    [data.winterEnd, "寒假訖日"],
    [data.summerStart, "暑假起日"],
    [data.summerEnd, "暑假訖日"],
  ];
  for (const [value, label] of dateFields) {
    const error = validateDateField(value, label);
    if (error) return { ok: false, message: error };
  }

  const rangeError =
    validateRange(data.academicYearStart, data.academicYearEnd, "學年度起日", "學年度訖日") ??
    validateRange(data.semesterStart, data.semesterEnd, "學期起日", "學期訖日") ??
    validateRange(data.winterStart, data.winterEnd, "寒假起日", "寒假訖日") ??
    validateRange(data.summerStart, data.summerEnd, "暑假起日", "暑假訖日");
  if (rangeError) return { ok: false, message: rangeError };

  return {
    ok: true,
    value: {
      academicYear: year,
      semester,
      academicYearStart: typeof data.academicYearStart === "string" ? data.academicYearStart.trim() : "",
      academicYearEnd: typeof data.academicYearEnd === "string" ? data.academicYearEnd.trim() : "",
      semesterStart: typeof data.semesterStart === "string" ? data.semesterStart.trim() : "",
      semesterEnd: typeof data.semesterEnd === "string" ? data.semesterEnd.trim() : "",
      winterStart: typeof data.winterStart === "string" ? data.winterStart.trim() : "",
      winterEnd: typeof data.winterEnd === "string" ? data.winterEnd.trim() : "",
      summerStart: typeof data.summerStart === "string" ? data.summerStart.trim() : "",
      summerEnd: typeof data.summerEnd === "string" ? data.summerEnd.trim() : "",
    },
  };
}
