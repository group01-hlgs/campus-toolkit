import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { requireRole, toAuthResponse, type VerifiedSession } from "@/lib/dal";
import { requireFeatureModuleEnabled } from "@/lib/module-gate";
import { getSettings } from "../../../lib/self-directed-learning";
import {
  getLatestReview,
  getMyPlan,
  saveStudentPlan,
  type StudentIdentityLite,
} from "../../../lib/self-directed-learning-plans";
import { openStateOf, parsePlanDraft } from "../../../types/self-directed-learning";

const noStore = { "Cache-Control": "no-store" };

/** 主程式的 serverErrorMessage 等價小工具（模組不得依賴非公開面檔案） */
function errorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV !== "production" && error instanceof Error) return error.message;
  return fallback;
}

/** 由名冊條目（`session.__entry`）組出學生身分；缺班級資料＝非本校名冊學生 */
function studentIdentityOf(session: VerifiedSession): StudentIdentityLite | null {
  const entry = session.__entry;
  const grade = entry && typeof entry.grade === "string" ? entry.grade : "";
  if (!grade) return null;
  const classCode = entry && typeof entry.classCode === "string" ? entry.classCode : "";
  const name =
    entry && typeof entry.name === "string" && entry.name
      ? entry.name
      : session.displayName || session.account;
  const className = entry && typeof entry.className === "string" ? entry.className : "";
  return { uid: session.uid, name, grade, classCode, className };
}

/** GET：設定＋我的計畫＋最新審查意見＋期間狀態 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "self-directed-learning-list",
      RATE.SELF_DIRECTED_LEARNING_LIST.limit,
      RATE.SELF_DIRECTED_LEARNING_LIST.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("student");
    if (denial) return toAuthResponse(denial);

    const gate = await requireFeatureModuleEnabled("selfDirectedLearning", session);
    if (gate) return gate;

    const student = studentIdentityOf(session as VerifiedSession);
    if (!student) {
      return NextResponse.json(
        { success: false, message: "查無名冊身分資料，無法使用本功能" },
        { status: 403, headers: noStore }
      );
    }

    const settings = await getSettings();
    const plan = await getMyPlan(student.uid);
    const latestReview = plan ? await getLatestReview(plan.id) : null;
    return NextResponse.json(
      {
        success: true,
        settings,
        plan,
        latestReview,
        withinWindow: openStateOf(settings) === "open",
      },
      { headers: noStore }
    );
  } catch (error) {
    console.error("selfDirectedLearning student GET error:", error);
    return NextResponse.json(
      { success: false, message: errorMessage(error, "讀取資料失敗") },
      { status: 500, headers: noStore }
    );
  }
}

/** POST：`{ action: "save" | "submit", draft }` 儲存草稿或送出審核 */
export async function POST(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "self-directed-learning-student",
      RATE.SELF_DIRECTED_LEARNING_STUDENT.limit,
      RATE.SELF_DIRECTED_LEARNING_STUDENT.windowMs
    );
    if (limited) return limited;
    if (!(await assertSameOrigin(request))) {
      return NextResponse.json(
        { success: false, message: "跨來源請求已被拒絕" },
        { status: 403, headers: noStore }
      );
    }

    const { session, denial } = await requireRole("student");
    if (denial) return toAuthResponse(denial);

    const gate = await requireFeatureModuleEnabled("selfDirectedLearning", session);
    if (gate) return gate;

    const student = studentIdentityOf(session as VerifiedSession);
    if (!student) {
      return NextResponse.json(
        { success: false, message: "查無名冊身分資料，無法使用本功能" },
        { status: 403, headers: noStore }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      action?: string;
      draft?: unknown;
    } | null;
    const action = body?.action === "submit" ? "submit" : "save";

    const settings = await getSettings();
    const parsed = parsePlanDraft(body?.draft, settings.maxWeeks);
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, message: parsed.message },
        { status: 400, headers: noStore }
      );
    }

    const result = await saveStudentPlan({ student, draft: parsed.value, action, settings });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: result.status, headers: noStore }
      );
    }

    if (action === "submit") {
      await logActivity({
        userId: student.uid,
        role: session.role,
        action: "self_directed_learning_plan_submitted",
        ip: getClientIp(request),
        details: `送出自主學習計畫：${result.plan.topic}`,
      });
    }

    return NextResponse.json(
      { success: true, plan: result.plan },
      { headers: noStore }
    );
  } catch (error) {
    console.error("selfDirectedLearning student POST error:", error);
    return NextResponse.json(
      { success: false, message: errorMessage(error, "儲存計畫失敗") },
      { status: 500, headers: noStore }
    );
  }
}
