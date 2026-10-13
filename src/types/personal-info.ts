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
}

export const DEFAULT_STUDENT_PERSONAL_INFO_SETTINGS: StudentPersonalInfoSettings = {
  enabled: false,
  startDate: "",
  endDate: "",
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
  const rawStartDate = typeof data.startDate === "string" ? data.startDate : "";
  const rawEndDate = typeof data.endDate === "string" ? data.endDate : "";
  const startDate = isIsoDate(rawStartDate) ? rawStartDate : "";
  const endDate = isIsoDate(rawEndDate) ? rawEndDate : "";
  return {
    enabled:
      data.enabled === true &&
      Boolean(startDate) &&
      Boolean(endDate) &&
      endDate >= startDate,
    startDate,
    endDate,
  };
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
