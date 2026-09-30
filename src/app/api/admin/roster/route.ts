import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { getCurrentPeriod } from "@/lib/settings-server";
import {
  AccountStatus,
  ACTIVE_STATUS,
  ALL_ROLES,
  isAccountStatus,
  statusLabel,
  USER_COLLECTION,
} from "@/types/users";
import {
  isRosterRole,
  rosterCollection,
  rosterRoleLabel,
  RosterInput,
  RosterRole,
} from "@/types/roster";
import {
  buildRosterEntry,
  checkRosterConflict,
  countOtherActiveAdmins,
  findAccountByKey,
  getRosterEntry,
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
} {
  const role = isRosterRole(body.role) ? body.role : null;
  const uid = typeof body.uid === "string" ? body.uid : "";
  const raw = body.input;
  const input: RosterInput =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as RosterInput)
      : {};
  return { role, uid, input };
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

    // 綁定既有帳號：先用電子郵件／帳號查出帳號與其當期具備的身分
    const lookup = request.nextUrl.searchParams.get("lookup");
    if (lookup) {
      const account = await findAccountByKey(lookup);
      if (!account) {
        return NextResponse.json({ success: false, message: "查無此帳號" }, { status: 404 });
      }
      const period = await getCurrentPeriod();
      const entries = await Promise.all(
        ALL_ROLES.map((role) => getRosterEntry(account.uid, role, period))
      );
      const roles = ALL_ROLES.filter((_, index) => entries[index] !== null);
      return NextResponse.json(
        { success: true, account: { ...account, roles } },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

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

/**
 * POST：在「既有帳號」上建立本期名冊條目（綁定）。
 * 帳號與密碼屬「使用者帳號管理」，本 API 不建立帳號、不處理密碼。
 */
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
    const { role, uid, input } = parseRosterBody(body);
    if (!role) {
      return NextResponse.json({ success: false, message: "帳號身分無效" }, { status: 400 });
    }
    if (!uid) {
      return NextResponse.json({ success: false, message: "請先查詢要綁定的帳號" }, { status: 400 });
    }

    const period = await getCurrentPeriod();

    // 一個帳號最多四種身分（同身分同週期唯一），故只建立名冊條目
    const db = getAdminDb();
    const accountSnap = await db.collection(USER_COLLECTION).doc(uid).get();
    if (!accountSnap.exists) {
      return NextResponse.json({ success: false, message: "查無此帳號" }, { status: 404 });
    }
    const accountData = accountSnap.data() || {};
    const email = typeof accountData.email === "string" ? accountData.email : "";
    const account = typeof accountData.account === "string" ? accountData.account : "";
    const name = typeof accountData.name === "string" ? accountData.name : "";

    // 帳號欄位一律以既有帳號為準（表單只用來辨識，不改帳號層）
    const result = validateRosterInput(role, { ...input, email, account, name });
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    const entryRef = db.collection(rosterCollection(role)).doc(rosterEntryId(uid, period));
    if ((await entryRef.get()).exists) {
      return NextResponse.json(
        { success: false, message: `此帳號本期已具備${rosterRoleLabel(role)}身分` },
        { status: 409 }
      );
    }

    // 電子郵件／帳號屬既有帳號，只檢查該身分專屬欄位（如學號）是否衝突
    const index = await loadRosterIndex(role, period, uid);
    const conflict = checkRosterConflict(result.account, result.roster, index);
    if (conflict) {
      return NextResponse.json({ success: false, message: conflict }, { status: 409 });
    }

    await entryRef.set(
      buildRosterEntry(uid, role, period, result.roster, { email, name })
    );

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_created",
      ip: getClientIp(request),
      details: `將${rosterRoleLabel(role)}身分綁定至既有帳號 ${accountData.account || email}（${name}）`,
    });

    return NextResponse.json({
      success: true,
      uid,
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
    const { role, uid, input } = parseRosterBody(body);
    if (!role || !uid) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    const result = validateRosterInput(role, input);
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

    // 密碼、慣用身分、帳號狀態屬帳號層，由「使用者帳號管理」工作表維護
    const { account } = result;
    await ref.update({
      email: account.email,
      account: account.account,
      name: account.name,
    });

    // 名稱／信箱變更：同步當期四張名冊的展示資料（歷史學期保留當時資料）
    await syncEntryIdentity(uid, period, { email: account.email, name: account.name });

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
      details: `更新${rosterRoleLabel(role)} ${account.account || account.email}`,
    });

    return NextResponse.json({ success: true, message: "資料已更新" });
  } catch (error) {
    console.error("Roster update error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/**
 * PATCH：切換「本期該身分」的名冊狀態（有效／無效）。
 * 帳號層狀態（整個帳號能否登入）由「使用者帳號管理」工作表維護。
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
    const status: AccountStatus | null = isAccountStatus(body.status) ? body.status : null;
    if (!role || !uid || !status) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    if (status !== ACTIVE_STATUS && uid === session.uid) {
      return NextResponse.json(
        { success: false, message: "無法停用自己使用的本期身分" },
        { status: 400 }
      );
    }

    if (status !== ACTIVE_STATUS && role === "admin") {
      // 停用管理員名冊前先確認還有其他有效管理員，避免把自己鎖在門外
      if ((await countOtherActiveAdmins(uid)) === 0) {
        return NextResponse.json(
          { success: false, message: "無法停用最後一位有效管理員" },
          { status: 400 }
        );
      }
    }

    const period = await getCurrentPeriod();
    const ref = getAdminDb().collection(rosterCollection(role)).doc(rosterEntryId(uid, period));
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ success: false, message: "查無此筆資料" }, { status: 404 });
    }
    await ref.update({ status, updatedAt: Date.now() });

    const account = (await getAdminDb().collection(USER_COLLECTION).doc(uid).get()).data() || {};
    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_updated",
      ip: getClientIp(request),
      details: `將${rosterRoleLabel(role)}本期身分 ${account.account || uid} 狀態設為「${statusLabel(status)}」`,
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

    // 只刪除「本期」名冊條目，帳號與其他學期資料保留（帳號刪除請用帳號工作表）
    if (role === "admin" && uid === session.uid) {
      return NextResponse.json(
        { success: false, message: "無法刪除自己的管理員身分" },
        { status: 400 }
      );
    }

    const period = await getCurrentPeriod();
    const ref = getAdminDb().collection(rosterCollection(role)).doc(rosterEntryId(uid, period));
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ success: false, message: "查無此筆資料" }, { status: 404 });
    }
    const entry = snap.data() || {};

    if (role === "admin" && (await countOtherActiveAdmins(uid)) === 0) {
      return NextResponse.json(
        { success: false, message: "無法刪除最後一位有效管理員" },
        { status: 400 }
      );
    }

    await ref.delete();

    const account = (await getAdminDb().collection(USER_COLLECTION).doc(uid).get()).data() || {};
    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_deleted",
      ip: getClientIp(request),
      details: `刪除${rosterRoleLabel(role)} ${account.account || account.email || uid} 的本期名冊資料`,
    });

    return NextResponse.json({
      success: true,
      message: `已刪除本期${rosterRoleLabel(role)}名冊資料`,
    });
  } catch (error) {
    console.error("Roster delete error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}
