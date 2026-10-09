/**
 * 行事曆功能模組的型別與純函式（前端與伺服器共用；**不可** import server-only）。
 *
 * 資料存於 Firestore `calendarEvents` 集合（不入 settings/system，避免整份覆寫抹掉）。
 * 個人提醒存 `calendarReminders`（doc id＝`${eventId}_${uid}`）。
 * 模組設定（分類、提醒開關、顯示位置、行程原則）存 `settings/calendar` 單文件。
 *
 * 跨模組協議：其他模組在伺服器端呼叫 `src/lib/calendar.ts` 的
 * `publishScheduleFromModule()`（含 upsert 語意），只寫本集合、必填 `sourceModule`，
 * 受眾必須明確（見該檔註解）。
 */

import { ALL_ROLES, ROLE_LABELS, UserRole } from "./users";
import { ensureFallbackCategory, resolveCategoryName } from "./category";

export const CALENDAR_COLLECTION = "calendarEvents";
export const CALENDAR_SETTINGS_DOC_ID = "calendar";
/** 個人行程提醒：doc id＝`${eventId}_${uid}` */
export const CALENDAR_REMINDERS_COLLECTION = "calendarReminders";

/** active＝顯示中；cancelled＝保留文件、不顯示（供來源模組對帳） */
export type CalendarEventStatus = "active" | "cancelled";

/** 全站不限班級的 classCodes 哨兵（Firestore array-contains 查詢用） */
export const ALL_CLASSES_SENTINEL = "*";

export interface CalendarAudience {
  /** 可見身分（至少一個） */
  roles: UserRole[];
  /**
   * 班級代碼；空陣列或含 `*` ＝不限班級。
   * 有具體代碼時＝僅這些班可見（導師班行程）。
   */
  classCodes: string[];
}

export interface CalendarCategory {
  id: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
}

/**
 * 行程顯示位置（5 處，比照系統公告）：
 * 系統首頁登入表單上方＋四種身分功能首頁（切換身分下拉選單下方、第一個登出按鈕上方）。
 * 每處由管理員決定「顯示與否」。
 */
export type CalendarSurface = "login" | "student" | "parent" | "staff" | "admin";

export const CALENDAR_SURFACES: CalendarSurface[] = [
  "login",
  "student",
  "parent",
  "staff",
  "admin",
];

export const CALENDAR_SURFACE_LABELS: Record<CalendarSurface, string> = {
  login: "系統首頁（登入表單上方）",
  student: "學生功能首頁",
  parent: "家長功能首頁",
  staff: "教職員功能首頁",
  admin: "管理員功能首頁",
};

export function isCalendarSurface(value: unknown): value is CalendarSurface {
  return typeof value === "string" && (CALENDAR_SURFACES as string[]).includes(value);
}

/**
 * 顯示位置設定：目前僅「顯示與否」——顯示方式統一處理（單一行、
 * 顯示尚未結束的第 1 則行程），日後要逐處設定方式／筆數時再擴充欄位。
 */
export interface CalendarSurfaceSetting {
  enabled: boolean;
}

export type CalendarSurfaces = Record<CalendarSurface, CalendarSurfaceSetting>;

export function defaultCalendarSurfaces(): CalendarSurfaces {
  const setting: CalendarSurfaceSetting = { enabled: true };
  return {
    login: { ...setting },
    student: { ...setting },
    parent: { ...setting },
    staff: { ...setting },
    admin: { ...setting },
  };
}

/**
 * 行程原則（「規則設定」卡片設定）：
 * `hardDeleteCancelled`＝下架（取消）行程真實刪除——文件連同個人提醒一併刪除，
 * 關閉（預設）＝保留文件、僅不再顯示給任何身分（供來源模組對帳）。
 */
export interface CalendarPolicies {
  hardDeleteCancelled: boolean;
}

export const DEFAULT_CALENDAR_POLICIES: CalendarPolicies = {
  hardDeleteCancelled: false,
};

export interface CalendarSettings {
  categories: CalendarCategory[];
  /** 是否啟用個人提醒（「提醒我」按鈕） */
  defaultRemindersEnabled: boolean;
  /** 5 個顯示位置的顯示與否 */
  surfaces: CalendarSurfaces;
  /** 行程原則（下架真實刪除） */
  policies: CalendarPolicies;
}

export const DEFAULT_CALENDAR_CATEGORIES: CalendarCategory[] = [
  { id: "termStart", name: "學期初", sortOrder: 0, enabled: true },
  { id: "midterm", name: "期中", sortOrder: 1, enabled: true },
  { id: "final", name: "期末", sortOrder: 2, enabled: true },
  { id: "event", name: "活動", sortOrder: 3, enabled: true },
  { id: "other", name: "其他", sortOrder: 4, enabled: true },
];

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  categories: DEFAULT_CALENDAR_CATEGORIES,
  defaultRemindersEnabled: true,
  surfaces: defaultCalendarSurfaces(),
  policies: DEFAULT_CALENDAR_POLICIES,
};

/**
 * 後備行事曆類型（不可刪除）：類型被刪除後，既有行程顯示時自動歸入此類型。
 * 見 `types/category.ts` 的刪除機制說明。
 */
export const CALENDAR_FALLBACK_CATEGORY_ID = "other";
export const CALENDAR_FALLBACK_CATEGORY_NAME = "其他";

/** 補齊後備類型用的預設條目（sortOrder 由呼叫端決定） */
export function defaultCalendarFallbackCategory(sortOrder: number): CalendarCategory {
  return {
    id: CALENDAR_FALLBACK_CATEGORY_ID,
    name: CALENDAR_FALLBACK_CATEGORY_NAME,
    sortOrder,
    enabled: true,
  };
}

export interface CalendarEventRecord {
  id: string;
  title: string; // ≤ 120 字，必填
  description?: string; // ≤ 2000 字
  location?: string; // ≤ 120 字
  startAt: number; // epoch ms，必填（全天事件＝當日零時）
  endAt?: number; // epoch ms；缺省＝單點事件
  /** "YYYY-MM-DD"；全天事件用（此時 startAt 為當日本地零時） */
  allDayDate?: string;
  important: boolean; // 重要性標記（預設 false）
  /** 行事曆分類（settings/calendar 的 categories 之一） */
  categoryId: string;
  sourceModule: string; // 必填：來源模組代碼；行事曆自己建＝"calendar"
  sourceRef?: string; // 來源資料 id（如預約單號），改期/取消靠它定位
  audience: CalendarAudience;
  status: CalendarEventStatus;
  createdBy: { uid: string; name: string; role: UserRole };
  /** 發佈單位（如：教務處）；教職員建立時預帶名冊「單位」，可改 */
  publishUnit?: string;
  academicYear?: number;
  semester?: 1 | 2;
  createdAt: number;
  updatedAt: number;
}

/** 回給使用者端的行程項目（剝除 uid 等個資） */
export interface CalendarEventItem {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startAt: number;
  endAt?: number;
  allDayDate?: string;
  important: boolean;
  categoryId: string;
  categoryName: string;
  sourceModule: string;
  sourceRef?: string;
  audienceRoles: UserRole[];
  classScoped: boolean;
  classCodes: string[];
  status: CalendarEventStatus;
  createdByName: string;
  createdByRole: UserRole;
  /** 發佈單位（如：教務處） */
  publishUnit?: string;
  academicYear?: number;
  semester?: 1 | 2;
  createdAt: number;
  updatedAt: number;
  /** 使用者是否已設定個人提醒（API 依登入 uid 補上） */
  reminded?: boolean;
}

/** 顯示位置（系統首頁登入表單上方／四種身分功能首頁）回傳的行程項目 */
export interface CalendarSurfaceItem {
  id: string;
  title: string;
  startAt: number;
  endAt?: number;
  allDayDate?: string;
  important: boolean;
  categoryId: string;
  categoryName: string;
  sourceModule: string;
  publishUnit?: string;
}

/** 個人行程提醒列表項目 */
export interface CalendarReminderItem {
  eventId: string;
  title: string;
  description?: string;
  location?: string;
  startAt: number;
  endAt?: number;
  allDayDate?: string;
  important: boolean;
  categoryName: string;
  classScoped: boolean;
  createdAt: number;
}

/** 管理端清單項目：完整記錄＋行事曆類型名稱（保留巢狀 audience／createdBy 供編輯表單回填） */
export type AdminCalendarEventRow = CalendarEventRecord & {
  categoryName: string;
};

/** 不限班級的受眾 */
export function schoolWideAudience(roles: UserRole[]): CalendarAudience {
  return { roles: [...roles], classCodes: [ALL_CLASSES_SENTINEL] };
}

/** 是否為「不限班級」受眾 */
export function isSchoolWideAudience(audience: CalendarAudience): boolean {
  const codes = audience.classCodes ?? [];
  return codes.length === 0 || codes.includes(ALL_CLASSES_SENTINEL);
}

export function audienceClassScoped(audience: CalendarAudience): boolean {
  return !isSchoolWideAudience(audience);
}

/** 受眾是否包含該身分 */
export function audienceHasRole(audience: CalendarAudience, role: UserRole): boolean {
  return (audience.roles ?? []).includes(role);
}

/** 受眾是否可見於該班級（校級行程恒為 true；班級行程比對 classCode） */
export function audienceCoversClass(
  audience: CalendarAudience,
  classCode: string | undefined | null
): boolean {
  if (isSchoolWideAudience(audience)) return true;
  if (!classCode) return false;
  return (audience.classCodes ?? []).includes(classCode);
}

/** 行程對「該身分＋該班級」是否可見（管理端清單不受此限） */
export function canViewCalendarEvent(
  audience: CalendarAudience,
  role: UserRole,
  classCode: string | undefined | null
): boolean {
  return audienceHasRole(audience, role) && audienceCoversClass(audience, classCode);
}

/** 本地時區的該日零時（epoch ms）；日期非法回 0 */
export function allDayStartMs(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return 0;
  const ms = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** 本地時區的今日零時（epoch ms） */
export function startOfTodayMs(now: number = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 行程的結束時間（無 endAt＝單點事件，以其開始時間計） */
export function calendarEventEnd(item: { startAt: number; endAt?: number }): number {
  return typeof item.endAt === "number" && item.endAt > 0 ? item.endAt : item.startAt;
}

/**
 * 讀取端是否應顯示此行程：非 cancelled，且尚未早於「今日零時」結束
 * （同公告「到期自動隱藏」原則；查詢已下推 `startAt >= 今日零時`，此為記憶體安全網）。
 */
export function isCalendarEventActive(
  item: { status: CalendarEventStatus; startAt: number; endAt?: number },
  now: number = Date.now()
): boolean {
  if (item.status !== "active") return false;
  return calendarEventEnd(item) >= startOfTodayMs(now);
}

/** 行程輸入（表單與跨模組 publish 共用） */
export interface CalendarEventInput {
  title: string;
  description?: string;
  location?: string;
  startAt?: number;
  endAt?: number | null;
  /** 全天事件：以 allDayDate 定日，startAt 由其推導 */
  allDay?: boolean;
  allDayDate?: string;
  important?: boolean;
  categoryId?: string;
  /** 發佈單位（如：教務處）；缺省＝沿用現值（upsert 時） */
  publishUnit?: string;
  audience: CalendarAudience;
  academicYear?: number;
  semester?: 1 | 2;
}

export interface ValidatedCalendarEventInput {
  title: string;
  description?: string;
  location?: string;
  startAt: number;
  endAt?: number;
  allDayDate?: string;
  important: boolean;
  categoryId: string;
  publishUnit?: string;
  audience: CalendarAudience;
  academicYear?: number;
  semester?: 1 | 2;
}

export type CalendarValidation =
  | { ok: true; value: ValidatedCalendarEventInput }
  | { ok: false; message: string };

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;
const LOCATION_MAX = 120;
const CLASS_CODE_MAX = 32;
const CATEGORY_ID_MAX = 64;
const PUBLISH_UNIT_MAX = 64;
/** 允許的時間範圍：約 5 年，擋住明顯毀損的值 */
const MAX_FUTURE_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const MAX_PAST_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * 驗證並正規化行程輸入（建立表單、編輯與跨模組 publish 共用）。
 * 條件：標題非空、時間合法（endAt ≥ startAt）、roles 非空——見規劃書 §4.2 契約條文 1。
 */
export function validateCalendarInput(input: CalendarEventInput): CalendarValidation {
  const title = text(input.title, TITLE_MAX);
  if (!title) return { ok: false, message: "請填寫行程標題" };

  const allowed = ALL_ROLES;
  const roles = Array.isArray(input.audience?.roles)
    ? ALL_ROLES.filter((role) => input.audience.roles.includes(role) && allowed.includes(role))
    : [];
  if (roles.length === 0) return { ok: false, message: "請至少選擇一個可見身分" };

  const rawCodes = Array.isArray(input.audience?.classCodes) ? input.audience.classCodes : [];
  const classCodes: string[] = [];
  for (const raw of rawCodes) {
    const code = text(raw, CLASS_CODE_MAX);
    if (!code) continue;
    if (!classCodes.includes(code)) classCodes.push(code);
  }
  const normalizedAudience: CalendarAudience =
    classCodes.length === 0 ? schoolWideAudience(roles) : { roles, classCodes };

  const description = text(input.description, DESCRIPTION_MAX);
  const location = text(input.location, LOCATION_MAX);
  const important = input.important === true;
  const categoryId =
    text(input.categoryId, CATEGORY_ID_MAX) || CALENDAR_FALLBACK_CATEGORY_ID;
  const publishUnit = text(input.publishUnit, PUBLISH_UNIT_MAX) || undefined;

  const now = Date.now();
  const allDay = input.allDay === true;
  if (allDay) {
    const allDayDate = text(input.allDayDate, 10);
    const startAt = allDayStartMs(allDayDate);
    if (!allDayDate || !startAt) {
      return { ok: false, message: "請填寫正確的全天日期（YYYY-MM-DD）" };
    }
    if (startAt < now - MAX_PAST_MS || startAt > now + MAX_FUTURE_MS) {
      return { ok: false, message: "全天日期超出合理範圍" };
    }
    return {
      ok: true,
      value: {
        title,
        description: description || undefined,
        location: location || undefined,
        startAt,
        endAt: startAt + 24 * 60 * 60 * 1000 - 1,
        allDayDate,
        important,
        categoryId,
        publishUnit,
        audience: normalizedAudience,
        academicYear:
          typeof input.academicYear === "number" && input.academicYear > 0
            ? input.academicYear
            : undefined,
        semester: input.semester === 1 || input.semester === 2 ? input.semester : undefined,
      },
    };
  }

  const startAt =
    typeof input.startAt === "number" && Number.isFinite(input.startAt) && input.startAt > 0
      ? input.startAt
      : 0;
  if (!startAt) return { ok: false, message: "請填寫開始時間" };
  if (startAt < now - MAX_PAST_MS || startAt > now + MAX_FUTURE_MS) {
    return { ok: false, message: "開始時間超出合理範圍" };
  }

  let endAt: number | undefined;
  if (typeof input.endAt === "number" && Number.isFinite(input.endAt) && input.endAt > 0) {
    endAt = input.endAt;
    if (endAt < startAt) return { ok: false, message: "結束時間不得早於開始時間" };
    if (endAt > startAt + MAX_FUTURE_MS) return { ok: false, message: "結束時間超出合理範圍" };
  }

  return {
    ok: true,
    value: {
      title,
      description: description || undefined,
      location: location || undefined,
      startAt,
      endAt,
      important,
      categoryId,
      audience: normalizedAudience,
      academicYear:
        typeof input.academicYear === "number" && input.academicYear > 0
          ? input.academicYear
          : undefined,
      semester: input.semester === 1 || input.semester === 2 ? input.semester : undefined,
    },
  };
}

/** 教職員建立時：受眾若限定班級，必須包含自己的導師班（防發到別班） */
export function staffAudienceAllowed(
  audience: CalendarAudience,
  staffClassCode: string | undefined | null
): boolean {
  if (!audienceClassScoped(audience)) return true;
  if (!staffClassCode) return false;
  return (audience.classCodes ?? []).includes(staffClassCode);
}

/** Firestore 原始文件 → 行程記錄（寬容解析） */
export function readCalendarEventRecord(
  id: string,
  raw: Record<string, unknown> | null | undefined
): CalendarEventRecord | null {
  if (!raw) return null;
  const roles = Array.isArray(raw.audienceRoles)
    ? ALL_ROLES.filter((role) => (raw.audienceRoles as unknown[]).includes(role))
    : [];
  const classCodes = Array.isArray(raw.audienceClassCodes)
    ? (raw.audienceClassCodes as unknown[])
        .filter((code): code is string => typeof code === "string" && code.length > 0)
        .slice(0, 50)
    : [];
  const audience: CalendarAudience =
    classCodes.length === 0 ? schoolWideAudience(roles) : { roles, classCodes };
  const status: CalendarEventStatus = raw.status === "cancelled" ? "cancelled" : "active";
  const createdByRaw = raw.createdBy && typeof raw.createdBy === "object"
    ? (raw.createdBy as Record<string, unknown>)
    : null;
  return {
    id,
    title: typeof raw.title === "string" ? raw.title : "",
    description: typeof raw.description === "string" && raw.description ? raw.description : undefined,
    location: typeof raw.location === "string" && raw.location ? raw.location : undefined,
    startAt: typeof raw.startAt === "number" ? raw.startAt : 0,
    endAt: typeof raw.endAt === "number" && raw.endAt > 0 ? raw.endAt : undefined,
    allDayDate:
      typeof raw.allDayDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.allDayDate)
        ? raw.allDayDate
        : undefined,
    important: raw.important === true,
    categoryId: typeof raw.categoryId === "string" ? raw.categoryId : "",
    publishUnit:
      typeof raw.publishUnit === "string" && raw.publishUnit ? raw.publishUnit : undefined,
    sourceModule: typeof raw.sourceModule === "string" ? raw.sourceModule : "calendar",
    sourceRef: typeof raw.sourceRef === "string" && raw.sourceRef ? raw.sourceRef : undefined,
    audience,
    status,
    createdBy: {
      uid: typeof createdByRaw?.uid === "string" ? createdByRaw.uid : "",
      name: typeof createdByRaw?.name === "string" ? createdByRaw.name : "",
      role: (ALL_ROLES as string[]).includes(createdByRaw?.role as string)
        ? (createdByRaw?.role as UserRole)
        : "admin",
    },
    academicYear: typeof raw.academicYear === "number" ? raw.academicYear : undefined,
    semester: raw.semester === 1 || raw.semester === 2 ? raw.semester : undefined,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

/**
 * 行程記錄 → Firestore 寫入欄位。
 * audience 拉平為 `audienceRoles`／`audienceClassCodes` 以便 array-contains 查詢（比照公告）。
 */
export function calendarEventToFirestore(
  record: Omit<CalendarEventRecord, "id">
): Record<string, unknown> {
  return {
    title: record.title,
    ...(record.description ? { description: record.description } : {}),
    ...(record.location ? { location: record.location } : {}),
    startAt: record.startAt,
    ...(record.endAt ? { endAt: record.endAt } : {}),
    ...(record.allDayDate ? { allDayDate: record.allDayDate } : {}),
    important: record.important === true,
    categoryId: record.categoryId,
    sourceModule: record.sourceModule,
    ...(record.sourceRef ? { sourceRef: record.sourceRef } : {}),
    audienceRoles: record.audience.roles,
    audienceClassCodes: record.audience.classCodes,
    status: record.status,
    createdBy: record.createdBy,
    ...(record.publishUnit ? { publishUnit: record.publishUnit } : {}),
    ...(record.academicYear ? { academicYear: record.academicYear } : {}),
    ...(record.semester ? { semester: record.semester } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** 行程記錄 → 使用者端回傳項目（剝除 uid） */
export function calendarEventToItem(
  record: CalendarEventRecord,
  categoryName: string
): CalendarEventItem {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    location: record.location,
    startAt: record.startAt,
    endAt: record.endAt,
    allDayDate: record.allDayDate,
    important: record.important,
    categoryId: record.categoryId,
    categoryName,
    sourceModule: record.sourceModule,
    sourceRef: record.sourceRef,
    audienceRoles: record.audience.roles,
    classScoped: audienceClassScoped(record.audience),
    classCodes: record.audience.classCodes,
    status: record.status,
    createdByName: record.createdBy.name,
    createdByRole: record.createdBy.role,
    publishUnit: record.publishUnit,
    academicYear: record.academicYear,
    semester: record.semester,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** 行事曆類型表寬容讀取（缺漏／毀損退回預設五類） */
export function readCalendarSettings(raw: unknown): CalendarSettings {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rawCategories = data?.categories;
  let categories: CalendarCategory[] = [];
  if (Array.isArray(rawCategories)) {
    categories = rawCategories
      .map((item, index) => {
        const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
        const id = text(row?.id, CATEGORY_ID_MAX);
        const name = text(row?.name, 64);
        if (!id || !name) return null;
        return {
          id,
          name,
          sortOrder: typeof row?.sortOrder === "number" ? row.sortOrder : index,
          enabled: row?.enabled !== false,
        } satisfies CalendarCategory;
      })
      .filter((item): item is CalendarCategory => item !== null);
  }
  if (categories.length === 0) categories = [...DEFAULT_CALENDAR_CATEGORIES];
  // 後備類型（其他）不可被刪除：讀入時補齊並強制啟用（僅記憶體，不寫回）
  categories = ensureFallbackCategory(categories, CALENDAR_FALLBACK_CATEGORY_ID, () =>
    defaultCalendarFallbackCategory(categories.length)
  );

  // 5 個顯示位置：逐 key 寬容讀取，缺漏／毀損一律退回預設（未設定＝顯示）
  const surfaces: CalendarSurfaces = defaultCalendarSurfaces();
  const rawSurfaces = data?.surfaces;
  if (rawSurfaces && typeof rawSurfaces === "object") {
    const map = rawSurfaces as Record<string, unknown>;
    for (const key of CALENDAR_SURFACES) {
      const row = map[key];
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      surfaces[key] = { enabled: item.enabled !== false };
    }
  }

  // 行程原則：逐 key 寬容讀取，缺漏／毀損一律退回預設
  const policies: CalendarPolicies = { ...DEFAULT_CALENDAR_POLICIES };
  const rawPolicies = data?.policies;
  if (rawPolicies && typeof rawPolicies === "object") {
    const row = rawPolicies as Record<string, unknown>;
    if (typeof row.hardDeleteCancelled === "boolean") {
      policies.hardDeleteCancelled = row.hardDeleteCancelled;
    }
  }

  return {
    categories,
    defaultRemindersEnabled: data?.defaultRemindersEnabled !== false,
    surfaces,
    policies,
  };
}

/** 行事曆類型顯示名稱（查無退回 id 或「其他」） */
export function calendarCategoryName(
  settings: CalendarSettings,
  categoryId: string
): string {
  return resolveCategoryName(
    settings.categories,
    CALENDAR_FALLBACK_CATEGORY_ID,
    CALENDAR_FALLBACK_CATEGORY_NAME,
    categoryId
  );
}

/** 行程權限顯示文字：身分名稱串接 */
export function calendarPermissionText(audience: CalendarAudience): string {
  const roles = audience.roles ?? [];
  if (roles.length === 0) return "—";
  return roles.map((role) => ROLE_LABELS[role]).join("、");
}

/**
 * 請求體的 `audience` → 受眾（寬容解析；roles 缺漏回 null 由呼叫端決定是否擋下）。
 * 非法班級代碼一律捨棄，空陣列＝不限班級。
 */
export function parseCalendarAudience(raw: unknown): CalendarAudience | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const rawRoles = Array.isArray(data.roles) ? data.roles : [];
  const roles = ALL_ROLES.filter((role) => rawRoles.includes(role));
  if (roles.length === 0) return null;
  const classCodes = Array.isArray(data.classCodes)
    ? (data.classCodes as unknown[])
        .filter((code): code is string => typeof code === "string" && code.trim() !== "")
        .map((code) => code.trim().slice(0, CLASS_CODE_MAX))
        .slice(0, 50)
    : [];
  return { roles, classCodes };
}
