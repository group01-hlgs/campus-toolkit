import "server-only";
import { getAdminDb, getAdminStorageBucket } from "@/lib/firebase-admin";
import { cachedSettingDoc, invalidateReadCache } from "@/lib/read-cache";
import { SETTINGS_COLLECTION } from "@/lib/settings-server";
import { CLASSES_DOC_ID, readSchoolClasses, type SchoolClassesContext } from "@/types/school-classes";
import { PROFILE_DOC_ID, readSchoolProfile } from "@/types/school-profile";
import {
  DEFAULT_STUDENT_PERSONAL_INFO_SETTINGS,
  EMPTY_STUDENT_PERSONAL_INFO,
  EMPTY_STUDENT_PERSONAL_INFO_PHOTOS,
  PERSONAL_INFO_COLLECTION,
  personalInfoSettingsDocId,
  readStudentPersonalInfoRecord,
  readStudentPersonalInfoSettings,
  studentPersonalInfoDocId,
  type StudentPersonalInfoFields,
  type StudentPersonalInfoSettings,
  type StudentPersonalInfoRecord,
  type StudentPersonalPhotoKind,
  type StudentPersonalPhotoMetadata,
  type StudentPersonalInfoTargetOptions,
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
    return { ...DEFAULT_STUDENT_PERSONAL_INFO_SETTINGS };
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

export async function getStudentPersonalInfoTargetOptions(): Promise<StudentPersonalInfoTargetOptions> {
  try {
    const db = getAdminDb();
    const [classesSnap, profileSnap] = await Promise.all([
      cachedSettingDoc(CLASSES_DOC_ID, () =>
        db.collection(SETTINGS_COLLECTION).doc(CLASSES_DOC_ID).get()
      ),
      cachedSettingDoc(PROFILE_DOC_ID, () =>
        db.collection(SETTINGS_COLLECTION).doc(PROFILE_DOC_ID).get()
      ),
    ]);
    const profile = readSchoolProfile(profileSnap.exists ? profileSnap.data() : null);
    const context: SchoolClassesContext = {
      stages: profile.stages.map(({ stage, years }) => ({ stage, years })),
    };
    const schoolClasses = readSchoolClasses(
      classesSnap.exists ? classesSnap.data() : null,
      context
    );
    return {
      grades: schoolClasses.grades.map((grade) => ({
        value: String(grade.grade),
        label: grade.name,
        classes: grade.classes.map((classRow) => ({
          value: classRow.code,
          label: classRow.name,
        })),
      })),
    };
  } catch (error) {
    console.error("Student personal info target options read error:", error);
    return { grades: [] };
  }
}

export async function getStudentPersonalInfo(
  uid: string,
  period: SchoolPeriod
): Promise<StudentPersonalInfoRecord> {
  const snap = await getAdminDb()
    .collection(PERSONAL_INFO_COLLECTION)
    .doc(studentPersonalInfoDocId(uid, period))
    .get();
  return snap.exists
    ? readStudentPersonalInfoRecord(snap.data())
    : { fields: { ...EMPTY_STUDENT_PERSONAL_INFO }, photos: { ...EMPTY_STUDENT_PERSONAL_INFO_PHOTOS } };
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
    }, { merge: true });
}

export function studentPersonalInfoPhotoObjectPathPrefix(
  uid: string,
  period: SchoolPeriod,
  kind: StudentPersonalPhotoKind
): string {
  return `student-personal-info/${uid}/${period.academicYear}_${period.semester}/${kind}/`;
}

export async function saveStudentPersonalPhoto(
  uid: string,
  period: SchoolPeriod,
  kind: StudentPersonalPhotoKind,
  bytes: Buffer,
  contentType: StudentPersonalPhotoMetadata["contentType"]
): Promise<StudentPersonalPhotoMetadata> {
  const current = await getStudentPersonalInfo(uid, period);
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
  const objectPath = `${studentPersonalInfoPhotoObjectPathPrefix(uid, period, kind)}${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const metadata: StudentPersonalPhotoMetadata = { objectPath, contentType, updatedAt: Date.now() };
  const bucket = getAdminStorageBucket();
  await bucket.file(objectPath).save(bytes, {
    resumable: false,
    metadata: { contentType, cacheControl: "private, no-store" },
  });

  try {
    await getAdminDb()
      .collection(PERSONAL_INFO_COLLECTION)
      .doc(studentPersonalInfoDocId(uid, period))
      .set({
        uid,
        academicYear: period.academicYear,
        semester: period.semester,
        photos: { [kind]: metadata },
        updatedAt: metadata.updatedAt,
      }, { merge: true });
  } catch (error) {
    await bucket.file(objectPath).delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }

  const oldPath = current.photos[kind]?.objectPath;
  if (
    oldPath &&
    oldPath !== objectPath &&
    oldPath.startsWith(studentPersonalInfoPhotoObjectPathPrefix(uid, period, kind))
  ) {
    await bucket.file(oldPath).delete({ ignoreNotFound: true }).catch(() => {
      console.error("Unable to remove replaced personal photo from storage");
    });
  }
  return metadata;
}

export function personalPhotoObjectPathsForRecord(
  uid: string,
  period: SchoolPeriod,
  raw: unknown
): string[] {
  const record = readStudentPersonalInfoRecord(raw);
  const paths: string[] = [];
  for (const kind of Object.keys(record.photos) as StudentPersonalPhotoKind[]) {
    const objectPath = record.photos[kind]?.objectPath;
    if (objectPath?.startsWith(studentPersonalInfoPhotoObjectPathPrefix(uid, period, kind))) {
      paths.push(objectPath);
    }
  }
  return paths;
}

export async function deleteStudentPersonalPhotoObjects(objectPaths: string[]): Promise<void> {
  const safePaths = [...new Set(objectPaths)].filter((objectPath) =>
    objectPath.startsWith("student-personal-info/") && !objectPath.includes("..")
  );
  if (safePaths.length === 0) return;
  try {
    const bucket = getAdminStorageBucket();
    for (let offset = 0; offset < safePaths.length; offset += 100) {
      await Promise.all(
        safePaths.slice(offset, offset + 100).map((objectPath) =>
          bucket.file(objectPath).delete({ ignoreNotFound: true }).catch(() => {
            console.error("Unable to remove personal photo from storage");
          })
        )
      );
    }
  } catch {
    console.error("Unable to clean up personal photos from storage");
  }
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
  return `開放填寫至 ${end}。`;
}
