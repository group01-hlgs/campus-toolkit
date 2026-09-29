import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, FieldValue } from "@/lib/firebase-admin";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
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
  USER_COLLECTION,
  UserRole,
} from "@/types/users";
import { SchoolPeriod } from "@/types/settings";
import { rosterCollection } from "@/types/roster";
import {
  buildAccountRecord,
  checkRosterConflict,
  countOtherActiveAdmins,
  getRosterEntry,
  hashRosterPassword,
  isActiveEntry,
  loadAccountIndex,
  syncEntryIdentity,
  validateAccountInput,
} from "@/lib/roster";

/** 帳號狀態變更的守門：本人、以及「仍是有效管理員且只剩他一位」都要擋 */
async function assertAccountStatusAllowed(
  uid: string,
  sessionUid: string
): Promise<NextResponse | null> {
  if (uid === sessionUid) {
    return NextResponse.json(
      { success: false, message: "無法停用自己使用的帳號" },
      { status: 400 }
    );
  }
  const period = await getCurrentPeriod();
  const entry = await getRosterEntry(uid, "admin", period);
  if (isActiveEntry(entry) && (await countOtherActiveAdmins(uid)) === 0) {
    return NextResponse.json(
      { success: false, message: "無法停用最後一位有效管理員" },
      { status: 400 }
    );
  }
  return null;
}

/** 當期四張名冊 → 每個 uid 具備的身分（順序固定 ALL_ROLES） */
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
    status: isAccountStatus(data.status) ? data.status : ACTIVE_STATUS,
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
  const raw = body.input;
  const input: Record<string, string> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(
          Object.entries(raw as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : {};
  return { uid, input, preferredRole: body.preferredRole };
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

    const { denial } = await requireAdminModule("account");
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

/** POST：新增使用者帳號（不含名冊條目，身分於「身分名冊管理」建立） */
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

    const { session, denial } = await requireAdminModule("account");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { input, preferredRole } = parseAccountBody(body);
    if (!isValidPreferredRole(preferredRole)) {
      return NextResponse.json({ success: false, message: "慣用身分無效" }, { status: 400 });
    }

    const result = validateAccountInput(input, { requirePassword: true });
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    const index = await loadAccountIndex();
    const conflict = checkRosterConflict(result.account, {}, index);
    if (conflict) {
      return NextResponse.json({ success: false, message: conflict }, { status: 409 });
    }

    const record = buildAccountRecord(
      result.account,
      await hashRosterPassword(result.password as string),
      isUserRole(preferredRole) ? preferredRole : undefined
    );
    const docRef = await getAdminDb().collection(USER_COLLECTION).add(record);

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "account_created",
      ip: getClientIp(request),
      details: `建立帳號 ${result.account.account || result.account.email}（${result.account.name}）`,
    });

    return NextResponse.json({
      success: true,
      uid: docRef.id,
      message: "帳號已建立，請至「身分名冊管理」指定身分",
    });
  } catch (error) {
    console.error("Account create error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/** PUT：更新帳號（電子郵件／帳號／姓名／密碼／慣用身分），同步當期名冊展示資料 */
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

    const { session, denial } = await requireAdminModule("account");
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
    }
    // 慣用身分：空字串＝清除（多身分登入時改回每次詢問）
    if (preferredRole !== undefined) {
      updateData.preferredRole = isUserRole(preferredRole) ? preferredRole : FieldValue.delete();
    }

    await ref.update(updateData);

    // 名稱／信箱變更：同步當期四張名冊的展示資料（歷史學期不受影響）
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

/** PATCH：帳號狀態（有效／無效／停權），擋整個帳號能否登入 */
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

    const { session, denial } = await requireAdminModule("account");
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
      details: `將帳號 ${account.account || uid} 狀態設為「${status}」`,
    });

    return NextResponse.json({
      success: true,
      message: status === ACTIVE_STATUS ? "狀態已恢復為有效" : `狀態已設為「${status}」`,
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

    const { session, denial } = await requireAdminModule("account");
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
