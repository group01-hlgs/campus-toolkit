/**
 * 公告功能模組的型別與純函式（前端與伺服器共用；**不可** import server-only）。
 *
 * 資料存於 Firestore `announcements` 集合（不入 settings/system，避免整份覆寫抹掉）。
 * 模組設定（分類、顯示方式）存 `settings/announcements` 單文件。
 *
 * 跨模組協議：其他模組在伺服器端呼叫 `src/lib/announcements.ts` 的 `publishFromModule()`，
 * 只寫本集合、必填 `sourceModule`，受眾必須明確（見該檔註解）。
 */

import { ALL_ROLES, ROLE_LABELS, UserRole } from "./users";
import { ensureFallbackCategory, resolveCategoryName } from "./category";

export const ANNOUNCEMENTS_COLLECTION = "announcements";
export const ANNOUNCEMENT_SETTINGS_DOC_ID = "announcements";
/** 個人公告提醒：doc id＝`${announcementId}_${uid}` */
export const ANNOUNCEMENT_REMINDERS_COLLECTION = "announcementReminders";

export type AnnouncementStatus = "published" | "archived";

/** 依字數截斷（超出加 ...）；空白整併成單行——橫幅三行與單行清單共用 */
export function clipText(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max).join("")}...` : chars.join("");
}

/**
 * 公告閱讀權限：可多選身分（學生／家長／教職員），
 * 或獨立勾選「無」＝公開——任何人均可看見，不需先登入系統。
 * 「無」與身分選項互斥（isPublic）。
 */
export const ANNOUNCEMENT_PERMISSION_ROLES: UserRole[] = ["student", "parent", "staff"];

/** 「無（公開）」的權限文字 */
export const PUBLIC_PERMISSION_LABEL = "無";

/**
 * 公告顯示位置（5 處）：
 * 系統首頁登入表單上方＋四種身分功能首頁（切換身分下拉選單下方、第一個登出按鈕上方）。
 * 每處由管理員個別決定「顯示與否／顯示方式／顯示筆數」。
 */
export type AnnouncementSurface = "login" | "student" | "parent" | "staff" | "admin";

export const ANNOUNCEMENT_SURFACES: AnnouncementSurface[] = [
  "login",
  "student",
  "parent",
  "staff",
  "admin",
];

export const ANNOUNCEMENT_SURFACE_LABELS: Record<AnnouncementSurface, string> = {
  login: "系統首頁（登入表單上方）",
  student: "學生功能首頁",
  parent: "家長功能首頁",
  staff: "教職員功能首頁",
  admin: "管理員功能首頁",
};

export function isAnnouncementSurface(value: unknown): value is AnnouncementSurface {
  return typeof value === "string" && (ANNOUNCEMENT_SURFACES as string[]).includes(value);
}

/**
 * 顯示位置的顯示方式：
 * - 清單＝單行（日期｜分類｜標題 20 字內）；
 * - 「清單，置頂公告橫幅」＝置頂公告三行卡片、其餘單行清單；
 * - 橫幅＝三行卡片（標題 20 字內／內容摘要 40 字內／公告資訊）。
 * 橫幅儲存值沿用 `marquee` 以免遷移舊設定。
 */
export type AnnouncementSurfaceMethod = "list" | "pinnedTop" | "marquee";

export const ANNOUNCEMENT_SURFACE_METHOD_LABELS: Record<AnnouncementSurfaceMethod, string> = {
  list: "清單",
  pinnedTop: "清單，置頂公告橫幅",
  marquee: "橫幅",
};

/** 顯示方式寬容解析（缺漏／毀損退回 list） */
export function normalizeSurfaceMethod(value: unknown): AnnouncementSurfaceMethod {
  return value === "pinnedTop" || value === "marquee" ? value : "list";
}

export interface AnnouncementSurfaceSetting {
  enabled: boolean;
  method: AnnouncementSurfaceMethod;
  /** 顯示筆數（1～20） */
  limit: number;
}

export type AnnouncementSurfaces = Record<AnnouncementSurface, AnnouncementSurfaceSetting>;

export const ANNOUNCEMENT_SURFACE_LIMIT_MIN = 1;
export const ANNOUNCEMENT_SURFACE_LIMIT_MAX = 20;
export const ANNOUNCEMENT_SURFACE_LIMIT_DEFAULT = 5;

export function normalizeSurfaceLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return ANNOUNCEMENT_SURFACE_LIMIT_DEFAULT;
  return Math.min(
    ANNOUNCEMENT_SURFACE_LIMIT_MAX,
    Math.max(ANNOUNCEMENT_SURFACE_LIMIT_MIN, Math.round(n))
  );
}

export function defaultAnnouncementSurfaces(): AnnouncementSurfaces {
  const setting: AnnouncementSurfaceSetting = {
    enabled: true,
    method: "list",
    limit: ANNOUNCEMENT_SURFACE_LIMIT_DEFAULT,
  };
  return {
    login: { ...setting },
    student: { ...setting },
    parent: { ...setting },
    staff: { ...setting },
    admin: { ...setting },
  };
}

/** 全站不限班級的 classCodes 哨兵（Firestore array-contains 查詢用） */
export const ALL_CLASSES_SENTINEL = "*";

export interface AnnouncementAudience {
  /**欲送身分（至少一個） */
  roles: UserRole[];
  /**
   * 班級代碼；空陣列或含 `*` ＝不限班級。
   * 有具體代碼時＝僅這些班可見（導師班公告）。
   */
  classCodes: string[];
}

export interface AnnouncementCategory {
  id: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
}

/**
 * 公告原則（「公告原則管理」卡片設定）：
 * - `enablePinned`：允許將公告設為置頂（關閉＝新增／編輯皆無法再設定置頂）；
 * - `forceExpire`：到期時間留空時自動補上發布後一個月，避免過舊公告長期佔據公告區；
 * - `hardDeleteExpired`：封存或到期的公告連同個人提醒真實刪除（關閉＝僅隱藏保留、不進入搜尋）。
 */
export interface AnnouncementPolicies {
  enablePinned: boolean;
  forceExpire: boolean;
  hardDeleteExpired: boolean;
}

export const DEFAULT_ANNOUNCEMENT_POLICIES: AnnouncementPolicies = {
  enablePinned: true,
  forceExpire: true,
  hardDeleteExpired: false,
};

export interface AnnouncementSettings {
  categories: AnnouncementCategory[];
  /** 期 A 預設值；個人提醒介面於後續階段接上 */
  defaultRemindersEnabled: boolean;
  /** 5 個顯示位置的顯示與否／方式／筆數 */
  surfaces: AnnouncementSurfaces;
  /** 公告原則（置頂／到期下架／真實刪除） */
  policies: AnnouncementPolicies;
}

export const DEFAULT_ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = [
  { id: "general", name: "一般公告", sortOrder: 0, enabled: true },
  { id: "academic", name: "教務", sortOrder: 1, enabled: true },
  { id: "studentAffairs", name: "訓輔", sortOrder: 2, enabled: true },
  { id: "event", name: "活動", sortOrder: 3, enabled: true },
  { id: "other", name: "其他", sortOrder: 4, enabled: true },
];

export const DEFAULT_ANNOUNCEMENT_SETTINGS: AnnouncementSettings = {
  categories: DEFAULT_ANNOUNCEMENT_CATEGORIES,
  defaultRemindersEnabled: true,
  surfaces: defaultAnnouncementSurfaces(),
  policies: DEFAULT_ANNOUNCEMENT_POLICIES,
};

/**
 * 後備公告分類（不可刪除）：分類被刪除後，既有公告顯示時自動歸入此分類。
 * 「其他」＝分不下時的垃圾場，與行事曆的後備類型一致。
 * 見 `types/category.ts` 的刪除機制說明。
 */
export const ANNOUNCEMENT_FALLBACK_CATEGORY_ID = "other";
export const ANNOUNCEMENT_FALLBACK_CATEGORY_NAME = "其他";

/** 補齊後備分類用的預設條目（sortOrder 由呼叫端決定） */
export function defaultAnnouncementFallbackCategory(sortOrder: number): AnnouncementCategory {
  return {
    id: ANNOUNCEMENT_FALLBACK_CATEGORY_ID,
    name: ANNOUNCEMENT_FALLBACK_CATEGORY_NAME,
    sortOrder,
    enabled: true,
  };
}

export interface AnnouncementRecord {
  id: string;
  title: string;
  body: string;
  categoryId: string;
  /** 來源模組代碼；公告頁自己發＝"announcements"；其他模組掛勾發文時必填其代碼 */
  sourceModule: string;
  /** 來源模組的資料 id（如補修單號），選填 */
  sourceRef?: string;
  authorUid: string;
  authorName: string;
  authorRole: UserRole;
  audience: AnnouncementAudience;
  /**
   * 閱讀權限＝「無」（公開）：任何人可見，**不需登入**（顯示於系統首頁等公開位置）。
   * 為 true 時 audience 為全校＋全身分（登入者亦由一般查詢看到）。
   */
  isPublic: boolean;
  status: AnnouncementStatus;
  /** epoch ms */
  publishAt: number;
  /** epoch ms；缺省＝不過期 */
  expireAt?: number;
  academicYear?: number;
  semester?: 1 | 2;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 收件匣清單項目（API 回傳；含頁內提醒標示） */
export interface AnnouncementInboxItem {
  id: string;
  title: string;
  body: string;
  categoryId: string;
  categoryName: string;
  sourceModule: string;
  authorName: string;
  authorRole: UserRole;
  audienceRoles: UserRole[];
  classScoped: boolean;
  classCodes: string[];
  /** 閱讀權限＝「無」（公開，不需登入） */
  isPublic: boolean;
  publishAt: number;
  expireAt?: number;
  pinned: boolean;
  /** 是否即將到期（3 日內） */
  expiringSoon: boolean;
  /** 使用者是否已設定個人提醒（API 依登入 uid 補上） */
  reminded?: boolean;
}

/** 顯示位置（首頁／登入頁）回傳的公告項目 */
export interface AnnouncementSurfaceItem {
  id: string;
  title: string;
  body: string;
  categoryId: string;
  categoryName: string;
  sourceModule: string;
  authorName: string;
  publishAt: number;
  expireAt?: number;
  pinned: boolean;
  isPublic: boolean;
}

/** 個人提醒（首頁鈴鐺／提醒列表）：僅回仍可閱讀的公告 */
export interface AnnouncementReminderItem {
  announcementId: string;
  title: string;
  body: string;
  categoryName: string;
  authorName: string;
  publishAt: number;
  expireAt?: number;
  expiringSoon: boolean;
  classScoped: boolean;
  createdAt: number;
}

/** 不限班級的受眾 */
export function schoolWideAudience(roles: UserRole[]): AnnouncementAudience {
  return { roles: [...roles], classCodes: [ALL_CLASSES_SENTINEL] };
}

/** 是否為「不限班級」受眾 */
export function isSchoolWideAudience(audience: AnnouncementAudience): boolean {
  const codes = audience.classCodes ?? [];
  return codes.length === 0 || codes.includes(ALL_CLASSES_SENTINEL);
}

export function audienceClassScoped(audience: AnnouncementAudience): boolean {
  return !isSchoolWideAudience(audience);
}

/** 受眾是否包含該身分 */
export function audienceHasRole(audience: AnnouncementAudience, role: UserRole): boolean {
  return (audience.roles ?? []).includes(role);
}

/** 受眾是否可見於該班級（校級公告恒為 true；班級公告比對 classCode） */
export function audienceCoversClass(
  audience: AnnouncementAudience,
  classCode: string | undefined | null
): boolean {
  if (isSchoolWideAudience(audience)) return true;
  if (!classCode) return false;
  return (audience.classCodes ?? []).includes(classCode);
}

/** 公告對「該身分＋該班級」是否可見（管理端清單不受此限） */
export function canViewAnnouncement(
  audience: AnnouncementAudience,
  role: UserRole,
  classCode: string | undefined | null
): boolean {
  return audienceHasRole(audience, role) && audienceCoversClass(audience, classCode);
}

/** 是否在可閱讀時間窗內（已發布、未過期） */
export function isAnnouncementReadable(
  item: { status: AnnouncementStatus; publishAt: number; expireAt?: number },
  now: number = Date.now()
): boolean {
  if (item.status !== "published") return false;
  if (item.publishAt > now) return false;
  if (typeof item.expireAt === "number" && item.expireAt > 0 && item.expireAt <= now) {
    return false;
  }
  return true;
}

export const EXPIRING_SOON_MS = 3 * 24 * 60 * 60 * 1000;

export function isExpiringSoon(
  item: { expireAt?: number },
  now: number = Date.now()
): boolean {
  if (typeof item.expireAt !== "number" || item.expireAt <= 0) return false;
  return item.expireAt > now && item.expireAt - now <= EXPIRING_SOON_MS;
}

export interface AnnouncementInput {
  title: string;
  body: string;
  categoryId?: string;
  audience: AnnouncementAudience;
  /** 閱讀權限＝「無」（公開，不需登入可見）；與身分選項互斥 */
  isPublic?: boolean;
  publishAt?: number;
  expireAt?: number | null;
  pinned?: boolean;
  academicYear?: number;
  semester?: 1 | 2;
}

export interface ValidatedAnnouncementInput {
  title: string;
  body: string;
  categoryId: string;
  audience: AnnouncementAudience;
  isPublic: boolean;
  publishAt: number;
  expireAt?: number;
  pinned: boolean;
  academicYear?: number;
  semester?: 1 | 2;
}

export type AnnouncementValidation =
  | { ok: true; value: ValidatedAnnouncementInput }
  | { ok: false; message: string };

const TITLE_MAX = 120;
const BODY_MAX = 5000;
const CLASS_CODE_MAX = 32;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** 驗證並正規化公告輸入（發佈表單與跨模組 publish 共用） */
export function validateAnnouncementInput(
  input: AnnouncementInput,
  options?: { allowedRoles?: readonly UserRole[] }
): AnnouncementValidation {
  const title = text(input.title, TITLE_MAX);
  if (!title) return { ok: false, message: "請填寫公告標題" };
  const body = text(input.body, BODY_MAX);
  if (!body) return { ok: false, message: "請填寫公告內容" };

  const allowed = options?.allowedRoles ?? ALL_ROLES;
  // 閱讀權限「無」＝公開：任何身分皆可見，且不套班級限制（訪客沒有班級）
  const isPublic = input.isPublic === true;
  let roles: UserRole[];
  if (isPublic) {
    roles = [...ALL_ROLES];
  } else {
    roles = Array.isArray(input.audience?.roles)
      ? ALL_ROLES.filter((role) => input.audience.roles.includes(role) && allowed.includes(role))
      : [];
    if (roles.length === 0) {
      return { ok: false, message: "請至少選擇一個公告閱讀權限" };
    }
  }

  const rawCodes = isPublic
    ? []
    : Array.isArray(input.audience?.classCodes)
      ? input.audience.classCodes
      : [];
  const classCodes: string[] = [];
  for (const raw of rawCodes) {
    const code = text(raw, CLASS_CODE_MAX);
    if (!code) continue;
    if (!classCodes.includes(code)) classCodes.push(code);
  }
  const normalizedAudience: AnnouncementAudience =
    classCodes.length === 0 ? schoolWideAudience(roles) : { roles, classCodes };

  const publishAt =
    typeof input.publishAt === "number" && Number.isFinite(input.publishAt) && input.publishAt > 0
      ? input.publishAt
      : Date.now();
  if (publishAt > Date.now() + 365 * 24 * 60 * 60 * 1000) {
    return { ok: false, message: "發布時間過於未來" };
  }

  let expireAt: number | undefined;
  if (typeof input.expireAt === "number" && Number.isFinite(input.expireAt) && input.expireAt > 0) {
    expireAt = input.expireAt;
    if (expireAt <= publishAt) {
      return { ok: false, message: "到期時間必須晚於發布時間" };
    }
  }

  return {
    ok: true,
    value: {
      title,
      body,
      categoryId:
        text(input.categoryId, 64) || ANNOUNCEMENT_FALLBACK_CATEGORY_ID,
      audience: normalizedAudience,
      isPublic,
      publishAt,
      expireAt,
      pinned: input.pinned === true,
      academicYear:
        typeof input.academicYear === "number" && input.academicYear > 0
          ? input.academicYear
          : undefined,
      semester: input.semester === 1 || input.semester === 2 ? input.semester : undefined,
    },
  };
}

/** 教職員發佈時：受眾若限定班級，必須包含自己的導師班（防發到別班） */
export function staffAudienceAllowed(
  audience: AnnouncementAudience,
  staffClassCode: string | undefined | null
): boolean {
  if (!audienceClassScoped(audience)) return true;
  if (!staffClassCode) return false;
  return (audience.classCodes ?? []).includes(staffClassCode);
}

/** Firestore 原始文件 → 公告記錄（寬容解析） */
export function readAnnouncementRecord(
  id: string,
  raw: Record<string, unknown> | null | undefined
): AnnouncementRecord | null {
  if (!raw) return null;
  const roles = Array.isArray(raw.audienceRoles)
    ? ALL_ROLES.filter((role) => (raw.audienceRoles as unknown[]).includes(role))
    : [];
  const classCodes = Array.isArray(raw.audienceClassCodes)
    ? (raw.audienceClassCodes as unknown[])
        .filter((code): code is string => typeof code === "string" && code.length > 0)
        .slice(0, 50)
    : [];
  const audience: AnnouncementAudience =
    classCodes.length === 0 ? schoolWideAudience(roles) : { roles, classCodes };
  const status: AnnouncementStatus = raw.status === "archived" ? "archived" : "published";
  return {
    id,
    title: typeof raw.title === "string" ? raw.title : "",
    body: typeof raw.body === "string" ? raw.body : "",
    categoryId: typeof raw.categoryId === "string" ? raw.categoryId : "",
    sourceModule: typeof raw.sourceModule === "string" ? raw.sourceModule : "announcements",
    sourceRef: typeof raw.sourceRef === "string" && raw.sourceRef ? raw.sourceRef : undefined,
    authorUid: typeof raw.authorUid === "string" ? raw.authorUid : "",
    authorName: typeof raw.authorName === "string" ? raw.authorName : "",
    authorRole: (ALL_ROLES as string[]).includes(raw.authorRole as string)
      ? (raw.authorRole as UserRole)
      : "admin",
    audience,
    isPublic: raw.isPublic === true,
    status,
    publishAt: typeof raw.publishAt === "number" ? raw.publishAt : 0,
    expireAt: typeof raw.expireAt === "number" && raw.expireAt > 0 ? raw.expireAt : undefined,
    academicYear: typeof raw.academicYear === "number" ? raw.academicYear : undefined,
    semester: raw.semester === 1 || raw.semester === 2 ? raw.semester : undefined,
    pinned: raw.pinned === true,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

/** 公告記錄 → Firestore 寫入欄位（audience 拉平為陣列欄位以便 array-contains 查詢） */
export function announcementToFirestore(
  record: Omit<AnnouncementRecord, "id">
): Record<string, unknown> {
  return {
    title: record.title,
    body: record.body,
    categoryId: record.categoryId,
    sourceModule: record.sourceModule,
    ...(record.sourceRef ? { sourceRef: record.sourceRef } : {}),
    authorUid: record.authorUid,
    authorName: record.authorName,
    authorRole: record.authorRole,
    audienceRoles: record.audience.roles,
    audienceClassCodes: record.audience.classCodes,
    isPublic: record.isPublic === true,
    status: record.status,
    publishAt: record.publishAt,
    ...(record.expireAt ? { expireAt: record.expireAt } : {}),
    ...(record.academicYear ? { academicYear: record.academicYear } : {}),
    ...(record.semester ? { semester: record.semester } : {}),
    pinned: record.pinned === true,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** 分類表寬容讀取 */
export function readAnnouncementSettings(raw: unknown): AnnouncementSettings {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rawCategories = data?.categories;
  let categories: AnnouncementCategory[] = [];
  if (Array.isArray(rawCategories)) {
    categories = rawCategories
      .map((item, index) => {
        const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
        const id = text(row?.id, 64);
        const name = text(row?.name, 64);
        if (!id || !name) return null;
        return {
          id,
          name,
          sortOrder: typeof row?.sortOrder === "number" ? row.sortOrder : index,
          enabled: row?.enabled !== false,
        } satisfies AnnouncementCategory;
      })
      .filter((item): item is AnnouncementCategory => item !== null);
  }
  if (categories.length === 0) categories = [...DEFAULT_ANNOUNCEMENT_CATEGORIES];
  // 後備分類（其他）不可被刪除：讀入時補齊並強制啟用（僅記憶體，不寫回）
  categories = ensureFallbackCategory(categories, ANNOUNCEMENT_FALLBACK_CATEGORY_ID, () =>
    defaultAnnouncementFallbackCategory(categories.length)
  );

  // 5 個顯示位置：逐 key 寬容讀取，缺漏／毀損一律退回預設（未設定＝顯示）
  const surfaces: AnnouncementSurfaces = defaultAnnouncementSurfaces();
  const rawSurfaces = data?.surfaces;
  if (rawSurfaces && typeof rawSurfaces === "object") {
    const map = rawSurfaces as Record<string, unknown>;
    for (const key of ANNOUNCEMENT_SURFACES) {
      const row = map[key];
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      surfaces[key] = {
        enabled: item.enabled !== false,
        method: normalizeSurfaceMethod(item.method),
        limit: normalizeSurfaceLimit(item.limit),
      };
    }
  }

  // 公告原則：逐 key 寬容讀取，缺漏／毀損一律退回預設
  const rawPolicies = data?.policies;
  const policies: AnnouncementPolicies = { ...DEFAULT_ANNOUNCEMENT_POLICIES };
  if (rawPolicies && typeof rawPolicies === "object") {
    const row = rawPolicies as Record<string, unknown>;
    if (typeof row.enablePinned === "boolean") policies.enablePinned = row.enablePinned;
    if (typeof row.forceExpire === "boolean") policies.forceExpire = row.forceExpire;
    if (typeof row.hardDeleteExpired === "boolean") policies.hardDeleteExpired = row.hardDeleteExpired;
  }

  return {
    categories,
    defaultRemindersEnabled: data?.defaultRemindersEnabled !== false,
    surfaces,
    policies,
  };
}

/** 閱讀權限顯示文字：「無（公開）」或身分名稱串接 */
export function announcementPermissionText(
  audience: AnnouncementAudience,
  isPublic: boolean
): string {
  if (isPublic) return "無（公開）";
  const roles = audience.roles ?? [];
  if (roles.length === 0) return "—";
  return roles.map((role) => ROLE_LABELS[role]).join("、");
}

export function announcementCategoryName(
  settings: AnnouncementSettings,
  categoryId: string
): string {
  return resolveCategoryName(
    settings.categories,
    ANNOUNCEMENT_FALLBACK_CATEGORY_ID,
    ANNOUNCEMENT_FALLBACK_CATEGORY_NAME,
    categoryId
  );
}
