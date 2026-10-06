export interface Settings {
  systemEnabled: boolean;
  systemName: string;
  schoolFullName: string;
  schoolShortName: string;
  schoolOtherNames: string;
  academicYear: number;
  /** 學期：1=第1學期、2=第2學期 */
  semester: number;
  schoolCode: string;
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
  schoolCode: "",
  contactPerson: "",
  contactEmail: "",
  oauthEnabled: false,
  emailChangeAllowed: true,
  sessionTimeout: 10,
  cssThemeId: "",
  copyrightNotice: true,
  sponsorAdEnabled: false,
  dataSaverEnabled: false,
};
