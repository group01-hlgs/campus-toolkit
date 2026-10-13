import {
  isStudentPersonalPhotoStorage,
  type SchoolPeriod,
  type StudentPersonalPhotoStorage,
} from "@/types/settings";

export const PERSONAL_INFO_COLLECTION = "studentPersonalInfo";
export const STUDENT_PERSONAL_IDENTITY_COLLECTION = "studentPersonalIdentity";
/** 證件照獨立文件（Firestore 後端）：照片本體存這裡，避免主文件變肥 */
export const STUDENT_PERSONAL_PHOTO_COLLECTION = "studentPersonalPhoto";
/**
 * 可接受的「原始檔」上限：學生可能直接選照相館原檔（2 MB 以上很常見），
 * 瀏覽器會先縮圖再送出，這裡只是擋掉明顯不合理的巨檔。
 */
export const STUDENT_PERSONAL_PHOTO_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
/** 縮圖後的實存上限：Firestore 單一文件上限為 1 MiB，預留空間取 900 KB */
export const STUDENT_PERSONAL_PHOTO_STORED_MAX_BYTES = 900 * 1024;
/** Firebase Storage 後端的實存上限 */
export const STUDENT_PERSONAL_PHOTO_STORAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Firestore 後端的指標前綴，其後接原本的 object path */
export const STUDENT_PERSONAL_PHOTO_FIRESTORE_PREFIX = "firestore:";

export type StudentPersonalPhotoKind = "admission" | "graduation";

export function isStudentPersonalPhotoKind(value: unknown): value is StudentPersonalPhotoKind {
  return value === "admission" || value === "graduation";
}

export interface StudentPersonalPhotoMetadata {
  /** 不透明指標：Firebase Storage 物件路徑，或 `firestore:` 開頭的 Firestore 指標 */
  objectPath: string;
  /** 這張照片實際存在哪個後端；舊資料沒這欄位，一律視為 Firebase Storage */
  backend: StudentPersonalPhotoStorage;
  contentType: "image/jpeg";
  updatedAt: number;
}

export interface StudentPersonalInfoRecord {
  fields: StudentPersonalInfoFields;
  /** 照片本體存於 Firestore 或 Firebase Storage，此處僅保存伺服端指標與 metadata */
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

export interface StudentPersonalIdTypeOption {
  value: string;
  label: string;
}

/** 證件類型：國民身分證（有戶籍國民）或居留證（外來人口統一證號）。 */
export const STUDENT_PERSONAL_ID_TYPE_OPTIONS: readonly StudentPersonalIdTypeOption[] = [
  { value: "national", label: "國民身分證" },
  { value: "resident", label: "居留證" },
];

export const STUDENT_PERSONAL_GENDER_OPTIONS: readonly StudentPersonalIdTypeOption[] = [
  { value: "男", label: "男" },
  { value: "女", label: "女" },
];

export function studentPersonalIdTypeLabel(value: string): string {
  return STUDENT_PERSONAL_ID_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "";
}

/**
 * 國民身分證統一編號／外來人口統一證號的首碼英文字母對照值
 * （內政部戶政司配賦表；I、O 為後來升格縣市專用碼）。
 */
const STUDENT_ID_LETTER_VALUES: Record<string, number> = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19,
  L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29,
  W: 32, X: 30, Y: 31, Z: 33,
};

/** 檢查碼權數：首碼展開為兩位數後共 11 碼，依序乘上 1、9、8、7、6、5、4、3、2、1、1。 */
const STUDENT_ID_WEIGHTS = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];

function studentIdChecksumValid(id: string): boolean {
  const letterValue = STUDENT_ID_LETTER_VALUES[id[0]];
  if (letterValue === undefined) return false;
  const digits = [
    Math.trunc(letterValue / 10),
    letterValue % 10,
    ...id.slice(1).split("").map(Number),
  ];
  return digits.reduce((sum, digit, index) => sum + digit * STUDENT_ID_WEIGHTS[index], 0) % 10 === 0;
}

export interface StudentPersonalIdValidation {
  ok: boolean;
  message: string;
}

/**
 * 依證件類型驗證編號：
 * - 國民身分證：1 碼英文＋9 碼數字，第 2 碼性別碼 1（男）／2（女），第 10 碼為檢查碼。
 * - 居留證（新式外來人口統一證號，110-01-02 起）：同格式，第 2 碼性別碼 8（男）／9（女），
 *   檢查碼規則同國民身分證。
 */
export function validateStudentPersonalId(idType: string, raw: string): StudentPersonalIdValidation {
  const typeLabel = studentPersonalIdTypeLabel(idType);
  if (!typeLabel) {
    return { ok: false, message: "請選擇證件類型（國民身分證或居留證）。" };
  }
  const id = raw.trim().toUpperCase();
  if (!id) {
    return { ok: false, message: `請輸入${typeLabel}編號。` };
  }
  if (!/^[A-Z][0-9]{9}$/.test(id)) {
    return { ok: false, message: `${typeLabel}編號為 1 碼大寫英文字母加上 9 碼數字，請重新輸入。` };
  }
  const genderCode = id[1];
  if (idType === "national" && genderCode !== "1" && genderCode !== "2") {
    return { ok: false, message: "國民身分證第 2 碼為性別碼，須為 1（男）或 2（女）。" };
  }
  if (idType === "resident" && genderCode !== "8" && genderCode !== "9") {
    return { ok: false, message: "居留證第 2 碼為性別碼，須為 8（男）或 9（女）。" };
  }
  if (!studentIdChecksumValid(id)) {
    return { ok: false, message: `${typeLabel}編號檢查碼不符，請確認是否輸入正確。` };
  }
  return { ok: true, message: "" };
}

export interface StudentPersonalIdentityFields {
  gender: string;
  birthday: string;
  /** 必填：studentPersonalIdTypeLabel() 的 value，空值表示尚未擇一。 */
  idType: string;
  nationalId: string;
}

export interface StudentPersonalInfoTermFields {
  householdPostalCode: string;
  householdAddress: string;
  mailingPostalCode: string;
  mailingAddress: string;
  contactPhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
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
  options?: readonly StudentPersonalIdTypeOption[];
  /** 選單存值為代碼時，唯讀檢視用來顯示名稱 */
  display?: (value: string) => string;
}

export const STUDENT_PERSONAL_INFO_FIELD_DEFS: StudentPersonalInfoFieldDefinition[] = [
  {
    key: "gender",
    label: "性別",
    type: "select",
    maxLength: 10,
    options: STUDENT_PERSONAL_GENDER_OPTIONS,
  },
  { key: "birthday", label: "生日", type: "date", maxLength: 10 },
  {
    key: "idType",
    label: "證件類型",
    type: "select",
    maxLength: 10,
    options: STUDENT_PERSONAL_ID_TYPE_OPTIONS,
    display: studentPersonalIdTypeLabel,
  },
  { key: "nationalId", label: "身分證統一編號", type: "text", maxLength: 10 },
  { key: "householdPostalCode", label: "戶籍郵區", type: "text", maxLength: 6 },
  { key: "householdAddress", label: "戶籍地址", type: "textarea", maxLength: 200 },
  { key: "mailingPostalCode", label: "通訊郵區", type: "text", maxLength: 6 },
  { key: "mailingAddress", label: "通訊地址", type: "textarea", maxLength: 200 },
  { key: "contactPhone", label: "聯絡電話", type: "tel", maxLength: 30 },
  { key: "emergencyContactName", label: "緊急聯絡人（姓名）", type: "text", maxLength: 40 },
  { key: "emergencyContactPhone", label: "緊急聯絡人電話", type: "tel", maxLength: 30 },
];

export const STUDENT_PERSONAL_IDENTITY_KEYS = [
  "gender",
  "birthday",
  "idType",
  "nationalId",
] as const satisfies readonly (keyof StudentPersonalIdentityFields)[];

export const STUDENT_PERSONAL_IDENTITY_FIELD_DEFS = STUDENT_PERSONAL_INFO_FIELD_DEFS.filter(
  ({ key }) => (STUDENT_PERSONAL_IDENTITY_KEYS as readonly string[]).includes(key)
) as StudentPersonalInfoFieldDefinition<keyof StudentPersonalIdentityFields>[];
export const STUDENT_PERSONAL_INFO_TERM_FIELD_DEFS = STUDENT_PERSONAL_INFO_FIELD_DEFS.filter(
  ({ key }) => !(STUDENT_PERSONAL_IDENTITY_KEYS as readonly string[]).includes(key)
) as StudentPersonalInfoFieldDefinition<keyof StudentPersonalInfoTermFields>[];

export const EMPTY_STUDENT_PERSONAL_IDENTITY: StudentPersonalIdentityFields = {
  gender: "",
  birthday: "",
  idType: "",
  nationalId: "",
};

export const EMPTY_STUDENT_PERSONAL_INFO_TERM: StudentPersonalInfoTermFields = {
  householdPostalCode: "",
  householdAddress: "",
  mailingPostalCode: "",
  mailingAddress: "",
  contactPhone: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
};

export const EMPTY_STUDENT_PERSONAL_INFO: StudentPersonalInfoFields = {
  gender: "",
  birthday: "",
  idType: "",
  nationalId: "",
  householdPostalCode: "",
  householdAddress: "",
  mailingPostalCode: "",
  mailingAddress: "",
  contactPhone: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
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
    birthday: typeof source.birthday === "string" ? source.birthday.slice(0, 10) : "",
    idType: typeof source.idType === "string" ? source.idType.slice(0, 10) : "",
    nationalId: typeof source.nationalId === "string" ? source.nationalId.slice(0, 10) : "",
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
  return {
    objectPath,
    // 舊資料沒有 backend 欄位：那時只有 Firebase Storage 一種存法
    backend: isStudentPersonalPhotoStorage(data.backend) ? data.backend : "firebase-storage",
    contentType,
    updatedAt,
  };
}

/** 判斷指標是否屬於指定前綴（Firestore 後端的指標會多一層 `firestore:` 前綴）。 */
export function personalPhotoPointerMatches(objectPath: string, prefix: string): boolean {
  return (
    objectPath.startsWith(prefix) ||
    objectPath.startsWith(`${STUDENT_PERSONAL_PHOTO_FIRESTORE_PREFIX}${prefix}`)
  );
}

/** 取出指標的 storage 物件路徑；Firestore 後端會剝掉 `firestore:` 前綴。 */
export function personalPhotoStorageObjectPath(objectPath: string): string {
  return objectPath.startsWith(STUDENT_PERSONAL_PHOTO_FIRESTORE_PREFIX)
    ? objectPath.slice(STUDENT_PERSONAL_PHOTO_FIRESTORE_PREFIX.length)
    : objectPath;
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
