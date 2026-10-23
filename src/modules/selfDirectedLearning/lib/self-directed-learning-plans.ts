import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { getCurrentPeriod } from "@/lib/settings-server";
import { isActiveEntry } from "@/lib/roster";
import { rosterCollection } from "@/types/roster";
import {
  SELF_DIRECTED_LEARNING_PLANS_COLLECTION,
  SELF_DIRECTED_LEARNING_REVIEWS_COLLECTION,
  periodLabelOf,
  planDocIdOf,
  type PlanReview,
  type SelfDirectedLearningPlan,
  type SelfDirectedLearningSettings,
} from "../types/self-directed-learning";

function plansRef() {
  return getAdminDb().collection(SELF_DIRECTED_LEARNING_PLANS_COLLECTION);
}

/** 學生視角儀表資料 */
export interface StudentDashboard {
  period: string;
  plan: SelfDirectedLearningPlan | null;
  latestReview: PlanReview | null;
  /** 現在是否在開放撰寫期間 */
  withinWindow: boolean;
}

function readPlan(id: string, raw: Record<string, unknown>): SelfDirectedLearningPlan {
  const str = (value: unknown, fallback = "") =>
    typeof value === "string" ? value : fallback;
  const weeks = Array.isArray(raw.weeks)
    ? raw.weeks
        .map((item): SelfDirectedLearningPlan["weeks"][number] | null => {
          if (!item || typeof item !== "object") return null;
          const week = item as Record<string, unknown>;
          const weekNo = typeof week.week === "number" ? week.week : NaN;
          if (!Number.isInteger(weekNo) || weekNo < 1) return null;
          const timing = week.timing === "afterSchool" ? "afterSchool" : "flexible";
          return {
            week: weekNo,
            content: str(week.content),
            venue: str(week.venue),
            timing,
          };
        })
        .filter((week): week is NonNullable<typeof week> => week !== null)
        .sort((a, b) => a.week - b.week)
    : [];
  const status =
    raw.status === "submitted" || raw.status === "approved" || raw.status === "returned"
      ? raw.status
      : "draft";
  return {
    id,
    period: str(raw.period),
    studentUid: str(raw.studentUid),
    studentName: str(raw.studentName),
    grade: str(raw.grade),
    classCode: str(raw.classCode),
    className: str(raw.className),
    topic: str(raw.topic),
    studyGroup: str(raw.studyGroup),
    advisor: str(raw.advisor),
    weeks,
    status,
    submittedAt: typeof raw.submittedAt === "number" ? raw.submittedAt : null,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

/** 讀當期學生計畫（精準點查，無快取需求） */
export async function getMyPlan(studentUid: string): Promise<SelfDirectedLearningPlan | null> {
  const period = periodLabelOf(await getCurrentPeriod());
  const id = planDocIdOf(period, studentUid);
  const snap = await plansRef().doc(id).get();
  if (!snap.exists) return null;
  return readPlan(id, (snap.data() || {}) as Record<string, unknown>);
}

/** 讀計畫的最新審查意見（where 精準條件＋本機排序，筆數有界） */
export async function getLatestReview(planId: string): Promise<PlanReview | null> {
  const snap = await getAdminDb()
    .collection(SELF_DIRECTED_LEARNING_REVIEWS_COLLECTION)
    .where("planId", "==", planId)
    .limit(20)
    .get();
  if (snap.empty) return null;
  const items = snap.docs.map((doc) => {
    const raw = (doc.data() || {}) as Record<string, unknown>;
    return {
      id: doc.id,
      planId: typeof raw.planId === "string" ? raw.planId : "",
      reviewerUid: typeof raw.reviewerUid === "string" ? raw.reviewerUid : "",
      reviewerName: typeof raw.reviewerName === "string" ? raw.reviewerName : "",
      decision: raw.decision === "returned" ? ("returned" as const) : ("approved" as const),
      note: typeof raw.note === "string" ? raw.note : "",
      reviewedAt: typeof raw.reviewedAt === "number" ? raw.reviewedAt : 0,
    };
  });
  items.sort((a, b) => b.reviewedAt - a.reviewedAt);
  return items[0] || null;
}

export interface StudentIdentityLite {
  uid: string;
  name: string;
  grade: string;
  classCode: string;
  className: string;
}

export type SaveAction = "save" | "submit";

export type SavePlanResult =
  | { ok: true; plan: SelfDirectedLearningPlan }
  | { ok: false; status: 400 | 409; message: string };

/**
 * 儲存草稿／送出審核。
 * save：任何時間可存（approved 鎖定不可改）；submit：僅開放期間內、狀態不得為 approved/submitted。
 */
export async function saveStudentPlan(input: {
  student: StudentIdentityLite;
  draft: {
    topic: string;
    studyGroup: string;
    advisor: string;
    weeks: SelfDirectedLearningPlan["weeks"];
  };
  action: SaveAction;
  settings: SelfDirectedLearningSettings;
  now?: number;
}): Promise<SavePlanResult> {
  const now = input.now ?? Date.now();
  const period = periodLabelOf(await getCurrentPeriod());
  const id = planDocIdOf(period, input.student.uid);
  const current = await getMyPlan(input.student.uid);

  if (current && current.status === "approved") {
    return { ok: false, status: 409, message: "計畫已通過審核，不可再修改" };
  }

  if (input.action === "submit") {
    const { openAt, closeAt } = input.settings;
    if (openAt === null || closeAt === null) {
      return { ok: false, status: 400, message: "學校尚未開放撰寫時間" };
    }
    if (now < openAt) return { ok: false, status: 400, message: "尚未到開放撰寫時間" };
    if (now > closeAt) return { ok: false, status: 400, message: "已超過開放撰寫期限" };
    if (current && current.status === "submitted") {
      return { ok: false, status: 409, message: "計畫審核中，請等待審查結果" };
    }
  }

  const next: SelfDirectedLearningPlan = {
    id,
    period,
    studentUid: input.student.uid,
    studentName: input.student.name,
    grade: input.student.grade,
    classCode: input.student.classCode,
    className: input.student.className,
    topic: input.draft.topic,
    studyGroup: input.draft.studyGroup,
    advisor: input.draft.advisor,
    weeks: input.draft.weeks,
    status: input.action === "submit" ? "submitted" : "draft",
    submittedAt: input.action === "submit" ? now : current?.submittedAt ?? null,
    updatedAt: now,
  };
  await plansRef().doc(id).set(next, { merge: true });
  return { ok: true, plan: next };
}

/* ——— 教職員端：審核佇列與全班瀏覽 ——— */

function readPlansFromSnapshot(snap: {
  docs: { id: string; data: () => Record<string, unknown> | undefined }[];
}): SelfDirectedLearningPlan[] {
  return snap.docs
    .map((doc) => readPlan(doc.id, (doc.data() || {}) as Record<string, unknown>))
    .filter((plan) => plan.id);
}

/** 待審核佇列（當期 submitted；雙 equality 條件、limit 有界） */
export async function listSubmittedPlans(
  period: string,
  limit = 100
): Promise<SelfDirectedLearningPlan[]> {
  const snap = await plansRef()
    .where("period", "==", period)
    .where("status", "==", "submitted")
    .limit(limit)
    .get();
  const plans = readPlansFromSnapshot(snap);
  plans.sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
  return plans;
}

/** 兼導師瀏覽全班（當期＋班級代碼，limit 有界） */
export async function listClassPlans(
  period: string,
  classCode: string,
  limit = 100
): Promise<SelfDirectedLearningPlan[]> {
  const snap = await plansRef()
    .where("period", "==", period)
    .where("classCode", "==", classCode)
    .limit(limit)
    .get();
  const plans = readPlansFromSnapshot(snap);
  plans.sort((a, b) => a.studentName.localeCompare(b.studentName, "zh-Hant"));
  return plans;
}

export type ApplyReviewResult =
  | { ok: true; plan: SelfDirectedLearningPlan }
  | { ok: false; status: 404 | 409; message: string };

/**
 * 套用審核結果（transaction：僅 submitted 可審，寫 review＋更新狀態）。
 * 審核不受開放期間限制。
 */
export async function applyReview(input: {
  planId: string;
  action: "approve" | "return";
  note: string;
  reviewerUid: string;
  reviewerName: string;
}): Promise<ApplyReviewResult> {
  const db = getAdminDb();
  const planRef = plansRef().doc(input.planId);
  const reviewRef = db.collection(SELF_DIRECTED_LEARNING_REVIEWS_COLLECTION).doc();

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(planRef);
    if (!snap.exists) return { kind: "missing" as const };
    const current = readPlan(planRef.id, (snap.data() || {}) as Record<string, unknown>);
    if (current.status !== "submitted") return { kind: "badStatus" as const };
    const now = Date.now();
    const status: SelfDirectedLearningPlan["status"] =
      input.action === "approve" ? "approved" : "returned";
    tx.set(planRef, { status, updatedAt: now }, { merge: true });
    tx.set(reviewRef, {
      planId: input.planId,
      reviewerUid: input.reviewerUid,
      reviewerName: input.reviewerName,
      decision: input.action === "approve" ? "approved" : "returned",
      note: input.note,
      reviewedAt: now,
    });
    return {
      kind: "ok" as const,
      plan: { ...current, status, updatedAt: now },
    };
  });

  if (outcome.kind === "missing") {
    return { ok: false, status: 404, message: "查無此計畫" };
  }
  if (outcome.kind === "badStatus") {
    return { ok: false, status: 409, message: "此計畫不在待審核狀態" };
  }
  return { ok: true, plan: outcome.plan };
}

/* ——— 家長端：子女關聯 ——— */

export interface LinkedChild {
  uid: string;
  name: string;
  grade: string;
  classCode: string;
  className: string;
}

/**
 * 家長→子女：以家長名冊條目的學號＋學期等值條件下推（1 筆查詢），
 * 唯一有效匹配才回傳（照宿主 linkedStudentIdentityForParent 省流模式）。
 */
export async function linkedChildForParent(
  parentEntry: Record<string, unknown>
): Promise<LinkedChild | null> {
  const studentId = typeof parentEntry.studentId === "string" ? parentEntry.studentId.trim() : "";
  if (!studentId) return null;
  const expectedGrade = typeof parentEntry.grade === "string" ? parentEntry.grade.trim() : "";
  const expectedClass = typeof parentEntry.classCode === "string" ? parentEntry.classCode.trim() : "";
  const period = await getCurrentPeriod();
  const snapshot = await getAdminDb()
    .collection(rosterCollection("student"))
    .where("studentId", "==", studentId)
    .where("academicYear", "==", period.academicYear)
    .where("semester", "==", period.semester)
    .get();

  const matches: LinkedChild[] = [];
  for (const doc of snapshot.docs) {
    const entry = doc.data();
    if (!isActiveEntry(entry)) continue;
    const uid = typeof entry.uid === "string" ? entry.uid : "";
    const grade = typeof entry.grade === "string" ? entry.grade.trim() : "";
    const classCode = typeof entry.classCode === "string" ? entry.classCode.trim() : "";
    if (
      !uid ||
      (expectedGrade && grade !== expectedGrade) ||
      (expectedClass && classCode !== expectedClass)
    ) {
      continue;
    }
    matches.push({
      uid,
      name: typeof entry.name === "string" ? entry.name : "",
      grade,
      classCode,
      className: typeof entry.className === "string" ? entry.className : classCode,
    });
  }
  return matches.length === 1 ? matches[0] : null;
}
