import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { serverErrorMessage } from "@/lib/api-error";
import { getAnnouncementSettings, saveAnnouncementSettings } from "@/lib/announcements";
import type {
  AnnouncementDisplayMethod,
  AnnouncementCategory,
} from "@/types/announcements";

const noStore = { "Cache-Control": "no-store" };

/** GET：讀取公告模組設定 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "announcements-admin",
      RATE.ANNOUNCEMENTS_ADMIN_GET.limit,
      RATE.ANNOUNCEMENTS_ADMIN_GET.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireAdminModule("announcements");
    if (denial) return toAuthResponse(denial);

    const settings = await getAnnouncementSettings();
    return NextResponse.json({ success: true, settings }, { headers: noStore });
  } catch (error) {
    console.error("Get announcement settings error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}

/** PUT：儲存公告模組設定（分類、顯示方式） */
export async function PUT(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "announcements-admin",
      RATE.ANNOUNCEMENTS_ADMIN_MUTATE.limit,
      RATE.ANNOUNCEMENTS_ADMIN_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("announcements");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const methodRaw = typeof body.displayMethod === "string" ? body.displayMethod : "";
    const displayMethod: AnnouncementDisplayMethod | undefined =
      methodRaw === "list" || methodRaw === "pinnedTop" || methodRaw === "banner"
        ? methodRaw
        : undefined;

    const categories = Array.isArray(body.categories)
      ? (body.categories as unknown[]).map((item) => {
          const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return {
            id: typeof row.id === "string" ? row.id : "",
            name: typeof row.name === "string" ? row.name : "",
            sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : 0,
            enabled: row.enabled !== false,
          } satisfies AnnouncementCategory;
        })
      : undefined;

    const settings = await saveAnnouncementSettings({
      categories,
      displayMethod,
      defaultRemindersEnabled:
        typeof body.defaultRemindersEnabled === "boolean"
          ? body.defaultRemindersEnabled
          : undefined,
    });

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "announcements_settings_updated",
      ip: getClientIp(request),
      details: `更新公告模組設定（顯示方式=${settings.displayMethod}，分類 ${settings.categories.length} 筆）`,
    });

    return NextResponse.json(
      { success: true, message: "公告設定已儲存", settings },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Save announcement settings error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
