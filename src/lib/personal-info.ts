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

export function isStudentPersonalInfoOpen(
  settings: StudentPersonalInfoSettings,
  today = taipeiDateString()
): boolean {
  return (
    settings.enabled &&
    Boolean(settings.startDate) &&
    Boolean(settings.endDate) &&
    today >= settings.startDate &&
    today <= settings.endDate
  );
}

export function studentPersonalInfoAvailabilityMessage(
  settings: StudentPersonalInfoSettings,
  today = taipeiDateString()
): string {
  if (!settings.enabled) return "本學期個人資料填寫尚未開放。";
  if (!settings.startDate || !settings.endDate) return "管理員尚未設定完整的填寫起訖日期。";
  if (today < settings.startDate) return `填寫期間將於 ${settings.startDate} 開放。`;
  if (today > settings.endDate) return `填寫期限已於 ${settings.endDate} 結束。`;
  return `開放填寫至 ${settings.endDate}（含當日）。`;
}
