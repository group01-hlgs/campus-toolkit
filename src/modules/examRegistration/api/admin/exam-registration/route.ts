import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/audit";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import {
  ExamRegistrationError,
  buildExamRegistrationCsvForEvent,
  createExamEvent,
  countAdminExamEvents,
  deleteExamEvent,
  getExamEventRoster,
  listAdminExamEvents,
  unarchiveExamRegistration,
  updateExamEvent,
  updateExamRegistrationReview,
} from "../../../lib/exam-registration";
import { isExamReviewStatus } from "../../../types/exam-registration";

const noStore = { "Cache-Control": "no-store" };

/** 主程式的 serverErrorMessage 等價小工具（模組不得依賴非公開面檔案） */
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ExamRegistrationError) return error.message;
  if (process.env.NODE_ENV !== "production" && error instanceof Error) return error.message;
  return fallback;
}

/** GET：場次清單；`?eventId=` 時改回該場次名單與統計；`?summary=count` 僅回傳總筆數 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "exam-registration-admin",
      RATE.EXAM_REGISTRATION_ADMIN.limit,
      RATE.EXAM_REGISTRATION_ADMIN.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireAdminModule("examRegistration");
    if (denial) return toAuthResponse(denial);

    const eventId = request.nextUrl.searchParams.get("eventId");
    if (eventId) {
      if (request.nextUrl.searchParams.get("format") === "csv") {
        const csv = await buildExamRegistrationCsvForEvent(eventId);
        if (!csv) {
          return NextResponse.json({ success: false, message: "找不到報名場次" }, { status: 404, headers: noStore });
        }
        return new NextResponse(csv.content, {
          headers: {
            ...noStore,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(csv.filename)}`,
          },
        });
      }
      const roster = await getExamEventRoster(eventId);
      if (!roster) {
        return NextResponse.json({ success: false, message: "找不到報名場次" }, { status: 404, headers: noStore });
      }
      return NextResponse.json({ success: true, roster }, { headers: noStore });
    }

    if (request.nextUrl.searchParams.get("summary") === "count") {
      const total = await countAdminExamEvents();
      return NextResponse.json({ success: true, total }, { headers: noStore });
    }

    const { events, epoch } = await listAdminExamEvents();
    return NextResponse.json({ success: true, events, epoch, total: events.length }, { headers: noStore });
  } catch (error) {
    console.error("Admin exam registration GET error:", error);
    return NextResponse.json(
      { success: false, message: errorMessage(error, "系統錯誤") },
      { status: error instanceof ExamRegistrationError ? error.status : 500, headers: noStore }
    );
  }
}

/** POST：建立場次 */
export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "exam-registration-admin",
      RATE.EXAM_REGISTRATION_ADMIN.limit,
      RATE.EXAM_REGISTRATION_ADMIN.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("examRegistration");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400, headers: noStore });
    }

    const actor = {
      uid: session.uid,
      name: session.displayName || session.account,
      role: "admin" as const,
    };
    const { events, epoch } = await createExamEvent(body, actor, getClientIp(request));
    return NextResponse.json(
      { success: true, message: "場次已建立", events, epoch },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Admin exam registration POST error:", error);
    return NextResponse.json(
      { success: false, message: errorMessage(error, "系統錯誤") },
      { status: error instanceof ExamRegistrationError ? error.status : 500, headers: noStore }
    );
  }
}

/** PATCH：編輯場次與狀態轉換（`{ id, ...patch }`） */
export async function PATCH(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "exam-registration-admin",
      RATE.EXAM_REGISTRATION_ADMIN.limit,
      RATE.EXAM_REGISTRATION_ADMIN.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("examRegistration");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = body && typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ success: false, message: "缺少場次 id" }, { status: 400, headers: noStore });
    }

    const actor = {
      uid: session.uid,
      name: session.displayName || session.account,
      role: "admin" as const,
    };
    // 解除封存分支：`{ id, registrationId, unarchive: true }`（學生可重新修改）
    const registrationId = body && typeof body.registrationId === "string" ? body.registrationId : "";
    if (registrationId && body?.unarchive === true) {
      const { registration } = await unarchiveExamRegistration({
        eventId: id,
        registrationId,
        actor,
        ip: getClientIp(request),
      });
      return NextResponse.json(
        { success: true, message: "已解除封存，學生可重新修改", registration },
        { headers: noStore }
      );
    }
    // 審核分支：`{ id, registrationId, reviewStatus }`（僅 examMode=review 場次）
    if (registrationId) {
      const reviewStatus = body && isExamReviewStatus(body.reviewStatus) ? body.reviewStatus : null;
      if (!reviewStatus) {
        return NextResponse.json({ success: false, message: "審核結果無效" }, { status: 400, headers: noStore });
      }
      const { registration } = await updateExamRegistrationReview({
        eventId: id,
        registrationId,
        reviewStatus,
        actor,
        ip: getClientIp(request),
      });
      return NextResponse.json(
        { success: true, message: "審核結果已更新", registration },
        { headers: noStore }
      );
    }
    const { events, epoch } = await updateExamEvent(id, body, actor, getClientIp(request));
    return NextResponse.json(
      { success: true, message: "場次已更新", events, epoch },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Admin exam registration PATCH error:", error);
    return NextResponse.json(
      { success: false, message: errorMessage(error, "系統錯誤") },
      { status: error instanceof ExamRegistrationError ? error.status : 500, headers: noStore }
    );
  }
}

/** DELETE：硬刪除場次（`?id=`；連同該場次全部登錄名單一併刪除） */
export async function DELETE(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "exam-registration-admin",
      RATE.EXAM_REGISTRATION_ADMIN.limit,
      RATE.EXAM_REGISTRATION_ADMIN.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("examRegistration");
    if (denial) return toAuthResponse(denial);

    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, message: "缺少場次 id" }, { status: 400, headers: noStore });
    }

    const actor = {
      uid: session.uid,
      name: session.displayName || session.account,
      role: "admin" as const,
    };
    const { events, epoch } = await deleteExamEvent(id, actor, getClientIp(request));
    return NextResponse.json(
      { success: true, message: "場次已刪除", events, epoch },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Admin exam registration DELETE error:", error);
    return NextResponse.json(
      { success: false, message: errorMessage(error, "系統錯誤") },
      { status: error instanceof ExamRegistrationError ? error.status : 500, headers: noStore }
    );
  }
}
