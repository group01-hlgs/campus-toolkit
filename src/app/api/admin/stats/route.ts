import { NextRequest, NextResponse } from "next/server";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { serverErrorMessage } from "@/lib/api-error";
import { getAppHostingUsage } from "@/lib/usage-apphosting";
import { getFirebaseUsage } from "@/lib/usage-firebase";
import { getReadStatsSnapshot, resetReadStats } from "@/lib/read-stats";
import type { StatsResponse } from "@/types/usage";

/**
 * 統計儀表板：App Hosting（Cloud Run／Cloud Build）與 Firebase（Firestore）用量，
 * 以及端點級讀取統計（read-stats，本實例進程內累計、不寫 Firestore）。
 *
 * 權限：`stats` 是 superOnly 權限模組（`adminModulesOf` 只會把它給超級管理員），
 * 因此 `requireAdminModule("stats")` 即等同僅超級管理員可讀。
 * 兩個外部來源各自抓取、互不阻斷（一個失敗仍回另一個），結果於伺服器端快取 5 分鐘。
 *
 * POST：`{ action: "reset-read-stats" }` 清空本實例的端點讀取統計（開發除錯用）。
 */
export async function GET(request: NextRequest) {
  try {
    const { denial } = await requireAdminModule("stats");
    if (denial) return toAuthResponse(denial);

    const limited = enforceRateLimit(
      request,
      "admin-stats-usage",
      RATE.ADMIN_USAGE_GET.limit,
      RATE.ADMIN_USAGE_GET.windowMs
    );
    if (limited) return limited;

    const [appHosting, firebase] = await Promise.all([getAppHostingUsage(), getFirebaseUsage()]);

    const body: StatsResponse = {
      success: true,
      appHosting,
      firebase,
      readStats: getReadStatsSnapshot(),
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Stats usage error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const { denial } = await requireAdminModule("stats");
    if (denial) return toAuthResponse(denial);

    const limited = enforceRateLimit(
      request,
      "admin-stats-usage",
      RATE.ADMIN_USAGE_GET.limit,
      RATE.ADMIN_USAGE_GET.windowMs
    );
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || (body as { action?: unknown }).action !== "reset-read-stats") {
      return NextResponse.json({ success: false, message: "無效的操作" }, { status: 400 });
    }
    resetReadStats();
    return NextResponse.json(
      { success: true, message: "已重設本實例讀取統計", readStats: getReadStatsSnapshot() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Stats read-stats reset error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
