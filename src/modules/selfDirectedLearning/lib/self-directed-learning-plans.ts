import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { getCurrentPeriod } from "@/lib/settings-server";
import { isActiveEntry } from "@/lib/roster";
import { rosterCollection } from "@/types/roster";
import {
  SELF_DIRECTED_LEARNING_PLANS_COLLECTION,
  SELF_DIRECTED_LEARNING_REVIEWS_COLLECTION,
  normalizeWeekNotes,
  periodLabelOf,
  planDocIdOf,
  openStateOf,
  type PlanReview,
  type PlanWeekReview,
  type ReviewScope,
  type SelfDirectedLearningPlan,
  type SelfDirectedLearningSettings,
} from "../types/self-directed-learning";

function plansRef() {
  return getAdminDb().collection(SELF_DIRECTED_LEARNING_PLANS_COLLECTION);
}

/** 學生視角儀表資料 */
export interface StudentDashboard {
  period: string;
  /** 目前為止的所有計畫（正式與草稿並存；正式＝approved，其餘皆視為草稿） */
  plans: SelfDirectedLearningPlan[];
  /** 各計畫的最新審查意見（key＝plan id） */
  latestReviews: Record<string, PlanReview>;
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
    learningGoals: str(raw.learningGoals),
    weeks,
    status,
    deletedAt: typeof raw.deletedAt === "number" ? raw.deletedAt : null,
    submittedAt: typeof raw.submittedAt === "number" ? raw.submittedAt : null,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

/** 讀學生目前為止的所有計畫（單一等值查詢，避免複合索引；依更新時間新到舊） */
export async function getStudentPlans(
  studentUid: string,
  limit = 200
): Promise<SelfDirectedLearningPlan[]> {
  const snap = await plansRef().where("studentUid", "==", studentUid).limit(limit).get();
  const plans = readPlansFromSnapshot(snap);
  plans.sort((a, b) => b.updatedAt - a.updatedAt);
  return plans;
}

function readReview(id: string, raw: Record<string, unknown>): PlanReview {
  return {
    id,
    planId: typeof raw.planId === "string" ? raw.planId : "",
    reviewerUid: typeof raw.reviewerUid === "string" ? raw.reviewerUid : "",
    reviewerName: typeof raw.reviewerName === "string" ? raw.reviewerName : "",
    decision: raw.decision === "returned" ? ("returned" as const) : ("approved" as const),
    note: typeof raw.note === "string" ? raw.note : "",
    weekNotes: normalizeWeekNotes(raw.weekNotes),
    reviewedAt: typeof raw.reviewedAt === "number" ? raw.reviewedAt : 0,
  };
}

/** 讀計畫的最新審查意見（where 精準條件＋本機排序，筆數有界） */
export async function getLatestReview(planId: string): Promise<PlanReview | null> {
  const snap = await getAdminDb()
    .collection(SELF_DIRECTED_LEARNING_REVIEWS_COLLECTION)
    .where("planId", "==", planId)
    .limit(20)
    .get();
  if (snap.empty) return null;
  const items = snap.docs.map((doc) =>
    readReview(doc.id, (doc.data() || {}) as Record<string, unknown>)
  );
  items.sort((a, b) => b.reviewedAt - a.reviewedAt);
  return items[0] || null;
}

/** 一次取多筆計畫的最新審查意見（`planId in` 分塊，避免逐筆 N+1） */
export async function getLatestReviews(planIds: string[]): Promise<Record<string, PlanReview>> {
  const unique = [...new Set(planIds.filter((id) => typeof id === "string" && id))];
  const latest: Record<string, PlanReview> = {};
  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const snap = await getAdminDb()
      .collection(SELF_DIRECTED_LEARNING_REVIEWS_COLLECTION)
      .where("planId", "in", chunk)
      .limit(500)
      .get();
    for (const doc of snap.docs) {
      const review = readReview(doc.id, (doc.data() || {}) as Record<string, unknown>);
      if (!review.planId) continue;
      const previous = latest[review.planId];
      if (!previous || review.reviewedAt > previous.reviewedAt) latest[review.planId] = review;
    }
  }
  return latest;
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
  | { ok: false; status: 400 | 403 | 404 | 409; message: string };

/** 新計畫的 doc id：`period_uid_時間亂數`（舊資料仍為 `period_uid`，兩種都相容） */
function newPlanDocId(period: string, studentUid: string, now: number): string {
  return `${planDocIdOf(period, studentUid)}_${now.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * 儲存草稿／送出審核。
 * - 未帶 planId＝新增計畫（僅限開放撰寫期間，且同一學期已有正式計畫時不可新增）。
 * - 帶 planId＝編輯既有草稿（草稿／退回修改可編輯；審核中／已通過不可編輯）。
 * - 正式計畫（approved）每學期僅一份；送出審核與審核通過時都會檢查。
 */
export async function saveStudentPlan(input: {
  student: StudentIdentityLite;
  draft: {
    topic: string;
    studyGroup: string;
    advisor: string;
    learningGoals: string;
    weeks: SelfDirectedLearningPlan["weeks"];
  };
  action: SaveAction;
  settings: SelfDirectedLearningSettings;
  /** 編輯既有草稿時帶入；新增計畫不帶 */
  planId?: string | null;
  now?: number;
}): Promise<SavePlanResult> {
  const now = input.now ?? Date.now();
  const currentPeriod = periodLabelOf(await getCurrentPeriod());
  const requestedId = typeof input.planId === "string" ? input.planId.trim() : "";

  let target: SelfDirectedLearningPlan | null = null;
  if (requestedId) {
    const snap = await plansRef().doc(requestedId).get();
    if (!snap.exists) return { ok: false, status: 404, message: "查無此計畫" };
    target = readPlan(requestedId, (snap.data() || {}) as Record<string, unknown>);
    if (target.studentUid !== input.student.uid) {
      return { ok: false, status: 403, message: "無權修改此計畫" };
    }
    if (target.deletedAt) {
      return { ok: false, status: 409, message: "此計畫在垃圾桶，請先還原後再編輯" };
    }
    if (target.status === "approved") {
      return { ok: false, status: 409, message: "計畫已通過審核，不可再修改" };
    }
    if (target.status === "submitted") {
      return { ok: false, status: 409, message: "計畫審核中，請等待審查結果" };
    }
  }

  const period = target?.period || currentPeriod;
  const studentPlans = await getStudentPlans(input.student.uid);
  const approvedElsewhere = studentPlans.find(
    (plan) => plan.period === period && plan.status === "approved" && plan.id !== requestedId
  );
  if (approvedElsewhere && (!target || input.action === "submit")) {
    return { ok: false, status: 409, message: "本學期已有正式計畫，無法再新增或送出計畫" };
  }

  if (!target && openStateOf(input.settings, now) !== "open") {
    return { ok: false, status: 400, message: "目前非開放撰寫期間，無法新增計畫" };
  }

  if (input.action === "submit") {
    const { openAt, closeAt } = input.settings;
    if (openAt === null || closeAt === null) {
      return { ok: false, status: 400, message: "學校尚未開放撰寫時間" };
    }
    if (now < openAt) return { ok: false, status: 400, message: "尚未到開放撰寫時間" };
    if (now > closeAt) return { ok: false, status: 400, message: "已超過開放撰寫期限" };
  }

  const id = target?.id ?? newPlanDocId(period, input.student.uid, now);
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
    learningGoals: input.draft.learningGoals,
    weeks: input.draft.weeks,
    status: input.action === "submit" ? "submitted" : "draft",
    deletedAt: null,
    submittedAt: input.action === "submit" ? now : target?.submittedAt ?? null,
    updatedAt: now,
  };
  await plansRef().doc(id).set(next, { merge: true });
  return { ok: true, plan: next };
}

export type PlanTrashResult =
  | { ok: true; plan: SelfDirectedLearningPlan }
  | { ok: false; status: 400 | 403 | 404 | 409; message: string };

/**
 * 假性刪除／還原：只允許本人操作，且只針對草稿或退回修改的計畫。
 * 審核中與已通過的計畫不可移至垃圾桶，避免正式紀錄消失。
 */
export async function setStudentPlanDeleted(input: {
  planId: string;
  studentUid: string;
  deleted: boolean;
  now?: number;
}): Promise<PlanTrashResult> {
  const snap = await plansRef().doc(input.planId).get();
  if (!snap.exists) return { ok: false, status: 404, message: "查無此計畫" };
  const plan = readPlan(input.planId, (snap.data() || {}) as Record<string, unknown>);
  if (plan.studentUid !== input.studentUid) {
    return { ok: false, status: 403, message: "無權操作此計畫" };
  }
  if (input.deleted) {
    if (plan.status === "submitted" || plan.status === "approved") {
      return {
        ok: false,
        status: 409,
        message: "審核中或已通過的計畫不可移至垃圾桶",
      };
    }
    if (plan.deletedAt) return { ok: true, plan };
  } else if (!plan.deletedAt) {
    return { ok: true, plan };
  }
  const now = input.now ?? Date.now();
  const next: SelfDirectedLearningPlan = {
    ...plan,
    deletedAt: input.deleted ? now : null,
    updatedAt: now,
  };
  await plansRef()
    .doc(plan.id)
    .set({ deletedAt: next.deletedAt, updatedAt: now }, { merge: true });
  return { ok: true, plan: next };
}

export type WithdrawPlanResult =
  | { ok: true; plan: SelfDirectedLearningPlan }
  | { ok: false; status: 400 | 403 | 404 | 409; message: string };

/**
 * 學生抽回審核中的計畫（限開放撰寫期間、限本學期）：
 * 抽回後回到草稿狀態，可修改後重新送出。
 * 以 transaction 重讀確認仍是 submitted，避免與審核人員同時處理。
 */
export async function withdrawStudentPlan(input: {
  planId: string;
  studentUid: string;
  /** 目前學期識別（只允許抽回本學期的計畫） */
  period: string;
  settings: SelfDirectedLearningSettings;
  now?: number;
}): Promise<WithdrawPlanResult> {
  const now = input.now ?? Date.now();
  if (openStateOf(input.settings, now) !== "open") {
    return { ok: false, status: 400, message: "目前非開放撰寫期間，無法抽回計畫" };
  }
  const db = getAdminDb();
  const planRef = plansRef().doc(input.planId);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(planRef);
    if (!snap.exists) return { kind: "missing" as const };
    const plan = readPlan(planRef.id, (snap.data() || {}) as Record<string, unknown>);
    if (plan.studentUid !== input.studentUid) return { kind: "forbidden" as const };
    if (plan.deletedAt) return { kind: "deleted" as const };
    if (plan.status !== "submitted") return { kind: "badStatus" as const };
    if (plan.period !== input.period) return { kind: "wrongPeriod" as const };
    const next: SelfDirectedLearningPlan = {
      ...plan,
      status: "draft",
      submittedAt: null,
      updatedAt: now,
    };
    tx.set(planRef, { status: "draft", submittedAt: null, updatedAt: now }, { merge: true });
    return { kind: "ok" as const, plan: next };
  });

  switch (outcome.kind) {
    case "missing":
      return { ok: false, status: 404, message: "查無此計畫" };
    case "forbidden":
      return { ok: false, status: 403, message: "無權操作此計畫" };
    case "deleted":
      return { ok: false, status: 409, message: "此計畫在垃圾桶，無法抽回" };
    case "badStatus":
      return { ok: false, status: 409, message: "只有審核中的計畫可以抽回修改" };
    case "wrongPeriod":
      return { ok: false, status: 409, message: "只能抽回本學期的計畫" };
    default:
      return { ok: true, plan: outcome.plan };
  }
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
  return plans.filter((plan) => !plan.deletedAt);
}

/**
 * 依審查範圍載入待審計畫（省流）：
 * - 班級：每個指定班級各下一筆等值查詢（不掃全校）。
 * - 個人（例外）：以計畫 doc id（period_uid）精準 getAll，只讀指定學生的計畫。
 * - 兩者同時指定時取聯集去重；未限制＝沿用既有全校待審查詢。
 */
export async function listSubmittedPlansForScope(
  period: string,
  scope: ReviewScope,
  limit = 100
): Promise<SelfDirectedLearningPlan[]> {
  if (scope.all) return listSubmittedPlans(period, limit);

  const merged = new Map<string, SelfDirectedLearningPlan>();

  const classCodes = [...new Set(scope.classCodes)];
  if (classCodes.length > 0) {
    const snaps = await Promise.all(
      classCodes.map((classCode) =>
        plansRef()
          .where("period", "==", period)
          .where("status", "==", "submitted")
          .where("classCode", "==", classCode)
          .limit(limit)
          .get()
      )
    );
    for (const snap of snaps) {
      for (const plan of readPlansFromSnapshot(snap)) {
        if (!plan.deletedAt) merged.set(plan.id, plan);
      }
    }
  }

  const uids = [...new Set(scope.studentUids)];
  for (let index = 0; index < uids.length; index += 30) {
    const chunk = uids.slice(index, index + 30);
    // 同一學生可能有數筆草稿／正式計畫，改用 studentUid 等值查詢（單一欄位索引）
    const snap = await plansRef().where("studentUid", "in", chunk).limit(300).get();
    for (const plan of readPlansFromSnapshot(snap)) {
      if (plan.period === period && plan.status === "submitted" && !plan.deletedAt) {
        merged.set(plan.id, plan);
      }
    }
  }

  return [...merged.values()]
    .sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0))
    .slice(0, limit);
}

/** 計畫是否落在審查範圍內 */
export function planInReviewScope(plan: SelfDirectedLearningPlan, scope: ReviewScope): boolean {
  if (scope.all) return true;
  return scope.classCodes.includes(plan.classCode) || scope.studentUids.includes(plan.studentUid);
}

/**
 * 待審件數（省流模式的輕量總數）：以 Firestore count 聚合計算，不載入任何計畫內容。
 * - 全校／僅班級／僅個人：各以 `count()` 精準計算（`in` 30 值／批）。
 * - 班級與個人同時指定：涉及聯集去重，改用既有待審清單（上限 100 筆）計數。
 * 審核中的計畫不可移至垃圾桶，故不必再過濾 `deletedAt`。
 */
export async function countSubmittedPlansForScope(
  period: string,
  scope: ReviewScope
): Promise<number> {
  if (scope.all) {
    const snap = await plansRef()
      .where("period", "==", period)
      .where("status", "==", "submitted")
      .count()
      .get();
    return snap.data().count;
  }

  const classCodes = [...new Set(scope.classCodes)];
  const studentUids = [...new Set(scope.studentUids)];
  if (classCodes.length > 0 && studentUids.length > 0) {
    return (await listSubmittedPlansForScope(period, scope)).length;
  }

  let total = 0;
  for (let index = 0; index < classCodes.length; index += 30) {
    const snap = await plansRef()
      .where("period", "==", period)
      .where("status", "==", "submitted")
      .where("classCode", "in", classCodes.slice(index, index + 30))
      .count()
      .get();
    total += snap.data().count;
  }
  for (let index = 0; index < studentUids.length; index += 30) {
    const snap = await plansRef()
      .where("period", "==", period)
      .where("status", "==", "submitted")
      .where("studentUid", "in", studentUids.slice(index, index + 30))
      .count()
      .get();
    total += snap.data().count;
  }
  return total;
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
  const plans = readPlansFromSnapshot(snap).filter((plan) => !plan.deletedAt);
  plans.sort((a, b) => a.studentName.localeCompare(b.studentName, "zh-Hant"));
  return plans;
}

export type ApplyReviewResult =
  | { ok: true; plan: SelfDirectedLearningPlan }
  | { ok: false; status: 403 | 404 | 409; message: string };

/**
 * 套用審核結果（transaction：僅 submitted 可審，寫 review＋更新狀態）。
 * 審核不受開放期間限制。
 */
export async function applyReview(input: {
  planId: string;
  action: "approve" | "return";
  note: string;
  /** 逐週審查意見（富文本；可留空） */
  weekNotes?: PlanWeekReview[];
  reviewerUid: string;
  reviewerName: string;
  /** 審查範圍；未提供＝全校（管理員或未設定範圍的審核人員） */
  scope?: ReviewScope;
}): Promise<ApplyReviewResult> {
  const db = getAdminDb();
  const planRef = plansRef().doc(input.planId);
  const reviewRef = db.collection(SELF_DIRECTED_LEARNING_REVIEWS_COLLECTION).doc();

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(planRef);
    if (!snap.exists) return { kind: "missing" as const };
    const current = readPlan(planRef.id, (snap.data() || {}) as Record<string, unknown>);
    if (input.scope && !planInReviewScope(current, input.scope)) {
      return { kind: "outOfScope" as const };
    }
    if (current.deletedAt) return { kind: "badStatus" as const };
    if (current.status !== "submitted") return { kind: "badStatus" as const };
    if (input.action === "approve") {
      // 同一學生同一學期僅能有一份正式計畫：審核當下再檢查一次，避免兩筆待審先後通過
      const approvedSnap = await tx.get(
        plansRef().where("studentUid", "==", current.studentUid).limit(50)
      );
      const conflict = approvedSnap.docs.some((doc) => {
        if (doc.id === current.id) return false;
        const data = (doc.data() || {}) as Record<string, unknown>;
        return data.period === current.period && data.status === "approved";
      });
      if (conflict) return { kind: "conflict" as const };
    }
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
      weekNotes: input.weekNotes ?? [],
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
  if (outcome.kind === "outOfScope") {
    return { ok: false, status: 403, message: "此計畫不在你的審查對象範圍內" };
  }
  if (outcome.kind === "badStatus") {
    return { ok: false, status: 409, message: "此計畫不在待審核狀態" };
  }
  if (outcome.kind === "conflict") {
    return { ok: false, status: 409, message: "此學生本學期已有正式計畫，無法再通過" };
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
