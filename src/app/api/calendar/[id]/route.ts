import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { toAuthResponse, verifySession } from "@/lib/dal";
import { serverErrorMessage } from "@/lib/api-error";
import { getReadableCalendarEvent } from "@/lib/calendar";
import { calendarEventToItem } from "@/types/calendar";

const noStore = { "Cache-Control": "no-store" };

function entryClassCode(entry: Record<string, unknown> | null | undefined): string {
  if (!entry) return "";
  return typeof entry.classCode === "string" ? entry.classCode : "";
}

type Params = { params: Promise<{ id: string }> };

/** GET：單則行程內容（受眾與班級判定同列表） */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const limited = enforceRateLimit(
      request,
      "calendar-list",
      RATE.CALENDAR_LIST.limit,
      RATE.CALENDAR_LIST.windowMs
    );
    if (limited) return limited;

    const session = await verifySession();
    if (!session) return toAuthResponse({ status: 401, message: "未登入或登入已失效" });

    const { id } = await params;
    if (!id || id.length > 64) {
      return NextResponse.json({ success: false, message: "查無此行程" }, { status: 404 });
    }

    const classCode = entryClassCode(session.__entry);
    const found = await getReadableCalendarEvent(id, session.role, classCode || null);
    if (!found) {
      return NextResponse.json({ success: false, message: "查無此行程" }, { status: 404 });
    }

    return NextResponse.json(
      { success: true, event: calendarEventToItem(found.record, found.categoryName) },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Get calendar event error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
