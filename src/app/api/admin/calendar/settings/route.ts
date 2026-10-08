import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { serverErrorMessage } from "@/lib/api-error";
import { getCalendarSettings, saveCalendarSettings } from "@/lib/calendar";
import type { CalendarCategory } from "@/types/calendar";

const noStore = { "Cache-Control": "no-store" };

/** GET：讀取行事曆模組設定 */
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
    return NextResponse.json({ success: true, settings }, { headers: noStore });
  } catch (error) {
    console.error("Get calendar settings error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}

/** PUT：儲存行事曆模組設定（分類、個人提醒開關） */
export async function PUT(request: NextRequest) {
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

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const categories = Array.isArray(body.categories)
      ? (body.categories as unknown[]).map((item) => {
          const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return {
            id: typeof row.id === "string" ? row.id : "",
            name: typeof row.name === "string" ? row.name : "",
            sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : 0,
            enabled: row.enabled !== false,
          } satisfies CalendarCategory;
        })
      : undefined;

    const settings = await saveCalendarSettings({
      categories,
      defaultRemindersEnabled:
        typeof body.defaultRemindersEnabled === "boolean"
          ? body.defaultRemindersEnabled
          : undefined,
    });

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "calendar_settings_updated",
      ip: getClientIp(request),
      details: `更新行事曆模組設定（分類 ${settings.categories.length} 筆，個人提醒 ${
        settings.defaultRemindersEnabled ? "啟用" : "停用"
      }）`,
    });

    return NextResponse.json(
      { success: true, message: "行事曆設定已儲存", settings },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Save calendar settings error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
