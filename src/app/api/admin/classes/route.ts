import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { serverErrorMessage } from "@/lib/api-error";
import { SETTINGS_COLLECTION, getCurrentPeriod } from "@/lib/settings-server";
import { isActiveEntry, loadPeriodEntries } from "@/lib/roster";
import { CLASSES_DOC_ID, readSchoolClasses } from "@/types/school-classes";
import { PROFILE_DOC_ID, readSchoolProfile } from "@/types/school-profile";

const noStore = { "Cache-Control": "no-store" };

/** 名冊條目的字串欄位（缺值或非字串一律視為空字串） */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 班級學生名單排序：座號（數字升冪、空白排最後）→ 姓名 → 學號 */
function compareStudents(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const seatA = str(a.seatNo).trim();
  const seatB = str(b.seatNo).trim();
  if (seatA !== seatB) {
    if (!seatA) return 1;
    if (!seatB) return -1;
    const numA = Number(seatA);
    const numB = Number(seatB);
    if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) return numA - numB;
    return seatA.localeCompare(seatB, "zh-Hant", { numeric: true });
  }
  return (
    str(a.name).localeCompare(str(b.name), "zh-Hant") ||
    str(a.studentId).localeCompare(str(b.studentId), "zh-Hant", { numeric: true })
  );
}

/**
 * 班級管理（classes 模組）總覽：當期各年級的班級清單＋每班學生人數（唯讀）。
 * 班級結構存 `settings/schoolClasses`（維護入口在學校基本設定 → 年段班級設定），
 * 學生人數＝當期 `rosterStudents` 有效條目依 `classCode` 分組計數。
 * 另帶 `?classCode=…` 時回單一班級資料與該班當期有效學生名單（班級學生名單子頁用）。
 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "classes",
      RATE.CLASSES_GET.limit,
      RATE.CLASSES_GET.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireAdminModule("classes");
    if (denial) return toAuthResponse(denial);

    const db = getAdminDb();
    const period = await getCurrentPeriod();
    const [classesSnap, profileSnap, students] = await Promise.all([
      db.collection(SETTINGS_COLLECTION).doc(CLASSES_DOC_ID).get(),
      db.collection(SETTINGS_COLLECTION).doc(PROFILE_DOC_ID).get(),
      loadPeriodEntries(period, "student"),
    ]);

    const profile = readSchoolProfile(profileSnap.exists ? profileSnap.data() : null);
    const context = {
      stages: profile.stages.map((item) => ({ stage: item.stage, years: item.years })),
    };
    const setting = readSchoolClasses(classesSnap.exists ? classesSnap.data() : null, context);

    // 單一班級模式（?classCode=…）：回該班資料＋當期有效學生名單，不需組總覽
    const classCodeParam = request.nextUrl.searchParams.get("classCode");
    if (classCodeParam !== null) {
      const code = classCodeParam.trim();
      const grade = code
        ? setting.grades.find((row) => row.classes.some((item) => item.code === code))
        : undefined;
      const item = grade?.classes.find((row) => row.code === code) ?? null;
      if (!grade || !item) {
        return NextResponse.json(
          { success: false, message: "查無此班級" },
          { status: 404, headers: noStore }
        );
      }

      const list = [...students.values()]
        .filter((entry) => isActiveEntry(entry) && str(entry.classCode) === code)
        .sort(compareStudents);

      return NextResponse.json(
        {
          success: true,
          period,
          classInfo: {
            code: item.code,
            name: item.name,
            grade: grade.grade,
            gradeName: grade.name,
            group: item.group,
            department: item.department,
            studentCount: list.length,
          },
          students: list.map((entry) => ({
            uid: str(entry.uid),
            name: str(entry.name),
            studentId: str(entry.studentId),
            seatNo: str(entry.seatNo),
            rollNo: str(entry.rollNo),
            email: str(entry.email),
            account: str(entry.account),
          })),
        },
        { headers: noStore }
      );
    }

    // 班級代碼全集＋依代碼累加學生人數（僅計有效名冊條目）
    const classCodes = new Set<string>();
    for (const grade of setting.grades) {
      for (const item of grade.classes) classCodes.add(item.code);
    }
    const counts = new Map<string, number>();
    let studentCount = 0;
    let unassignedCount = 0;
    for (const entry of students.values()) {
      if (!isActiveEntry(entry)) continue;
      studentCount += 1;
      const code = typeof entry.classCode === "string" ? entry.classCode : "";
      if (code && classCodes.has(code)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      } else {
        unassignedCount += 1;
      }
    }

    const grades = setting.grades.map((grade) => ({
      grade: grade.grade,
      code: grade.code,
      name: grade.name,
      classes: grade.classes.map((item) => ({
        code: item.code,
        name: item.name,
        group: item.group,
        department: item.department,
        studentCount: counts.get(item.code) ?? 0,
      })),
    }));

    return NextResponse.json(
      {
        success: true,
        period,
        grades,
        summary: {
          gradeCount: setting.grades.length,
          classCount: classCodes.size,
          studentCount,
          unassignedCount,
        },
      },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Class management GET error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
