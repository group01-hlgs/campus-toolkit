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
  ACTIVE_STATUS,
  isAccountActive,
  isAccountStatus,
  isUserRole,
  USER_COLLECTION,
  UserRole,
} from "@/types/users";
import {
  isRosterRole,
  rosterCollection,
  rosterRoleLabel,
  RosterInput,
  RosterRole,
} from "@/types/roster";
import {
  buildAccountRecord,
  buildRosterEntry,
  checkRosterConflict,
  hashRosterPassword,
  isActiveEntry,
  loadRosterIndex,
  rosterEntryId,
  syncEntryIdentity,
  toRosterMember,
  validateRosterInput,
} from "@/lib/roster";

function parseRosterBody(body: Record<string, unknown>): {
  role: RosterRole | null;
  uid: string;
  input: RosterInput;
  preferredRole: unknown;
} {
  const role = isRosterRole(body.role) ? body.role : null;
  const uid = typeof body.uid === "string" ? body.uid : "";
  const raw = body.input;
  const input: RosterInput =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as RosterInput)
      : {};
  return { role, uid, input, preferredRole: body.preferredRole };
}

/** 慣用身分：undefined＝不更動、空字串＝清除、其餘須為合法身分 */
function isValidPreferredRole(value: unknown): boolean {
  return value === undefined || value === "" || isUserRole(value);
}

function preferredRoleOf(value: unknown): UserRole | "" {
  return isUserRole(value) ? value : "";
}

/**
 * 當期「其他有效管理員」人數：名冊條目有效 ＋ 使用者帳號有效。
 * 用於擋停用／刪除最後一位管理員，避免把自己鎖在門外。
 */
async function countOtherActiveAdmins(excludeUid: string): Promise<number> {
  const db = getAdminDb();
  const period = await getCurrentPeriod();
  const snapshot = await db
    .collection(rosterCollection("admin"))
    .where("academicYear", "==", period.academicYear)
    .where("semester", "==", period.semester)
    .get();

  const uids = snapshot.docs
    .map((doc) => doc.data())
    .filter((data) => isActiveEntry(data) && typeof data.uid === "string" && data.uid !== excludeUid)
    .map((data) => data.uid as string);
  if (uids.length === 0) return 0;

  const docs = await db.getAll(
    ...uids.map((uid) => db.collection(USER_COLLECTION).doc(uid))
  );
  return docs.filter((doc) => doc.exists && isAccountActive(doc.data())).length;
}

export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "roster-list",
      RATE.ROSTER_LIST.limit,
      RATE.ROSTER_LIST.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireAdminModule("roster");
    if (denial) return toAuthResponse(denial);

    const role = request.nextUrl.searchParams.get("role");
    if (!isRosterRole(role)) {
      return NextResponse.json(
        { success: false, message: "帳號身分無效" },
        { status: 400 }
      );
    }

    // 清單＝「當期」該身分名冊條目 join 使用者帳號
    const period = await getCurrentPeriod();
    const snapshot = await getAdminDb()
      .collection(rosterCollection(role))
      .where("academicYear", "==", period.academicYear)
      .where("semester", "==", period.semester)
      .get();

    const uids = [
      ...new Set(
        snapshot.docs
          .map((doc) => doc.data().uid)
          .filter((uid): uid is string => typeof uid === "string" && !!uid)
      ),
    ];
    const accountDocs = uids.length
      ? await getAdminDb().getAll(
          ...uids.map((uid) => getAdminDb().collection(USER_COLLECTION).doc(uid))
        )
      : [];
    const accounts = new Map<string, Record<string, unknown>>();
    for (const doc of accountDocs) {
      if (doc.exists) accounts.set(doc.id, doc.data() ?? {});
    }

    const members = snapshot.docs
      .map((doc) => {
        const entry = doc.data();
        const uid = typeof entry.uid === "string" ? entry.uid : doc.id;
        return toRosterMember(role, uid, accounts.get(uid) ?? null, entry);
      })
      .sort((a, b) =>
        a.name.localeCompare(b.name, "zh-Hant") || a.account.localeCompare(b.account)
      );

    return NextResponse.json(
      { success: true, members, period },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Roster list error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "roster-mutate",
      RATE.ROSTER_MUTATE.limit,
      RATE.ROSTER_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("roster");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { role, input, preferredRole } = parseRosterBody(body);
    if (!role) {
      return NextResponse.json({ success: false, message: "帳號身分無效" }, { status: 400 });
    }
    if (!isValidPreferredRole(preferredRole)) {
      return NextResponse.json({ success: false, message: "慣用身分無效" }, { status: 400 });
    }

    const result = validateRosterInput(role, input, { requirePassword: true });
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    const period = await getCurrentPeriod();
    const index = await loadRosterIndex(role, period);
    const conflict = checkRosterConflict(result.account, result.roster, index);
    if (conflict) {
      return NextResponse.json({ success: false, message: conflict }, { status: 409 });
    }

    const db = getAdminDb();
    const accountRecord = buildAccountRecord(
      result.account,
      await hashRosterPassword(result.password as string),
      preferredRoleOf(preferredRole)
    );
    const docRef = await db.collection(USER_COLLECTION).add(accountRecord);

    // 建立「當期」該身分的名冊條目（四表各一，doc id 依 uid＋學年度＋學期）
    await db
      .collection(rosterCollection(role))
      .doc(rosterEntryId(docRef.id, period))
      .set(
        buildRosterEntry(docRef.id, role, period, result.roster, {
          email: result.account.email,
          name: result.account.name,
        })
      );

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_created",
      ip: getClientIp(request),
      details: `建立${rosterRoleLabel(role)} ${result.account.account || result.account.email}（${result.account.name}）`,
    });

    return NextResponse.json({
      success: true,
      uid: docRef.id,
      message: `${rosterRoleLabel(role)}已建立`,
    });
  } catch (error) {
    console.error("Roster create error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "roster-mutate",
      RATE.ROSTER_MUTATE.limit,
      RATE.ROSTER_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("roster");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { role, uid, input, preferredRole } = parseRosterBody(body);
    if (!role || !uid) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }
    if (!isValidPreferredRole(preferredRole)) {
      return NextResponse.json({ success: false, message: "慣用身分無效" }, { status: 400 });
    }

    const result = validateRosterInput(role, input, { requirePassword: false });
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    const ref = getAdminDb().collection(USER_COLLECTION).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ success: false, message: "查無此筆資料" }, { status: 404 });
    }

    const period = await getCurrentPeriod();
    const index = await loadRosterIndex(role, period, uid);
    const conflict = checkRosterConflict(result.account, result.roster, index);
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
      updateData.preferredRole = isUserRole(preferredRole)
        ? preferredRole
        : FieldValue.delete();
    }

    await ref.update(updateData);

    // 名稱／信箱變更：同步當期四張名冊的展示資料（歷史學期保留當時資料）
    if (typeof updateData.email === "string" || typeof updateData.name === "string") {
      await syncEntryIdentity(uid, period, {
        ...(typeof updateData.email === "string" ? { email: updateData.email } : {}),
        ...(typeof updateData.name === "string" ? { name: updateData.name } : {}),
      });
    }

    // 名冊專屬欄位寫入「目前學年度學期」的條目，歷史學期不受影響
    const entryId = rosterEntryId(uid, period);
    const entryRef = getAdminDb().collection(rosterCollection(role)).doc(entryId);
    const entrySnap = await entryRef.get();
    if (entrySnap.exists) {
      const patch: Record<string, unknown> = { ...result.roster, updatedAt: Date.now() };
      await entryRef.update(patch);
    } else {
      await entryRef.set(
        buildRosterEntry(uid, role, period, result.roster, {
          email: account.email,
          name: account.name,
        })
      );
    }

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_updated",
      ip: getClientIp(request),
      details: `更新${rosterRoleLabel(role)} ${account.account || account.email}${
        password ? "（密碼已重設）" : ""
      }${preferredRole !== undefined ? "（慣用身分已更新）" : ""}`,
    });

    return NextResponse.json({ success: true, message: "資料已更新" });
  } catch (error) {
    console.error("Roster update error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/**
 * PATCH：切換狀態（有效／無效／停權）。
 * scope="account"＝帳號層（整個帳號能否登入）；scope="roster"＝名冊層（本期該身分能否使用）。
 * 預設 roster（列表上的「停用」按鈕＝停用本期該身分）。
 */
export async function PATCH(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "roster-mutate",
      RATE.ROSTER_MUTATE.limit,
      RATE.ROSTER_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("roster");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const role = isRosterRole(body.role) ? body.role : null;
    const uid = typeof body.uid === "string" ? body.uid : "";
    const scope: "account" | "roster" = body.scope === "account" ? "account" : "roster";
    const status: AccountStatus | null = isAccountStatus(body.status) ? body.status : null;
    if (!role || !uid || !status) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    if (status !== ACTIVE_STATUS && uid === session.uid) {
      return NextResponse.json(
        { success: false, message: "無法停用自己使用的帳號" },
        { status: 400 }
      );
    }

    if (status !== ACTIVE_STATUS && role === "admin") {
      // 停用管理員前先確認還有其他有效管理員，避免把自己鎖在門外
      if ((await countOtherActiveAdmins(uid)) === 0) {
        return NextResponse.json(
          { success: false, message: "無法停用最後一位有效管理員" },
          { status: 400 }
        );
      }
    }

    const period = await getCurrentPeriod();

    if (scope === "account") {
      const ref = getAdminDb().collection(USER_COLLECTION).doc(uid);
      const snap = await ref.get();
      if (!snap.exists) {
        return NextResponse.json({ success: false, message: "查無此筆資料" }, { status: 404 });
      }
      await ref.update({ status });
    } else {
      const ref = getAdminDb().collection(rosterCollection(role)).doc(rosterEntryId(uid, period));
      const snap = await ref.get();
      if (!snap.exists) {
        return NextResponse.json({ success: false, message: "查無此筆資料" }, { status: 404 });
      }
      await ref.update({ status, updatedAt: Date.now() });
    }

    const account = (await getAdminDb().collection(USER_COLLECTION).doc(uid).get()).data() || {};
    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "account_updated",
      ip: getClientIp(request),
      details: `將${rosterRoleLabel(role)}${scope === "account" ? "帳號" : "本期身分"} ${
        account.account || uid
      } 狀態設為「${status}」`,
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

export async function DELETE(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "roster-mutate",
      RATE.ROSTER_MUTATE.limit,
      RATE.ROSTER_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("roster");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { role, uid } = parseRosterBody(body);
    if (!role || !uid) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    if (uid === session.uid) {
      return NextResponse.json(
        { success: false, message: "無法刪除自己使用的帳號" },
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

    if (role === "admin" && (await countOtherActiveAdmins(uid)) === 0) {
      return NextResponse.json(
        { success: false, message: "無法刪除最後一位管理員" },
        { status: 400 }
      );
    }

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
      action: "roster_deleted",
      ip: getClientIp(request),
      details: `刪除${rosterRoleLabel(role)} ${target.account || target.email || uid}`,
    });

    return NextResponse.json({ success: true, message: "已刪除" });
  } catch (error) {
    console.error("Roster delete error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}
