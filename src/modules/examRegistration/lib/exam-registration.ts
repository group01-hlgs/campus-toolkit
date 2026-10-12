import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { cachedRead, invalidateReadCache } from "@/lib/read-cache";
import { cachedListRead, invalidateAdminListCache } from "@/lib/list-cache";
import { logActivity } from "@/lib/audit";
import { publishFromModule } from "@/lib/announcements";
import { publishScheduleFromModule } from "@/lib/calendar";
import { schoolWideAudience } from "@/types/announcements";
import type { UserRole } from "@/types/users";
import {
  EXAM_EVENT_STATUS_LABELS,
  EXAM_FEE_CODE_LABELS,
  buildExamRegistrationCsv,
  calcExamFee,
  canTransitionExamStatus,
  countSubjectsByRegistrations,
  effectiveExamStatus,
  examEventToDraft,
  formatExamDateRange,
  isExamCategory,
  isExamEventType,
  isExamFeeCode,
  isExamMode,
  isExamOpen,
  isExamRegistrationMode,
  isExamReviewStatus,
  isTargetMatch,
  parseExamEventDraft,
  parseSubjectKeys,
  pickValidSubjectKeys,
  resolveLocationLabel,
  subjectCapacity,
  EXAM_SERVICE_NOTE_MAX,
  OPT_OUT_REASON_MAX,
} from "../types/exam-registration";
import type {
  ExamEvent,
  ExamEventDraft,
  ExamEventRoster,
  ExamRegistration,
  ExamReviewStatus,
  ExamRosterSummary,
  StudentExamEvent,
} from "../types/exam-registration";

export const EXAM_EVENTS_COLLECTION = "examEvents";
export const EXAM_REGISTRATIONS_COLLECTION = "examRegistrations";

const ADMIN_EVENT_LIST_KEY = "admin:exam-registration:events";
const ADMIN_ROSTER_KEY_PREFIX = "admin:exam-registration:roster:";
const STUDENT_CACHE_PREFIX = "exam-registration:";
const STUDENT_EVENT_CACHE_KEY = `${STUDENT_CACHE_PREFIX}events:visible`;
const STUDENT_COUNTS_CACHE_PREFIX = `${STUDENT_CACHE_PREFIX}counts:`;
const STUDENT_EVENT_CACHE_TTL_MS = 30_000;
const ADMIN_EVENT_LIST_LIMIT = 200;
const ROSTER_LIMIT = 1000;

/** API 可直接對應 HTTP 狀態的模組錯誤 */
export class ExamRegistrationError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ExamRegistrationError";
    this.status = status;
  }
}

export interface StudentIdentity {
  uid: string;
  name: string;
  grade: string;
  classCode: string;
  /** 學號（名冊有才帶；CSV 造冊用） */
  studentId?: string;
  /** 座號（名冊有才帶） */
  seatNo?: string;
}

export interface Actor {
  uid: string;
  name: string;
  role: UserRole;
}

export interface ExamEventWriteResult {
  events: ExamEvent[];
  epoch: number;
}

export function registrationDocId(eventId: string, studentUid: string): string {
  return `${eventId}__${studentUid}`;
}

export function readExamEvent(id: string, raw: Record<string, unknown>): ExamEvent {
  return {
    id,
    title: typeof raw.title === "string" ? raw.title : "",
    examType: isExamCategory(raw.examType) ? raw.examType : "other",
    examDate: typeof raw.examDate === "string" ? raw.examDate : "",
    examEndDate: typeof raw.examEndDate === "string" ? raw.examEndDate : "",
    location: typeof raw.location === "string" ? raw.location : "",
    locationOptions: readLocationOptions(raw.locationOptions),
    note: typeof raw.note === "string" ? raw.note : "",
    deadline: typeof raw.deadline === "number" ? raw.deadline : 0,
    registrationOpenAt:
      typeof raw.registrationOpenAt === "number" && Number.isFinite(raw.registrationOpenAt) && raw.registrationOpenAt > 0
        ? raw.registrationOpenAt
        : 0,
    subjects: Array.isArray(raw.subjects)
      ? raw.subjects.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const record = item as Record<string, unknown>;
          const key = typeof record.key === "string" ? record.key : "";
          const label = typeof record.label === "string" ? record.label : "";
          if (!key || !label) return [];
          const capacity =
            typeof record.capacity === "number" && Number.isFinite(record.capacity) && record.capacity > 0
              ? Math.floor(record.capacity)
              : 0;
          const feeStandard = readFee(record.feeStandard);
          const feeReduced = readFee(record.feeReduced);
          const entry: ExamEvent["subjects"][number] = { key, label };
          if (capacity > 0) entry.capacity = capacity;
          if (feeStandard > 0) entry.feeStandard = feeStandard;
          if (feeReduced > 0) entry.feeReduced = feeReduced;
          return [entry];
        })
      : [],
    target: readTarget(raw.target),
    basicFee: readBasicFee(raw),
    examMode: isExamMode(raw.examMode) ? raw.examMode : "first-come",
    registrationMode: isExamRegistrationMode(raw.registrationMode) ? raw.registrationMode : "optional",
    status: isExamEventType(raw.status) ? raw.status : "draft",
    createdBy: readActor(raw.createdBy),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

/** 費用欄位（M1 舊資料只有單一 fee 欄位 → standard=fee、reduced=0 向後相容） */
function readFee(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** 地點選項（缺省 []；code/label 缺一即略過該項） */
function readLocationOptions(raw: unknown): ExamEvent["locationOptions"] {
  if (!Array.isArray(raw)) return [];
  const list: ExamEvent["locationOptions"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!code || !label) continue;
    list.push(record.isDefault === true ? { code, label, isDefault: true } : { code, label });
  }
  return list;
}

function readBasicFee(raw: Record<string, unknown>): { standard: number; reduced: number } {
  const record = (raw.basicFee && typeof raw.basicFee === "object" ? raw.basicFee : null) as
    | Record<string, unknown>
    | null;
  if (record) return { standard: readFee(record.standard), reduced: readFee(record.reduced) };
  const legacy = readFee(raw.fee);
  return { standard: legacy, reduced: 0 };
}

export function readExamRegistration(
  id: string,
  raw: Record<string, unknown>
): ExamRegistration {
  return {
    id,
    eventId: typeof raw.eventId === "string" ? raw.eventId : "",
    studentUid: typeof raw.studentUid === "string" ? raw.studentUid : "",
    studentName: typeof raw.studentName === "string" ? raw.studentName : "",
    studentClass: typeof raw.studentClass === "string" ? raw.studentClass : "",
    studentGrade: typeof raw.studentGrade === "string" ? raw.studentGrade : "",
    studentId: typeof raw.studentId === "string" ? raw.studentId : "",
    seatNo: typeof raw.seatNo === "string" ? raw.seatNo : "",
    subjectKeys: parseSubjectKeys(raw.subjectKeys),
    optOut: raw.optOut === true,
    optOutReason: typeof raw.optOutReason === "string" ? raw.optOutReason : "",
    locationCode: typeof raw.locationCode === "string" ? raw.locationCode : "",
    nonAirConditionedRoom: raw.nonAirConditionedRoom === true,
    examServiceNote: typeof raw.examServiceNote === "string" ? raw.examServiceNote : "",
    feeCode: isExamFeeCode(raw.feeCode) ? raw.feeCode : "1",
    feeAmount: typeof raw.feeAmount === "number" && Number.isFinite(raw.feeAmount) && raw.feeAmount > 0
      ? Math.floor(raw.feeAmount)
      : 0,
    archived: raw.archived === true,
    archivedAt: typeof raw.archivedAt === "number" ? raw.archivedAt : null,
    reviewStatus: isExamReviewStatus(raw.reviewStatus) ? raw.reviewStatus : "pending",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

function readTarget(raw: unknown): { grades: string[]; classes: string[] } {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    grades: readStringArray(record.grades),
    classes: readStringArray(record.classes),
  };
}

function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function readActor(raw: unknown): { uid: string; name: string } {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    uid: typeof record.uid === "string" ? record.uid : "",
    name: typeof record.name === "string" ? record.name : "",
  };
}

function readExamEventDraft(raw: unknown): ExamEventDraft {
  const parsed = parseExamEventDraft(raw);
  if (!parsed.ok) throw new ExamRegistrationError(400, parsed.message);
  return parsed.value;
}

async function invalidateExamRegistrationCaches(): Promise<void> {
  invalidateReadCache(STUDENT_CACHE_PREFIX);
  await invalidateAdminListCache();
}

// —— 學生端 ——

/**
 * 學生可見場次（status ∈ open/closed）：30 秒快取。
 * 鐵律 6：非管理端寫入的快取，只 invalidateReadCache(前綴)、不 bump epoch。
 */
export async function listVisibleExamEvents(): Promise<ExamEvent[]> {
  return cachedRead(STUDENT_EVENT_CACHE_KEY, STUDENT_EVENT_CACHE_TTL_MS, async () => {
    const snap = await getAdminDb()
      .collection(EXAM_EVENTS_COLLECTION)
      .where("status", "in", ["open", "closed"])
      .get();
    const rows = snap.docs.map((doc) => readExamEvent(doc.id, doc.data()));
    rows.sort((a, b) => a.examDate.localeCompare(b.examDate) || a.createdAt - b.createdAt);
    return rows;
  });
}

/** 各場次即時科目人數（30 秒快取；optOut 不佔名額） */
async function listSubjectCountMap(
  eventIds: string[]
): Promise<Record<string, Record<string, number>>> {
  if (!eventIds.length) return {};
  const key = `${STUDENT_COUNTS_CACHE_PREFIX}${[...eventIds].sort().join(",")}`;
  return cachedRead(key, STUDENT_EVENT_CACHE_TTL_MS, async () => {
    const snap = await getAdminDb()
      .collection(EXAM_REGISTRATIONS_COLLECTION)
      .where("eventId", "in", eventIds)
      .get();
    const perEventKeys = new Map<string, string[][]>();
    for (const doc of snap.docs) {
      const raw = doc.data();
      const eventId = typeof raw.eventId === "string" ? raw.eventId : "";
      if (!eventId) continue;
      if (raw.optOut === true) continue;
      const list = perEventKeys.get(eventId) ?? [];
      list.push(parseSubjectKeys(raw.subjectKeys));
      perEventKeys.set(eventId, list);
    }
    const result: Record<string, Record<string, number>> = {};
    for (const [eventId, keysList] of perEventKeys) {
      result[eventId] = {};
      for (const keys of keysList) {
        for (const key of keys) result[eventId][key] = (result[eventId][key] ?? 0) + 1;
      }
    }
    return result;
  });
}

/** 場次快取＋本人登錄＋各科人數 → 對象過濾在記憶體內完成（場次數量為個位數） */
export async function listStudentExamEvents(student: StudentIdentity): Promise<StudentExamEvent[]> {
  const events = await listVisibleExamEvents();
  const visible = events.filter((event) => isTargetMatch(event.target, student));
  const snap = await getAdminDb()
    .collection(EXAM_REGISTRATIONS_COLLECTION)
    .where("studentUid", "==", student.uid)
    .get();
  const mine = new Map<string, ExamRegistration>();
  for (const doc of snap.docs) {
    const registration = readExamRegistration(doc.id, doc.data());
    mine.set(registration.eventId, registration);
  }
  const counts = await listSubjectCountMap(visible.map((event) => event.id));
  const now = Date.now();
  return visible.map((event) => {
    const registration = mine.get(event.id);
    const effective = effectiveExamStatus(event, now);
    const eventCounts = counts[event.id] ?? {};
    const subjectStats: StudentExamEvent["subjectStats"] = {};
    for (const subject of event.subjects) {
      subjectStats[subject.key] = {
        count: eventCounts[subject.key] ?? 0,
        capacity: subjectCapacity(subject),
      };
    }
    return {
      ...event,
      status:
        effective === "open"
          ? ("open" as const)
          : effective === "upcoming"
            ? ("upcoming" as const)
            : ("closed" as const),
      mySubjectKeys: registration ? pickValidSubjectKeys(registration.subjectKeys, event.subjects) : [],
      registeredAt: registration ? registration.updatedAt : null,
      reviewStatus: registration ? registration.reviewStatus : null,
      myOptOut: registration?.optOut ?? false,
      myOptOutReason: registration?.optOutReason ?? "",
      myLocationCode: registration?.locationCode ?? "",
      myNonAirConditionedRoom: registration?.nonAirConditionedRoom ?? false,
      myExamServiceNote: registration?.examServiceNote ?? "",
      myFeeCode: registration ? registration.feeCode : null,
      myFeeAmount: registration ? (registration.optOut ? 0 : registration.feeAmount) : null,
      myArchived: registration?.archived ?? false,
      subjectStats,
    };
  });
}

/** 點查（不存在＝0 讀）；學生與管理端共用 */
export async function getExamEvent(eventId: string): Promise<ExamEvent | null> {
  const snap = await getAdminDb().collection(EXAM_EVENTS_COLLECTION).doc(eventId).get();
  return snap.exists ? readExamEvent(snap.id, snap.data() ?? {}) : null;
}

/**
 * 登錄／修改（含不報名、繳費身分）：先驗場次、對象、科目（純計算），再 transaction upsert。
 * 文件 id ＝ `eventId__studentUid`（決定論），唯一性由文件 id 直接保證。
 * - optOut=true（僅 required 場次）：不報名，optOutReason 必填，subjectKeys 恆空、費用 0
 * - archived=true：凍結唯讀，upsert／取消一律 409（解除封存走管理端）
 * - 額滿統計排除 optOut（不報名不佔名額）
 */
export async function upsertExamRegistration(input: {
  eventId: string;
  student: StudentIdentity;
  subjectKeys: string[];
  optOut?: boolean;
  optOutReason?: string;
  /** 所選地點代碼（場次有選項時驗證；空值取預設項） */
  locationCode?: string;
  /** 勾選非冷氣試場 */
  nonAirConditionedRoom?: boolean;
  /** 特殊應考服務需求 */
  examServiceNote?: string;
  feeCode?: string;
  ip?: string;
}): Promise<{ registration: ExamRegistration; created: boolean }> {
  const event = await getExamEvent(input.eventId);
  if (!event) throw new ExamRegistrationError(404, "找不到報名場次");
  assertEventAcceptingRegistration(event);
  if (!isTargetMatch(event.target, input.student)) {
    throw new ExamRegistrationError(403, "你不在本次報名對象內（年級／班級不符）");
  }

  const optOut = input.optOut === true;
  const optOutReason = typeof input.optOutReason === "string" ? input.optOutReason.trim() : "";
  const nonAirConditionedRoom = input.nonAirConditionedRoom === true;
  const examServiceNote = typeof input.examServiceNote === "string" ? input.examServiceNote.trim() : "";
  const feeCode = isExamFeeCode(input.feeCode) ? input.feeCode : "1";

  // 地點選項（僅場次有選項時要求；預設＝標記 isDefault 項、否則第一項）
  let locationCode = "";
  if (!optOut && event.locationOptions.length) {
    const requested = typeof input.locationCode === "string" ? input.locationCode.trim() : "";
    const fallback =
      event.locationOptions.find((option) => option.isDefault)?.code ?? event.locationOptions[0].code;
    const code = requested || fallback;
    if (!event.locationOptions.some((option) => option.code === code)) {
      throw new ExamRegistrationError(400, "所選考試地點無效，請重新整理後再試");
    }
    locationCode = code;
  }

  if (optOut) {
    if (event.registrationMode !== "required") {
      throw new ExamRegistrationError(400, "自由報名場次不需勾選不報名——不登錄即可");
    }
    if (!optOutReason) throw new ExamRegistrationError(400, "勾選不報名時，請說明原因");
    if (optOutReason.length > OPT_OUT_REASON_MAX) {
      throw new ExamRegistrationError(400, `不報名原因過長（最多 ${OPT_OUT_REASON_MAX} 字）`);
    }
  } else if (examServiceNote.length > EXAM_SERVICE_NOTE_MAX) {
    throw new ExamRegistrationError(400, `特殊應考服務需求過長（最多 ${EXAM_SERVICE_NOTE_MAX} 字）`);
  } else {
    const keys = parseSubjectKeys(input.subjectKeys);
    if (!keys.length) throw new ExamRegistrationError(400, "請至少勾選一個科目");
    const subjectKeys = pickValidSubjectKeys(keys, event.subjects);
    if (subjectKeys.length !== keys.length) {
      throw new ExamRegistrationError(400, "勾選的科目與本場次不符，請重新整理後再試");
    }
  }

  const subjectKeys = optOut ? [] : pickValidSubjectKeys(parseSubjectKeys(input.subjectKeys), event.subjects);
  const feeAmount = optOut ? 0 : calcExamFee(event, subjectKeys, feeCode);

  const db = getAdminDb();
  const ref = db.collection(EXAM_REGISTRATIONS_COLLECTION).doc(registrationDocId(event.id, input.student.uid));
  const now = Date.now();
  const base = {
    eventId: event.id,
    studentUid: input.student.uid,
    studentName: input.student.name,
    studentGrade: input.student.grade,
    studentClass: input.student.classCode,
    studentId: input.student.studentId ?? "",
    seatNo: input.student.seatNo ?? "",
  };
  /** 先到先得且有科設名額上限 → transaction 內讀全场次統計（排除 optOut），額滿即拒 */
  const needsCapacityCheck =
    !optOut &&
    event.examMode === "first-come" &&
    event.subjects.some((subject) => subjectCapacity(subject) > 0);

  const result = await db.runTransaction(async (tx) => {
    const [snap, all] = await Promise.all([
      tx.get(ref),
      needsCapacityCheck
        ? tx.get(db.collection(EXAM_REGISTRATIONS_COLLECTION).where("eventId", "==", event.id))
        : Promise.resolve(null),
    ]);
    if (snap.exists) {
      const previous = readExamRegistration(snap.id, snap.data() ?? {});
      if (previous.archived) {
        throw new ExamRegistrationError(409, "資料已封存，無法修改——請聯繫承辦解除封存");
      }
    }
    if (all) {
      const others = all.docs
        .filter((doc) => doc.id !== ref.id)
        .flatMap((doc) => {
          if (doc.data().optOut === true) return [];
          return [parseSubjectKeys(doc.data().subjectKeys)];
        });
      const counts = countSubjectsByRegistrations(others, event.subjects);
      for (const key of subjectKeys) {
        const subject = event.subjects.find((item) => item.key === key);
        if (!subject) continue;
        const capacity = subjectCapacity(subject);
        if (capacity > 0 && (counts[key] ?? 0) >= capacity) {
          throw new ExamRegistrationError(409, `「${subject.label}」已額滿（名額 ${capacity} 名）`);
        }
      }
    }
    const record = {
      ...base,
      subjectKeys,
      optOut,
      optOutReason: optOut ? optOutReason : "",
      locationCode,
      nonAirConditionedRoom: optOut ? false : nonAirConditionedRoom,
      examServiceNote: optOut ? "" : examServiceNote,
      feeCode,
      feeAmount,
      archived: false,
      archivedAt: null,
    };
    if (snap.exists) {
      const previous = readExamRegistration(snap.id, snap.data() ?? {});
      tx.update(ref, { ...record, updatedAt: now });
      return {
        created: false,
        registration: { ...previous, ...record, updatedAt: now },
      };
    }
    const full = { ...record, reviewStatus: "pending" as const, createdAt: now, updatedAt: now };
    tx.set(ref, full);
    return {
      created: true,
      registration: { id: ref.id, ...full },
    };
  });

  await invalidateExamRegistrationCaches();
  await logActivity({
    userId: input.student.uid,
    role: "student",
    action: "exam_registration_recorded",
    ip: input.ip,
    details: optOut
      ? `勾選不報名（${event.title}，原因：${optOutReason}）`
      : `${result.created ? "登錄" : "修改"}報名（${event.title}，科目 ${subjectKeys.length} 項，${EXAM_FEE_CODE_LABELS[feeCode]}，費用 ${feeAmount} 元）`,
  });
  return result;
}

export async function withdrawExamRegistration(input: {
  eventId: string;
  studentUid: string;
  ip?: string;
}): Promise<{ eventId: string }> {
  const event = await getExamEvent(input.eventId);
  if (!event) throw new ExamRegistrationError(404, "找不到報名場次");
  assertEventAcceptingRegistration(event);

  const ref = getAdminDb()
    .collection(EXAM_REGISTRATIONS_COLLECTION)
    .doc(registrationDocId(event.id, input.studentUid));
  await getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ExamRegistrationError(404, "你尚未登錄本場次");
    const existing = readExamRegistration(snap.id, snap.data() ?? {});
    if (existing.archived) throw new ExamRegistrationError(409, "資料已封存，無法取消——請聯繫承辦解除封存");
    tx.delete(ref);
  });

  await invalidateExamRegistrationCaches();
  await logActivity({
    userId: input.studentUid,
    role: "student",
    action: "exam_registration_withdrawn",
    ip: input.ip,
    details: `取消報名（${event.title}）`,
  });
  return { eventId: event.id };
}

/**
 * 學生自行封存（對齊原系統「資料封存」）：確認資料無誤後凍結唯讀，可下載報名表留存。
 * 已封存者再封存為 no-op（幂等）；無登錄不可封存。
 */
export async function archiveExamRegistration(input: {
  eventId: string;
  studentUid: string;
  ip?: string;
}): Promise<{ registration: ExamRegistration }> {
  const event = await getExamEvent(input.eventId);
  if (!event) throw new ExamRegistrationError(404, "找不到報名場次");
  if (event.status === "archived") throw new ExamRegistrationError(409, "場次已封存");

  const ref = getAdminDb()
    .collection(EXAM_REGISTRATIONS_COLLECTION)
    .doc(registrationDocId(event.id, input.studentUid));
  const registration = await getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ExamRegistrationError(404, "你尚未登錄本場次");
    const previous = readExamRegistration(snap.id, snap.data() ?? {});
    if (previous.archived) return previous;
    const now = Date.now();
    tx.update(ref, { archived: true, archivedAt: now, updatedAt: now });
    return { ...previous, archived: true, archivedAt: now, updatedAt: now };
  });

  await invalidateExamRegistrationCaches();
  await logActivity({
    userId: input.studentUid,
    role: "student",
    action: "exam_registration_archived",
    ip: input.ip,
    details: `封存報名資料（${event.title}）`,
  });
  return { registration };
}

/** 承辦解除封存（對齊原系統 removeStudentArchive）：學生可重新修改 */
export async function unarchiveExamRegistration(input: {
  eventId: string;
  registrationId: string;
  actor: Actor;
  ip?: string;
}): Promise<{ registration: ExamRegistration }> {
  const event = await getExamEvent(input.eventId);
  if (!event) throw new ExamRegistrationError(404, "找不到報名場次");

  const ref = getAdminDb()
    .collection(EXAM_REGISTRATIONS_COLLECTION)
    .doc(registrationDocId(event.id, input.registrationId));
  const registration = await getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ExamRegistrationError(404, "查無此登錄資料");
    const previous = readExamRegistration(snap.id, snap.data() ?? {});
    if (!previous.archived) return previous;
    const now = Date.now();
    tx.update(ref, { archived: false, archivedAt: null, updatedAt: now });
    return { ...previous, archived: false, archivedAt: null, updatedAt: now };
  });

  await invalidateExamRegistrationCaches();
  await logActivity({
    userId: input.actor.uid,
    role: input.actor.role,
    action: "exam_registration_unarchived",
    ip: input.ip,
    details: `解除封存（${event.title}，${registration.studentName}）`,
  });
  return { registration };
}

function assertEventAcceptingRegistration(event: ExamEvent): void {
  if (isExamOpen(event)) return;
  if (event.status === "archived") throw new ExamRegistrationError(409, "場次已封存");
  if (event.status === "draft") throw new ExamRegistrationError(409, "場次尚未開放");
  if (effectiveExamStatus(event) === "upcoming") {
    throw new ExamRegistrationError(409, "報名尚未開放");
  }
  throw new ExamRegistrationError(409, "報名已截止");
}

/**
 * 承辦審核單筆登錄（僅 examMode=review 場次）：pending→admitted/waitlist/rejected。
 * 審核不鎖定場次狀態（closed 後仍可放榜）；archived 後不可改。
 */
export async function updateExamRegistrationReview(input: {
  eventId: string;
  registrationId: string;
  reviewStatus: ExamReviewStatus;
  actor: Actor;
  ip?: string;
}): Promise<{ registration: ExamRegistration }> {
  const event = await getExamEvent(input.eventId);
  if (!event) throw new ExamRegistrationError(404, "找不到報名場次");
  if (event.examMode !== "review") {
    throw new ExamRegistrationError(400, "非審核錄取場次，無需審核");
  }
  if (event.status === "archived") throw new ExamRegistrationError(409, "場次已封存");
  if (!isExamReviewStatus(input.reviewStatus)) throw new ExamRegistrationError(400, "審核結果無效");

  const ref = getAdminDb()
    .collection(EXAM_REGISTRATIONS_COLLECTION)
    .doc(registrationDocId(event.id, input.registrationId));
  const registration = await getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ExamRegistrationError(404, "查無此登錄資料");
    const previous = readExamRegistration(snap.id, snap.data() ?? {});
    if (previous.optOut) throw new ExamRegistrationError(400, "該生已勾選不報名，無需審核");
    if (previous.archived) throw new ExamRegistrationError(409, "資料已封存，無法審核——請先解除封存");
    const now = Date.now();
    tx.update(ref, { reviewStatus: input.reviewStatus, updatedAt: now });
    return { ...previous, reviewStatus: input.reviewStatus, updatedAt: now };
  });

  await invalidateExamRegistrationCaches();
  await logActivity({
    userId: input.actor.uid,
    role: input.actor.role,
    action: "exam_registration_reviewed",
    ip: input.ip,
    details: `審核報名（${event.title}，${registration.studentName} → ${input.reviewStatus}）`,
  });
  return { registration };
}

// —— 管理端 ——

export async function listAdminExamEvents(): Promise<{ events: ExamEvent[]; epoch: number }> {
  const { data, epoch } = await cachedListRead(ADMIN_EVENT_LIST_KEY, async () => {
    const snap = await getAdminDb()
      .collection(EXAM_EVENTS_COLLECTION)
      .orderBy("examDate", "desc")
      .limit(ADMIN_EVENT_LIST_LIMIT)
      .get();
    const rows = snap.docs.map((doc) => readExamEvent(doc.id, doc.data()));
    rows.sort((a, b) => b.examDate.localeCompare(a.examDate) || b.updatedAt - a.updatedAt);
    return rows;
  });
  return { events: data, epoch };
}

export async function countAdminExamEvents(): Promise<number> {
  const snap = await getAdminDb().collection(EXAM_EVENTS_COLLECTION).count().get();
  return snap.data().count ?? 0;
}

export async function createExamEvent(
  input: unknown,
  actor: Actor,
  ip?: string
): Promise<ExamEventWriteResult> {
  const draft = readExamEventDraft(input);
  assertDraftDeadline(draft);

  const ref = getAdminDb().collection(EXAM_EVENTS_COLLECTION).doc();
  const now = Date.now();
  const record = {
    ...draft,
    createdBy: { uid: actor.uid, name: actor.name },
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(record);
  const event: ExamEvent = { id: ref.id, ...record };

  await invalidateExamRegistrationCaches();
  await syncExamEventHooks(event, actor, true);
  await logActivity({
    userId: actor.uid,
    role: actor.role,
    action: "exam_registration_event_created",
    ip,
    details: `建立報名場次（${event.title}，狀態=${EXAM_EVENT_STATUS_LABELS[event.status]}，對象=${describeTarget(event)}）`,
  });
  return listAdminExamEvents();
}

export async function updateExamEvent(
  eventId: string,
  patch: unknown,
  actor: Actor,
  ip?: string
): Promise<ExamEventWriteResult> {
  const event = await getExamEvent(eventId);
  if (!event) throw new ExamRegistrationError(404, "找不到報名場次");

  const record = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const draft = readExamEventDraft({ ...examEventToDraft(event), ...record });
  if (!canTransitionExamStatus(event.status, draft.status)) {
    throw new ExamRegistrationError(
      400,
      `狀態不可由「${EXAM_EVENT_STATUS_LABELS[event.status]}」變更為「${EXAM_EVENT_STATUS_LABELS[draft.status]}」`
    );
  }
  assertDraftDeadline(draft);

  const now = Date.now();
  await getAdminDb()
    .collection(EXAM_EVENTS_COLLECTION)
    .doc(eventId)
    .update({ ...draft, updatedAt: now });
  const updated: ExamEvent = { ...event, ...draft, updatedAt: now };

  await invalidateExamRegistrationCaches();
  if (draft.status === "open") {
    await syncExamEventHooks(updated, actor, event.status !== "open");
  }
  await logActivity({
    userId: actor.uid,
    role: actor.role,
    action: "exam_registration_event_updated",
    ip,
    details: `更新報名場次（${updated.title}，狀態 ${EXAM_EVENT_STATUS_LABELS[event.status]}→${
      EXAM_EVENT_STATUS_LABELS[draft.status]
    }，截止 ${formatDateTime(draft.deadline)}）`,
  });
  return listAdminExamEvents();
}

/**
 * 硬刪除場次：連同該場次全部登錄名單一併刪除（對齊 GAS `deletePipeAndSheet`——刪管道連同名單工作表）。
 * 已發佈的公告／行事曆無法自動撤回（宿主 P5 未落地），刪除前由 UI 確認框提醒。
 */
export async function deleteExamEvent(
  eventId: string,
  actor: Actor,
  ip?: string
): Promise<ExamEventWriteResult> {
  const event = await getExamEvent(eventId);
  if (!event) throw new ExamRegistrationError(404, "找不到報名場次");

  // 連動刪除該場次全部登錄（分批 transaction，每批 400 筆）
  const regCol = getAdminDb().collection(EXAM_REGISTRATIONS_COLLECTION);
  let deletedRegs = 0;
  for (;;) {
    const snap = await regCol.where("eventId", "==", eventId).limit(400).get();
    if (snap.empty) break;
    const batch = getAdminDb().batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    deletedRegs += snap.size;
    if (snap.size < 400) break;
  }

  await getAdminDb().collection(EXAM_EVENTS_COLLECTION).doc(eventId).delete();
  await invalidateExamRegistrationCaches();
  await logActivity({
    userId: actor.uid,
    role: actor.role,
    action: "exam_registration_event_deleted",
    ip,
    details: `刪除報名場次（${event.title}，狀態=${EXAM_EVENT_STATUS_LABELS[event.status]}${
      deletedRegs > 0 ? `，連同刪除 ${deletedRegs} 筆登錄` : "，無登錄"
    }）`,
  });
  return listAdminExamEvents();
}

/** 場次名單＋統計（同一次查詢，1 讀 ≈ 登錄人數；epoch 失效） */
export async function getExamEventRoster(eventId: string): Promise<ExamEventRoster | null> {
  const event = await getExamEvent(eventId);
  if (!event) return null;
  const { data, epoch } = await cachedListRead(`${ADMIN_ROSTER_KEY_PREFIX}${eventId}`, async () => {
    const snap = await getAdminDb()
      .collection(EXAM_REGISTRATIONS_COLLECTION)
      .where("eventId", "==", eventId)
      .limit(ROSTER_LIMIT)
      .get();
    const rows = snap.docs.map((doc) => readExamRegistration(doc.id, doc.data()));
    rows.sort(
      (a, b) =>
        a.studentClass.localeCompare(b.studentClass, "zh-Hant") ||
        a.seatNo.localeCompare(b.seatNo) ||
        a.studentName.localeCompare(b.studentName, "zh-Hant")
    );
    return { registrations: rows, summary: summarizeRoster(rows, event) };
  });
  return { eventId, event, ...data, epoch };
}

function summarizeRoster(rows: ExamRegistration[], event: ExamEvent): ExamRosterSummary {
  const bySubject: ExamRosterSummary["bySubject"] = {};
  for (const subject of event.subjects) {
    bySubject[subject.key] = {
      label: subject.label,
      count: 0,
      capacity: subjectCapacity(subject),
      full: false,
    };
  }
  const byClass: Record<string, number> = {};
  let registeredCount = 0;
  let optOutCount = 0;
  let archivedCount = 0;
  for (const row of rows) {
    if (row.archived) archivedCount += 1;
    if (row.optOut) {
      optOutCount += 1;
    } else {
      registeredCount += 1;
      for (const key of pickValidSubjectKeys(row.subjectKeys, event.subjects)) {
        const entry = bySubject[key];
        if (entry) entry.count += 1;
      }
    }
    byClass[row.studentClass] = (byClass[row.studentClass] ?? 0) + 1;
  }
  for (const entry of Object.values(bySubject)) {
    entry.full = entry.capacity > 0 && entry.count >= entry.capacity;
  }
  return { total: rows.length, registeredCount, optOutCount, archivedCount, bySubject, byClass };
}

/** 造冊 CSV：讀取名單後組 CSV（含 BOM）；內容直接回給管理端下載 */
export async function buildExamRegistrationCsvForEvent(
  eventId: string
): Promise<{ filename: string; content: string } | null> {
  const roster = await getExamEventRoster(eventId);
  if (!roster) return null;
  const content = buildExamRegistrationCsv(
    roster.registrations,
    roster.event.subjects,
    roster.event.locationOptions
  );
  const safeTitle = roster.event.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  return { filename: `造冊_${safeTitle || eventId}.csv`, content };
}

/**
 * 掛勾：場次開放時寫入行事曆（upsert，來源鍵＝場次 id，重複儲存只更新不重複）；
 * 公告沒有 upsert，只在「轉為開放」時發一次，避免重複儲存洗版。
 * M1 只發佈、不撤回（跨模組撤回介面尚未提供）；掛勾失敗不影響儲存結果。
 */
export async function syncExamEventHooks(
  event: ExamEvent,
  actor: Actor,
  publishAnnouncement: boolean
): Promise<void> {
  if (event.status !== "open") return;
  const audience = event.target.classes.length
    ? { roles: ["student"] as UserRole[], classCodes: event.target.classes }
    : schoolWideAudience(["student"]);
  const description = buildEventDescription(event);

  if (publishAnnouncement) {
    try {
      await publishFromModule({
        sourceModule: "examRegistration",
        sourceRef: event.id,
        title: `【報名開放】${event.title}`,
        body: description,
        authorUid: actor.uid,
        authorName: actor.name,
        authorRole: actor.role,
        audience,
        isPublic: false,
      });
    } catch (error) {
      console.error("Exam registration announcement hook error:", error);
    }
  }

  try {
    await publishScheduleFromModule({
      sourceModule: "examRegistration",
      sourceRef: event.id,
      title: event.title,
      description,
      // 地點：有選項取預設項名稱，否則沿用舊版文字（宿主全天事件僅支援單日，多日以起日入曆、描述帶區間）
      location:
        resolveLocationLabel(
          event.locationOptions,
          event.locationOptions.find((option) => option.isDefault)?.code ?? event.locationOptions[0]?.code ?? ""
        ) || event.location || undefined,
      allDay: true,
      allDayDate: event.examDate,
      audience,
      isPublic: false,
      status: "active",
      createdBy: { uid: actor.uid, name: actor.name, role: actor.role },
    });
  } catch (error) {
    console.error("Exam registration calendar hook error:", error);
  }
}

function assertDraftDeadline(draft: ExamEventDraft): void {
  if (draft.status === "open" && draft.deadline <= Date.now()) {
    throw new ExamRegistrationError(400, "開放報名狀態的截止時間必須晚於現在");
  }
}

function describeTarget(event: ExamEvent): string {
  const grades = event.target.grades.join("、") || "—";
  const classes = event.target.classes.length ? `（${event.target.classes.join("、")}）` : "（全年級）";
  return `${grades} 年級 ${classes}`;
}

function buildEventDescription(event: ExamEvent): string {
  const feeText =
    event.basicFee.standard > 0 || event.basicFee.reduced > 0
      ? `基本費用：一般生 ${event.basicFee.standard} 元／中低收入戶 ${event.basicFee.reduced} 元（低收入戶免繳）`
      : "";
  const windowText = event.registrationOpenAt
    ? `報名期間：${formatDateTime(event.registrationOpenAt)} ~ ${formatDateTime(event.deadline)}`
    : `報名期間：至 ${formatDateTime(event.deadline)}`;
  const locationText = event.locationOptions.length
    ? `考試地點：${event.locationOptions.map((option) => option.label).join("、")}（可選）`
    : event.location
      ? `考試地點：${event.location}`
      : "";
  const lines = [
    windowText,
    `考試日期：${formatExamDateRange(event)}`,
    locationText,
    `科目：${event.subjects.map((subject) => subject.label).join("、")}`,
    `對象：${describeTarget(event)}`,
    feeText,
    event.note ? `說明：${event.note}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function formatDateTime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
