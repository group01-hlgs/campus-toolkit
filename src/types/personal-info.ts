import type { SchoolPeriod } from "@/types/settings";

export const PERSONAL_INFO_COLLECTION = "studentPersonalInfo";

export interface StudentPersonalInfoFields {
  gender: string;
  nationalId: string;
  birthday: string;
  householdPostalCode: string;
  householdAddress: string;
  mailingPostalCode: string;
  mailingAddress: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  contactPhone: string;
}

export type StudentPersonalInfoFieldKey = keyof StudentPersonalInfoFields;

export const STUDENT_PERSONAL_INFO_FIELD_DEFS: {
  key: StudentPersonalInfoFieldKey;
  label: string;
  type: "text" | "date" | "tel" | "select" | "textarea";
  maxLength: number;
  options?: readonly string[];
}[] = [
  { key: "gender", label: "性別", type: "select", maxLength: 10, options: ["男", "女", "其他", "不提供"] },
  { key: "nationalId", label: "身分證", type: "text", maxLength: 20 },
  { key: "birthday", label: "生日", type: "date", maxLength: 10 },
  { key: "householdPostalCode", label: "戶籍郵區", type: "text", maxLength: 6 },
  { key: "householdAddress", label: "戶籍地址", type: "textarea", maxLength: 200 },
  { key: "mailingPostalCode", label: "通訊郵區", type: "text", maxLength: 6 },
  { key: "mailingAddress", label: "通訊地址", type: "textarea", maxLength: 200 },
  { key: "emergencyContactName", label: "緊急聯絡人（姓名）", type: "text", maxLength: 40 },
  { key: "emergencyContactPhone", label: "緊急聯絡人電話", type: "tel", maxLength: 30 },
  { key: "contactPhone", label: "聯絡電話", type: "tel", maxLength: 30 },
];

export const EMPTY_STUDENT_PERSONAL_INFO: StudentPersonalInfoFields = {
  gender: "",
  nationalId: "",
  birthday: "",
  householdPostalCode: "",
  householdAddress: "",
  mailingPostalCode: "",
  mailingAddress: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  contactPhone: "",
};

export interface StudentPersonalInfoSettings {
  enabled: boolean;
  startDate: string;
  endDate: string;
  target: StudentPersonalInfoTarget;
}

export type StudentPersonalInfoTargetMode = "all" | "grades" | "classes";

export interface StudentPersonalInfoTarget {
  mode: StudentPersonalInfoTargetMode;
  /** 名冊 grade 欄位儲存的年級編號字串，例如 "1" */
  grades: string[];
  /** 名冊 classCode 欄位儲存的班級代碼 */
  classes: string[];
}

export interface StudentPersonalInfoTargetOptions {
  grades: {
    value: string;
    label: string;
    classes: { value: string; label: string }[];
  }[];
}

export const DEFAULT_STUDENT_PERSONAL_INFO_TARGET: StudentPersonalInfoTarget = {
  mode: "all",
  grades: [],
  classes: [],
};

export const DEFAULT_STUDENT_PERSONAL_INFO_SETTINGS: StudentPersonalInfoSettings = {
  enabled: false,
  startDate: "",
  endDate: "",
  target: { ...DEFAULT_STUDENT_PERSONAL_INFO_TARGET },
};

export function personalInfoSettingsDocId(period: SchoolPeriod): string {
  return `personalInfo_${period.academicYear}_${period.semester}`;
}

export function studentPersonalInfoDocId(uid: string, period: SchoolPeriod): string {
  return `${uid}_${period.academicYear}_${period.semester}`;
}

export function readStudentPersonalInfoSettings(raw: unknown): StudentPersonalInfoSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STUDENT_PERSONAL_INFO_SETTINGS };
  const data = raw as Record<string, unknown>;
  const hasStoredTarget = Object.prototype.hasOwnProperty.call(data, "target");
  const targetData = data.target && typeof data.target === "object"
    ? (data.target as Record<string, unknown>)
    : null;
  const mode = targetData?.mode === "grades" || targetData?.mode === "classes"
    ? targetData.mode
    : targetData?.mode === "all" || !hasStoredTarget
      ? "all"
      : "classes";
  const readList = (value: unknown, maxLength: number): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, maxLength)
      : [];
  const target: StudentPersonalInfoTarget = {
    mode,
    grades: mode === "grades" ? readList(targetData?.grades, 24) : [],
    classes: mode === "classes" ? readList(targetData?.classes, 300) : [],
  };
  const rawStartDate = typeof data.startDate === "string" ? data.startDate : "";
  const rawEndDate = typeof data.endDate === "string" ? data.endDate : "";
  const startDate = normalizePersonalInfoDateTime(rawStartDate, "start");
  const endDate = normalizePersonalInfoDateTime(rawEndDate, "end");
  return {
    enabled:
      data.enabled === true &&
      Boolean(startDate) &&
      Boolean(endDate) &&
      endDate >= startDate &&
      (target.mode === "all" ||
        (target.mode === "grades" && target.grades.length > 0) ||
        (target.mode === "classes" && target.classes.length > 0)),
    startDate,
    endDate,
    target,
  };
}

export function isStudentPersonalInfoTargetEligible(
  target: StudentPersonalInfoTarget,
  grade: unknown,
  classCode: unknown
): boolean {
  if (target.mode === "all") return true;
  const studentGrade = typeof grade === "string" || typeof grade === "number" ? String(grade) : "";
  const studentClass = typeof classCode === "string" ? classCode : "";
  if (target.mode === "grades") return target.grades.includes(studentGrade);
  return target.classes.includes(studentClass);
}

export function readStudentPersonalInfoFields(raw: unknown): StudentPersonalInfoFields {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STUDENT_PERSONAL_INFO };
  const data = raw as Record<string, unknown>;
  const fields = (data.fields && typeof data.fields === "object"
    ? data.fields
    : data) as Record<string, unknown>;
  const result = { ...EMPTY_STUDENT_PERSONAL_INFO };
  for (const { key, maxLength } of STUDENT_PERSONAL_INFO_FIELD_DEFS) {
    result[key] = typeof fields[key] === "string" ? fields[key].slice(0, maxLength) : "";
  }
  return result;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isIsoDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  if (!isIsoDate(value.slice(0, 10))) return false;
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/** 舊設定只有日期：起始日轉為 00:00，結束日轉為 23:59，避免縮短原開放期間。 */
export function normalizePersonalInfoDateTime(
  value: string,
  edge: "start" | "end"
): string {
  if (isIsoDateTime(value)) return value;
  if (isIsoDate(value)) return `${value}T${edge === "start" ? "00:00" : "23:59"}`;
  return "";
}
