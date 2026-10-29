/** 註冊身分與財稅查調（identityTaxInquiry）共用型別與驗證（用戶端／伺服器端皆可用） */

export const IDENTITY_TAX_INQUIRY_VALUE = "identityTaxInquiry";
export const SETTINGS_COLLECTION = "identityTaxInquirySettings";
export const RECORDS_COLLECTION = "identityTaxInquiryRecords";
export const SETTINGS_DOC_ID = "default";

/** 預設身分別選項（管理端可調整） */
export const DEFAULT_IDENTITY_OPTIONS = [
  "一般生",
  "原住民",
  "低收入戶",
  "中低收入戶",
  "身心障礙",
  "特殊境遇家庭",
  "其他",
] as const;

/** 預設需要財稅查調的身分別 */
export const DEFAULT_TAX_INQUIRY_IDENTITIES = ["低收入戶", "中低收入戶"];

export const IDENTITY_LABEL_MAX = 20;
export const IDENTITY_OPTION_MAX = 20;
export const PARENT_NAME_MAX = 40;
export const NOTE_MAX = 500;

export const MAINTENANCE_TITLE = "此功能目前未啟用";
export const MAINTENANCE_HINT =
  "學校尚未開放「註冊身分與財稅查調」，請稍後再試或洽教務處。";

export type IdentityWindowState = "unset" | "upcoming" | "open" | "ended";
export type ConfirmationStatus = "draft" | "confirmed";
export type TaxInquiryStatus = "none" | "pending" | "done" | "exempt";

export const CONFIRMATION_STATUS_LABELS: Record<ConfirmationStatus, string> = {
  draft: "草稿",
  confirmed: "已確認",
};

export const TAX_INQUIRY_STATUS_LABELS: Record<TaxInquiryStatus, string> = {
  none: "尚不需要",
  pending: "待查調",
  done: "已查調",
  exempt: "免查調",
};

export const IDENTITY_WINDOW_LABELS: Record<IdentityWindowState, string> = {
  unset: "學校尚未設定確認期間",
  upcoming: "尚未開放確認",
  open: "確認期間內",
  ended: "已超過確認期間",
};

export interface IdentityTaxInquirySettings {
  /** 功能總開關（模組層級；預設關閉，fail-safe） */
  enabled: boolean;
  /** 學生確認開放時間（epoch ms）；null＝未設定 */
  openAt: number | null;
  /** 學生確認截止時間（epoch ms）；null＝未設定 */
  closeAt: number | null;
  /** 實施說明（純文字） */
  instructions: string;
  /** 身分別選項 */
  identityOptions: string[];
  /** 需要財稅查調的身分別 */
  taxInquiryIdentities: string[];
  /** 需要查調時，是否必填父或母的身分證字號 */
  requireParentId: boolean;
  updatedAt: number;
}

export interface ParentIdInfo {
  name: string;
  idNumber: string;
}

export interface TaxInquiryState {
  required: boolean;
  status: TaxInquiryStatus;
  note: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: number;
}

export interface IdentityTaxInquiryRecord {
  /** doc id＝`${period}_${studentUid}` */
  id: string;
  period: string;
  studentUid: string;
  studentName: string;
  grade: string;
  classCode: string;
  className: string;
  identities: string[];
  father: ParentIdInfo;
  mother: ParentIdInfo;
  note: string;
  status: ConfirmationStatus;
  confirmedAt: number | null;
  taxInquiry: TaxInquiryState;
  updatedAt: number;
}

/** 名冊列（名冊學生＋確認紀錄合併） */
export interface InquiryRow {
  studentUid: string;
  studentName: string;
  studentId: string;
  seatNo: string;
  grade: string;
  classCode: string;
  className: string;
  status: ConfirmationStatus | "missing";
  identities: string[];
  taxInquiry: TaxInquiryState;
  father: ParentIdInfo;
  mother: ParentIdInfo;
  note: string;
  confirmedAt: number | null;
  updatedAt: number;
}

export const DEFAULT_IDENTITY_TAX_INQUIRY_SETTINGS: IdentityTaxInquirySettings = {
  enabled: false,
  openAt: null,
  closeAt: null,
  instructions: "",
  identityOptions: [...DEFAULT_IDENTITY_OPTIONS],
  taxInquiryIdentities: [...DEFAULT_TAX_INQUIRY_IDENTITIES],
  requireParentId: true,
  updatedAt: 0,
};

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanStringList(value: unknown, max: number, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of value) {
    const text = cleanString(item, max);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    list.push(text);
    if (list.length >= limit) break;
  }
  return list;
}

/** 寬容讀取設定（缺欄位回預設） */
export function normalizeSettings(raw: unknown): IdentityTaxInquirySettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_IDENTITY_TAX_INQUIRY_SETTINGS };
  }
  const data = raw as Record<string, unknown>;
  const identityOptions = cleanStringList(data.identityOptions, IDENTITY_LABEL_MAX, IDENTITY_OPTION_MAX);
  const taxInquiryIdentities = cleanStringList(
    data.taxInquiryIdentities,
    IDENTITY_LABEL_MAX,
    IDENTITY_OPTION_MAX
  );
  const openAt = isEpoch(data.openAt) ? data.openAt : null;
  const closeAt = isEpoch(data.closeAt) ? data.closeAt : null;
  return {
    enabled: data.enabled === true,
    openAt,
    closeAt,
    instructions: typeof data.instructions === "string" ? data.instructions.slice(0, 5000) : "",
    identityOptions: identityOptions.length ? identityOptions : [...DEFAULT_IDENTITY_OPTIONS],
    taxInquiryIdentities: taxInquiryIdentities.length
      ? taxInquiryIdentities
      : [...DEFAULT_TAX_INQUIRY_IDENTITIES],
    requireParentId: data.requireParentId !== false,
    updatedAt: isEpoch(data.updatedAt) ? data.updatedAt : 0,
  };
}

/** 確認期間狀態（未設定起訖＝unset；只設起＝無截止） */
export function windowStateOf(
  settings: Pick<IdentityTaxInquirySettings, "openAt" | "closeAt">,
  now = Date.now()
): IdentityWindowState {
  if (settings.openAt === null) return "unset";
  if (now < settings.openAt) return "upcoming";
  if (settings.closeAt !== null && now > settings.closeAt) return "ended";
  return "open";
}

/** 是否為需要財稅查調的身分別組合 */
export function needsTaxInquiry(
  identities: string[],
  settings: Pick<IdentityTaxInquirySettings, "taxInquiryIdentities">
): boolean {
  return identities.some((identity) => settings.taxInquiryIdentities.includes(identity));
}

/** 中華民國身分證字號格式（1 英文字母＋1 或 2＋8 碼數字） */
export function isValidIdNumber(value: string): boolean {
  return /^[A-Z][12]\d{8}$/.test(value.trim().toUpperCase());
}

/** 顯示用遮蔽：保留首字母與末 3 碼 */
export function maskIdNumber(value: string): string {
  const text = value.trim().toUpperCase();
  if (text.length < 5) return text ? "＊".repeat(text.length) : "";
  return `${text.slice(0, 1)}${"＊".repeat(text.length - 4)}${text.slice(-3)}`;
}

export function periodLabelOf(period: { academicYear: number; semester: number }): string {
  return `${period.academicYear}-${period.semester}`;
}

export function formatDateTime(epoch: number | null): string {
  if (!epoch) return "—";
  const date = new Date(epoch);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** 本地時間 → `datetime-local` 值 */
export function toDateTimeLocal(epoch: number | null): string {
  if (!epoch) return "";
  const date = new Date(epoch);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** `datetime-local` 值 → epoch ms；空字串回 null */
export function fromDateTimeLocal(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export interface RecordInput {
  identities: string[];
  father: ParentIdInfo;
  mother: ParentIdInfo;
  note: string;
}

export type ParseRecordResult =
  | { ok: true; value: RecordInput }
  | { ok: false; message: string };

/**
 * 解析學生送出的確認內容。
 * - `mode: "confirm"`：至少一個身分別；需要查調且設定要求時，父或母至少一組完整身分證字號。
 * - `mode: "draft"`：允許不完整，但已填的證號仍須符合格式。
 */
export function parseRecordInput(
  raw: unknown,
  settings: Pick<IdentityTaxInquirySettings, "identityOptions" | "taxInquiryIdentities" | "requireParentId">,
  mode: "draft" | "confirm"
): ParseRecordResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "缺少確認內容" };
  }
  const data = raw as Record<string, unknown>;
  const supplied = cleanStringList(data.identities, IDENTITY_LABEL_MAX, IDENTITY_OPTION_MAX);
  const identities = supplied.filter((identity) => settings.identityOptions.includes(identity));
  if (identities.length !== supplied.length) {
    return { ok: false, message: "包含未開放的身分別，請重新選擇" };
  }
  const readParent = (value: unknown): ParentIdInfo => {
    const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return {
      name: cleanString(record.name, PARENT_NAME_MAX),
      idNumber: cleanString(record.idNumber, 10).toUpperCase(),
    };
  };
  const father = readParent(data.father);
  const mother = readParent(data.mother);
  for (const parent of [father, mother]) {
    if (parent.idNumber && !isValidIdNumber(parent.idNumber)) {
      return { ok: false, message: "父母身分證字號格式不正確（例：A123456789）" };
    }
  }
  const note = cleanString(data.note, NOTE_MAX);

  if (mode === "confirm") {
    if (identities.length === 0) return { ok: false, message: "請至少選擇一個註冊身分別" };
    if (needsTaxInquiry(identities, settings) && settings.requireParentId) {
      const complete = [father, mother].some(
        (parent) => parent.name !== "" && isValidIdNumber(parent.idNumber)
      );
      if (!complete) {
        return {
          ok: false,
          message: "此身分別需要財稅查調，請至少填寫父或母的姓名與身分證字號",
        };
      }
    }
  }

  return { ok: true, value: { identities, father, mother, note } };
}

export interface StudentPagePayload {
  success: boolean;
  maintenance?: boolean;
  message?: string;
  settings: IdentityTaxInquirySettings;
  record: IdentityTaxInquiryRecord | null;
  period: string;
  windowState: IdentityWindowState;
  student: { name: string; className: string };
}

export interface StaffRoles {
  isTutor: boolean;
  classCode: string;
  permissions: string[];
}

export interface InquiryStats {
  total: number;
  confirmed: number;
  draft: number;
  missing: number;
  taxPending: number;
  taxDone: number;
  taxExempt: number;
}

export function buildStats(rows: InquiryRow[]): InquiryStats {
  const stats: InquiryStats = {
    total: rows.length,
    confirmed: 0,
    draft: 0,
    missing: 0,
    taxPending: 0,
    taxDone: 0,
    taxExempt: 0,
  };
  for (const row of rows) {
    if (row.status === "confirmed") stats.confirmed += 1;
    else if (row.status === "draft") stats.draft += 1;
    else stats.missing += 1;
    if (row.taxInquiry.status === "pending") stats.taxPending += 1;
    else if (row.taxInquiry.status === "done") stats.taxDone += 1;
    else if (row.taxInquiry.status === "exempt") stats.taxExempt += 1;
  }
  return stats;
}
