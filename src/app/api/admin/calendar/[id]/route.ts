import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { serverErrorMessage } from "@/lib/api-error";
import {
  cancelCalendarEvent,
  getCalendarEvent,
  getCalendarSettings,
  listAdminCalendarEvents,
  updateCalendarEvent,
} from "@/lib/calendar";
import { parseCalendarAudience } from "@/types/calendar";

const noStore = { "Cache-Control": "no-store" };

type Params = { params: Promise<{ id: string }> };

/** GET：讀取單則行程（編輯用） */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const limited = enforceRateLimit(
      request,
      "calendar-admin",
      RATE.CALENDAR_ADMIN_GET.limit,
      RATE.CALENDAR_ADMIN_GET.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireAdminModule("calendar");
    if (denial) return toAuthResponse(denial);

    const { id } = await params;
    const event = await getCalendarEvent(id);
    if (!event) {
      return NextResponse.json({ success: false, message: "查無此行程" }, { status: 404 });
    }
    return NextResponse.json({ success: true, event }, { headers: noStore });
  } catch (error) {
    console.error("Get calendar event error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}

/** PATCH：更新行程（含 status=cancelled 取消） */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "calendar-admin",
      RATE.CALENDAR_ADMIN_MUTATE.limit,
      RATE.CALENDAR_ADMIN_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("calendar");
    if (denial) return toAuthResponse(denial);

    const { id } = await params;
    const existing = await getCalendarEvent(id);
    if (!existing) {
      return NextResponse.json({ success: false, message: "查無此行程" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const audience =
      body.audience !== undefined ? parseCalendarAudience(body.audience) : undefined;
    if (body.audience !== undefined && !audience) {
      return NextResponse.json(
        { success: false, message: "可見範圍無效（請至少選擇一個身分）" },
        { status: 400 }
      );
    }
    const status =
      body.status === "cancelled"
        ? ("cancelled" as const)
        : body.status === "active"
          ? ("active" as const)
          : undefined;

    await updateCalendarEvent(id, {
      sourceModule: existing.sourceModule,
      sourceRef: existing.sourceRef,
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      location: typeof body.location === "string" ? body.location : undefined,
      startAt: typeof body.startAt === "number" ? body.startAt : undefined,
      endAt:
        body.endAt === null ? null : typeof body.endAt === "number" ? body.endAt : undefined,
      allDay: typeof body.allDay === "boolean" ? body.allDay : undefined,
      allDayDate: typeof body.allDayDate === "string" ? body.allDayDate : undefined,
      important: typeof body.important === "boolean" ? body.important : undefined,
      categoryId: typeof body.categoryId === "string" ? body.categoryId : undefined,
      publishUnit:
        typeof body.publishUnit === "string" ? body.publishUnit : undefined,
      audience: audience ?? undefined,
      status,
    });

    const cancelled = status === "cancelled";
    await logActivity({
      userId: session.uid,
      role: "admin",
      action: cancelled ? "calendar_cancelled" : "calendar_updated",
      ip: getClientIp(request),
      details: `${cancelled ? "取消" : "更新"}行程 id=${id}`,
    });

    const [events, settings] = await Promise.all([
      listAdminCalendarEvents(),
      getCalendarSettings(),
    ]);
    return NextResponse.json(
      {
        success: true,
        message: cancelled ? "行程已取消" : "行程已更新",
        events,
        settings,
      },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Update calendar event error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}

/** POST：取消行程（快捷） */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "calendar-admin",
      RATE.CALENDAR_ADMIN_MUTATE.limit,
      RATE.CALENDAR_ADMIN_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("calendar");
    if (denial) return toAuthResponse(denial);

    const { id } = await params;
    const existing = await getCalendarEvent(id);
    if (!existing) {
      return NextResponse.json({ success: false, message: "查無此行程" }, { status: 404 });
    }
    await cancelCalendarEvent(id);

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "calendar_cancelled",
      ip: getClientIp(request),
      details: `取消行程 id=${id}`,
    });

    const [events, settings] = await Promise.all([
      listAdminCalendarEvents(),
      getCalendarSettings(),
    ]);
    return NextResponse.json(
      { success: true, message: "行程已取消", events, settings },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Cancel calendar event error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
