import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { toAuthResponse, verifySession } from "@/lib/dal";
import { getCalendarSettings, listSurfaceCalendarEvents } from "@/lib/calendar";
import { isCalendarSurface } from "@/types/calendar";

const noStore = { "Cache-Control": "no-store" };

function entryClassCode(entry: Record<string, unknown> | null | undefined): string {
  if (!entry) return "";
  return typeof entry.classCode === "string" ? entry.classCode : "";
}

/**
 * GET：顯示位置的行程（系統首頁登入表單上方／四種身分功能首頁）。
 * ?surface=login｜student｜parent｜staff｜admin
 *
 * 顯示方式統一：只回尚未結束的第 1 則行程。
 * `surface=login`（未登入也可讀）只回四種身分皆可見的行程；
 * 其餘位置須登入，依 session 身分過濾。
 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "calendar-surface",
      RATE.CALENDAR_SURFACE.limit,
      RATE.CALENDAR_SURFACE.windowMs
    );
    if (limited) return limited;

    const surface = request.nextUrl.searchParams.get("surface");
    if (!isCalendarSurface(surface)) {
      return NextResponse.json({ success: false, message: "未知的顯示位置" }, { status: 400 });
    }

    const session = await verifySession();
    if (!session && surface !== "login") {
      return toAuthResponse({ status: 401, message: "未登入或登入已失效" });
    }

    const settings = await getCalendarSettings();
    const setting = settings.surfaces[surface];
    if (!setting.enabled) {
      return NextResponse.json(
        { success: true, surface: setting, items: [] },
        { headers: noStore }
      );
    }

    const role = surface === "login" || !session ? null : session.role;
    const classCode = role && session ? entryClassCode(session.__entry) || null : null;
    const items = await listSurfaceCalendarEvents({ surface, role, classCode }, 1);
    return NextResponse.json(
      { success: true, surface: setting, items },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Calendar surface error:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
