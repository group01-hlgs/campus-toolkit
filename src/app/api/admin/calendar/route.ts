import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { serverErrorMessage } from "@/lib/api-error";
import { getCurrentPeriod } from "@/lib/settings-server";
import {
  createCalendarEvent,
  getCalendarSettings,
  listAdminCalendarEvents,
  purgeDownCalendarEvents,
} from "@/lib/calendar";
import { parseCalendarAudience } from "@/types/calendar";

const noStore = { "Cache-Control": "no-store" };

/** GET：管理端行程清單（含已取消）＋模組設定 */
export async function GET(request: NextRequest) {
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

    const settings = await getCalendarSettings();
    // 下架原則＝真實刪除：清單載入時掃描已取消行程並刪除（含個人提醒）
    if (settings.policies.hardDeleteCancelled) {
      await purgeDownCalendarEvents();
    }
    const events = await listAdminCalendarEvents();
    return NextResponse.json({ success: true, events, settings }, { headers: noStore });
  } catch (error) {
    console.error("List calendar events error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}

/** POST：建立行程 */
export async function POST(request: NextRequest) {
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

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }
    const audience = parseCalendarAudience(body.audience);
    if (!audience) {
      return NextResponse.json(
        { success: false, message: "可見範圍無效（請至少選擇一個身分）" },
        { status: 400 }
      );
    }

    const period = await getCurrentPeriod();
    const { id } = await createCalendarEvent({
      sourceModule: "calendar",
      title: typeof body.title === "string" ? body.title : "",
      description: typeof body.description === "string" ? body.description : undefined,
      location: typeof body.location === "string" ? body.location : undefined,
      startAt: typeof body.startAt === "number" ? body.startAt : undefined,
      endAt: typeof body.endAt === "number" ? body.endAt : null,
      allDay: body.allDay === true,
      allDayDate: typeof body.allDayDate === "string" ? body.allDayDate : undefined,
      important: body.important === true,
      categoryId: typeof body.categoryId === "string" ? body.categoryId : undefined,
      publishUnit: typeof body.publishUnit === "string" ? body.publishUnit : undefined,
      audience,
      status: "active",
      createdBy: {
        uid: session.uid,
        name: session.displayName || session.account,
        role: "admin",
      },
    });

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "calendar_created",
      ip: getClientIp(request),
      details: `建立行程（id=${id}，可見身分=${audience.roles.join("、")}，學年 ${period.academicYear}-${period.semester}）`,
    });

    const [events, settings] = await Promise.all([
      listAdminCalendarEvents(),
      getCalendarSettings(),
    ]);
    return NextResponse.json(
      { success: true, message: "行程已建立", id, events, settings },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Create calendar event error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
