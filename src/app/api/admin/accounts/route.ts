import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, FieldValue } from "@/lib/firebase-admin";
import { hasAdminModule, requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { getCurrentPeriod } from "@/lib/settings-server";
import {
  AccountStatus,
  AccountSummary,
  ACTIVE_STATUS,
  ALL_ROLES,
  isAccountStatus,
  isTwoFactorMethod,
  isUserRole,
  lastLoginOf,
  normalizeAccountStatus,
  statusLabel,
  USER_COLLECTION,
  UserRole,
} from "@/types/users";
import { SchoolPeriod } from "@/types/settings";
import {
  isRosterRole,
  rosterCollection,
  rosterRoleLabel,
  RosterInput,
  RosterRole,
} from "@/types/roster";
import {
  accountStatusGuard,
  buildAccountRecord,
  buildRosterEntry,
  checkRosterConflict,
  hashRosterPassword,
  loadAccountIndex,
  loadRosterIndex,
  rosterEntryId,
  syncEntryIdentity,
  validateAccountInput,
  validateRosterInput,
} from "@/lib/roster";

/** 帳號狀態變更的守門：本人、以及「仍是有效管理員且只剩他一位」都要擋 */
async function assertAccountStatusAllowed(
  uid: string,
  sessionUid: string
): Promise<NextResponse | null> {
  const message = await accountStatusGuard(uid, sessionUid);
  if (!message) return null;
  return NextResponse.json({ success: false, message }, { status: 400 });
}

/** 本學期四張名冊 → 每個 uid 具備的身分（順序固定 ALL_ROLES） */
async function loadRolesByUid(period: SchoolPeriod): Promise<Map<string, UserRole[]>> {
  const db = getAdminDb();
  const snapshots = await Promise.all(
    ALL_ROLES.map((role) =>
      db
        .collection(rosterCollection(role))
        .where("academicYear", "==", period.academicYear)
        .where("semester", "==", period.semester)
        .get()
    )
  );
  const map = new Map<string, UserRole[]>();
  snapshots.forEach((snapshot, index) => {
    const role = ALL_ROLES[index];
    for (const doc of snapshot.docs) {
      const uid = doc.data().uid;
      if (typeof uid !== "string" || !uid) continue;
      const list = map.get(uid) ?? [];
      if (!list.includes(role)) list.push(role);
      map.set(uid, list);
    }
  });
  for (const [uid, list] of map) {
    map.set(uid, ALL_ROLES.filter((role) => list.includes(role)));
  }
  return map;
}

/** 使用者帳號文件 → 工作表一列（不含密碼） */
function toAccountSummary(
  uid: string,
  data: Record<string, unknown>,
  roles: UserRole[]
): AccountSummary {
  const str = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : "");
  const summary: AccountSummary = {
    uid,
    email: str("email"),
    account: str("account"),
    name: str("name"),
    status: normalizeAccountStatus(data.status),
    roles,
  };
  if (isUserRole(data.preferredRole)) summary.preferredRole = data.preferredRole;
  if (isTwoFactorMethod(data.twoFactor)) summary.twoFactor = data.twoFactor;
  const lastLogin = lastLoginOf(data);
  if (lastLogin) summary.lastLogin = lastLogin;
  if (typeof data.loginCount === "number") summary.loginCount = data.loginCount;
  return summary;
}

function parseAccountBody(body: Record<string, unknown>): {
  uid: string;
  input: Record<string, string>;
  preferredRole: unknown;
} {
  const uid = typeof body.uid === "string" ? body.uid : "";
  return { uid, input: parseStringRecord(body.input), preferredRole: body.preferredRole };
}

function parseStringRecord(raw: unknown): Record<string, string> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    : {};
}

/** 「同時建立身分」區段：格式或身分無效回 null（呼叫端回 400） */
function parseRosterSection(raw: unknown): { role: RosterRole; input: RosterInput } | null {
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const section = raw as Record<string, unknown>;
  if (!isRosterRole(section.role)) return null;
  return { role: section.role, input: parseStringRecord(section.input) as RosterInput };
}

/** 慣用身分：undefined＝不更動、空字串＝清除、其餘須為合法身分 */
function isValidPreferredRole(value: unknown): boolean {
  return value === undefined || value === "" || isUserRole(value);
}

/** GET：全帳號工作表（不分頁），含每人的具備身分與登入資訊 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "accounts-list",
      RATE.ACCOUNTS_LIST.limit,
      RATE.ACCOUNTS_LIST.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireAdminModule("users");
    if (denial) return toAuthResponse(denial);

    const period = await getCurrentPeriod();
    const db = getAdminDb();
    const [usersSnapshot, rolesByUid] = await Promise.all([
      db.collection(USER_COLLECTION).get(),
      loadRolesByUid(period),
    ]);

    const accounts = usersSnapshot.docs.map((doc) =>
      toAccountSummary(doc.id, doc.data(), rolesByUid.get(doc.id) ?? [])
    );
    accounts.sort(
      (a, b) => a.name.localeCompare(b.name, "zh-Hant") || a.account.localeCompare(b.account)
    );

    return NextResponse.json(
      { success: true, accounts, period },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Accounts list error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/**
 * POST：新增使用者帳號；可於同一請求附帶「同時建立身分」，
 * 於寫入帳號後一併建立本學期（目前學年度學期）的身分名冊條目。
 */
export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "accounts-mutate",
      RATE.ACCOUNTS_MUTATE.limit,
      RATE.ACCOUNTS_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("users");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { input, preferredRole } = parseAccountBody(body);
    if (!isValidPreferredRole(preferredRole)) {
      return NextResponse.json({ success: false, message: "慣用身分無效" }, { status: 400 });
    }

    // 同時建立身分（選填）：未提供＝只建帳號
    const rawRoster = body.roster;
    let rosterSection: { role: RosterRole; input: RosterInput } | null = null;
    if (rawRoster !== undefined && rawRoster !== null) {
      rosterSection = parseRosterSection(rawRoster);
      if (!rosterSection) {
        return NextResponse.json({ success: false, message: "帳號身分無效" }, { status: 400 });
      }
      // 名冊寫入屬「身分名冊管理」權限：未被指派者只能建立帳號本身
      if (!(await hasAdminModule(session, "roster"))) {
        return NextResponse.json(
          { success: false, message: "需具備「身分名冊管理」權限才能同時建立身分" },
          { status: 403 }
        );
      }
    }

    const result = validateAccountInput(input, { requirePassword: true });
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    // 名冊欄位驗證：帳號三欄一律以帳號輸入為準（名冊只存展示副本）
    const rosterValidation = rosterSection
      ? validateRosterInput(rosterSection.role, {
          ...rosterSection.input,
          email: result.account.email,
          account: result.account.account,
          name: result.account.name,
        })
      : null;
    if (rosterSection && !rosterValidation?.ok) {
      return NextResponse.json(
        { success: false, message: rosterValidation?.message || "身分資料無效" },
        { status: 400 }
      );
    }

    const period = rosterSection ? await getCurrentPeriod() : null;
    // 建立身分時需連同學號查重（學號索引取自本學期該身分名冊）
    const index =
      rosterSection && period
        ? await loadRosterIndex(rosterSection.role, period)
        : await loadAccountIndex();
    const conflict = checkRosterConflict(
      result.account,
      rosterValidation?.ok ? rosterValidation.roster : {},
      index
    );
    if (conflict) {
      return NextResponse.json({ success: false, message: conflict }, { status: 409 });
    }

    const record = buildAccountRecord(
      result.account,
      await hashRosterPassword(result.password as string),
      isUserRole(preferredRole) ? preferredRole : undefined
    );
    const docRef = await getAdminDb().collection(USER_COLLECTION).add(record);

    // 本學期身分名冊條目：doc id ＝ uid_學年度_學期，之後可在「身分名冊管理」維護
    if (rosterSection && rosterValidation?.ok && period) {
      await getAdminDb()
        .collection(rosterCollection(rosterSection.role))
        .doc(rosterEntryId(docRef.id, period))
        .set(
          buildRosterEntry(docRef.id, rosterSection.role, period, rosterValidation.roster, {
            email: result.account.email,
            name: result.account.name,
          })
        );
    }

    const rosterLabel = rosterSection ? `、同時建立本學期${rosterRoleLabel(rosterSection.role)}身分` : "";
    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "account_created",
      ip: getClientIp(request),
      details: `建立帳號 ${result.account.account || result.account.email}（${result.account.name}）${rosterLabel}`,
    });

    return NextResponse.json({
      success: true,
      uid: docRef.id,
      message: rosterSection
        ? `帳號已建立，並已建立本學期${rosterRoleLabel(rosterSection.role)}身分`
        : "帳號已建立，請至「身分名冊管理」指定身分",
    });
  } catch (error) {
    console.error("Account create error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/** PUT：更新帳號（電子郵件／帳號／姓名／密碼／慣用身分），同步本學期名冊展示資料 */
export async function PUT(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "accounts-mutate",
      RATE.ACCOUNTS_MUTATE.limit,
      RATE.ACCOUNTS_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("users");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { uid, input, preferredRole } = parseAccountBody(body);
    if (!uid) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }
    if (!isValidPreferredRole(preferredRole)) {
      return NextResponse.json({ success: false, message: "慣用身分無效" }, { status: 400 });
    }

    const result = validateAccountInput(input, { requirePassword: false });
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    const ref = getAdminDb().collection(USER_COLLECTION).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ success: false, message: "查無此筆資料" }, { status: 404 });
    }

    const index = await loadAccountIndex(uid);
    const conflict = checkRosterConflict(result.account, {}, index);
    if (conflict) {
      return NextResponse.json({ success: false, message: conflict }, { status: 409 });
    }

    const { account, password } = result;
    const updateData: Record<string, unknown> = {
      email: account.email,
      account: account.account,
      name: account.name,
    };
    if (password) {
      const current = snap.data() || {};
      updateData.passwordHash = await hashRosterPassword(password);
      // 重設密碼即失效該帳號既有 session（文件沒有 tokenVersion 時視為 1）
      const currentVersion = typeof current.tokenVersion === "number" ? current.tokenVersion : 1;
      updateData.tokenVersion = currentVersion + 1;
      updateData.failedAttempts = 0;
      updateData.lockedUntil = 0;
      updateData.lockIp = "";
      // 管理員代設的預設密碼：對方下次登入須先由本人修改
      updateData.mustChangePassword = true;
    }
    // 慣用身分：空字串＝清除（多身分登入時改回每次詢問）
    if (preferredRole !== undefined) {
      updateData.preferredRole = isUserRole(preferredRole) ? preferredRole : FieldValue.delete();
    }

    await ref.update(updateData);

    // 名稱／信箱變更：同步本學期四張名冊的展示資料（歷史學期不受影響）
    await syncEntryIdentity(uid, await getCurrentPeriod(), {
      email: account.email,
      name: account.name,
    });

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "account_updated",
      ip: getClientIp(request),
      details: `更新帳號 ${account.account || account.email}${
        password ? "（密碼已重設）" : ""
      }${preferredRole !== undefined ? "（慣用身分已更新）" : ""}`,
    });

    return NextResponse.json({ success: true, message: "帳號已更新" });
  } catch (error) {
    console.error("Account update error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/** PATCH：帳號狀態（有效／無效），擋整個帳號能否登入 */
export async function PATCH(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "accounts-mutate",
      RATE.ACCOUNTS_MUTATE.limit,
      RATE.ACCOUNTS_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("users");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const uid = typeof body.uid === "string" ? body.uid : "";
    const status: AccountStatus | null = isAccountStatus(body.status) ? body.status : null;
    if (!uid || !status) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    const guard = await assertAccountStatusAllowed(uid, session.uid);
    if (guard) return guard;

    const ref = getAdminDb().collection(USER_COLLECTION).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ success: false, message: "查無此筆資料" }, { status: 404 });
    }
    await ref.update({ status });

    const account = snap.data() || {};
    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "account_updated",
      ip: getClientIp(request),
      details: `將帳號 ${account.account || uid} 狀態設為「${statusLabel(status)}」`,
    });

    return NextResponse.json({
      success: true,
      message: status === ACTIVE_STATUS ? "狀態已恢復為有效" : `狀態已設為「${statusLabel(status)}」`,
    });
  } catch (error) {
    console.error("Account status error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/** DELETE：刪除使用者帳號，連動刪除其所有學期的名冊條目 */
export async function DELETE(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "accounts-mutate",
      RATE.ACCOUNTS_MUTATE.limit,
      RATE.ACCOUNTS_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("users");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const uid = typeof body.uid === "string" ? body.uid : "";
    if (!uid) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    const guard = await assertAccountStatusAllowed(uid, session.uid);
    if (guard) {
      // 刪除的守門訊息與停用不同
      return NextResponse.json(
        { success: false, message: "無法刪除自己或最後一位有效管理員" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const ref = db.collection(USER_COLLECTION).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ success: false, message: "查無此筆資料" }, { status: 404 });
    }
    const target = snap.data() || {};

    await ref.delete();

    // 帳號刪除時一併清掉四張名冊中所有學年度學期的條目
    const collections = ["rosterStudents", "rosterParents", "rosterStaff", "rosterAdmins"];
    const snaps = await Promise.all(
      collections.map((name) => db.collection(name).where("uid", "==", uid).get())
    );
    const batch = db.batch();
    let deletes = 0;
    for (const entrySnap of snaps) {
      for (const doc of entrySnap.docs) {
        batch.delete(doc.ref);
        deletes += 1;
      }
    }
    if (deletes > 0) await batch.commit();

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "account_deleted",
      ip: getClientIp(request),
      details: `刪除帳號 ${target.account || target.email || uid}`,
    });

    return NextResponse.json({ success: true, message: "帳號已刪除" });
  } catch (error) {
    console.error("Account delete error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}
