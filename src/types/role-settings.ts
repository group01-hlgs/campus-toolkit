/**
 * 身分設定（`roleSettings` 集合）：以學年度、學期為週期，一份文件回答
 * 「該學期四種身分是否啟用」。停用的身分：該期所有人都無法以此身分登入。
 *
 * 文件 id = `${學年度}_${學期}`，與系統設定（settings.system）的學年度學期對齊；
 * 文件不存在＝該期資料未建立，四種身分一律視為啟用（不影響登入）。
 */

import { SchoolPeriod } from "@/types/settings";
import { ALL_ROLES, UserRole } from "@/types/users";

export const ROLE_SETTINGS_COLLECTION = "roleSettings";

/** 某一期四種身分的啟用狀態 */
export type RoleEnabledMap = Record<UserRole, boolean>;

export interface RoleSettingsRecord {
  /** 學年度（民國年） */
  academicYear: number;
  /** 學期：1=第1學期、2=第2學期 */
  semester: number;
  /** 四種身分在該期是否啟用（缺漏的身分視為啟用） */
  roles: RoleEnabledMap;
  /** 最後更新時間（epoch ms） */
  updatedAt?: number;
  /** 最後更新者（使用者 uid） */
  updatedBy?: string;
}

/** 身分設定文件 id：每「學年度 × 學期」一份 */
export function roleSettingsId(period: SchoolPeriod): string {
  return `${period.academicYear}_${period.semester}`;
}

/** 期間序號：用來比較先後與挑出最近一期（學年度 × 2 ＋ 學期） */
export function periodScore(period: SchoolPeriod): number {
  return period.academicYear * 2 + period.semester;
}

export function isSamePeriod(a: SchoolPeriod, b: SchoolPeriod): boolean {
  return a.academicYear === b.academicYear && a.semester === b.semester;
}

/** 顯示用期間文字：115 學年度 第1學期 */
export function periodLabel(period: SchoolPeriod): string {
  return `${period.academicYear} 學年度 第${period.semester}學期`;
}

/** 全部啟用（該期資料未建立時的預設值） */
export function allRolesEnabled(): RoleEnabledMap {
  const roles = {} as RoleEnabledMap;
  for (const role of ALL_ROLES) roles[role] = true;
  return roles;
}

/**
 * 讀回文件上的啟用狀態：僅承認布林值，缺漏或型別不符一律視為啟用
 * （fail-safe，避免欄位毀損把所有人擋在門外）。
 */
export function readRoleEnabled(raw: unknown): RoleEnabledMap {
  const roles = allRolesEnabled();
  if (!raw || typeof raw !== "object") return roles;
  const data = raw as Record<string, unknown>;
  for (const role of ALL_ROLES) {
    if (typeof data[role] === "boolean") roles[role] = data[role] as boolean;
  }
  return roles;
}
