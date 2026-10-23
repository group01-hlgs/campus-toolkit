import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { requireRole, toAuthResponse, type VerifiedSession } from "@/lib/dal";
import { requireFeatureModuleEnabled } from "@/lib/module-gate";
import { getSettings } from "../../../lib/self-directed-learning";
import {
  applyReview,
  listClassPlans,
  listSubmittedPlans,
} from "../../../lib/self-directed-learning-plans";
import { getCurrentPeriod } from "@/lib/settings-server";
import {
  MAINTENANCE_TITLE,
  parseReviewInput,
  periodLabelOf,
  type SelfDirectedLearningSettings,
} from "../../../types/self-directed-learning";

const noStore = { "Cache-Control": "no-store" };

/** 主程式的 serverErrorMessage 等價小工具（模組不得依賴非公開面檔案） */
function errorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV !== "production" && error instanceof Error) return error.message;
  return fallback;
}

interface StaffRoles {
  isReviewer: boolean;
  isTutor: boolean;
  classCode: string;
}

/** 審核資格＝管理端設定的名單；導師資格＝名冊條目 attribute 為兼導師且有班級代碼 */
async function staffRolesOf(
  session: VerifiedSession,
  settings: SelfDirectedLearningSettings
): Promise<StaffRoles> {
  const isReviewer = settings.reviewers.some((reviewer) => reviewer.uid === session.uid);
  const entry = session.__entry;
  const attribute = entry && typeof entry.attribute === "string" ? entry.attribute.trim() : "";
  const classCode = entry && typeof entry.classCode === "string" ? entry.classCode.trim() : "";
  return { isReviewer, isTutor: attribute === "兼導師" && Boolean(classCode), classCode };
}

/** GET：`?mode=review`（審核佇列，需審核資格）／`?mode=class`（全班，需兼導師） */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "self-directed-learning-staff",
      RATE.SELF_DIRECTED_LEARNING_STAFF.limit,
      RATE.SELF_DIRECTED_LEARNING_STAFF.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("staff");
    if (denial) return toAuthResponse(denial);

    const gate = await requireFeatureModuleEnabled("selfDirectedLearning", session);
    if (gate) return gate;

    const settings = await getSettings();
    const roles = await staffRolesOf(session as VerifiedSession, settings);
    const mode = request.nextUrl.searchParams.get("mode") === "class" ? "class" : "review";
    const period = periodLabelOf(await getCurrentPeriod());

    // 總開關關閉：非管理端只回維護旗標（計畫清單不回傳）
    if (!settings.enabled) {
      return NextResponse.json(
        { success: true, maintenance: true, mode, roles, period, plans: [] },
        { headers: noStore }
      );
    }

    if (mode === "class") {
      if (!roles.isTutor) {
        return NextResponse.json(
          { success: false, message: "此功能僅提供給有班級代碼的兼導師。" },
          { status: 403, headers: noStore }
        );
      }
      const plans = await listClassPlans(period, roles.classCode);
      return NextResponse.json(
        { success: true, mode, roles, period, plans },
        { headers: noStore }
      );
    }

    if (!roles.isReviewer) {
      return NextResponse.json(
        { success: false, message: "你不在本模組的審核人員名單內。" },
        { status: 403, headers: noStore }
      );
    }
    const plans = await listSubmittedPlans(period);
    return NextResponse.json(
      { success: true, mode, roles, period, plans },
      { headers: noStore }
    );
  } catch (error) {
    console.error("selfDirectedLearning staff GET error:", error);
    return NextResponse.json(
      { success: false, message: errorMessage(error, "讀取資料失敗") },
      { status: 500, headers: noStore }
    );
  }
}

/** POST：`{ action: "approve" | "return", planId, note }`（需審核資格） */
export async function POST(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "self-directed-learning-staff-mutate",
      RATE.SELF_DIRECTED_LEARNING_STAFF.limit,
      RATE.SELF_DIRECTED_LEARNING_STAFF.windowMs
    );
    if (limited) return limited;
    if (!(await assertSameOrigin(request))) {
      return NextResponse.json(
        { success: false, message: "跨來源請求已被拒絕" },
        { status: 403, headers: noStore }
      );
    }

    const { session, denial } = await requireRole("staff");
    if (denial) return toAuthResponse(denial);

    const gate = await requireFeatureModuleEnabled("selfDirectedLearning", session);
    if (gate) return gate;

    const settings = await getSettings();
    if (!settings.enabled) {
      return NextResponse.json(
        { success: false, message: MAINTENANCE_TITLE },
        { status: 403, headers: noStore }
      );
    }

    const roles = await staffRolesOf(session as VerifiedSession, settings);
    if (!roles.isReviewer) {
      return NextResponse.json(
        { success: false, message: "你不在本模組的審核人員名單內。" },
        { status: 403, headers: noStore }
      );
    }

    const parsed = parseReviewInput(await request.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, message: parsed.message },
        { status: 400, headers: noStore }
      );
    }

    const reviewerName = session.displayName || session.account;
    const result = await applyReview({
      planId: parsed.value.planId,
      action: parsed.value.action,
      note: parsed.value.note,
      reviewerUid: session.uid,
      reviewerName,
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: result.status, headers: noStore }
      );
    }

    await logActivity({
      userId: session.uid,
      role: session.role,
      action: "self_directed_learning_plan_reviewed",
      ip: getClientIp(request),
      details: `${parsed.value.action === "approve" ? "通過" : "退回"}自主學習計畫：${result.plan.topic}`,
    });

    return NextResponse.json({ success: true, plan: result.plan }, { headers: noStore });
  } catch (error) {
    console.error("selfDirectedLearning staff POST error:", error);
    return NextResponse.json(
      { success: false, message: errorMessage(error, "審核處理失敗") },
      { status: 500, headers: noStore }
    );
  }
}
