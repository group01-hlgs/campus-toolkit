import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { cachedRead, invalidateReadCache } from "@/lib/read-cache";
import { getCacheTtlSeconds, getCurrentPeriod } from "@/lib/settings-server";
import { isActiveEntry, loadPeriodEntries } from "@/lib/roster";
import {
  DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS,
  SELF_DIRECTED_LEARNING_SETTINGS_COLLECTION,
  SELF_DIRECTED_LEARNING_SETTINGS_DOC_ID,
  countWeeksBetween,
  normalizeSettings,
  type PeriodOption,
  type SelfDirectedLearningSettings,
  type SpaceOption,
  type StaffCandidate,
} from "../types/self-directed-learning";

const SETTINGS_CACHE_KEY = "selfDirectedLearning:settings";

async function settingsTtlMs(): Promise<number> {
  return (await getCacheTtlSeconds()) * 1000;
}

function settingsRef() {
  return getAdminDb()
    .collection(SELF_DIRECTED_LEARNING_SETTINGS_COLLECTION)
    .doc(SELF_DIRECTED_LEARNING_SETTINGS_DOC_ID);
}

/** 主程式課表作息的預設上課星期（週一至週五） */
const DEFAULT_SCHOOL_DAYS = [1, 2, 3, 4, 5] as const;
const PERIOD_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

interface RawSchoolPeriodRow {
  code: string;
  period: number;
  name: string;
}

function readSchoolDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_SCHOOL_DAYS];
  const days = new Set<number>();
  for (const item of value) {
    const day = Number(item);
    if (Number.isInteger(day) && day >= 1 && day <= 7) days.add(day);
  }
  if (days.size === 0) return [...DEFAULT_SCHOOL_DAYS];
  return [...days].sort((a, b) => a - b);
}

/** 讀回主程式課表作息（寬容）：只保留可用節次，缺漏時回預設上課星期 */
function readSchoolPeriods(raw: unknown): {
  schoolDays: number[];
  periods: RawSchoolPeriodRow[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { schoolDays: [...DEFAULT_SCHOOL_DAYS], periods: [] };
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.periods)) {
    return { schoolDays: [...DEFAULT_SCHOOL_DAYS], periods: [] };
  }
  const periods: RawSchoolPeriodRow[] = [];
  for (const item of record.periods.slice(0, 50)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const code = typeof row.code === "string" ? row.code.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const start = typeof row.start === "string" ? row.start.trim() : "";
    const end = typeof row.end === "string" ? row.end.trim() : "";
    const period = typeof row.period === "number" ? row.period : NaN;
    if (!code || !name || code.length > 20 || name.length > 40) continue;
    if (!Number.isInteger(period)) continue;
    if (!PERIOD_TIME_PATTERN.test(start) || !PERIOD_TIME_PATTERN.test(end)) continue;
    periods.push({ code, period, name });
  }
  return { schoolDays: readSchoolDays(record.schoolDays), periods };
}

interface RawSpaceUnit {
  code: string;
  name: string;
  floor: string;
  parent: string | null;
}

/** 讀回主程式樓層空間（寬容）：只取需要的欄位，供葉子空間場域候選使用 */
function readSpaceUnits(raw: unknown): RawSpaceUnit[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.units)) return [];
  const units: RawSpaceUnit[] = [];
  for (const item of data.units) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const unit = item as Record<string, unknown>;
    const code = typeof unit.code === "string" ? unit.code.trim() : "";
    const name = typeof unit.name === "string" ? unit.name.trim() : "";
    if (!code || !name) continue;
    const floor = typeof unit.floor === "string" ? unit.floor.trim() : "";
    const parent =
      typeof unit.parent === "string" && unit.parent.trim() ? unit.parent.trim() : null;
    units.push({ code, name, floor, parent });
  }
  return units;
}

/** 讀設定（缺檔即建預設值：lazy init） */
export async function getSettings(): Promise<SelfDirectedLearningSettings> {
  return cachedRead(SETTINGS_CACHE_KEY, await settingsTtlMs(), async () => {
    const snap = await settingsRef().get();
    if (!snap.exists) {
      const initial = { ...DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS, updatedAt: Date.now() };
      await settingsRef().set(initial);
      return initial;
    }
    return normalizeSettings(snap.data());
  });
}

/** 存設定（合併寫入＋失效快取） */
export async function saveSettings(
  value: SelfDirectedLearningSettings
): Promise<SelfDirectedLearningSettings> {
  const next: SelfDirectedLearningSettings = { ...value, updatedAt: Date.now() };
  await settingsRef().set(next, { merge: true });
  invalidateReadCache(SETTINGS_CACHE_KEY);
  return next;
}

const FULL_WEEKS_CACHE_KEY = "selfDirectedLearning:fullWeeks";

/**
 * 全學期形式的須填週數：依主程式「學校基本設定 → 學期起訖設定」推算——
 * **優先上課日起訖**（實際授课期間，以週日～週六為一週、未滿七日仍計一週，
 * 台灣學校通常為 21 或 22 週），其次學期起訖、再次學年度起訖；
 * 學校尚未設定起訖時回 null。
 * 只讀主程式的 `settings/system` 日期欄位，不寫入。
 */
export async function getFullWeeks(): Promise<number | null> {
  return cachedRead(FULL_WEEKS_CACHE_KEY, await settingsTtlMs(), async () => {
    const snap = await getAdminDb().collection("settings").doc("system").get();
    const data = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
    const str = (value: unknown) => (typeof value === "string" ? value : "");
    return (
      countWeeksBetween(str(data.classDayStart), str(data.classDayEnd)) ??
      countWeeksBetween(str(data.semesterStart), str(data.semesterEnd)) ??
      countWeeksBetween(str(data.academicYearStart), str(data.academicYearEnd))
    );
  });
}

const PERIOD_OPTIONS_CACHE_KEY = "selfDirectedLearning:periodOptions";
const SPACE_OPTIONS_CACHE_KEY = "selfDirectedLearning:spaceOptions";
const SCHOOL_DAYS_CACHE_KEY = "selfDirectedLearning:schoolDays";
const STAFF_CANDIDATES_CACHE_KEY = "selfDirectedLearning:staffCandidates";

/** 學校作息：上課星期（1=週一…7=週日）與節次候選（只讀主程式課表作息） */
export interface SchoolScheduleOptions {
  /** 上課日的星期代碼（升冪；至少一天） */
  schoolDays: number[];
  /** 節次候選（作息表順序） */
  periods: PeriodOption[];
}

/** 學校作息候選：主程式「學校基本設定 → 課表作息時間」（文件缺漏時回內建預設） */
export async function getSchoolScheduleOptions(): Promise<SchoolScheduleOptions> {
  return cachedRead(PERIOD_OPTIONS_CACHE_KEY, await settingsTtlMs(), async () => {
    const snap = await getAdminDb().collection("settings").doc("schoolPeriods").get();
    const setting = readSchoolPeriods(snap.exists ? snap.data() : null);
    return {
      schoolDays: setting.schoolDays.length ? [...setting.schoolDays] : [...DEFAULT_SCHOOL_DAYS],
      periods: setting.periods.map((row) => ({
        code: row.code,
        name: row.name,
        period: row.period,
      })),
    };
  });
}

/** 場域候選清單：主程式「學校基本設定 → 樓層空間設定」的葉子空間（無下層者） */
export async function getSpaceOptions(): Promise<SpaceOption[]> {
  return cachedRead(SPACE_OPTIONS_CACHE_KEY, await settingsTtlMs(), async () => {
    const snap = await getAdminDb().collection("settings").doc("spaces").get();
    const units = readSpaceUnits(snap.exists ? snap.data() : null);
    const hasChild = new Set(
      units.filter((unit) => unit.parent !== null).map((unit) => unit.parent as string)
    );
    return units
      .filter((unit) => !hasChild.has(unit.code) && unit.name)
      .map((unit) => ({ name: unit.name, floor: unit.floor }));
  });
}

/** 當期教職員名冊候選人（有效條目，不依屬性過濾）；審核人員選擇用 */
export async function getStaffCandidates(): Promise<StaffCandidate[]> {
  return cachedRead(STAFF_CANDIDATES_CACHE_KEY, await settingsTtlMs(), async () => {
    const period = await getCurrentPeriod();
    const entries = await loadPeriodEntries(period, "staff");
    const list: StaffCandidate[] = [];
    for (const entry of entries.values()) {
      if (!isActiveEntry(entry)) continue;
      const uid = typeof entry.uid === "string" ? entry.uid : "";
      if (!uid) continue;
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      const attribute = typeof entry.attribute === "string" ? entry.attribute.trim() : "";
      list.push({ uid, name, attribute });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    return list;
  });
}
