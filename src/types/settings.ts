export interface Settings {
  systemEnabled: boolean;
  systemName: string;
  schoolFullName: string;
  schoolShortName: string;
  schoolOtherNames: string;
  academicYear: number;
  /** 學期：1=第1學期、2=第2學期 */
  semester: number;
  /** 學年度起日（YYYY-MM-DD，可留空；於「學校基本設定 → 學期起訖設定」維護） */
  academicYearStart: string;
  /** 學年度訖日（YYYY-MM-DD，可留空） */
  academicYearEnd: string;
  /** 學期起日（YYYY-MM-DD，可留空） */
  semesterStart: string;
  /** 學期訖日（YYYY-MM-DD，可留空） */
  semesterEnd: string;
  /** 上課日起日（YYYY-MM-DD，可留空；於「學校基本設定 → 學期起訖設定」維護） */
  classDayStart: string;
  /** 上課日訖日（YYYY-MM-DD，可留空） */
  classDayEnd: string;
  /** 寒假起日（YYYY-MM-DD，可留空；於「學校基本設定 → 學期起訖設定」維護） */
  winterStart: string;
  /** 寒假訖日（YYYY-MM-DD，可留空） */
  winterEnd: string;
  /** 暑假起日（YYYY-MM-DD，可留空） */
  summerStart: string;
  /** 暑假訖日（YYYY-MM-DD，可留空） */
  summerEnd: string;
  contactPerson: string;
  contactEmail: string;
  oauthEnabled: boolean;
  /** 開放使用者自行變更電子郵件地址（已有地址者受此設定限制；尚無地址者僅能新增） */
  emailChangeAllowed: boolean;
  sessionTimeout: number;
  cssThemeId: string; // Admin 強制主題
  copyrightNotice: boolean;
  sponsorAdEnabled: boolean;
  /** 省流開關：啟用後「使用者帳號管理」「身分名冊管理」「班級總覽」改為按鈕手動顯示列表 */
  dataSaverEnabled: boolean;
  /**
   * 清單類快取壽命（秒）。主程式與所有功能模組統一適用：
   * 延長＝資料庫讀取更少、更省費用，但非管理端寫入（如學生報名）後
   * 管理端看到最新資料的延遲上限變長；縮短＝資料較即時，但讀取次數增加。
   * 範圍 30–300。管理端增修刪會 bump cacheEpoch 立即失效，不受此值影響。
   */
  cacheTtlSeconds: number;
  /**
   * 學生證件照的儲存後端。
   * `firestore`＝存在 Firestore，免費（Spark）方案即可用；
   * `firebase-storage`＝存在 Firebase Storage bucket，需專案綁定 Blaze 並建立 bucket。
   * 僅影響「新上傳」的照片；已存在的照片仍依其自身記錄的後端讀取。
   */
  studentPersonalPhotoStorage: StudentPersonalPhotoStorage;
}

export type StudentPersonalPhotoStorage = "firestore" | "firebase-storage";

export const STUDENT_PERSONAL_PHOTO_STORAGE_OPTIONS: readonly {
  value: StudentPersonalPhotoStorage;
  label: string;
}[] = [
  { value: "firestore", label: "Firestore（免方案可用，檔案上限 900 KB）" },
  { value: "firebase-storage", label: "Firebase Storage（需綁定 Blaze，檔案上限 5 MB）" },
];

export function isStudentPersonalPhotoStorage(
  value: unknown
): value is StudentPersonalPhotoStorage {
  return value === "firestore" || value === "firebase-storage";
}

/** 讀不到設定時的預設值：免費方案也能運作 */
export const DEFAULT_STUDENT_PERSONAL_PHOTO_STORAGE: StudentPersonalPhotoStorage = "firestore";

/** 清單類快取壽命上下限（秒）與預設值 */
export const CACHE_TTL_SECONDS_MIN = 30;
export const CACHE_TTL_SECONDS_MAX = 300;
export const DEFAULT_CACHE_TTL_SECONDS = 30;

/** 將任意輸入夾到合法的快取壽命秒數（非有限數回預設值） */
export function clampCacheTtlSeconds(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CACHE_TTL_SECONDS;
  return Math.min(CACHE_TTL_SECONDS_MAX, Math.max(CACHE_TTL_SECONDS_MIN, Math.floor(n)));
}

/** 系統（程式）名稱未自命名時的預設值，信件抬頭與頁首共用 */
export const DEFAULT_SYSTEM_NAME = "數位校園工具箱";

/** 所屬學年度與學期（學年度為民國年） */
export interface SchoolPeriod {
  /** 學年度（民國年），如 115 */
  academicYear: number;
  /** 學期：1=第1學期、2=第2學期 */
  semester: number;
}

/**
 * 依日期推算所屬學年度與學期。
 * 學年度以開始的西元年減 1911 命名：2026/9 起為 115學年度；
 * 第1學期為 9 ～ 1 月、第2學期為 2 ～ 8 月，故 1 ～ 8 月屬前一個學年度。
 */
export function detectPeriod(date: Date = new Date()): SchoolPeriod {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 9 ? year : year - 1;
  return {
    academicYear: startYear - 1911,
    semester: month >= 9 || month === 1 ? 1 : 2,
  };
}

/** 首次載入時的推算結果，僅供預設值；實際值以管理員儲存的設定為準 */
const INITIAL_PERIOD = detectPeriod();

export const defaultSettings: Settings = {
  systemEnabled: true,
  systemName: "",
  schoolFullName: "",
  schoolShortName: "",
  schoolOtherNames: "",
  academicYear: INITIAL_PERIOD.academicYear,
  semester: INITIAL_PERIOD.semester,
  academicYearStart: "",
  academicYearEnd: "",
  semesterStart: "",
  semesterEnd: "",
  classDayStart: "",
  classDayEnd: "",
  winterStart: "",
  winterEnd: "",
  summerStart: "",
  summerEnd: "",
  contactPerson: "",
  contactEmail: "",
  oauthEnabled: false,
  emailChangeAllowed: true,
  sessionTimeout: 10,
  cssThemeId: "",
  copyrightNotice: true,
  sponsorAdEnabled: false,
  dataSaverEnabled: false,
  cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  studentPersonalPhotoStorage: DEFAULT_STUDENT_PERSONAL_PHOTO_STORAGE,
};
