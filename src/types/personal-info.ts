import type { SchoolPeriod } from "@/types/settings";

export const PERSONAL_INFO_COLLECTION = "studentPersonalInfo";
export const STUDENT_PERSONAL_IDENTITY_COLLECTION = "studentPersonalIdentity";
export const STUDENT_PERSONAL_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type StudentPersonalPhotoKind = "admission" | "graduation";

export function isStudentPersonalPhotoKind(value: unknown): value is StudentPersonalPhotoKind {
  return value === "admission" || value === "graduation";
}

export interface StudentPersonalPhotoMetadata {
  objectPath: string;
  contentType: "image/jpeg";
  updatedAt: number;
}

export interface StudentPersonalInfoRecord {
  fields: StudentPersonalInfoFields;
  /** 照片本體存於私人 Firebase Storage bucket，僅保存伺服端 object path 與 metadata */
  photos: Record<StudentPersonalPhotoKind, StudentPersonalPhotoMetadata | null>;
}

export interface StudentPersonalInfoEntry {
  academicYear: number;
  semester: number;
  fields: StudentPersonalInfoTermFields;
  photos: Record<StudentPersonalPhotoKind, StudentPersonalPhotoMetadata | null>;
  /** 舊期文件遷移到獨立身分文件前的欄位，僅伺服器端用來補資料 */
  legacyIdentity: StudentPersonalIdentityFields;
}

export interface StudentPersonalIdentityFields {
  gender: string;
  nationalId: string;
  birthday: string;
}

export interface StudentPersonalInfoTermFields {
  householdPostalCode: string;
  householdAddress: string;
  mailingPostalCode: string;
  mailingAddress: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  contactPhone: string;
}

export interface StudentPersonalInfoFields
  extends StudentPersonalIdentityFields, StudentPersonalInfoTermFields {}

export type StudentPersonalInfoFieldKey = keyof StudentPersonalInfoFields;

export interface StudentPersonalInfoFieldDefinition<
  K extends StudentPersonalInfoFieldKey = StudentPersonalInfoFieldKey
> {
  key: K;
  label: string;
  type: "text" | "date" | "tel" | "select" | "textarea";
  maxLength: number;
  options?: readonly string[];
}

export const STUDENT_PERSONAL_INFO_FIELD_DEFS: StudentPersonalInfoFieldDefinition[] = [
  { key: "gender", label: "性別", type: "select", maxLength: 10, options: ["男", "女", "其他", "不提供"] },
  { key: "nationalId", label: "身分證", type: "text", maxLength: 20 },
  { key: "birthday", label: "生日", type: "date", maxLength: 10 },
  { key: "householdPostalCode", label: "戶籍郵區", type: "text", maxLength: 6 },
  { key: "householdAddress", label: "戶籍地址", type: "textarea", maxLength: 200 },
  { key: "mailingPostalCode", label: "通訊郵區", type: "text", maxLength: 6 },
  { key: "mailingAddress", label: "通訊地址", type: "textarea", maxLength: 200 },
  { key: "contactPhone", label: "聯絡電話", type: "tel", maxLength: 30 },
  { key: "emergencyContactName", label: "緊急聯絡人（姓名）", type: "text", maxLength: 40 },
  { key: "emergencyContactPhone", label: "緊急聯絡人電話", type: "tel", maxLength: 30 },
];

export const STUDENT_PERSONAL_IDENTITY_FIELD_DEFS = STUDENT_PERSONAL_INFO_FIELD_DEFS.filter(
  ({ key }) => key === "gender" || key === "nationalId" || key === "birthday"
) as StudentPersonalInfoFieldDefinition<keyof StudentPersonalIdentityFields>[];
export const STUDENT_PERSONAL_INFO_TERM_FIELD_DEFS = STUDENT_PERSONAL_INFO_FIELD_DEFS.filter(
  ({ key }) => key !== "gender" && key !== "nationalId" && key !== "birthday"
) as StudentPersonalInfoFieldDefinition<keyof StudentPersonalInfoTermFields>[];

export const EMPTY_STUDENT_PERSONAL_IDENTITY: StudentPersonalIdentityFields = {
  gender: "",
  nationalId: "",
  birthday: "",
};

export const EMPTY_STUDENT_PERSONAL_INFO_TERM: StudentPersonalInfoTermFields = {
  householdPostalCode: "",
  householdAddress: "",
  mailingPostalCode: "",
  mailingAddress: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  contactPhone: "",
};

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

export const EMPTY_STUDENT_PERSONAL_INFO_PHOTOS: StudentPersonalInfoRecord["photos"] = {
  admission: null,
  graduation: null,
};

export interface StudentPersonalInfoSettings {
  enabled: boolean;
  startDate: string;
  endDate: string;
  target: StudentPersonalInfoTarget;
  allowAdmissionPhotoReplacement: boolean;
  allowGraduationPhotoUpload: boolean;
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
  allowAdmissionPhotoReplacement: false,
  allowGraduationPhotoUpload: false,
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
    allowAdmissionPhotoReplacement: data.allowAdmissionPhotoReplacement === true,
    allowGraduationPhotoUpload: data.allowGraduationPhotoUpload === true,
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

export function readStudentPersonalIdentityFields(raw: unknown): StudentPersonalIdentityFields {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STUDENT_PERSONAL_IDENTITY };
  const data = raw as Record<string, unknown>;
  const source = (data.fields && typeof data.fields === "object"
    ? data.fields
    : data) as Record<string, unknown>;
  return {
    gender: typeof source.gender === "string" ? source.gender.slice(0, 10) : "",
    nationalId: typeof source.nationalId === "string" ? source.nationalId.slice(0, 20) : "",
    birthday: typeof source.birthday === "string" ? source.birthday.slice(0, 10) : "",
  };
}

export function readStudentPersonalInfoTermFields(raw: unknown): StudentPersonalInfoTermFields {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STUDENT_PERSONAL_INFO_TERM };
  const data = raw as Record<string, unknown>;
  const source = (data.fields && typeof data.fields === "object"
    ? data.fields
    : data) as Record<string, unknown>;
  const result = { ...EMPTY_STUDENT_PERSONAL_INFO_TERM };
  for (const { key, maxLength } of STUDENT_PERSONAL_INFO_TERM_FIELD_DEFS) {
    result[key as keyof StudentPersonalInfoTermFields] =
      typeof source[key] === "string" ? source[key].slice(0, maxLength) : "";
  }
  return result;
}

export function readStudentPersonalPhotoMetadata(raw: unknown): StudentPersonalPhotoMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const objectPath = typeof data.objectPath === "string" ? data.objectPath : "";
  const contentType = data.contentType;
  const updatedAt = data.updatedAt;
  if (
    !objectPath ||
    contentType !== "image/jpeg" ||
    typeof updatedAt !== "number" ||
    !Number.isFinite(updatedAt)
  ) {
    return null;
  }
  return { objectPath, contentType, updatedAt };
}

export function readStudentPersonalInfoRecord(raw: unknown): StudentPersonalInfoRecord {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const photos = data.photos && typeof data.photos === "object"
    ? (data.photos as Record<string, unknown>)
    : {};
  return {
    fields: readStudentPersonalInfoFields(raw),
    photos: {
      admission: readStudentPersonalPhotoMetadata(photos.admission),
      graduation: readStudentPersonalPhotoMetadata(photos.graduation),
    },
  };
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
