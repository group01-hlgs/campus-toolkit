/**
 * 校務基本資料（教育階段、學校年制、校長、副校長、校區、官網）。
 *
 * 屬「學校基本設定」模組（schoolSettings，超級專屬）的子功能 `schoolSettings.profile`：
 * 登記學校最基礎的對外資料，供日後各功能取用（首頁抬頭、對外頁面、表單預設值…）。
 *
 * 資料存於獨立文件 `settings/schoolProfile`（結構性資料、不按學期）：
 * - 不放 `settings/system`：系統設定的 PUT 是整份覆寫（只保留 roleEnabled），
 *   存同文件會在下次儲存系統設定時被清掉。
 * - 不放 `settings/school`：單位層級設定的 PUT 同樣是整份 set() 覆寫，會互相清掉。
 *
 * 本檔不可 import `server-only`（`src/lib/*` 皆為伺服器專用），
 * 前端表單與 API 伺服器端共用這裡的驗證。
 */
import {
  CODES_MAX_SCHOOL_TYPES,
  CODES_VOC_CODE_MAX,
  CODES_VOC_NAME_MAX,
  type VocCodeRow,
} from "@/types/school-codes";

/** 教育階段（固定選單；新增階段時在此加一列即可，舊資料以 stage 值對照） */
export const EDUCATION_STAGES = [
  { value: "primary", label: "國民小學" },
  { value: "juniorHigh", label: "國民中學" },
  { value: "seniorHigh", label: "高級中等學校" },
  { value: "university", label: "大專院校" },
] as const;

export type StageValue = (typeof EDUCATION_STAGES)[number]["value"];

/** 一個教育階段及其學制年數（例如國民小學 6 年制） */
export interface StageSetting {
  stage: StageValue;
  /** 學校年制（該階段修業年數），1..PROFILE_MAX_YEARS */
  years: number;
}

/** 一個校區 */
export interface Campus {
  /** 穩定代碼：新增時產生、改名不變，供日後引用 */
  id: string;
  /** 校區名稱（如「本部」「鳳山校區」） */
  name: string;
  /** 學校地址 */
  address: string;
  /** 學校電話 */
  phone: string;
}

export interface SchoolProfile {
  /** 教育階段＋年制；未勾選的階段不出現在陣列中 */
  stages: StageSetting[];
  /**
   * 高級中等學校辦理的類型（複選，取自各式代碼表的類型清單）。
   * 只描述學校辦理哪些類型學制，**與年制無關**；
   * 未勾選高級中等學校時介面隱藏，但資料保留（重新勾選即恢復顯示）。
   */
  seniorHighTypes: VocCodeRow[];
  /** 現任校長（可留空） */
  principal: string;
  /** 現任副校長（可多位，可為空陣列） */
  vicePrincipals: string[];
  /** 校區（至少 1 筆；1 筆即單一校區） */
  campuses: Campus[];
  /** 學校官網地址（可留空；填寫時須為 http/https URL） */
  website: string;
}

export const PROFILE_DOC_ID = "schoolProfile";
export const PROFILE_MAX_YEARS = 12;
export const PROFILE_MAX_VICE_PRINCIPALS = 10;
export const PROFILE_MIN_CAMPUSES = 1;
export const PROFILE_MAX_CAMPUSES = 10;
export const PROFILE_NAME_MAX = 40;
export const PROFILE_CAMPUS_NAME_MAX = 30;
export const PROFILE_ADDRESS_MAX = 120;
export const PROFILE_PHONE_MAX = 30;
export const PROFILE_WEBSITE_MAX = 200;

/** 教育階段的顯示名稱（未知值原樣返回，交由驗證回報） */
export function stageLabel(value: string): string {
  return EDUCATION_STAGES.find((item) => item.value === value)?.label ?? value;
}

/** 勾選教育階段時的預設年制（依一般學制） */
export function defaultYearsFor(stage: StageValue): number {
  switch (stage) {
    case "primary":
      return 6;
    case "juniorHigh":
      return 3;
    case "seniorHigh":
      return 3;
    case "university":
      return 4;
    default:
      return 3;
  }
}

/** 新校區代碼：時間基底＋亂碼，同毫秒內也不會相撞 */
export function newCampusId(): string {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultSchoolProfile(): SchoolProfile {
  return {
    stages: [],
    seniorHighTypes: [],
    principal: "",
    vicePrincipals: [],
    campuses: [{ id: newCampusId(), name: "本部", address: "", phone: "" }],
    website: "",
  };
}

function readString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function readYears(value: unknown): number {
  const years = Number(value);
  if (!Number.isInteger(years) || years < 1 || years > PROFILE_MAX_YEARS) return 3;
  return years;
}

function readCampus(raw: unknown): Campus | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id =
    typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 64) : newCampusId();
  return {
    id,
    name: readString(item.name, PROFILE_CAMPUS_NAME_MAX),
    address: readString(item.address, PROFILE_ADDRESS_MAX),
    phone: readString(item.phone, PROFILE_PHONE_MAX),
  };
}

/** 高級中等學校類型複選：逐筆去空白、留白該筆丟棄、「代碼＋名稱」重複只留第一筆 */
function readSeniorHighTypes(value: unknown): VocCodeRow[] {
  if (!Array.isArray(value)) return [];
  const rows: VocCodeRow[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (rows.length >= CODES_MAX_SCHOOL_TYPES) break;
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const code = typeof entry.code === "string" ? entry.code.trim() : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!code || !name) continue;
    if (code.length > CODES_VOC_CODE_MAX || name.length > CODES_VOC_NAME_MAX) continue;
    const key = `${code}\u0000${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ code, name });
  }
  return rows;
}

/**
 * 讀回校務基本資料（寬容）：只把型別與範圍修到安全值，
 * 語意問題（重複階段、校區數不足…）交由驗證回報，避免資料毀損時整份作廢。
 */
export function readSchoolProfile(raw: unknown): SchoolProfile {
  if (!raw || typeof raw !== "object") return defaultSchoolProfile();
  const data = raw as Record<string, unknown>;

  const stages: StageSetting[] = [];
  const seenStages = new Set<string>();
  const rawStages = Array.isArray(data.stages) ? data.stages : [];
  for (const item of rawStages) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const stage = typeof entry.stage === "string" ? entry.stage : "";
    if (!EDUCATION_STAGES.some((option) => option.value === stage)) continue;
    if (seenStages.has(stage)) continue;
    seenStages.add(stage);
    stages.push({ stage: stage as StageValue, years: readYears(entry.years) });
  }

  const vicePrincipals = (Array.isArray(data.vicePrincipals) ? data.vicePrincipals : [])
    .map((item) => readString(item, PROFILE_NAME_MAX))
    .filter(Boolean)
    .slice(0, PROFILE_MAX_VICE_PRINCIPALS);

  const campuses: Campus[] = [];
  const seenIds = new Set<string>();
  const rawCampuses = Array.isArray(data.campuses) ? data.campuses : [];
  for (const item of rawCampuses) {
    const campus = readCampus(item);
    if (!campus || seenIds.has(campus.id)) continue;
    seenIds.add(campus.id);
    campuses.push(campus);
  }
  if (campuses.length === 0) {
    campuses.push({ id: newCampusId(), name: "本部", address: "", phone: "" });
  }

  return {
    stages,
    seniorHighTypes: readSeniorHighTypes(data.seniorHighTypes),
    principal: readString(data.principal, PROFILE_NAME_MAX),
    vicePrincipals,
    campuses: campuses.slice(0, PROFILE_MAX_CAMPUSES),
    website: readString(data.website, PROFILE_WEBSITE_MAX),
  };
}

export type ProfileValidation =
  | { ok: true; value: SchoolProfile }
  | { ok: false; message: string };

/** 校區電話：僅允許數字、空白與常見分隔符號與「轉」 */
const PHONE_PATTERN = /^[0-9+\-()#轉.\s]*$/;

function validateWebsite(raw: string): string | null {
  if (!raw) return null;
  if (raw.length > PROFILE_WEBSITE_MAX) {
    return `學校官網過長（最多 ${PROFILE_WEBSITE_MAX} 字）`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "學校官網格式不正確，請輸入完整網址（如 https://www.school.edu.tw）";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "學校官網需為 http:// 或 https:// 開頭的網址";
  }
  return null;
}

/** 完整驗證（API 與表單共用），任一項目不過即回錯誤訊息 */
export function validateSchoolProfile(raw: unknown): ProfileValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "無效的校務基本資料內容" };
  }
  const data = raw as Record<string, unknown>;

  const rawStages = Array.isArray(data.stages) ? data.stages : [];
  if (rawStages.length > EDUCATION_STAGES.length) {
    return { ok: false, message: "教育階段的數量超出可選項目" };
  }
  const stages: StageSetting[] = [];
  const stageKeys = new Set<string>();
  for (const item of rawStages) {
    if (!item || typeof item !== "object") return { ok: false, message: "教育階段資料格式錯誤" };
    const entry = item as Record<string, unknown>;
    const stage = typeof entry.stage === "string" ? entry.stage : "";
    const label = stageLabel(stage);
    if (!EDUCATION_STAGES.some((option) => option.value === stage)) {
      return { ok: false, message: `未知的教育階段：「${label || "（空白）"}」` };
    }
    if (stageKeys.has(stage)) {
      return { ok: false, message: `教育階段「${label}」重複，請重新整理頁面後再試` };
    }
    stageKeys.add(stage);
    const years = Number(entry.years);
    if (!Number.isInteger(years) || years < 1 || years > PROFILE_MAX_YEARS) {
      return {
        ok: false,
        message: `「${label}」的學校年制需為 1 至 ${PROFILE_MAX_YEARS} 的整數`,
      };
    }
    stages.push({ stage: stage as StageValue, years });
  }

  const rawTypes = data.seniorHighTypes === undefined ? [] : data.seniorHighTypes;
  if (!Array.isArray(rawTypes)) {
    return { ok: false, message: "高級中等學校類型清單格式錯誤" };
  }
  if (rawTypes.length > CODES_MAX_SCHOOL_TYPES) {
    return { ok: false, message: `高級中等學校類型最多 ${CODES_MAX_SCHOOL_TYPES} 筆` };
  }
  const seniorHighTypes: VocCodeRow[] = [];
  const typeKeys = new Set<string>();
  for (let index = 0; index < rawTypes.length; index += 1) {
    const item = rawTypes[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, message: `第 ${index + 1} 筆高級中等學校類型格式錯誤` };
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.code !== "string" || typeof entry.name !== "string") {
      return { ok: false, message: `第 ${index + 1} 筆高級中等學校類型的代碼與名稱都必須是文字` };
    }
    const code = entry.code.trim();
    const name = entry.name.trim();
    if (!code) return { ok: false, message: `第 ${index + 1} 筆高級中等學校類型未填代碼` };
    if (code.length > CODES_VOC_CODE_MAX) {
      return { ok: false, message: `高級中等學校類型代碼「${code}」超過 ${CODES_VOC_CODE_MAX} 個字` };
    }
    if (!name) return { ok: false, message: `高級中等學校類型代碼「${code}」未填名稱` };
    if (name.length > CODES_VOC_NAME_MAX) {
      return { ok: false, message: `高級中等學校類型名稱「${name}」超過 ${CODES_VOC_NAME_MAX} 個字` };
    }
    const key = `${code}\u0000${name}`;
    if (typeKeys.has(key)) {
      return { ok: false, message: `高級中等學校類型「${code} ${name}」重複，請移除多餘的項目` };
    }
    typeKeys.add(key);
    seniorHighTypes.push({ code, name });
  }

  const principal = typeof data.principal === "string" ? data.principal.trim() : "";
  if (principal.length > PROFILE_NAME_MAX) {
    return { ok: false, message: `現任校長姓名過長（最多 ${PROFILE_NAME_MAX} 字）` };
  }

  const rawVice = Array.isArray(data.vicePrincipals) ? data.vicePrincipals : [];
  if (rawVice.length > PROFILE_MAX_VICE_PRINCIPALS) {
    return {
      ok: false,
      message: `副校長人數超過上限（最多 ${PROFILE_MAX_VICE_PRINCIPALS} 位）`,
    };
  }
  const vicePrincipals: string[] = [];
  const viceKeys = new Set<string>();
  for (let index = 0; index < rawVice.length; index += 1) {
    const value = rawVice[index];
    const name = typeof value === "string" ? value.trim() : "";
    if (!name) return { ok: false, message: `第 ${index + 1} 位副校長姓名不可空白` };
    if (name.length > PROFILE_NAME_MAX) {
      return { ok: false, message: `副校長「${name}」姓名過長（最多 ${PROFILE_NAME_MAX} 字）` };
    }
    if (viceKeys.has(name)) return { ok: false, message: `副校長「${name}」重複` };
    viceKeys.add(name);
    vicePrincipals.push(name);
  }

  const rawCampuses = Array.isArray(data.campuses) ? data.campuses : [];
  if (rawCampuses.length < PROFILE_MIN_CAMPUSES) {
    return { ok: false, message: `至少需有 ${PROFILE_MIN_CAMPUSES} 個校區資料` };
  }
  if (rawCampuses.length > PROFILE_MAX_CAMPUSES) {
    return { ok: false, message: `校區數量超過上限（最多 ${PROFILE_MAX_CAMPUSES} 個）` };
  }
  const campuses: Campus[] = [];
  const campusIds = new Set<string>();
  const campusNames = new Set<string>();
  for (let index = 0; index < rawCampuses.length; index += 1) {
    const item = rawCampuses[index];
    if (!item || typeof item !== "object") return { ok: false, message: "校區資料格式錯誤" };
    const entry = item as Record<string, unknown>;
    const label = `第 ${index + 1} 個校區`;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) return { ok: false, message: `${label}缺少校區代碼，請重新整理頁面後再試` };
    if (campusIds.has(id)) {
      return { ok: false, message: "校區代碼重複，請重新整理頁面後再試" };
    }
    campusIds.add(id);

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) return { ok: false, message: `${label}的校區名稱不可空白` };
    if (name.length > PROFILE_CAMPUS_NAME_MAX) {
      return {
        ok: false,
        message: `校區名稱「${name}」過長（最多 ${PROFILE_CAMPUS_NAME_MAX} 字）`,
      };
    }
    if (campusNames.has(name)) return { ok: false, message: `校區名稱「${name}」重複` };
    campusNames.add(name);

    const address = typeof entry.address === "string" ? entry.address.trim() : "";
    if (!address) return { ok: false, message: `${label}（${name}）的學校地址不可空白` };
    if (address.length > PROFILE_ADDRESS_MAX) {
      return {
        ok: false,
        message: `「${name}」的學校地址過長（最多 ${PROFILE_ADDRESS_MAX} 字）`,
      };
    }

    const phone = typeof entry.phone === "string" ? entry.phone.trim() : "";
    if (phone.length > PROFILE_PHONE_MAX) {
      return { ok: false, message: `「${name}」的學校電話過長（最多 ${PROFILE_PHONE_MAX} 字）` };
    }
    if (!PHONE_PATTERN.test(phone)) {
      return { ok: false, message: `「${name}」的學校電話含無效字元（僅限數字與 - ( ) # 轉 等）` };
    }

    campuses.push({ id, name, address, phone });
  }

  const website = typeof data.website === "string" ? data.website.trim() : "";
  const websiteError = validateWebsite(website);
  if (websiteError) return { ok: false, message: websiteError };

  return {
    ok: true,
    value: { stages, seniorHighTypes, principal, vicePrincipals, campuses, website },
  };
}
