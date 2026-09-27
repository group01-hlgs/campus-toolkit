export interface Settings {
  systemEnabled: boolean;
  systemName: string;
  schoolFullName: string;
  schoolShortName: string;
  schoolOtherNames: string;
  academicYear: number;
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
}

export const defaultSettings: Settings = {
  systemEnabled: true,
  systemName: "",
  schoolFullName: "",
  schoolShortName: "",
  schoolOtherNames: "",
  academicYear: new Date().getFullYear() - 1911,
  schoolCode: "",
  contactPerson: "",
  contactEmail: "",
  oauthEnabled: false,
  emailChangeAllowed: true,
  sessionTimeout: 10,
  cssThemeId: "",
  copyrightNotice: true,
  sponsorAdEnabled: false,
};
