import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { getClientIp, logActivity } from "@/lib/audit";
import { requireRole, toAuthResponse, type VerifiedSession } from "@/lib/dal";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getCurrentPeriod } from "@/lib/settings-server";
import { serverErrorMessage } from "@/lib/api-error";
import { getPostalCodeOptions } from "@/lib/postal-codes";
import {
  getStudentPersonalInfoEntries,
  getStudentPersonalInfoSettings,
  isStudentPersonalInfoOpen,
  saveStudentPersonalInfo,
  studentPersonalInfoAvailabilityMessage,
  taipeiDateTimeString,
  taipeiDateString,
} from "@/lib/personal-info";
import {
  EMPTY_STUDENT_PERSONAL_INFO,
  EMPTY_STUDENT_PERSONAL_INFO_PHOTOS,
  isIsoDate,
  isStudentPersonalInfoTargetEligible,
  STUDENT_PERSONAL_INFO_FIELD_DEFS,
  type StudentPersonalInfoFields,
} from "@/types/personal-info";

const noStore = { "Cache-Control": "no-store" };

function validateStudentFields(raw: unknown): StudentPersonalInfoFields | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const fields = {} as StudentPersonalInfoFields;
  for (const definition of STUDENT_PERSONAL_INFO_FIELD_DEFS) {
    const rawValue = input[definition.key];
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (value.length > definition.maxLength) return null;
    fields[definition.key] = value;
  }
  if (
    fields.gender &&
    !STUDENT_PERSONAL_INFO_FIELD_DEFS.find((field) => field.key === "gender")?.options?.includes(fields.gender)
  ) {
    return null;
  }
  if (fields.birthday && (!isIsoDate(fields.birthday) || fields.birthday > taipeiDateString())) {
    return null;
  }
  for (const postalCode of [fields.householdPostalCode, fields.mailingPostalCode]) {
    if (postalCode && !/^\d{3,6}$/.test(postalCode)) return null;
  }
  return fields;
}

/** 讀取學生本人本學期個人資料與填寫期間。 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "student-personal-info-get",
      RATE.ACCOUNT_GET.limit,
      RATE.ACCOUNT_GET.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("student");
    if (denial) return toAuthResponse(denial);

    const period = await getCurrentPeriod();
    const [settings, personalInfoEntries, postalCodeOptions] = await Promise.all([
      getStudentPersonalInfoSettings(period),
      getStudentPersonalInfoEntries(session.uid),
      getPostalCodeOptions(),
    ]);
    const currentEntry = personalInfoEntries.find(
      (entry) => entry.academicYear === period.academicYear && entry.semester === period.semester
    );
    const entries = [
      currentEntry ?? {
        academicYear: period.academicYear,
        semester: period.semester,
        fields: { ...EMPTY_STUDENT_PERSONAL_INFO },
        photos: { ...EMPTY_STUDENT_PERSONAL_INFO_PHOTOS },
      },
      ...personalInfoEntries.filter(
        (entry) => entry.academicYear !== period.academicYear || entry.semester !== period.semester
      ),
    ];
    const rosterEntry = (session as VerifiedSession).__entry;
    const currentDateTime = taipeiDateTimeString();
    const targetEligible = isStudentPersonalInfoTargetEligible(
      settings.target,
      rosterEntry?.grade,
      rosterEntry?.classCode
    );
    const canEdit = isStudentPersonalInfoOpen(settings, currentDateTime) && targetEligible;
    const photoPermissions = {
      admission: canEdit && settings.allowAdmissionPhotoReplacement,
      graduation: canEdit && settings.allowGraduationPhotoUpload,
    };
    const availabilityMessage = !isStudentPersonalInfoOpen(settings, currentDateTime)
      ? studentPersonalInfoAvailabilityMessage(settings, currentDateTime)
      : !targetEligible
        ? "本次開放填寫對象不包含你的年級或班級。"
        : studentPersonalInfoAvailabilityMessage(settings, currentDateTime);
    return NextResponse.json(
      {
        success: true,
        period,
        settings,
        entries: entries.map((entry) => ({
          academicYear: entry.academicYear,
          semester: entry.semester,
          fields: entry.fields,
          photos: {
            admission: entry.photos.admission
              ? { updatedAt: entry.photos.admission.updatedAt }
              : null,
            graduation: entry.photos.graduation
              ? { updatedAt: entry.photos.graduation.updatedAt }
              : null,
          },
        })),
        photoPermissions,
        postalCodeOptions,
        canEdit,
        targetEligible,
        currentDateTime,
        message: availabilityMessage,
      },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Get student personal info error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "讀取個人資料失敗") },
      { status: 500, headers: noStore }
    );
  }
}

/** 學生僅能在目前學期的開放期間編輯自己的資料。 */
export async function PUT(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "student-personal-info-save",
      RATE.ACCOUNT_UPDATE.limit,
      RATE.ACCOUNT_UPDATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("student");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || JSON.stringify(body).length > 10_000) {
      return NextResponse.json(
        { success: false, message: "個人資料內容無效或過大" },
        { status: 400, headers: noStore }
      );
    }
    const fields = validateStudentFields(body.fields);
    if (!fields) {
      return NextResponse.json(
        { success: false, message: "請檢查資料格式、郵遞區號與欄位長度" },
        { status: 400, headers: noStore }
      );
    }

    const period = await getCurrentPeriod();
    const settings = await getStudentPersonalInfoSettings(period);
    if (!isStudentPersonalInfoOpen(settings)) {
      return NextResponse.json(
        {
          success: false,
          message: studentPersonalInfoAvailabilityMessage(settings),
        },
        { status: 403, headers: noStore }
      );
    }
    const rosterEntry = (session as VerifiedSession).__entry;
    if (!isStudentPersonalInfoTargetEligible(settings.target, rosterEntry?.grade, rosterEntry?.classCode)) {
      return NextResponse.json(
        { success: false, message: "本次開放填寫對象不包含你的年級或班級" },
        { status: 403, headers: noStore }
      );
    }

    await saveStudentPersonalInfo(session.uid, period, fields);
    await logActivity({
      userId: session.uid,
      role: "student",
      action: "student_personal_info_updated",
      ip: getClientIp(request),
      details: `更新 ${period.academicYear} 學年度第 ${period.semester} 學期個人基本資料`,
    });

    return NextResponse.json(
      { success: true, message: "個人資料已儲存", fields },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Save student personal info error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "儲存個人資料失敗") },
      { status: 500, headers: noStore }
    );
  }
}
