import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { getClientIp, logActivity } from "@/lib/audit";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { requireRole, toAuthResponse, type VerifiedSession } from "@/lib/dal";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getCurrentPeriod } from "@/lib/settings-server";
import { serverErrorMessage } from "@/lib/api-error";
import {
  getStudentPersonalInfo,
  getStudentPersonalInfoSettings,
  isStudentPersonalInfoOpen,
  saveStudentPersonalPhoto,
  studentPersonalInfoPhotoObjectPathPrefix,
  taipeiDateTimeString,
} from "@/lib/personal-info";
import {
  isStudentPersonalInfoTargetEligible,
  isStudentPersonalPhotoKind,
  STUDENT_PERSONAL_PHOTO_MAX_BYTES,
} from "@/types/personal-info";

const privateNoStore = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function detectImageContentType(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes.subarray(1, 4).toString("ascii") === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** 照片只透過登入後的同源 API 提供，不建立公開 Storage URL。 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "student-personal-photo-get",
      RATE.ACCOUNT_GET.limit,
      RATE.ACCOUNT_GET.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("student");
    if (denial) return toAuthResponse(denial);

    const kind = request.nextUrl.searchParams.get("kind");
    if (!isStudentPersonalPhotoKind(kind)) {
      return NextResponse.json({ success: false, message: "證件照類型無效" }, { status: 400, headers: privateNoStore });
    }

    const period = await getCurrentPeriod();
    const record = await getStudentPersonalInfo(session.uid, period);
    const photo = record.photos[kind];
    if (
      !photo ||
      !photo.objectPath.startsWith(studentPersonalInfoPhotoObjectPathPrefix(session.uid, period, kind))
    ) {
      return NextResponse.json({ success: false, message: "尚未上傳證件照" }, { status: 404, headers: privateNoStore });
    }

    const file = getAdminStorageBucket().file(photo.objectPath);
    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json({ success: false, message: "證件照檔案不存在" }, { status: 404, headers: privateNoStore });
    }
    const [contents] = await file.download();
    return new NextResponse(new Uint8Array(contents), {
      headers: {
        ...privateNoStore,
        "Content-Type": photo.contentType,
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    console.error("Student personal photo GET error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "讀取證件照失敗") },
      { status: 500, headers: privateNoStore }
    );
  }
}

/** 上傳／更換學生本人證件照，檔案存入此 fork 設定的 Firebase Storage 私有 bucket。 */
export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "student-personal-photo-upload",
      RATE.ACCOUNT_UPDATE.limit,
      RATE.ACCOUNT_UPDATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("student");
    if (denial) return toAuthResponse(denial);

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > STUDENT_PERSONAL_PHOTO_MAX_BYTES + 128_000) {
      return NextResponse.json(
        { success: false, message: "照片不可超過 5 MB" },
        { status: 413, headers: privateNoStore }
      );
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ success: false, message: "上傳內容無效" }, { status: 400, headers: privateNoStore });
    }
    const kind = formData.get("kind");
    const file = formData.get("file");
    if (!isStudentPersonalPhotoKind(kind) || !(file instanceof File)) {
      return NextResponse.json({ success: false, message: "請選擇證件照檔案" }, { status: 400, headers: privateNoStore });
    }
    if (file.size <= 0 || file.size > STUDENT_PERSONAL_PHOTO_MAX_BYTES) {
      return NextResponse.json({ success: false, message: "照片不可為空，且檔案大小不可超過 5 MB" }, { status: 400, headers: privateNoStore });
    }

    const period = await getCurrentPeriod();
    const settings = await getStudentPersonalInfoSettings(period);
    const rosterEntry = (session as VerifiedSession).__entry;
    const canEdit =
      isStudentPersonalInfoOpen(settings) &&
      isStudentPersonalInfoTargetEligible(settings.target, rosterEntry?.grade, rosterEntry?.classCode);
    const photoRuleEnabled =
      kind === "admission"
        ? settings.allowAdmissionPhotoReplacement
        : settings.allowGraduationPhotoUpload;
    if (!canEdit || !photoRuleEnabled) {
      return NextResponse.json(
        { success: false, message: "目前未開放你上傳或更換此類證件照" },
        { status: 403, headers: privateNoStore }
      );
    }

    const contents = Buffer.from(await file.arrayBuffer());
    const contentType = detectImageContentType(contents);
    if (!contentType) {
      return NextResponse.json(
        { success: false, message: "照片格式僅接受 JPEG、PNG 或 WebP 圖片" },
        { status: 400, headers: privateNoStore }
      );
    }

    const photo = await saveStudentPersonalPhoto(session.uid, period, kind, contents, contentType);
    await logActivity({
      userId: session.uid,
      role: "student",
      action: "student_personal_photo_updated",
      ip: getClientIp(request),
      details: `上傳或更換 ${kind === "admission" ? "入學時" : "畢業"}證件照（${period.academicYear} 學年度第 ${period.semester} 學期）`,
    });
    return NextResponse.json(
      { success: true, message: "證件照已上傳", photo: { updatedAt: photo.updatedAt } },
      { headers: privateNoStore }
    );
  } catch (error) {
    console.error("Student personal photo upload error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "上傳證件照失敗") },
      { status: 500, headers: privateNoStore }
    );
  }
}
