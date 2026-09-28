import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { getCurrentPeriod } from "@/lib/settings-server";
import { invalidateRoleSettingsCache } from "@/lib/role-settings";
import { ROLE_LABELS, isUserRole, UserRole } from "@/types/users";
import { SchoolPeriod } from "@/types/settings";
import {
  allRolesEnabled,
  isSamePeriod,
  periodScore,
  readRoleEnabled,
  ROLE_SETTINGS_COLLECTION,
  RoleEnabledMap,
  roleSettingsId,
} from "@/types/role-settings";

/** 身分管理總覽回應 */
interface RoleSettingsView {
  period: SchoolPeriod;
  roles: RoleEnabledMap;
  aligned: boolean;
  storedPeriod: SchoolPeriod | null;
}

interface StoredRoleSettings {
  period: SchoolPeriod;
  roles: RoleEnabledMap;
}

/** 由文件欄位讀出期間；欄位缺漏或不合法時回 null（視為毀損資料，略過） */
function readPeriod(data: Record<string, unknown>): SchoolPeriod | null {
  const academicYear = Number(data.academicYear);
  const semester = Number(data.semester);
  if (!Number.isFinite(academicYear) || (semester !== 1 && semester !== 2)) return null;
  return { academicYear, semester };
}

/** 讀出集合內所有期別的身分設定（文件數＝學期數，量體很小，一次全讀） */
async function readAllSettings(): Promise<StoredRoleSettings[]> {
  const snapshot = await getAdminDb().collection(ROLE_SETTINGS_COLLECTION).get();
  const list: StoredRoleSettings[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const period = readPeriod(data);
    if (!period) continue;
    list.push({ period, roles: readRoleEnabled(data.roles) });
  }
  return list;
}

/** 最近一期（學年度＋學期最大者）；完全沒有資料時回 null */
function latestOf(list: StoredRoleSettings[]): StoredRoleSettings | null {
  return list.reduce<StoredRoleSettings | null>(
    (best, item) => (!best || periodScore(item.period) > periodScore(best.period) ? item : best),
    null
  );
}

/**
 * 讀取身分設定總覽：
 * - roles ＝「系統設定的學年度學期」生效中的四種身分狀態（該期資料未建立＝全部啟用）
 * - aligned ＝ 該期資料是否已建立（＝與系統設定對齊）
 * - storedPeriod ＝集合內最近一期資料所屬學期，與系統設定不一致時供頁面醒目提示
 */
async function loadView(period: SchoolPeriod): Promise<RoleSettingsView> {
  const list = await readAllSettings();
  const current = list.find((item) => isSamePeriod(item.period, period)) ?? null;
  const latest = latestOf(list);
  return {
    period,
    roles: current ? current.roles : allRolesEnabled(),
    aligned: current !== null,
    storedPeriod: latest ? latest.period : null,
  };
}

/**
 * 確保「系統設定學期」的身分資料存在：
 * 尚未建立時沿用最近一期的啟用狀態（學期轉換沿用上次選擇），完全沒有資料則全部啟用。
 */
async function ensureCurrentDoc(period: SchoolPeriod, updatedBy: string): Promise<RoleEnabledMap> {
  const db = getAdminDb();
  const ref = db.collection(ROLE_SETTINGS_COLLECTION).doc(roleSettingsId(period));
  const snap = await ref.get();
  if (snap.exists) return readRoleEnabled(snap.data());

  const latest = latestOf(await readAllSettings());
  const roles = latest ? latest.roles : allRolesEnabled();
  await ref.set({
    academicYear: period.academicYear,
    semester: period.semester,
    roles,
    updatedAt: Date.now(),
    updatedBy,
  });
  invalidateRoleSettingsCache();
  return roles;
}

/** GET：讀取該期四種身分的啟用狀態與對齊狀態 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "role-settings",
      RATE.ROLE_SETTINGS_GET.limit,
      RATE.ROLE_SETTINGS_GET.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireAdminModule("roles");
    if (denial) return toAuthResponse(denial);

    const view = await loadView(await getCurrentPeriod());
    return NextResponse.json(
      { success: true, ...view },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Role settings list error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/**
 * PUT：對齊系統學期。
 * 以系統設定的學年度學期建立本期資料（沿用最近一期的啟用狀態），消除期間不一致的警示。
 */
export async function PUT(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "role-settings",
      RATE.ROLE_SETTINGS_MUTATE.limit,
      RATE.ROLE_SETTINGS_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("roles");
    if (denial) return toAuthResponse(denial);

    const period = await getCurrentPeriod();
    await ensureCurrentDoc(period, session.uid);
    const view = await loadView(period);

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "role_settings_updated",
      ip: getClientIp(request),
      details: `身分資料對齊系統學期（${period.academicYear} 學年度 第${period.semester}學期）`,
    });

    return NextResponse.json({ success: true, message: "已對齊系統學期", ...view });
  } catch (error) {
    console.error("Role settings align error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/** PATCH：啟用／停用該學期的單一身分 */
export async function PATCH(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "role-settings",
      RATE.ROLE_SETTINGS_MUTATE.limit,
      RATE.ROLE_SETTINGS_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("roles");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const role: UserRole | null = isUserRole(body.role) ? body.role : null;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : null;
    if (!role || enabled === null) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    // 停用管理員＝所有管理員當期失效，之後無人可回到本頁重新啟用，故一律禁止
    if (role === "admin" && !enabled) {
      return NextResponse.json(
        { success: false, message: "無法停用管理員身分（停用後將無人可管理系統）" },
        { status: 400 }
      );
    }

    const period = await getCurrentPeriod();
    const roles = await ensureCurrentDoc(period, session.uid);
    const next: RoleEnabledMap = { ...roles, [role]: enabled };
    await getAdminDb()
      .collection(ROLE_SETTINGS_COLLECTION)
      .doc(roleSettingsId(period))
      .update({ roles: next, updatedAt: Date.now(), updatedBy: session.uid });
    invalidateRoleSettingsCache();

    const view = await loadView(period);
    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "role_settings_updated",
      ip: getClientIp(request),
      details: `將${ROLE_LABELS[role]}身分於 ${period.academicYear} 學年度 第${period.semester}學期設為「${enabled ? "啟用" : "停用"}」`,
    });

    return NextResponse.json({
      success: true,
      message: `${ROLE_LABELS[role]}已${enabled ? "啟用" : "停用"}`,
      ...view,
    });
  } catch (error) {
    console.error("Role settings update error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}
