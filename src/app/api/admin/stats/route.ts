import { NextRequest, NextResponse } from "next/server";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { serverErrorMessage } from "@/lib/api-error";
import { getVercelUsage } from "@/lib/usage-vercel";
import { getFirebaseUsage } from "@/lib/usage-firebase";
import type { StatsResponse } from "@/types/usage";

/**
 * 統計儀表板：Vercel 與 Firebase（Firestore）用量。
 *
 * 權限：`stats` 是 superOnly 權限模組（`adminModulesOf` 只會把它給超級管理員），
 * 因此 `requireAdminModule("stats")` 即等同僅超級管理員可讀。
 * 兩個來源各自抓取、互不阻斷（一個失敗仍回另一個），結果於伺服器端快取 5 分鐘。
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

    const [vercel, firebase] = await Promise.all([getVercelUsage(), getFirebaseUsage()]);

    const body: StatsResponse = { success: true, vercel, firebase };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Stats usage error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
