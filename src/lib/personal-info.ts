import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { cachedSettingDoc, invalidateReadCache } from "@/lib/read-cache";
import { SETTINGS_COLLECTION } from "@/lib/settings-server";
import {
  EMPTY_STUDENT_PERSONAL_INFO,
  PERSONAL_INFO_COLLECTION,
  personalInfoSettingsDocId,
  readStudentPersonalInfoFields,
  readStudentPersonalInfoSettings,
  studentPersonalInfoDocId,
  type StudentPersonalInfoFields,
  type StudentPersonalInfoSettings,
} from "@/types/personal-info";
import type { SchoolPeriod } from "@/types/settings";

export async function getStudentPersonalInfoSettings(
  period: SchoolPeriod
): Promise<StudentPersonalInfoSettings> {
  const docId = personalInfoSettingsDocId(period);
  try {
    const raw = await cachedSettingDoc(docId, async () => {
      const snap = await getAdminDb().collection(SETTINGS_COLLECTION).doc(docId).get();
      return snap.exists ? snap.data() ?? null : null;
    });
    return readStudentPersonalInfoSettings(raw);
  } catch (error) {
    console.error("Student personal info settings read error:", error);
    return { enabled: false, startDate: "", endDate: "" };
  }
}

export async function saveStudentPersonalInfoSettings(
  period: SchoolPeriod,
  settings: StudentPersonalInfoSettings
): Promise<void> {
  const docId = personalInfoSettingsDocId(period);
  await getAdminDb().collection(SETTINGS_COLLECTION).doc(docId).set({
    ...settings,
    academicYear: period.academicYear,
    semester: period.semester,
    updatedAt: Date.now(),
  });
  invalidateReadCache(`setting-doc:${docId}`);
}

export async function getStudentPersonalInfo(
  uid: string,
  period: SchoolPeriod
): Promise<StudentPersonalInfoFields> {
  const snap = await getAdminDb()
    .collection(PERSONAL_INFO_COLLECTION)
    .doc(studentPersonalInfoDocId(uid, period))
    .get();
  return snap.exists ? readStudentPersonalInfoFields(snap.data()) : { ...EMPTY_STUDENT_PERSONAL_INFO };
}

export async function saveStudentPersonalInfo(
  uid: string,
  period: SchoolPeriod,
  fields: StudentPersonalInfoFields
): Promise<void> {
  await getAdminDb()
    .collection(PERSONAL_INFO_COLLECTION)
    .doc(studentPersonalInfoDocId(uid, period))
    .set({
      uid,
      academicYear: period.academicYear,
      semester: period.semester,
      fields,
      updatedAt: Date.now(),
    });
}

export function taipeiDateString(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function taipeiDateTimeString(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function isStudentPersonalInfoOpen(
  settings: StudentPersonalInfoSettings,
  now = taipeiDateTimeString()
): boolean {
  return (
    settings.enabled &&
    Boolean(settings.startDate) &&
    Boolean(settings.endDate) &&
    now >= settings.startDate &&
    now <= settings.endDate
  );
}

export function studentPersonalInfoAvailabilityMessage(
  settings: StudentPersonalInfoSettings,
  now = taipeiDateTimeString()
): string {
  if (!settings.enabled) return "本學期個人資料填寫尚未開放。";
  if (!settings.startDate || !settings.endDate) return "管理員尚未設定完整的填寫起訖日期。";
  const start = settings.startDate.replace("T", " ");
  const end = settings.endDate.replace("T", " ");
  if (now < settings.startDate) return `填寫期間將於 ${start} 開放。`;
  if (now > settings.endDate) return `填寫期限已於 ${end} 結束。`;
  return `開放填寫至 ${end}（含該分鐘）。`;
}
