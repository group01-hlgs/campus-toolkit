import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { getClientIp, logActivity } from "@/lib/audit";
import { requireRole, toAuthResponse } from "@/lib/dal";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getCurrentPeriod } from "@/lib/settings-server";
import { serverErrorMessage } from "@/lib/api-error";
import { getStudentPersonalInfoSettings, saveStudentPersonalInfoSettings } from "@/lib/personal-info";
import { isIsoDate } from "@/types/personal-info";

const noStore = { "Cache-Control": "no-store" };

/** 讀取目前學期學生個人資料填寫規則。 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "feature-modules",
      RATE.FEATURE_MODULES_GET.limit,
      RATE.FEATURE_MODULES_GET.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const period = await getCurrentPeriod();
    const settings = await getStudentPersonalInfoSettings(period);
    return NextResponse.json({ success: true, settings, period }, { headers: noStore });
  } catch (error) {
    console.error("Get student personal info settings error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "讀取管理規則失敗") },
      { status: 500, headers: noStore }
    );
  }
}

/** 儲存目前學期學生個人資料填寫規則。 */
export async function PUT(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "feature-modules",
      RATE.FEATURE_MODULES_MUTATE.limit,
      RATE.FEATURE_MODULES_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw || typeof raw.enabled !== "boolean") {
      return NextResponse.json(
        { success: false, message: "請提供有效的開放填寫狀態" },
        { status: 400, headers: noStore }
      );
    }

    const startDate = typeof raw.startDate === "string" ? raw.startDate.trim() : "";
    const endDate = typeof raw.endDate === "string" ? raw.endDate.trim() : "";
    if ((startDate && !isIsoDate(startDate)) || (endDate && !isIsoDate(endDate))) {
      return NextResponse.json(
        { success: false, message: "起訖日期格式無效" },
        { status: 400, headers: noStore }
      );
    }
    if (raw.enabled && (!startDate || !endDate)) {
      return NextResponse.json(
        { success: false, message: "開放填寫前，請先設定起始日期與結束日期" },
        { status: 400, headers: noStore }
      );
    }
    if (startDate && endDate && endDate < startDate) {
      return NextResponse.json(
        { success: false, message: "結束日期不可早於起始日期" },
        { status: 400, headers: noStore }
      );
    }

    const period = await getCurrentPeriod();
    const settings = { enabled: raw.enabled, startDate, endDate };
    await saveStudentPersonalInfoSettings(period, settings);
    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "personal_info_settings_updated",
      ip: getClientIp(request),
      details: `更新 ${period.academicYear} 學年度第 ${period.semester} 學期個人資料填寫規則（${settings.enabled ? "開放" : "關閉"}，${startDate || "未設定"} 至 ${endDate || "未設定"}）`,
    });

    return NextResponse.json(
      { success: true, message: "管理規則已儲存", settings, period },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Save student personal info settings error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "儲存管理規則失敗") },
      { status: 500, headers: noStore }
    );
  }
}
