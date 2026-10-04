/**
 * 年段班級設定（年段、學制、年級與班級）。
 *
 * 屬「學校基本設定」模組（schoolSettings，超級專屬）的子功能 `schoolSettings.classes`：
 * 登記本校的年段劃分、各年段綁定的學制、涵蓋的年級（代碼＋名稱），
 * 以及每年級的班級清單（代碼＋名稱，高級中等學校學制另有群別與科別），
 * 供日後名冊的年級／班級欄位引用。
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

/** 一個年級及其班級清單 */
export interface GradeRow {
  /** 穩定代碼：新增時產生、改名不變，供日後引用 */
  id: string;
  /** 年級編號：落在該學制的全校編號範圍內、全校不可重複，僅供排序與產生預設值 */
  grade: number;
  /** 年級代碼（預設＝年級編號），全校不可重複 */
  code: string;
  /** 年級名稱（預設＝該學制內第 N 年級），同年段內不可重複 */
  name: string;
  /** 該年級的班級；兄弟順序＝陣列相對順序 */
  classes: ClassRow[];
}

/** 一個年段（綁定一個學制，如「低年段」綁國民小學） */
export interface Segment {
  /** 穩定代碼：新增時產生、改名不變，供日後引用 */
  id: string;
  /** 年段名稱（如「低年段」「國小部」） */
  name: string;
  /** 綁定的學制；null＝尚未選擇（驗證會擋下） */
  stage: StageValue | null;
  /** 涵蓋的年級，升冪排列、編號全校不可重複 */
  grades: GradeRow[];
}

export interface SchoolClassesSetting {
  /** 年段；兄弟順序＝陣列相對順序 */
  segments: Segment[];
}

/** 驗證上下文：取自校務基本資料（`settings/schoolProfile`）的教育階段與年制 */
export interface SchoolClassesContext {
  stages: { stage: StageValue; years: number }[];
}

/** 高級中等學校：唯一可填寫群別／科別的學制 */
export const SENIOR_HIGH_STAGE: StageValue = "seniorHigh";

export const CLASSES_DOC_ID = "schoolClasses";
/** 年段數量的結構上限（實際可用學制數另受校務基本資料約束） */
export const CLASSES_MAX_SEGMENTS = 6;
export const CLASSES_MIN_GRADE = 1;
/** 年級編號的結構上限（read 用的寬容範圍）；語意上限由校務基本資料的年制總和決定 */
export const CLASSES_MAX_GRADE = 24;
export const CLASSES_MAX_CLASSES_PER_GRADE = 30;
export const CLASSES_MAX_CLASSES = 300;
export const CLASSES_SEGMENT_NAME_MAX = 20;
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

/** 該學制尚未被占用的年級編號（由小到大）；未勾選該學制時回空陣列 */
export function freeGradeNumbers(
  setting: SchoolClassesSetting,
  context: SchoolClassesContext,
  stage: StageValue | null
): number[] {
  const range = gradeRangeOf(context, stage);
  if (!range) return [];
  const used = new Set<number>();
  for (const segment of setting.segments) {
    for (const row of segment.grades) used.add(row.grade);
  }
  const free: number[] = [];
  for (let value = range.start; value <= range.end; value += 1) {
    if (!used.has(value)) free.push(value);
  }
  return free;
}

/** 年級名稱預設值：該學制內的第 N 年級（如國中編號 7 → 「1 年級」） */
export function defaultGradeName(grade: number, range: { start: number } | null): string {
  const local = range ? grade - range.start + 1 : grade;
  return `${local} 年級`;
}

/** 年級代碼預設值：年級編號（全校唯一） */
export function defaultGradeCode(grade: number): string {
  return String(grade);
}

/** 新年段代碼：時間基底＋亂碼，同毫秒內也不會相撞 */
export function newSegmentId(): string {
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 新年級代碼：時間基底＋亂碼，同毫秒內也不會相撞 */
export function newGradeId(): string {
  return `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 新班級代碼：時間基底＋亂碼，同毫秒內也不會相撞 */
export function newClassId(): string {
  return `cl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultSchoolClasses(): SchoolClassesSetting {
  return { segments: [] };
}

/** 年級總數 */
export function totalGradeCount(setting: SchoolClassesSetting): number {
  let total = 0;
  for (const segment of setting.segments) total += segment.grades.length;
  return total;
}

/** 班級總數 */
export function totalClassCount(setting: SchoolClassesSetting): number {
  let total = 0;
  for (const segment of setting.segments) {
    for (const row of segment.grades) total += row.classes.length;
  }
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
 * 讀回年段班級設定（寬容）：只把型別與範圍修到安全值
 * （補 id、補年級代碼與名稱預設值、去重、年級排序、非高中職學制丟棄群別科別），
 * 語意問題（學制未勾選、年級編號超出學制範圍、代碼重複、空白名稱…）交由驗證回報，
 * 避免資料毀損時整份作廢。`context` 缺省時以空上下文讀（預設值退化為年級編號）。
 */
export function readSchoolClasses(
  raw: unknown,
  context: SchoolClassesContext = emptyContext()
): SchoolClassesSetting {
  if (!raw || typeof raw !== "object") return defaultSchoolClasses();
  const data = raw as Record<string, unknown>;

  const segments: Segment[] = [];
  const seenSegmentIds = new Set<string>();
  const seenGrades = new Set<number>();
  const seenClassIds = new Set<string>();
  let remaining = CLASSES_MAX_CLASSES;

  const rawSegments = Array.isArray(data.segments) ? data.segments : [];
  for (const item of rawSegments) {
    if (segments.length >= CLASSES_MAX_SEGMENTS) break;
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;

    let id = readId(entry.id, newSegmentId);
    if (seenSegmentIds.has(id)) id = newSegmentId();
    seenSegmentIds.add(id);

    const stageValue = typeof entry.stage === "string" ? entry.stage : "";
    const stage = EDUCATION_STAGES.some((option) => option.value === stageValue)
      ? (stageValue as StageValue)
      : null;
    const range = gradeRangeOf(context, stage);

    const grades: GradeRow[] = [];
    const rawGrades = Array.isArray(entry.grades) ? entry.grades : [];
    for (const gradeItem of rawGrades) {
      if (!gradeItem || typeof gradeItem !== "object") continue;
      const gradeEntry = gradeItem as Record<string, unknown>;
      const grade = Number(gradeEntry.grade);
      if (!Number.isInteger(grade) || grade < CLASSES_MIN_GRADE || grade > CLASSES_MAX_GRADE) {
        continue;
      }
      if (seenGrades.has(grade)) continue;
      seenGrades.add(grade);

      const code =
        typeof gradeEntry.code === "string" && gradeEntry.code.trim()
          ? gradeEntry.code.trim().slice(0, CLASSES_GRADE_CODE_MAX)
          : defaultGradeCode(grade);
      const name =
        typeof gradeEntry.name === "string" && gradeEntry.name.trim()
          ? gradeEntry.name.trim().slice(0, CLASSES_GRADE_NAME_MAX)
          : defaultGradeName(grade, range);

      const classes = readClasses(
        gradeEntry.classes,
        seenClassIds,
        Math.min(CLASSES_MAX_CLASSES_PER_GRADE, remaining),
        stage === SENIOR_HIGH_STAGE
      );
      remaining -= classes.length;
      grades.push({
        id: readId(gradeEntry.id, newGradeId),
        grade,
        code,
        name,
        classes,
      });
      if (remaining <= 0) break;
    }
    grades.sort((a, b) => a.grade - b.grade);

    segments.push({
      id,
      name:
        typeof entry.name === "string"
          ? entry.name.trim().slice(0, CLASSES_SEGMENT_NAME_MAX)
          : "",
      stage,
      grades,
    });
    if (remaining <= 0) break;
  }

  return { segments };
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
 * `context` 為校務基本資料的教育階段與年制：學制是否勾選、年級編號範圍、
 * 年級總數上限皆由此決定。
 */
export function validateSchoolClasses(
  raw: unknown,
  context: SchoolClassesContext = emptyContext()
): ClassesValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "無效的年段班級設定內容" };
  }
  const data = raw as Record<string, unknown>;

  const rawSegments = Array.isArray(data.segments) ? data.segments : [];
  if (rawSegments.length === 0) return { ok: true, value: { segments: [] } };
  if (rawSegments.length > CLASSES_MAX_SEGMENTS) {
    return { ok: false, message: `年段數量超過上限（最多 ${CLASSES_MAX_SEGMENTS} 個）` };
  }
  if (context.stages.length === 0) {
    return {
      ok: false,
      message: "尚未於「校務基本資料」勾選教育階段與學校年制，請先前往設定後再回來建立年段。",
    };
  }

  const segments: Segment[] = [];
  const segmentIds = new Set<string>();
  const segmentNames = new Set<string>();
  const stageYears = new Map(context.stages.map((item) => [item.stage, item.years]));
  const gradeNumbers = new Set<number>();
  const gradeCodes = new Map<string, string>();
  const gradeIds = new Set<string>();
  const classIds = new Set<string>();
  const classCodeOwners = new Map<string, string>();
  let totalGrades = 0;
  let totalClasses = 0;

  for (let index = 0; index < rawSegments.length; index += 1) {
    const item = rawSegments[index];
    if (!item || typeof item !== "object") {
      return { ok: false, message: `第 ${index + 1} 個年段資料格式錯誤` };
    }
    const entry = item as Record<string, unknown>;

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) {
      return { ok: false, message: `第 ${index + 1} 個年段缺少年段代碼，請重新整理頁面後再試` };
    }
    if (segmentIds.has(id)) {
      return { ok: false, message: "年段代碼重複，請重新整理頁面後再試" };
    }
    segmentIds.add(id);

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) {
      return { ok: false, message: `第 ${index + 1} 個年段的名稱不可空白` };
    }
    if (name.length > CLASSES_SEGMENT_NAME_MAX) {
      return {
        ok: false,
        message: `年段名稱「${name}」過長（最多 ${CLASSES_SEGMENT_NAME_MAX} 字）`,
      };
    }
    if (segmentNames.has(name)) {
      return { ok: false, message: `年段名稱「${name}」重複` };
    }
    segmentNames.add(name);

    const rawStage = entry.stage;
    if (rawStage !== null && rawStage !== undefined && typeof rawStage !== "string") {
      return { ok: false, message: `年段「${name}」的學制格式錯誤` };
    }
    const stageValue = typeof rawStage === "string" ? rawStage : "";
    if (stageValue === "") {
      return { ok: false, message: `年段「${name}」尚未選擇學制` };
    }
    if (!EDUCATION_STAGES.some((option) => option.value === stageValue)) {
      return {
        ok: false,
        message: `年段「${name}」綁定了未知的學制：「${stageLabel(stageValue)}」`,
      };
    }
    const stage = stageValue as StageValue;
    const years = stageYears.get(stage);
    if (years === undefined) {
      return {
        ok: false,
        message: `年段「${name}」的學制「${stageLabel(stage)}」未在校務基本資料中勾選，請先勾選或調整本年段的學制`,
      };
    }
    const range = gradeRangeOf(context, stage);
    if (!range) {
      return { ok: false, message: `年段「${name}」的學制年制資料異常，請重新整理頁面後再試` };
    }

    const rawGrades = Array.isArray(entry.grades) ? entry.grades : [];
    if (rawGrades.length === 0) {
      return { ok: false, message: `年段「${name}」尚未設定任何年級` };
    }
    if (rawGrades.length > years) {
      return {
        ok: false,
        message: `年段「${name}」的年級數超過學制「${stageLabel(stage)}」的年數（${years} 年）`,
      };
    }

    const grades: GradeRow[] = [];
    let previousGrade = 0;
    for (let gradeIndex = 0; gradeIndex < rawGrades.length; gradeIndex += 1) {
      const gradeItem = rawGrades[gradeIndex];
      if (!gradeItem || typeof gradeItem !== "object") {
        return { ok: false, message: `年段「${name}」的年級資料格式錯誤` };
      }
      const gradeEntry = gradeItem as Record<string, unknown>;

      const gradeId = typeof gradeEntry.id === "string" ? gradeEntry.id.trim() : "";
      if (!gradeId) {
        return { ok: false, message: `年段「${name}」有年級缺少年級代碼，請重新整理頁面後再試` };
      }
      if (gradeIds.has(gradeId)) {
        return { ok: false, message: "年級的內部編號重複，請重新整理頁面後再試" };
      }
      gradeIds.add(gradeId);

      const grade = Number(gradeEntry.grade);
      if (!Number.isInteger(grade) || grade < CLASSES_MIN_GRADE || grade > CLASSES_MAX_GRADE) {
        return {
          ok: false,
          message: `年段「${name}」的第 ${gradeIndex + 1} 個年級編號格式錯誤`,
        };
      }
      if (grade < range.start || grade > range.end) {
        return {
          ok: false,
          message: `年段「${name}」的年級編號 ${grade} 超出學制「${stageLabel(stage)}」的年級編號範圍（${range.start}～${range.end}），請至校務基本資料確認年制，或刪除該年級`,
        };
      }
      if (grade <= previousGrade) {
        return { ok: false, message: `年段「${name}」的年級需由小到大排列且不可重複` };
      }
      previousGrade = grade;
      if (gradeNumbers.has(grade)) {
        return { ok: false, message: `年級編號 ${grade} 重複，每個年級編號全校只能使用一次` };
      }
      gradeNumbers.add(grade);
      totalGrades += 1;

      const gradeCode = typeof gradeEntry.code === "string" ? gradeEntry.code.trim() : "";
      if (!gradeCode) {
        return { ok: false, message: `年段「${name}」第 ${gradeIndex + 1} 個年級的年級代碼不可空白` };
      }
      if (gradeCode.length > CLASSES_GRADE_CODE_MAX) {
        return {
          ok: false,
          message: `年級代碼「${gradeCode}」過長（最多 ${CLASSES_GRADE_CODE_MAX} 字）`,
        };
      }
      const codeOwner = gradeCodes.get(gradeCode);
      if (codeOwner !== undefined) {
        return { ok: false, message: `年級代碼「${gradeCode}」重複（已用於年段「${codeOwner}」）` };
      }
      gradeCodes.set(gradeCode, name);

      const gradeName = typeof gradeEntry.name === "string" ? gradeEntry.name.trim() : "";
      if (!gradeName) {
        return { ok: false, message: `年段「${name}」第 ${gradeIndex + 1} 個年級的年級名稱不可空白` };
      }
      if (gradeName.length > CLASSES_GRADE_NAME_MAX) {
        return {
          ok: false,
          message: `年級名稱「${gradeName}」過長（最多 ${CLASSES_GRADE_NAME_MAX} 字）`,
        };
      }
      if (grades.some((row) => row.name === gradeName)) {
        return { ok: false, message: `年段「${name}」的年級名稱「${gradeName}」重複` };
      }

      const rawClasses = Array.isArray(gradeEntry.classes) ? gradeEntry.classes : [];
      if (rawClasses.length > CLASSES_MAX_CLASSES_PER_GRADE) {
        return {
          ok: false,
          message: `年段「${name}」年級「${gradeName}」的班級數超過上限（最多 ${CLASSES_MAX_CLASSES_PER_GRADE} 班）`,
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
        const codeOwner = classCodeOwners.get(code);
        if (codeOwner !== undefined) {
          return { ok: false, message: `班級代碼「${code}」重複（已用於${codeOwner}）` };
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

    segments.push({ id, name, stage, grades });
  }

  if (totalGrades > contextYearsSum(context)) {
    return {
      ok: false,
      message: `年級總數（${totalGrades}）超過校務基本資料的年制總和（${contextYearsSum(context)} 年）`,
    };
  }

  return { ok: true, value: { segments } };
}
