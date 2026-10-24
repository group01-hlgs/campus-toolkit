/** 自主學習計畫：共用型別（client/server 皆可 import，不含伺服器端依賴） */

export const SELF_DIRECTED_LEARNING_SETTINGS_COLLECTION = "selfDirectedLearningSettings";
export const SELF_DIRECTED_LEARNING_SETTINGS_DOC_ID = "global";

export const WEEKDAY_LABELS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"] as const;

/** 單一審核人員可指派班級數的伺服器防濫用上限（＝主程式班級上限，實務上等同無限制） */
export const MAX_REVIEWER_CLASSES = 300;

/** 單一審核人員可指定個別學生數的伺服器防濫用上限 */
export const MAX_REVIEWER_STUDENTS = 500;

/** 指定審查的個別學生（denormalize 姓名與班級，省去顯示時的額外讀取） */
export interface ReviewerStudentRef {
  uid: string;
  name: string;
  classCode: string;
}

/** 審核人員（候選取自當期教職員名冊；uid 供 staff 端鑑權比對） */
export interface ReviewerEntry {
  uid: string;
  name: string;
  /** 指定審查班級（勾選後才顯示班級清單；未勾選且未指定個人＝全校） */
  classScoped?: boolean;
  /** classScoped＝true 時審查的班級代碼 */
  classCodes?: string[];
  /** 另指定個別學生（例外需求；勾選後才顯示學生選擇） */
  studentScoped?: boolean;
  /** studentScoped＝true 時審查的個別學生 */
  students?: ReviewerStudentRef[];
}

/** 審查範圍（供 staff 端查詢與審核權限檢查使用） */
export interface ReviewScope {
  /** true＝全校（不限制） */
  all: boolean;
  classCodes: string[];
  studentUids: string[];
}

/** 由審核人員設定解析出實際審查範圍（未勾選任何指定＝全校） */
export function reviewerScopeOf(reviewer: ReviewerEntry | null | undefined): ReviewScope {
  const classCodes = reviewer?.classScoped ? (reviewer.classCodes ?? []) : [];
  const studentUids = reviewer?.studentScoped
    ? (reviewer.students ?? []).map((student) => student.uid)
    : [];
  return {
    all: !reviewer?.classScoped && !reviewer?.studentScoped,
    classCodes: [...classCodes],
    studentUids,
  };
}

/** 名冊班級候選（審查對象「班級」與「個人」選擇用） */
export interface ClassOption {
  code: string;
  name: string;
  grade: string;
}

/** 名冊學生候選（審查對象「個人」選擇用；僅載入指定班級） */
export interface StudentOption {
  uid: string;
  name: string;
  classCode: string;
  className: string;
  grade: string;
}

/** 教職員名冊候選人（審核人員選擇用） */
export interface StaffCandidate {
  uid: string;
  name: string;
  /** 名冊屬性（如專任教師、兼導師）；候選不依此過濾 */
  attribute: string;
}

/** 彈性學習節次行程：週幾（1=週一…7=週日）＋該日節次文字（如「第 5 節」） */
export interface FlexibleSlot {
  day: number;
  periods: string[];
}

/** 逐週填寫無固定上限（週數受假期與定期考試影響）；
 *  全學期形式的週數由程式依學校行事曆（學期起訖）自動判斷，不開放人工設定；
 *  僅以防濫用為由保留伺服器硬上限 */
export const MAX_PLAN_WEEKS = 104;

/** 週數填寫形式：full＝全學期（空白週數都須填寫，週數自動判斷）；flexible＝彈性（至少下限週數） */
export type WeekMode = "full" | "flexible";

/** 節次候選（取自主程式課表作息；管理端節次行程選擇用） */
export interface PeriodOption {
  code: string;
  name: string;
  period: number;
}

/** 場域候選（取自主程式樓層空間設定的葉子空間；管理端開放場域選擇用） */
export interface SpaceOption {
  name: string;
  floor: string;
}

/** 總開關關閉時，非管理端一律只見此說明（頁面標題與 API 錯誤訊息共用） */
export const MAINTENANCE_TITLE = "目前此功能關閉維護中";
export const MAINTENANCE_HINT =
  "本功能正在維護資料，期間暫停填報與檢視，開放時間將另行公告。";

/** selfDirectedLearningSettings/global 單文件設定 */
export interface SelfDirectedLearningSettings {
  /** 功能總開關（false＝關閉維護中：學生／教職員／家長只見維護說明，寫入 API 一律擋下） */
  enabled: boolean;
  /** 開放撰寫開始（epoch ms；null＝尚未設定） */
  openAt: number | null;
  /** 開放撰寫截止（epoch ms；null＝尚未設定） */
  closeAt: number | null;
  /** 週數填寫形式（full＝全學期皆須填寫，週數由行事曆自動判斷；flexible＝至少填到下限週數） */
  weekMode: WeekMode;
  /** 彈性形式的下限週數（建議至少 6 週；全學期形式不使用） */
  minWeeks: number;
  /** 校內彈性學習節次行程 */
  slots: FlexibleSlot[];
  /** 開放場域 */
  venues: string[];
  /** 審核人員名單 */
  reviewers: ReviewerEntry[];
  /** 自主學習實施說明（給學生、家長的總說明） */
  instructions: string;
  /** 自主學習計畫撰寫說明（學生發起新計畫或編輯草稿時的撰寫說明） */
  writingInstructions: string;
  /** 儲存設定時是否同步發布（或更新）系統公告（由管理人員勾選，預設不自動發送） */
  publishAnnouncement: boolean;
  /** 儲存設定時是否同步發布（或更新）行事曆行程（由管理人員勾選，預設不自動發送） */
  publishCalendar: boolean;
  updatedAt: number;
}

export const DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS: SelfDirectedLearningSettings = {
  enabled: true,
  openAt: null,
  closeAt: null,
  weekMode: "full",
  minWeeks: 6,
  slots: [],
  venues: [],
  reviewers: [],
  instructions: "",
  writingInstructions: "",
  publishAnnouncement: false,
  publishCalendar: false,
  updatedAt: 0,
};

function asStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

function asEpoch(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function asReviewerStudents(value: unknown): ReviewerStudentRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const students: ReviewerStudentRef[] = [];
  for (const item of value) {
    if (students.length >= MAX_REVIEWER_STUDENTS) break;
    if (!item || typeof item !== "object") continue;
    const student = item as Record<string, unknown>;
    const uid = typeof student.uid === "string" ? student.uid.trim() : "";
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    students.push({
      uid: uid.slice(0, 128),
      name: (typeof student.name === "string" ? student.name.trim() : "").slice(0, 128),
      classCode:
        typeof student.classCode === "string" ? student.classCode.trim().slice(0, 20) : "",
    });
  }
  return students;
}

/** 讀 Firestore 原始資料後正規化（防欄位缺漏／型別損毀） */
export function normalizeSettings(raw: unknown): SelfDirectedLearningSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const slots: FlexibleSlot[] = Array.isArray(source.slots)
    ? source.slots
        .map((item): FlexibleSlot | null => {
          if (!item || typeof item !== "object") return null;
          const slot = item as Record<string, unknown>;
          const day = typeof slot.day === "number" ? slot.day : NaN;
          if (!Number.isInteger(day) || day < 1 || day > 7) return null;
          return { day, periods: asStringArray(slot.periods, 20, 40) };
        })
        .filter((slot): slot is FlexibleSlot => slot !== null)
        .slice(0, 14)
    : [];
  const reviewers: ReviewerEntry[] = Array.isArray(source.reviewers)
    ? source.reviewers
        .map((item): ReviewerEntry | null => {
          if (!item || typeof item !== "object") return null;
          const reviewer = item as Record<string, unknown>;
          const uid = typeof reviewer.uid === "string" ? reviewer.uid.trim() : "";
          if (!uid) return null;
          const name = typeof reviewer.name === "string" ? reviewer.name.trim() : "";
          const classCodes = asStringArray(reviewer.classCodes, MAX_REVIEWER_CLASSES, 20);
          const students = asReviewerStudents(reviewer.students);
          // 相容 0.0.20 以前的單一 scope 欄位（classes／students／all）
          const classScoped =
            typeof reviewer.classScoped === "boolean"
              ? reviewer.classScoped
              : reviewer.scope === "classes";
          const studentScoped =
            typeof reviewer.studentScoped === "boolean"
              ? reviewer.studentScoped
              : reviewer.scope === "students";
          return {
            uid: uid.slice(0, 128),
            name: name.slice(0, 128),
            classScoped,
            classCodes,
            studentScoped,
            students,
          };
        })
        .filter((reviewer): reviewer is ReviewerEntry => reviewer !== null)
        .slice(0, 50)
    : [];
  const minWeeksRaw =
    typeof source.minWeeks === "number" && Number.isInteger(source.minWeeks)
      ? source.minWeeks
      : DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS.minWeeks;
  return {
    enabled:
      typeof source.enabled === "boolean"
        ? source.enabled
        : DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS.enabled,
    openAt: asEpoch(source.openAt),
    closeAt: asEpoch(source.closeAt),
    weekMode: source.weekMode === "flexible" ? "flexible" : "full",
    minWeeks: Math.min(Math.max(minWeeksRaw, 1), MAX_PLAN_WEEKS),
    slots,
    venues: asStringArray(source.venues, 60, 80),
    reviewers,
    instructions:
      typeof source.instructions === "string" ? source.instructions.slice(0, 4000) : "",
    writingInstructions:
      typeof source.writingInstructions === "string"
        ? source.writingInstructions.slice(0, 4000)
        : "",
    // 舊版單一開關（syncAnnouncementAndCalendar）一併視為兩者皆開啟，避免既有勾選失效
    publishAnnouncement:
      typeof source.publishAnnouncement === "boolean"
        ? source.publishAnnouncement
        : typeof source.syncAnnouncementAndCalendar === "boolean"
          ? source.syncAnnouncementAndCalendar
          : DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS.publishAnnouncement,
    publishCalendar:
      typeof source.publishCalendar === "boolean"
        ? source.publishCalendar
        : typeof source.syncAnnouncementAndCalendar === "boolean"
          ? source.syncAnnouncementAndCalendar
          : DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS.publishCalendar,
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : 0,
  };
}

export type ParseResult = { ok: true; value: SelfDirectedLearningSettings } | { ok: false; message: string };

/** API 輸入驗證（POST body） */
export function parseSettingsInput(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, message: "請求內容格式錯誤" };
  const body = raw as Record<string, unknown>;
  const openAt = asEpoch(body.openAt);
  const closeAt = asEpoch(body.closeAt);
  if (body.openAt !== null && openAt === null) return { ok: false, message: "開放開始時間格式錯誤" };
  if (body.closeAt !== null && closeAt === null) return { ok: false, message: "開放截止時間格式錯誤" };
  if (openAt !== null && closeAt !== null && closeAt <= openAt) {
    return { ok: false, message: "截止時間必須晚於開始時間" };
  }
  const value = normalizeSettings(body);
  if ("enabled" in body && typeof body.enabled !== "boolean") {
    return { ok: false, message: "功能總開關格式錯誤" };
  }
  if ("weekMode" in body && body.weekMode !== "full" && body.weekMode !== "flexible") {
    return { ok: false, message: "週數填寫形式不合法" };
  }
  if ("minWeeks" in body && typeof body.minWeeks === "number" && !Number.isInteger(body.minWeeks)) {
    return { ok: false, message: "下限週數必須是整數" };
  }
  if ("publishAnnouncement" in body && typeof body.publishAnnouncement !== "boolean") {
    return { ok: false, message: "系統公告同步設定格式錯誤" };
  }
  if ("publishCalendar" in body && typeof body.publishCalendar !== "boolean") {
    return { ok: false, message: "行事曆同步設定格式錯誤" };
  }
  return { ok: true, value };
}

/** 開放狀態：closed（未設定或未開始）／open（開放中）／ended（已截止） */
export function openStateOf(
  settings: SelfDirectedLearningSettings,
  now: number = Date.now()
): "unset" | "closed" | "open" | "ended" {
  if (settings.openAt === null || settings.closeAt === null) return "unset";
  if (now < settings.openAt) return "closed";
  if (now > settings.closeAt) return "ended";
  return "open";
}

/* ——— 學生計畫（selfDirectedLearningPlans） ——— */

export const SELF_DIRECTED_LEARNING_PLANS_COLLECTION = "selfDirectedLearningPlans";
export const SELF_DIRECTED_LEARNING_REVIEWS_COLLECTION = "selfDirectedLearningReviews";

/** 安排時段：學校彈性學習時間／課餘時間（課綱） */
export type PlanTiming = "flexible" | "afterSchool";

/** draft 草稿 → submitted 審核中 → approved 通過／returned 退回修改 */
export type PlanStatus = "draft" | "submitted" | "approved" | "returned";

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  draft: "草稿",
  submitted: "審核中",
  approved: "已通過",
  returned: "退回修改",
};

export const PLAN_TIMING_LABELS: Record<PlanTiming, string> = {
  flexible: "學校彈性學習時間",
  afterSchool: "課餘時間",
};

/** 每週課程安排 */
export interface PlanWeek {
  week: number;
  content: string;
  venue: string;
  timing: PlanTiming;
}

export interface SelfDirectedLearningPlan {
  /** doc id＝`${period}_${studentUid}` */
  id: string;
  /** 學期識別（如 `115-1`） */
  period: string;
  studentUid: string;
  studentName: string;
  grade: string;
  classCode: string;
  className: string;
  /** 主題 */
  topic: string;
  /** 學群 */
  studyGroup: string;
  /** 指導老師（非必填） */
  advisor: string;
  weeks: PlanWeek[];
  status: PlanStatus;
  submittedAt: number | null;
  updatedAt: number;
}

/** 審查意見（staff 端寫入；學生端讀最新一筆） */
export interface PlanReview {
  id: string;
  planId: string;
  reviewerUid: string;
  reviewerName: string;
  /** "approved" | "returned" */
  decision: "approved" | "returned";
  note: string;
  reviewedAt: number;
}

export function periodLabelOf(period: { academicYear: number; semester: number }): string {
  return `${period.academicYear}-${period.semester}`;
}

export function planDocIdOf(period: string, studentUid: string): string {
  return `${period}_${studentUid}`;
}

function isTiming(value: unknown): value is PlanTiming {
  return value === "flexible" || value === "afterSchool";
}

/**
 * 由起訖日期（YYYY-MM-DD）推算週數；不可用時回 null。
 * 台灣公家機關週計算：每週第一日為星期日、最後一日為星期六；
 * 第一週或最後一週未滿七日仍以一週計（先對齊到所在週的週日／週六再算整週）。
 */
export function countWeeksBetween(start: string, end: string): number | null {
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) return null;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return null;
  }
  // getDay()：0=週日…6=週六。起日回退到該週週日、訖日進位到該週週六
  const alignedStart = new Date(startDate);
  alignedStart.setDate(startDate.getDate() - startDate.getDay());
  const alignedEnd = new Date(endDate);
  alignedEnd.setDate(endDate.getDate() + (6 - endDate.getDay()));
  const days =
    Math.round((alignedEnd.getTime() - alignedStart.getTime()) / 86_400_000) + 1;
  return Math.round(days / 7);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type PlanParseResult =
  | { ok: true; value: Omit<SelfDirectedLearningPlan, "id" | "period" | "studentUid" | "studentName" | "grade" | "classCode" | "className" | "status" | "submittedAt" | "updatedAt"> }
  | { ok: false; message: string };

/** 學生計畫草稿輸入驗證（送審與草稿共用；草稿寬鬆、送審才套週數形式與每週必填） */
export function parsePlanDraft(
  raw: unknown,
  rules: Pick<SelfDirectedLearningSettings, "weekMode" | "minWeeks"> & {
    /** 程式判斷的學期總週數（兩種形式的填寫上限；null＝學校尚未設定起訖） */
    fullWeeks: number | null;
  },
  action: "save" | "submit"
): PlanParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, message: "請求內容格式錯誤" };
  const body = raw as Record<string, unknown>;
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 100) : "";
  const studyGroup = typeof body.studyGroup === "string" ? body.studyGroup.trim().slice(0, 100) : "";
  const advisor = typeof body.advisor === "string" ? body.advisor.trim().slice(0, 100) : "";
  if (!topic) return { ok: false, message: "請填寫主題" };
  if (!studyGroup) return { ok: false, message: "請填寫學群" };

  if (!Array.isArray(body.weeks) || body.weeks.length < 1) {
    return { ok: false, message: "請至少填寫一週的課程安排" };
  }
  if (body.weeks.length > MAX_PLAN_WEEKS) {
    return { ok: false, message: `週數不得超過 ${MAX_PLAN_WEEKS} 週` };
  }
  // 兩種形式的填寫上限皆為程式判斷的學期總週數
  if (action === "submit" && rules.fullWeeks !== null && body.weeks.length > rules.fullWeeks) {
    return {
      ok: false,
      message: `週數不得超過程式判斷的學期總週數 ${rules.fullWeeks} 週（目前 ${body.weeks.length} 週）`,
    };
  }
  if (action === "submit" && rules.weekMode === "full") {
    if (rules.fullWeeks === null) {
      return {
        ok: false,
        message: "學校尚未設定上課日／學期起訖，暫無法判斷全學期週數——請改用彈性形式，或請學校至「學校基本設定 → 學期起訖設定」填寫上課日起訖",
      };
    }
    if (body.weeks.length !== rules.fullWeeks) {
      return {
        ok: false,
        message: `全學期形式須填寫全部 ${rules.fullWeeks} 週（目前 ${body.weeks.length} 週）`,
      };
    }
  }
  if (action === "submit" && rules.weekMode === "flexible" && body.weeks.length < rules.minWeeks) {
    return {
      ok: false,
      message: `彈性形式至少須填寫 ${rules.minWeeks} 週的學校下限（目前 ${body.weeks.length} 週）`,
    };
  }
  const weeks: PlanWeek[] = [];
  const seen = new Set<number>();
  for (const item of body.weeks) {
    if (!item || typeof item !== "object") return { ok: false, message: "每週安排格式錯誤" };
    const week = item as Record<string, unknown>;
    const weekNo = typeof week.week === "number" ? week.week : NaN;
    if (!Number.isInteger(weekNo) || weekNo < 1 || weekNo > MAX_PLAN_WEEKS) {
      return { ok: false, message: "週次編號不合法" };
    }
    if (seen.has(weekNo)) return { ok: false, message: `第 ${weekNo} 週重複` };
    seen.add(weekNo);
    const content = typeof week.content === "string" ? week.content.trim().slice(0, 600) : "";
    const venue = typeof week.venue === "string" ? week.venue.trim().slice(0, 120) : "";
    // 草稿可留白（進度可分次完成）；送審時每一週的學習安排與場地都必填
    if (action === "submit" && !content) return { ok: false, message: `第 ${weekNo} 週未填寫學習安排` };
    if (action === "submit" && !venue) return { ok: false, message: `第 ${weekNo} 週未填寫場地` };
    const timing: PlanTiming = isTiming(week.timing) ? week.timing : "flexible";
    weeks.push({ week: weekNo, content, venue, timing });
  }
  weeks.sort((a, b) => a.week - b.week);
  return { ok: true, value: { topic, studyGroup, advisor, weeks } };
}

/* ——— 教職員審核 ——— */

export type ReviewAction = "approve" | "return";

export type ReviewParseResult =
  | { ok: true; value: { planId: string; action: ReviewAction; note: string } }
  | { ok: false; message: string };

/** 審核輸入驗證（退回必填審查意見） */
export function parseReviewInput(raw: unknown): ReviewParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, message: "請求內容格式錯誤" };
  const body = raw as Record<string, unknown>;
  const planId = typeof body.planId === "string" ? body.planId.trim() : "";
  if (!planId) return { ok: false, message: "缺少計畫識別" };
  const isApprove = body.action === "approve";
  const isReturn = body.action === "return";
  if (!isApprove && !isReturn) return { ok: false, message: "審核動作不合法" };
  const action: ReviewAction = isApprove ? "approve" : "return";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (action === "return" && !note) {
    return { ok: false, message: "退回時必須填寫審查意見" };
  }
  return { ok: true, value: { planId, action, note } };
}
