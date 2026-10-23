/**
 * 課表作息時間（settings/schoolPeriods）：每日節次的代碼、序號、名稱與起訖時間，
 * 含午休等非授課時段，供課表、行事曆、作息公告等日後引用。
 *
 * 屬「學校基本設定」模組（schoolSettings，超級專屬）的子功能 `schoolSettings.periods`：
 * 頁面層由 `school-settings/layout.tsx` 擋一次，
 * API 端以 `requireAdminModule("schoolSettings")` 再擋一次。
 */

export const PERIODS_DOC_ID = "schoolPeriods";
export const PERIODS_MAX_ROWS = 50;
export const PERIODS_CODE_MAX = 20;
export const PERIODS_NAME_MAX = 40;
/** 節次序號下限（0 保留給午休等非授課時段） */
export const PERIODS_MIN_NUMBER = 0;
/** 節次序號上限 */
export const PERIODS_MAX_NUMBER = 99;

/** `HH:MM`（24 小時制，補零） */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 一筆節次：代碼、序號、名稱與起訖時間 */
export type SchoolPeriodRow = {
  /** 主要節次代碼（識別用，全校唯一，如 `P1`、`N`） */
  code: string;
  /** 節次（0～99 整數，全校唯一；0 為非授課時段如午休） */
  period: number;
  /** 節次名稱（顯示用，如「第一節」「午休」） */
  name: string;
  /** 開始時間 `HH:MM` */
  start: string;
  /** 結束時間 `HH:MM` */
  end: string;
};

/** 上課星期（1=週一…7=週日；台灣學校一般為週一至週五） */
export const SCHOOL_DAY_LABELS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"] as const;

/** 預設上課星期：週一至週五 */
export const DEFAULT_SCHOOL_DAYS = [1, 2, 3, 4, 5] as const;

export type SchoolPeriodsSetting = {
  /** 上課星期（勾選＝該日為上課日；1=週一…7=週日，至少一天） */
  schoolDays: number[];
  periods: SchoolPeriodRow[];
};

export type PeriodsValidation =
  | { ok: true; value: SchoolPeriodsSetting }
  | { ok: false; message: string };

/** 內建預設：每日八節＋午休（文件不存在時回這裡） */
const DEFAULT_PERIODS: SchoolPeriodRow[] = [
  { code: "P1", period: 1, name: "第一節", start: "08:00", end: "08:50" },
  { code: "P2", period: 2, name: "第二節", start: "09:20", end: "10:10" },
  { code: "P3", period: 3, name: "第三節", start: "10:20", end: "11:10" },
  { code: "P4", period: 4, name: "第四節", start: "11:20", end: "12:10" },
  { code: "N", period: 0, name: "午休", start: "12:40", end: "13:10" },
  { code: "P5", period: 5, name: "第五節", start: "13:20", end: "14:10" },
  { code: "P6", period: 6, name: "第六節", start: "14:20", end: "15:10" },
  { code: "P7", period: 7, name: "第七節", start: "15:20", end: "16:10" },
  { code: "P8", period: 8, name: "第八節", start: "16:20", end: "17:10" },
];

/** 讀回上課星期（寬容）：只留 1–7 的整數、去重升冪；缺漏或全無效回預設週一至週五 */
function readSchoolDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_SCHOOL_DAYS];
  const days = new Set<number>();
  for (const item of value) {
    const day = Number(item);
    if (Number.isInteger(day) && day >= 1 && day <= 7) days.add(day);
  }
  if (days.size === 0) return [...DEFAULT_SCHOOL_DAYS];
  return [...days].sort((a, b) => a - b);
}

/** 內建預設（複製一份，避免外部改動到內建值） */
export function defaultSchoolPeriods(): SchoolPeriodsSetting {
  return { schoolDays: [...DEFAULT_SCHOOL_DAYS], periods: DEFAULT_PERIODS.map((row) => ({ ...row })) };
}

/**
 * 逐筆清洗（讀回不驗證、不擋畫面）：去頭尾空白、代碼或名稱留白該筆丟棄、
 * 節次非整數或時間格式不符該筆丟棄；超長丟棄。
 * 文件不存在或 `periods` 不是陣列 → 回內建預設（每日八節＋午休）；
 * 明確給空陣列則尊重（作息表就是空的）。
 */
export function readSchoolPeriods(raw: unknown): SchoolPeriodsSetting {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultSchoolPeriods();
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.periods)) return defaultSchoolPeriods();

  const rows: SchoolPeriodRow[] = [];
  for (const item of record.periods) {
    if (rows.length >= PERIODS_MAX_ROWS) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const code = typeof row.code === "string" ? row.code.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const start = typeof row.start === "string" ? row.start.trim() : "";
    const end = typeof row.end === "string" ? row.end.trim() : "";
    const period = typeof row.period === "number" ? row.period : NaN;
    if (!code || !name) continue;
    if (code.length > PERIODS_CODE_MAX || name.length > PERIODS_NAME_MAX) continue;
    if (!Number.isInteger(period)) continue;
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) continue;
    rows.push({ code, period, name, start, end });
  }
  return { schoolDays: readSchoolDays(record.schoolDays), periods: rows };
}

/** 時段是否合法（`HH:MM` 且 24 小時制） */
export function isPeriodTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/**
 * 儲存前驗證：欄位、唯一性、時間先後與時段重疊逐項檢查，
 * 不過即整份不寫入；錯誤訊息帶列序號，可直接對照畫面。
 */
export function validateSchoolPeriods(raw: unknown): PeriodsValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "無效的課表作息時間內容" };
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.periods)) {
    return { ok: false, message: "節次清單格式錯誤" };
  }
  if (record.periods.length > PERIODS_MAX_ROWS) {
    return { ok: false, message: `節次最多 ${PERIODS_MAX_ROWS} 筆` };
  }

  const schoolDaysRaw = record.schoolDays === undefined ? DEFAULT_SCHOOL_DAYS : record.schoolDays;
  if (!Array.isArray(schoolDaysRaw)) {
    return { ok: false, message: "上課星期格式錯誤" };
  }
  const schoolDays = new Set<number>();
  for (const item of schoolDaysRaw) {
    const day = Number(item);
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      return { ok: false, message: "上課星期僅能選擇週一至週日" };
    }
    if (schoolDays.has(day)) {
      return { ok: false, message: "上課星期有重複的選項" };
    }
    schoolDays.add(day);
  }
  if (schoolDays.size === 0) {
    return { ok: false, message: "至少須勾選一天上課星期" };
  }

  const rows: SchoolPeriodRow[] = [];
  const codes = new Set<string>();
  const numbers = new Set<number>();

  for (let index = 0; index < record.periods.length; index += 1) {
    const item = record.periods[index];
    const label = `第 ${index + 1} 筆`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, message: `${label}格式錯誤` };
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.code !== "string" ||
      typeof row.name !== "string" ||
      typeof row.start !== "string" ||
      typeof row.end !== "string"
    ) {
      return { ok: false, message: `${label}的主要節次代碼、節次名稱與時間都必須是文字` };
    }
    const code = row.code.trim();
    const name = row.name.trim();
    const start = row.start.trim();
    const end = row.end.trim();

    if (!code) return { ok: false, message: `${label}未填主要節次代碼` };
    if (code.length > PERIODS_CODE_MAX) {
      return { ok: false, message: `${label}的主要節次代碼「${code}」超過 ${PERIODS_CODE_MAX} 個字` };
    }
    if (!name) return { ok: false, message: `${label}未填節次名稱` };
    if (name.length > PERIODS_NAME_MAX) {
      return { ok: false, message: `${label}的節次名稱「${name}」超過 ${PERIODS_NAME_MAX} 個字` };
    }
    if (
      typeof row.period !== "number" ||
      !Number.isInteger(row.period) ||
      row.period < PERIODS_MIN_NUMBER ||
      row.period > PERIODS_MAX_NUMBER
    ) {
      return {
        ok: false,
        message: `${label}的節次必須是 ${PERIODS_MIN_NUMBER}～${PERIODS_MAX_NUMBER} 的整數（0 代表非授課時段）`,
      };
    }
    if (codes.has(code)) {
      return { ok: false, message: `${label}的主要節次代碼「${code}」重複，請移除多餘的列` };
    }
    if (numbers.has(row.period)) {
      return { ok: false, message: `${label}的節次 ${row.period} 重複，請移除多餘的列` };
    }
    if (!TIME_PATTERN.test(start)) return { ok: false, message: `${label}的開始時間格式須為 HH:MM` };
    if (!TIME_PATTERN.test(end)) return { ok: false, message: `${label}的結束時間格式須為 HH:MM` };
    if (start >= end) {
      return { ok: false, message: `${label}的結束時間（${end}）必須晚於開始時間（${start}）` };
    }

    codes.add(code);
    numbers.add(row.period);
    rows.push({ code, period: row.period, name, start, end });
  }

  // 時段重疊：依開始時間排序後相鄰比對（同日作息不允許兩筆時間交疊）
  const sorted = [...rows].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.start < previous.end) {
      return {
        ok: false,
        message: `「${previous.name}」（${previous.start}–${previous.end}）與「${current.name}」（${current.start}–${current.end}）時段重疊`,
      };
    }
  }

  return { ok: true, value: { schoolDays: [...schoolDays].sort((a, b) => a - b), periods: rows } };
}
