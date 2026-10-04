import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { SETTINGS_COLLECTION } from "@/lib/settings-server";
import {
  CLASSES_DOC_ID,
  readSchoolClasses,
  totalClassCount,
  validateSchoolClasses,
} from "@/types/school-classes";

const CLASSES_DOC = { collection: SETTINGS_COLLECTION, id: CLASSES_DOC_ID };
const MAX_BODY = 100_000;
const noStore = { "Cache-Control": "no-store" };

/**
 * 年段班級設定（學校基本設定 schoolSettings 的子功能）。
 * 守門用 requireAdminModule("schoolSettings")：adminModulesOf 對非超級一律剝除該模組，
 * 因此等同「僅超級管理員」，與頁面層的判斷保持同一把尺。
 */

/** GET：讀回年段班級設定（結構性資料，不按學期） */
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

    const snap = await getAdminDb()
      .collection(CLASSES_DOC.collection)
      .doc(CLASSES_DOC.id)
      .get();
    const setting = readSchoolClasses(snap.exists ? snap.data() : null);
    return NextResponse.json({ success: true, setting }, { headers: noStore });
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
    const checked = validateSchoolClasses(body.setting);
    if (!checked.ok) {
      return NextResponse.json({ success: false, message: checked.message }, { status: 400 });
    }
    const setting = checked.value;

    await getAdminDb()
      .collection(CLASSES_DOC.collection)
      .doc(CLASSES_DOC.id)
      .set({
        segments: setting.segments.map((segment) => ({
          id: segment.id,
          name: segment.name,
          stage: segment.stage,
          grades: segment.grades.map((grade) => ({
            grade: grade.grade,
            classes: grade.classes.map((item) => ({
              id: item.id,
              code: item.code,
              name: item.name,
            })),
          })),
        })),
      });

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "school_classes_updated",
      ip: getClientIp(request),
      details: `年段班級設定已更新（${setting.segments.length} 個年段、${totalClassCount(setting)} 個班級）`,
    });

    return NextResponse.json({ success: true, message: "年段班級設定已儲存", setting });
  } catch (error) {
    console.error("School classes PUT error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
