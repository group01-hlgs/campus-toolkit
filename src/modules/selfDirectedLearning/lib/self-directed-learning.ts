import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { cachedRead, invalidateReadCache } from "@/lib/read-cache";
import { getCacheTtlSeconds, getCurrentPeriod } from "@/lib/settings-server";
import { isActiveEntry, loadPeriodEntries } from "@/lib/roster";
import { readSchoolPeriods, DEFAULT_SCHOOL_DAYS } from "@/types/school-periods";
import { readSpaceStructure } from "@/types/school-spaces";
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
    const structure = readSpaceStructure(snap.exists ? snap.data() : null);
    const hasChild = new Set(
      structure.units.filter((unit) => unit.parent !== null).map((unit) => unit.parent as string)
    );
    return structure.units
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
