import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { SETTINGS_COLLECTION } from "@/lib/settings-server";
import { PROFILE_DOC_ID, readSchoolProfile } from "@/types/school-profile";
import {
  CLASSES_DOC_ID,
  SchoolClassesContext,
  readSchoolClasses,
  totalClassCount,
  totalGradeCount,
  validateSchoolClasses,
} from "@/types/school-classes";

const CLASSES_DOC = { collection: SETTINGS_COLLECTION, id: CLASSES_DOC_ID };
const PROFILE_DOC = { collection: SETTINGS_COLLECTION, id: PROFILE_DOC_ID };
const MAX_BODY = 100_000;
const noStore = { "Cache-Control": "no-store" };

/**
 * 年段班級設定（學校基本設定 schoolSettings 的子功能）。
 * 守門用 requireAdminModule("schoolSettings")：adminModulesOf 對非超級一律剝除該模組，
 * 因此等同「僅超級管理員」，與頁面層的判斷保持同一把尺。
 *
 * 驗證上限取自校務基本資料（學制與年制），故讀寫前都先取一次 context。
 */

/** 讀校務基本資料組成驗證上下文（學制是否勾選、年級編號範圍、年數總和） */
async function loadContext(): Promise<SchoolClassesContext> {
  const snap = await getAdminDb().collection(PROFILE_DOC.collection).doc(PROFILE_DOC.id).get();
  const profile = readSchoolProfile(snap.exists ? snap.data() : null);
  return { stages: profile.stages.map((item) => ({ stage: item.stage, years: item.years })) };
}

/** GET：讀回年段班級設定與校務基本資料的學制年制（結構性資料，不按學期） */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "school-classes",
      RATE.SCHOOL_CLASSES_GET.limit,
      RATE.SCHOOL_CLASSES_GET.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireAdminModule("schoolSettings");
    if (denial) return toAuthResponse(denial);

    const [snap, context] = await Promise.all([
      getAdminDb().collection(CLASSES_DOC.collection).doc(CLASSES_DOC.id).get(),
      loadContext(),
    ]);
    const setting = readSchoolClasses(snap.exists ? snap.data() : null, context);
    return NextResponse.json(
      { success: true, setting, stages: context.stages },
      { headers: noStore }
    );
  } catch (error) {
    console.error("School classes GET error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}

/** PUT：整份覆寫年段班級設定（驗證不過一律 400，不寫入） */
export async function PUT(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "school-classes",
      RATE.SCHOOL_CLASSES_MUTATE.limit,
      RATE.SCHOOL_CLASSES_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("schoolSettings");
    if (denial) return toAuthResponse(denial);

    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ success: false, message: "無效的設定內容" }, { status: 400 });
    }
    if (JSON.stringify(raw).length > MAX_BODY) {
      return NextResponse.json({ success: false, message: "設定過大" }, { status: 413 });
    }

    const body = raw as Record<string, unknown>;
    const context = await loadContext();
    const checked = validateSchoolClasses(body.setting, context);
    if (!checked.ok) {
      return NextResponse.json({ success: false, message: checked.message }, { status: 400 });
    }
    const setting = checked.value;

    await getAdminDb()
      .collection(CLASSES_DOC.collection)
      .doc(CLASSES_DOC.id)
      .set({
        nameStyle: setting.nameStyle,
        segments: setting.segments.map((segment) => ({
          id: segment.id,
          name: segment.name,
          stage: segment.stage,
          grades: segment.grades.map((grade) => ({
            id: grade.id,
            grade: grade.grade,
            code: grade.code,
            name: grade.name,
            classes: grade.classes.map((item) => ({
              id: item.id,
              code: item.code,
              name: item.name,
              group: item.group,
              department: item.department,
            })),
          })),
        })),
      });

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "school_classes_updated",
      ip: getClientIp(request),
      details: `年段班級設定已更新（${setting.segments.length} 個年段、${totalGradeCount(setting)} 個年級、${totalClassCount(setting)} 個班級）`,
    });

    return NextResponse.json({
      success: true,
      message: "年段班級設定已儲存",
      setting,
      stages: context.stages,
    });
  } catch (error) {
    console.error("School classes PUT error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
