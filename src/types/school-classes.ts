/**
 * 年段班級設定（年段、涵蓋年級與各年級的班級代碼／名稱）。
 *
 * 屬「學校基本設定」模組（schoolSettings，超級專屬）的子功能 `schoolSettings.classes`：
 * 登記本校的年段劃分、各年段涵蓋的年級，以及每年級的班級清單（代碼＋名稱），
 * 供日後名冊的年級／班級欄位引用。
 *
 * 資料存於獨立文件 `settings/schoolClasses`（結構性資料、不按學期、全校一份）：
 * - 不放 `settings/system`：系統設定的 PUT 是整份覆寫（只保留 roleEnabled），
 *   存同文件會在下次儲存系統設定時被清掉。
 * - 不放 `settings/school`（單位層級設定）：其 PUT 同樣是整份 set() 覆寫，會互相清掉。
 * - 不放 `settings/schoolProfile`（校務基本資料）：同上，且年段可不綁教育階段，
 *   兩份資料的生命週期不同，不互相依賴。
 *
 * 本檔不可 import `server-only`（`src/lib/*` 皆為伺服器專用），
 * 前端表單與 API 伺服器端共用這裡的驗證。
 */

import { EDUCATION_STAGES, StageValue, stageLabel } from "@/types/school-profile";

/** 一個班級 */
export interface ClassRow {
  /** 穩定代碼：新增時產生、改名不變，供日後引用 */
  id: string;
  /** 班級代碼（日後對應名冊 `classCode`），全校不可重複 */
  code: string;
  /** 班級名稱（日後對應名冊 `className`），同年級內不可重複 */
  name: string;
}

/** 一個年級及其班級清單 */
export interface GradeRow {
  /** 年級（1..CLASSES_MAX_GRADE），同一年段內升冪、全校只可歸屬一個年段 */
  grade: number;
  /** 該年級的班級；兄弟順序＝陣列相對順序 */
  classes: ClassRow[];
}

/** 一個年段（如「低年段」「國小部」） */
export interface Segment {
  /** 穩定代碼：新增時產生、改名不變，供日後引用 */
  id: string;
  /** 年段名稱 */
  name: string;
  /** 綁定的教育階段（可不綁定＝null），僅供日後對照，不展開年級 */
  stage: StageValue | null;
  /** 涵蓋的年級，升冪排列、全校不可重複 */
  grades: GradeRow[];
}

export interface SchoolClassesSetting {
  /** 年段；兄弟順序＝陣列相對順序 */
  segments: Segment[];
}

export const CLASSES_DOC_ID = "schoolClasses";
export const CLASSES_MAX_SEGMENTS = 6;
export const CLASSES_MIN_GRADE = 1;
export const CLASSES_MAX_GRADE = 12;
export const CLASSES_MAX_CLASSES_PER_GRADE = 30;
export const CLASSES_MAX_CLASSES = 300;
export const CLASSES_SEGMENT_NAME_MAX = 20;
export const CLASSES_CODE_MAX = 20;
export const CLASSES_NAME_MAX = 40;

/** 教育階段的顯示名稱（未綁定時傳回空字串） */
export function stageName(stage: StageValue | null): string {
  return stage ? stageLabel(stage) : "";
}

/** 新年段代碼：時間基底＋亂碼，同毫秒內也不會相撞 */
export function newSegmentId(): string {
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 新班級代碼：時間基底＋亂碼，同毫秒內也不會相撞 */
export function newClassId(): string {
  return `cl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultSchoolClasses(): SchoolClassesSetting {
  return { segments: [] };
}

/** 已被占用的年級（供介面列出尚可新增的年級） */
export function usedGrades(setting: SchoolClassesSetting): Set<number> {
  const used = new Set<number>();
  for (const segment of setting.segments) {
    for (const row of segment.grades) used.add(row.grade);
  }
  return used;
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
function readId(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : newSegmentId();
}

function readClasses(
  raw: unknown,
  seenIds: Set<string>,
  budget: number
): ClassRow[] {
  const classes: ClassRow[] = [];
  if (!Array.isArray(raw)) return classes;
  for (const item of raw) {
    if (classes.length >= budget) break;
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id = readId(entry.id);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    classes.push({
      id,
      code: typeof entry.code === "string" ? entry.code.trim().slice(0, CLASSES_CODE_MAX) : "",
      name: typeof entry.name === "string" ? entry.name.trim().slice(0, CLASSES_NAME_MAX) : "",
    });
  }
  return classes;
}

/**
 * 讀回年段班級設定（寬容）：只把型別與範圍修到安全值（補 id、去重、年級排序），
 * 語意問題（年級跨年段重複、班級代碼重複、空白名稱…）交由驗證回報，
 * 避免資料毀損時整份作廢。
 */
export function readSchoolClasses(raw: unknown): SchoolClassesSetting {
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

    let id = readId(entry.id);
    if (seenSegmentIds.has(id)) id = newSegmentId();
    seenSegmentIds.add(id);

    const stageValue = typeof entry.stage === "string" ? entry.stage : "";
    const stage = EDUCATION_STAGES.some((option) => option.value === stageValue)
      ? (stageValue as StageValue)
      : null;

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
      const classes = readClasses(gradeEntry.classes, seenClassIds, Math.min(CLASSES_MAX_CLASSES_PER_GRADE, remaining));
      remaining -= classes.length;
      grades.push({ grade, classes });
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

/** 完整驗證（API 與表單共用），任一項目不過即回錯誤訊息 */
export function validateSchoolClasses(raw: unknown): ClassesValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "無效的年段班級設定內容" };
  }
  const data = raw as Record<string, unknown>;

  const rawSegments = Array.isArray(data.segments) ? data.segments : [];
  if (rawSegments.length > CLASSES_MAX_SEGMENTS) {
    return { ok: false, message: `年段數量超過上限（最多 ${CLASSES_MAX_SEGMENTS} 個）` };
  }

  const segments: Segment[] = [];
  const segmentIds = new Set<string>();
  const segmentNames = new Set<string>();
  const gradeOwners = new Map<number, string>();
  const classIds = new Set<string>();
  const classCodeOwners = new Map<string, string>();
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
      return { ok: false, message: `年段「${name}」的教育階段格式錯誤` };
    }
    const stageValue = typeof rawStage === "string" ? rawStage : "";
    if (stageValue !== "" && !EDUCATION_STAGES.some((option) => option.value === stageValue)) {
      return {
        ok: false,
        message: `年段「${name}」綁定了未知的教育階段：「${stageLabel(stageValue)}」`,
      };
    }
    const stage = stageValue === "" ? null : (stageValue as StageValue);

    const rawGrades = Array.isArray(entry.grades) ? entry.grades : [];
    if (rawGrades.length === 0) {
      return { ok: false, message: `年段「${name}」尚未設定任何年級` };
    }

    const grades: GradeRow[] = [];
    let previousGrade = 0;
    for (let gradeIndex = 0; gradeIndex < rawGrades.length; gradeIndex += 1) {
      const gradeItem = rawGrades[gradeIndex];
      if (!gradeItem || typeof gradeItem !== "object") {
        return { ok: false, message: `年段「${name}」的年級資料格式錯誤` };
      }
      const gradeEntry = gradeItem as Record<string, unknown>;
      const grade = Number(gradeEntry.grade);
      if (!Number.isInteger(grade) || grade < CLASSES_MIN_GRADE || grade > CLASSES_MAX_GRADE) {
        return {
          ok: false,
          message: `年段「${name}」的第 ${gradeIndex + 1} 個年級需為 ${CLASSES_MIN_GRADE} 至 ${CLASSES_MAX_GRADE} 的整數`,
        };
      }
      if (grade <= previousGrade) {
        return {
          ok: false,
          message: `年段「${name}」的年級需由小到大排列且不可重複`,
        };
      }
      previousGrade = grade;
      const owner = gradeOwners.get(grade);
      if (owner !== undefined) {
        return {
          ok: false,
          message: `${grade} 年級同時出現在年段「${owner}」與年段「${name}」，每個年級只能歸屬一個年段`,
        };
      }
      gradeOwners.set(grade, name);

      const rawClasses = Array.isArray(gradeEntry.classes) ? gradeEntry.classes : [];
      if (rawClasses.length > CLASSES_MAX_CLASSES_PER_GRADE) {
        return {
          ok: false,
          message: `${grade} 年級的班級數超過上限（最多 ${CLASSES_MAX_CLASSES_PER_GRADE} 班）`,
        };
      }

      const classes: ClassRow[] = [];
      const gradeNames = new Set<string>();
      for (let classIndex = 0; classIndex < rawClasses.length; classIndex += 1) {
        const classItem = rawClasses[classIndex];
        if (!classItem || typeof classItem !== "object") {
          return { ok: false, message: `${grade} 年級的班級資料格式錯誤` };
        }
        const classEntry = classItem as Record<string, unknown>;

        const classId = typeof classEntry.id === "string" ? classEntry.id.trim() : "";
        if (!classId) {
          return {
            ok: false,
            message: `${grade} 年級的第 ${classIndex + 1} 個班級缺少班級代碼，請重新整理頁面後再試`,
          };
        }
        if (classIds.has(classId)) {
          return { ok: false, message: "班級編號重複，請重新整理頁面後再試" };
        }
        classIds.add(classId);

        const code = typeof classEntry.code === "string" ? classEntry.code.trim() : "";
        if (!code) {
          return { ok: false, message: `${grade} 年級第 ${classIndex + 1} 個班級的班級代碼不可空白` };
        }
        if (code.length > CLASSES_CODE_MAX) {
          return {
            ok: false,
            message: `班級代碼「${code}」過長（最多 ${CLASSES_CODE_MAX} 字）`,
          };
        }
        const codeOwner = classCodeOwners.get(code);
        if (codeOwner !== undefined) {
          return {
            ok: false,
            message: `班級代碼「${code}」重複（已用於${codeOwner}）`,
          };
        }
        classCodeOwners.set(code, `${grade} 年級`);

        const className = typeof classEntry.name === "string" ? classEntry.name.trim() : "";
        if (!className) {
          return { ok: false, message: `${grade} 年級第 ${classIndex + 1} 個班級的班級名稱不可空白` };
        }
        if (className.length > CLASSES_NAME_MAX) {
          return {
            ok: false,
            message: `班級名稱「${className}」過長（最多 ${CLASSES_NAME_MAX} 字）`,
          };
        }
        if (gradeNames.has(className)) {
          return { ok: false, message: `${grade} 年級的班級名稱「${className}」重複` };
        }
        gradeNames.add(className);

        totalClasses += 1;
        if (totalClasses > CLASSES_MAX_CLASSES) {
          return { ok: false, message: `班級總數超過上限（最多 ${CLASSES_MAX_CLASSES} 班）` };
        }

        classes.push({ id: classId, code, name: className });
      }

      grades.push({ grade, classes });
    }

    segments.push({ id, name, stage, grades });
  }

  return { ok: true, value: { segments } };
}
