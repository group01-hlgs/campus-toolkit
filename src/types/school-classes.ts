/**
 * 年段班級設定（年段＝年級、學制與班級）。
 *
 * 屬「學校基本設定」模組（schoolSettings，超級專屬）的子功能 `schoolSettings.classes`：
 * 登記本校的年段（**一個年段＝一個年級**，如「高一」）與其代碼、名稱，
 * 以及每年級的班級清單（代碼＋名稱，高級中等學校學制另有群別與科別），
 * 供日後名冊的年級／班級欄位引用。
 * 所屬學制不另存欄位：由年級編號在校務基本資料年制總和中的位置推導（`stageOfGrade`）。
 * 早先的 `segments`（年段包年級）結構由 `collectRawGrades` 讀入時自動攤平，不需遷移。
 *
 * 資料存於獨立文件 `settings/schoolClasses`（結構性資料、不按學期、全校一份）：
 * - 不放 `settings/system`：系統設定的 PUT 是整份覆寫（只保留 roleEnabled），
 *   存同文件會在下次儲存系統設定時被清掉。
 * - 不放 `settings/school`（單位層級設定）：其 PUT 同樣是整份 set() 覆寫，會互相清掉。
 * - 不放 `settings/schoolProfile`（校務基本資料）：同上。
 *   但**上限取自校務基本資料**：驗證需帶 `SchoolClassesContext`（學制與年制），
 *   由 API 讀 `settings/schoolProfile` 組成、前端由 GET 回傳取得。
 *
 * 本檔不可 import `server-only`（`src/lib/*` 皆為伺服器專用），
 * 前端表單與 API 伺服器端共用這裡的驗證。
 */

import { EDUCATION_STAGES, StageValue, stageLabel } from "@/types/school-profile";

/** 群別／科別（僅高級中等學校學制的班級可填寫） */
export interface VocField {
  code: string;
  name: string;
}

/** 一個班級 */
export interface ClassRow {
  /** 穩定代碼：新增時產生、改名不變，供日後引用 */
  id: string;
  /** 班級代碼（日後對應名冊 `classCode`），全校不可重複 */
  code: string;
  /** 班級名稱（日後對應名冊 `className`），同年級內不可重複 */
  name: string;
  /** 群別（僅高級中等學校學制；其餘學制一律 null） */
  group: VocField | null;
  /** 科別（僅高級中等學校學制；其餘學制一律 null） */
  department: VocField | null;
}

/**
 * 一個年段＝一個年級（**年段就是年級**，例如高中的高一／高二／高三各是一個年段），
 * 連同該年級的班級清單。所屬學制不另存欄位，由 `grade` 編號配合校務基本資料推導。
 */
export interface GradeRow {
  /** 穩定代碼：新增時產生、改名不變，供日後引用 */
  id: string;
  /** 年級編號（＝年段編號）：1～年制總和、全校唯一、升冪；決定所屬學制與編號範圍 */
  grade: number;
  /** 年級代碼（預設＝年級編號），全校不可重複 */
  code: string;
  /** 年級名稱（預設依 nameStyle：學制內序號或全域編號），同學制內不可重複 */
  name: string;
  /** 該年級的班級；**兄弟順序＝班級順位**（有意義，見文件） */
  classes: ClassRow[];
}

/**
 * 年級名稱的預設命名慣例（只影響之後新建年級的預設名稱，既有名稱不動）。
 * `local`＝學制內序號（國中 1～3 年級）、`global`＝全域編號（國中 7～9 年級）。
 * 兩種說法在現場都常見，故開放切換；年級代碼一律預設為年級編號，不受此設定影響。
 */
export type GradeNameStyle = "local" | "global";

export interface SchoolClassesSetting {
  /** 年段（＝年級），升冪排列；畫面上依所屬學制分區顯示 */
  grades: GradeRow[];
  /** 年級名稱的預設慣例（缺省視為 local） */
  nameStyle: GradeNameStyle;
}

/** 驗證上下文：取自校務基本資料（`settings/schoolProfile`）的教育階段與年制 */
export interface SchoolClassesContext {
  stages: { stage: StageValue; years: number }[];
}

/** 高級中等學校：唯一可填寫群別／科別的學制 */
export const SENIOR_HIGH_STAGE: StageValue = "seniorHigh";

export const CLASSES_DOC_ID = "schoolClasses";
export const CLASSES_MIN_GRADE = 1;
/**
 * 年級編號的結構上限（read 用的寬容範圍）；
 * 語意上限由校務基本資料的年制總和決定（年段＝年級，故年段數上限亦同）。
 */
export const CLASSES_MAX_GRADE = 24;
export const CLASSES_MAX_CLASSES_PER_GRADE = 30;
export const CLASSES_MAX_CLASSES = 300;
export const CLASSES_GRADE_CODE_MAX = 10;
export const CLASSES_GRADE_NAME_MAX = 20;
export const CLASSES_CODE_MAX = 20;
export const CLASSES_NAME_MAX = 40;
export const CLASSES_VOC_CODE_MAX = 20;
export const CLASSES_VOC_NAME_MAX = 40;

export function emptyContext(): SchoolClassesContext {
  return { stages: [] };
}

/** 各學制年數總和（年級編號總量的上限） */
export function contextYearsSum(context: SchoolClassesContext): number {
  return context.stages.reduce((sum, item) => sum + item.years, 0);
}

/** 教育階段的顯示名稱（未綁定時傳回空字串） */
export function stageName(stage: StageValue | null): string {
  return stage ? stageLabel(stage) : "";
}

/**
 * 該學制在全校的年級編號範圍（依校務基本資料的學制順序展開）。
 * 例如國民小學 6 年制排第一 → 1～6、國民中學 3 年制 → 7～9。
 * 校務基本資料未勾選該學制時回 null。
 */
export function gradeRangeOf(
  context: SchoolClassesContext,
  stage: StageValue | null
): { start: number; end: number } | null {
  if (!stage) return null;
  let cursor = CLASSES_MIN_GRADE;
  for (const item of context.stages) {
    const start = cursor;
    const end = start + item.years - 1;
    if (item.stage === stage) return { start, end };
    cursor = end + 1;
  }
  return null;
}

/**
 * 年級編號所屬的學制：由編號落在校務基本資料的哪一段範圍推導。
 * 例如國小 6 年＋國中 3 年 → 編號 7 屬國民中學；超出年制總和回 null。
 */
export function stageOfGrade(
  context: SchoolClassesContext,
  grade: number
): StageValue | null {
  if (!Number.isFinite(grade)) return null;
  let cursor = CLASSES_MIN_GRADE;
  for (const item of context.stages) {
    const end = cursor + item.years - 1;
    if (grade >= cursor && grade <= end) return item.stage;
    cursor = end + 1;
  }
  return null;
}

/** 該學制尚未被占用的年級編號（由小到大）；未勾選該學制時回空陣列 */
export function freeGradeNumbers(
  setting: Pick<SchoolClassesSetting, "grades">,
  context: SchoolClassesContext,
  stage: StageValue | null
): number[] {
  const range = gradeRangeOf(context, stage);
  if (!range) return [];
  const used = new Set<number>();
  for (const row of setting.grades) used.add(row.grade);
  const free: number[] = [];
  for (let value = range.start; value <= range.end; value += 1) {
    if (!used.has(value)) free.push(value);
  }
  return free;
}

/**
 * 年級名稱預設值。`local`＝該學制內的第 N 年級（國中編號 7 →「1 年級」）、
 * `global`＝年級編號本身（國中編號 7 →「7 年級」）。
 */
export function defaultGradeName(
  grade: number,
  range: { start: number } | null,
  style: GradeNameStyle = "local"
): string {
  const value = style === "global" || !range ? grade : grade - range.start + 1;
  return `${value} 年級`;
}

/** 年級代碼預設值：年級編號（全校唯一） */
export function defaultGradeCode(grade: number): string {
  return String(grade);
}

/** 新年級代碼：時間基底＋亂碼，同毫秒內也不會相撞 */
export function newGradeId(): string {
  return `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 新班級代碼：時間基底＋亂碼，同毫秒內也不會相撞 */
export function newClassId(): string {
  return `cl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 末段數字 +1（保留前導零：`"009"`→`"010"`、`"09"`→`"10"`）。
 * 「末段數字」＝字串中最後一段連續數字（`"1 年 1 班"` 取到末尾前的 `1` → `"1 年 2 班"`），
 * 因此代碼（`101`→`102`）與名稱（`1 年 1 班`→`1 年 2 班`）都適用。
 * 沒有數字、數字過大失去精度、或 +1 後超過 `maxLength` 回 `null`，由呼叫端決定退回策略。
 */
export function incrementLastNumber(value: string, maxLength: number): string | null {
  const match = /(\d+)(?!.*\d)/.exec(value);
  if (!match) return null;
  const digits = match[1];
  const next = Number(digits) + 1;
  if (!Number.isSafeInteger(next)) return null;
  const padded = String(next).padStart(digits.length, "0");
  const result = value.slice(0, match.index) + padded + value.slice(match.index + digits.length);
  if (result.length > maxLength) return null;
  return result;
}

export function defaultSchoolClasses(): SchoolClassesSetting {
  return { grades: [], nameStyle: "local" };
}

/** 解析命名慣例（寬容）：非合法值一律當作 local */
function readNameStyle(value: unknown): GradeNameStyle {
  return value === "global" ? "global" : "local";
}

/** 年段（＝年級）總數 */
export function totalGradeCount(setting: Pick<SchoolClassesSetting, "grades">): number {
  return setting.grades.length;
}

/** 班級總數 */
export function totalClassCount(setting: Pick<SchoolClassesSetting, "grades">): number {
  let total = 0;
  for (const row of setting.grades) total += row.classes.length;
  return total;
}

/** 穩定代碼讀回：空白或毀損時補新的（同 readSchoolProfile 的寬容做法） */
function readId(value: unknown, fallback: () => string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : fallback();
}

function readVoc(raw: unknown): VocField | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const code =
    typeof entry.code === "string" ? entry.code.trim().slice(0, CLASSES_VOC_CODE_MAX) : "";
  const name =
    typeof entry.name === "string" ? entry.name.trim().slice(0, CLASSES_VOC_NAME_MAX) : "";
  if (!code && !name) return null;
  return { code, name };
}

function readClasses(raw: unknown, seenIds: Set<string>, budget: number, allowVoc: boolean): ClassRow[] {
  const classes: ClassRow[] = [];
  if (!Array.isArray(raw)) return classes;
  for (const item of raw) {
    if (classes.length >= budget) break;
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id = readId(entry.id, newClassId);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    classes.push({
      id,
      code: typeof entry.code === "string" ? entry.code.trim().slice(0, CLASSES_CODE_MAX) : "",
      name: typeof entry.name === "string" ? entry.name.trim().slice(0, CLASSES_NAME_MAX) : "",
      group: allowVoc ? readVoc(entry.group) : null,
      department: allowVoc ? readVoc(entry.department) : null,
    });
  }
  return classes;
}

/**
 * 攤平年段來源：新版頂層 `grades`；舊版（年段包年級）則取 `segments[].grades`。
 * 讀與驗證共用，舊資料不必先遷移就能繼續用。
 */
function collectRawGrades(data: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (item && typeof item === "object") out.push(item as Record<string, unknown>);
    }
  };
  if (Array.isArray(data.grades)) {
    push(data.grades);
  } else if (Array.isArray(data.segments)) {
    for (const item of data.segments) {
      if (item && typeof item === "object") push((item as Record<string, unknown>).grades);
    }
  }
  return out;
}

/**
 * 讀回年段班級設定（寬容）：只把型別與範圍修到安全值
 * （補 id、補年級代碼與名稱預設值、去重、依年級編號排序、非高中職學制丟棄群別科別），
 * 語意問題（編號超出年制總和、代碼重複、空白名稱…）交由驗證回報，
 * 避免資料毀損時整份作廢。舊版 `segments` 結構會自動攤平為 `grades`。
 * `context` 缺省時以空上下文讀（推不出學制，預設值退化為年級編號）。
 */
export function readSchoolClasses(
  raw: unknown,
  context: SchoolClassesContext = emptyContext()
): SchoolClassesSetting {
  if (!raw || typeof raw !== "object") return defaultSchoolClasses();
  const data = raw as Record<string, unknown>;
  const nameStyle = readNameStyle(data.nameStyle);

  const grades: GradeRow[] = [];
  const seenIds = new Set<string>();
  const seenNumbers = new Set<number>();
  const seenClassIds = new Set<string>();
  let remaining = CLASSES_MAX_CLASSES;

  for (const gradeEntry of collectRawGrades(data)) {
    if (grades.length >= CLASSES_MAX_GRADE) break;

    const grade = Number(gradeEntry.grade);
    if (!Number.isInteger(grade) || grade < CLASSES_MIN_GRADE || grade > CLASSES_MAX_GRADE) {
      continue;
    }
    if (seenNumbers.has(grade)) continue;
    seenNumbers.add(grade);

    const stage = stageOfGrade(context, grade);
    const range = stage ? gradeRangeOf(context, stage) : null;
    const code =
      typeof gradeEntry.code === "string" && gradeEntry.code.trim()
        ? gradeEntry.code.trim().slice(0, CLASSES_GRADE_CODE_MAX)
        : defaultGradeCode(grade);
    const name =
      typeof gradeEntry.name === "string" && gradeEntry.name.trim()
        ? gradeEntry.name.trim().slice(0, CLASSES_GRADE_NAME_MAX)
        : defaultGradeName(grade, range, nameStyle);

    const classes = readClasses(
      gradeEntry.classes,
      seenClassIds,
      Math.min(CLASSES_MAX_CLASSES_PER_GRADE, remaining),
      stage === SENIOR_HIGH_STAGE
    );
    remaining -= classes.length;

    let id = readId(gradeEntry.id, newGradeId);
    if (seenIds.has(id)) id = newGradeId();
    seenIds.add(id);

    grades.push({ id, grade, code, name, classes });
    if (remaining <= 0) break;
  }

  grades.sort((a, b) => a.grade - b.grade);
  return { grades, nameStyle };
}

export type ClassesValidation =
  | { ok: true; value: SchoolClassesSetting }
  | { ok: false; message: string };

function validateVoc(
  raw: unknown,
  label: string
): { ok: true; value: VocField | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "object") return { ok: false, message: `${label}資料格式錯誤` };
  const entry = raw as Record<string, unknown>;
  const code = typeof entry.code === "string" ? entry.code.trim() : "";
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (!code && !name) return { ok: true, value: null };
  if (!code || !name) {
    return { ok: false, message: `${label}的代碼與名稱需同時填寫` };
  }
  if (code.length > CLASSES_VOC_CODE_MAX) {
    return { ok: false, message: `${label}代碼「${code}」過長（最多 ${CLASSES_VOC_CODE_MAX} 字）` };
  }
  if (name.length > CLASSES_VOC_NAME_MAX) {
    return { ok: false, message: `${label}名稱「${name}」過長（最多 ${CLASSES_VOC_NAME_MAX} 字）` };
  }
  return { ok: true, value: { code, name } };
}

/**
 * 完整驗證（API 與表單共用），任一項目不過即回錯誤訊息。
 * `context` 為校務基本資料的教育階段與年制：年級編號範圍與年段（＝年級）數量上限
 * （＝年制總和）由此決定；所屬學制由編號推導，決定班級可否填寫群別科別。
 */
export function validateSchoolClasses(
  raw: unknown,
  context: SchoolClassesContext = emptyContext()
): ClassesValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "無效的年段班級設定內容" };
  }
  const data = raw as Record<string, unknown>;

  const rawStyle = data.nameStyle;
  if (rawStyle !== undefined && rawStyle !== null && rawStyle !== "local" && rawStyle !== "global") {
    return { ok: false, message: "年級名稱的命名慣例格式錯誤" };
  }
  const nameStyle: GradeNameStyle = rawStyle === "global" ? "global" : "local";

  const rawGrades = collectRawGrades(data);
  if (rawGrades.length === 0) return { ok: true, value: { grades: [], nameStyle } };
  if (context.stages.length === 0) {
    return {
      ok: false,
      message: "尚未於「校務基本資料」勾選教育階段與學校年制，請先前往設定後再回來建立年段。",
    };
  }
  const gradeLimit = contextYearsSum(context);
  if (rawGrades.length > gradeLimit) {
    return {
      ok: false,
      message: `年段數量（${rawGrades.length}）超過校務基本資料的年制總和（${gradeLimit}）`,
    };
  }

  const grades: GradeRow[] = [];
  const gradeIds = new Set<string>();
  const gradeCodes = new Map<string, number>();
  /** 各學制內的年段名稱對照（年段名稱只需在同學制內唯一，不同學制可同名） */
  const gradeNamesByStage = new Map<string, Map<string, number>>();
  const classIds = new Set<string>();
  const classCodeOwners = new Map<string, string>();
  let totalClasses = 0;
  let previousGrade = 0;

  for (let index = 0; index < rawGrades.length; index += 1) {
    const entry = rawGrades[index];

    const gradeId = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!gradeId) {
      return { ok: false, message: `第 ${index + 1} 個年段缺少年級代碼，請重新整理頁面後再試` };
    }
    if (gradeIds.has(gradeId)) {
      return { ok: false, message: "年級的內部編號重複，請重新整理頁面後再試" };
    }
    gradeIds.add(gradeId);

    const grade = Number(entry.grade);
    if (!Number.isInteger(grade) || grade < CLASSES_MIN_GRADE || grade > CLASSES_MAX_GRADE) {
      return { ok: false, message: `第 ${index + 1} 個年段的年級編號格式錯誤` };
    }
    if (grade <= previousGrade) {
      return { ok: false, message: "年級編號需由小到大排列且不可重複" };
    }
    previousGrade = grade;
    if (grade > gradeLimit) {
      return {
        ok: false,
        message: `年級編號 ${grade} 超出校務基本資料的年制總和（${gradeLimit}），請至校務基本資料調整年制，或刪除該年段`,
      };
    }
    const stage = stageOfGrade(context, grade);
    const range = stage ? gradeRangeOf(context, stage) : null;
    if (!stage || !range) {
      return { ok: false, message: `年級編號 ${grade} 的所屬學制無法判定，請重新整理頁面後再試` };
    }
    const stageTitle = stageLabel(stage);

    const gradeCode = typeof entry.code === "string" ? entry.code.trim() : "";
    if (!gradeCode) {
      return { ok: false, message: `第 ${index + 1} 個年段的年級代碼不可空白` };
    }
    if (gradeCode.length > CLASSES_GRADE_CODE_MAX) {
      return {
        ok: false,
        message: `年級代碼「${gradeCode}」過長（最多 ${CLASSES_GRADE_CODE_MAX} 字）`,
      };
    }
    const codeOwner = gradeCodes.get(gradeCode);
    if (codeOwner !== undefined) {
      return { ok: false, message: `年級代碼「${gradeCode}」重複（已用於年級編號 ${codeOwner}）` };
    }
    gradeCodes.set(gradeCode, grade);

    const gradeName = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!gradeName) {
      return { ok: false, message: `第 ${index + 1} 個年段的年級名稱不可空白` };
    }
    if (gradeName.length > CLASSES_GRADE_NAME_MAX) {
      return {
        ok: false,
        message: `年級名稱「${gradeName}」過長（最多 ${CLASSES_GRADE_NAME_MAX} 字）`,
      };
    }
    const stageNames = gradeNamesByStage.get(stage) ?? new Map<string, number>();
    const nameOwner = stageNames.get(gradeName);
    if (nameOwner !== undefined) {
      return {
        ok: false,
        message: `年級名稱「${gradeName}」重複（同學制「${stageTitle}」已用於年級編號 ${nameOwner}）`,
      };
    }
    stageNames.set(gradeName, grade);
    gradeNamesByStage.set(stage, stageNames);

    const rawClasses = Array.isArray(entry.classes) ? entry.classes : [];
    if (rawClasses.length > CLASSES_MAX_CLASSES_PER_GRADE) {
      return {
        ok: false,
        message: `年段「${gradeName}」的班級數超過上限（最多 ${CLASSES_MAX_CLASSES_PER_GRADE} 班）`,
      };
    }

    const classes: ClassRow[] = [];
    const gradeClassNames = new Set<string>();
    for (let classIndex = 0; classIndex < rawClasses.length; classIndex += 1) {
      const classItem = rawClasses[classIndex];
      if (!classItem || typeof classItem !== "object") {
        return { ok: false, message: `年級「${gradeName}」的班級資料格式錯誤` };
      }
      const classEntry = classItem as Record<string, unknown>;

      const classId = typeof classEntry.id === "string" ? classEntry.id.trim() : "";
      if (!classId) {
        return {
          ok: false,
          message: `年級「${gradeName}」的第 ${classIndex + 1} 個班級缺少班級編號，請重新整理頁面後再試`,
        };
      }
      if (classIds.has(classId)) {
        return { ok: false, message: "班級編號重複，請重新整理頁面後再試" };
      }
      classIds.add(classId);

      const code = typeof classEntry.code === "string" ? classEntry.code.trim() : "";
      if (!code) {
        return { ok: false, message: `年級「${gradeName}」第 ${classIndex + 1} 個班級的班級代碼不可空白` };
      }
      if (code.length > CLASSES_CODE_MAX) {
        return { ok: false, message: `班級代碼「${code}」過長（最多 ${CLASSES_CODE_MAX} 字）` };
      }
      const classCodeOwner = classCodeOwners.get(code);
      if (classCodeOwner !== undefined) {
        return { ok: false, message: `班級代碼「${code}」重複（已用於${classCodeOwner}）` };
      }
      classCodeOwners.set(code, `年級「${gradeName}」`);

      const className = typeof classEntry.name === "string" ? classEntry.name.trim() : "";
      if (!className) {
        return { ok: false, message: `年級「${gradeName}」第 ${classIndex + 1} 個班級的班級名稱不可空白` };
      }
      if (className.length > CLASSES_NAME_MAX) {
        return { ok: false, message: `班級名稱「${className}」過長（最多 ${CLASSES_NAME_MAX} 字）` };
      }
      if (gradeClassNames.has(className)) {
        return { ok: false, message: `年級「${gradeName}」的班級名稱「${className}」重複` };
      }
      gradeClassNames.add(className);

      totalClasses += 1;
      if (totalClasses > CLASSES_MAX_CLASSES) {
        return { ok: false, message: `班級總數超過上限（最多 ${CLASSES_MAX_CLASSES} 班）` };
      }

      const allowVoc = stage === SENIOR_HIGH_STAGE;
      const group = validateVoc(classEntry.group, "群別");
      if (!group.ok) {
        return { ok: false, message: `年級「${gradeName}」班級「${className}」：${group.message}` };
      }
      const department = validateVoc(classEntry.department, "科別");
      if (!department.ok) {
        return { ok: false, message: `年級「${gradeName}」班級「${className}」：${department.message}` };
      }
      if (!allowVoc && (group.value || department.value)) {
        return {
          ok: false,
          message: `僅「高級中等學校」學制的班級可填寫群別與科別（年級「${gradeName}」班級「${className}」）`,
        };
      }

      classes.push({
        id: classId,
        code,
        name: className,
        group: group.value,
        department: department.value,
      });
    }

    grades.push({ id: gradeId, grade, code: gradeCode, name: gradeName, classes });
  }

  return { ok: true, value: { grades, nameStyle } };
}
