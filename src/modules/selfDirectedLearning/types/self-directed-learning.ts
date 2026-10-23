/** 自主學習計畫：共用型別（client/server 皆可 import，不含伺服器端依賴） */

export const SELF_DIRECTED_LEARNING_SETTINGS_COLLECTION = "selfDirectedLearningSettings";
export const SELF_DIRECTED_LEARNING_SETTINGS_DOC_ID = "global";

export const WEEKDAY_LABELS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"] as const;

/** 審核人員（v1 手動輸入 uid＋名稱；uid 供 staff 端鑑權比對，v1.1 擬改帳號選擇器） */
export interface ReviewerEntry {
  uid: string;
  name: string;
}

/** 彈性學習節次行程：週幾（1=週一…7=週日）＋該日節次文字（如「第 5 節」） */
export interface FlexibleSlot {
  day: number;
  periods: string[];
}

/** 週數填寫形式：full＝全學期（空白週數都須填寫）；flexible＝彈性週數（至少下限週數） */
export type WeekMode = "full" | "flexible";

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
  /** 全學期週數（課綱 21/22 週，校方可調）：全學期模式＝須全數填寫的週數、彈性模式＝可填寫上限 */
  maxWeeks: number;
  /** 週數填寫形式（full＝全學期皆須填寫；flexible＝至少填到下限週數） */
  weekMode: WeekMode;
  /** 彈性模式的下限週數（建議至少 6 週；全學期模式不使用） */
  minWeeks: number;
  /** 校內彈性學習節次行程 */
  slots: FlexibleSlot[];
  /** 開放場域 */
  venues: string[];
  /** 審核人員名單 */
  reviewers: ReviewerEntry[];
  /** 給學生的說明文字 */
  instructions: string;
  updatedAt: number;
}

export const DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS: SelfDirectedLearningSettings = {
  enabled: true,
  openAt: null,
  closeAt: null,
  maxWeeks: 22,
  weekMode: "full",
  minWeeks: 6,
  slots: [],
  venues: [],
  reviewers: [],
  instructions: "",
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
          return { uid: uid.slice(0, 128), name: name.slice(0, 128) };
        })
        .filter((reviewer): reviewer is ReviewerEntry => reviewer !== null)
        .slice(0, 50)
    : [];
  const maxWeeks =
    typeof source.maxWeeks === "number" && Number.isInteger(source.maxWeeks)
      ? Math.min(Math.max(source.maxWeeks, 1), 52)
      : DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS.maxWeeks;
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
    maxWeeks,
    weekMode: source.weekMode === "flexible" ? "flexible" : "full",
    minWeeks: Math.min(Math.max(minWeeksRaw, 1), maxWeeks),
    slots,
    venues: asStringArray(source.venues, 60, 80),
    reviewers,
    instructions:
      typeof source.instructions === "string" ? source.instructions.slice(0, 4000) : "",
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
  if (typeof body.maxWeeks === "number" && !Number.isInteger(body.maxWeeks)) {
    return { ok: false, message: "全學期週數必須是整數" };
  }
  if ("enabled" in body && typeof body.enabled !== "boolean") {
    return { ok: false, message: "功能總開關格式錯誤" };
  }
  if ("weekMode" in body && body.weekMode !== "full" && body.weekMode !== "flexible") {
    return { ok: false, message: "週數填寫形式不合法" };
  }
  if ("minWeeks" in body && typeof body.minWeeks === "number" && !Number.isInteger(body.minWeeks)) {
    return { ok: false, message: "下限週數必須是整數" };
  }
  if (value.slots.length === 0 && value.maxWeeks < 1) {
    return { ok: false, message: "設定內容不合法" };
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

export type PlanParseResult =
  | { ok: true; value: Omit<SelfDirectedLearningPlan, "id" | "period" | "studentUid" | "studentName" | "grade" | "classCode" | "className" | "status" | "submittedAt" | "updatedAt"> }
  | { ok: false; message: string };

/** 學生計畫草稿輸入驗證（送審與草稿共用；草稿寬鬆、送審才套週數形式與每週必填） */
export function parsePlanDraft(
  raw: unknown,
  rules: Pick<SelfDirectedLearningSettings, "maxWeeks" | "minWeeks" | "weekMode">,
  action: "save" | "submit"
): PlanParseResult {
  const maxWeeks = rules.maxWeeks;
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
  if (body.weeks.length > maxWeeks) {
    return { ok: false, message: `週數不得超過學校設定的 ${maxWeeks} 週` };
  }
  if (action === "submit" && rules.weekMode === "full" && body.weeks.length !== maxWeeks) {
    return {
      ok: false,
      message: `全學期形式須填寫全部 ${maxWeeks} 週（目前 ${body.weeks.length} 週）`,
    };
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
    if (!Number.isInteger(weekNo) || weekNo < 1 || weekNo > maxWeeks) {
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
