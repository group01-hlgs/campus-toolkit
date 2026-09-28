import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, FieldValue } from "@/lib/firebase-admin";
import { requireRole, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { getCurrentPeriod } from "@/lib/settings-server";
import {
  ROLE_COLLECTIONS,
  AccountStatus,
  ACTIVE_STATUS,
  isAccountActive,
  isAccountStatus,
} from "@/types/users";
import { isRosterRole, rosterRoleLabel, ROSTER_ENTRY_FIELDS, RosterInput, RosterRole } from "@/types/roster";
import {
  buildAccountRecord,
  buildRosterEntry,
  checkRosterConflict,
  entryRoleOf,
  hashRosterPassword,
  loadPeriodEntries,
  loadRosterIndex,
  ROSTER_COLLECTION,
  rosterEntryId,
  toRosterMember,
  validateRosterInput,
} from "@/lib/roster";

/** 名稱欄位：管理員文件用 displayName，其餘身分用 name */
function nameKey(role: RosterRole): "displayName" | "name" {
  return role === "admin" ? "displayName" : "name";
}

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

    const { denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const role = request.nextUrl.searchParams.get("role");
    if (!isRosterRole(role)) {
      return NextResponse.json(
        { success: false, message: "帳號身分無效" },
        { status: 400 }
      );
    }

    const period = await getCurrentPeriod();
    const snapshot = await getAdminDb().collection(ROLE_COLLECTIONS[role]).get();
    const entryRole = entryRoleOf(role);
    // 管理員名冊條目只有學年度學期標記、沒有欄位，清單不需讀取
    const entries =
      ROSTER_ENTRY_FIELDS[entryRole].length > 0
        ? await loadPeriodEntries(period, entryRole)
        : new Map<string, Record<string, unknown>>();

    const members = snapshot.docs
      .map((doc) => toRosterMember(role, doc.id, doc.data(), entries.get(doc.id) ?? null))
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

    const { session, denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { role, input } = parseRosterBody(body);
    if (!role) {
      return NextResponse.json({ success: false, message: "帳號身分無效" }, { status: 400 });
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

    const accountRecord = buildAccountRecord(
      result.account,
      await hashRosterPassword(result.password as string)
    );
    const docRef = await getAdminDb().collection(ROLE_COLLECTIONS[role]).add(accountRecord);

    // 四種身分都寫入當期名冊條目（管理員條目只有學年度學期標記）
    const entryRole = entryRoleOf(role);
    await getAdminDb()
      .collection(ROSTER_COLLECTION)
      .doc(rosterEntryId(docRef.id, period))
      .set(buildRosterEntry(docRef.id, entryRole, period, result.roster));

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

    const { session, denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { role, uid, input } = parseRosterBody(body);
    if (!role || !uid) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    const result = validateRosterInput(role, input, { requirePassword: false });
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    const ref = getAdminDb().collection(ROLE_COLLECTIONS[role]).doc(uid);
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
      [nameKey(role)]: account.name,
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

    await ref.update(updateData);

    // 名冊欄位寫入「目前學年度學期」的條目，歷史學期不受影響
    const entryRole = entryRoleOf(role);
    const entryId = rosterEntryId(uid, period);
    const entryRef = getAdminDb().collection(ROSTER_COLLECTION).doc(entryId);
    const entrySnap = await entryRef.get();
    if (entrySnap.exists) {
      const patch: Record<string, unknown> = { ...result.roster, updatedAt: Date.now() };
      await entryRef.update(patch);
    } else {
      await entryRef.set(buildRosterEntry(uid, entryRole, period, result.roster));
    }

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_updated",
      ip: getClientIp(request),
      details: `更新${rosterRoleLabel(role)} ${account.account || account.email}${password ? "（密碼已重設）" : ""}`,
    });

    return NextResponse.json({ success: true, message: "資料已更新" });
  } catch (error) {
    console.error("Roster update error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/** PATCH：切換帳號有效／無效 */
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

    const { session, denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const role = isRosterRole(body.role) ? body.role : null;
    const uid = typeof body.uid === "string" ? body.uid : "";
    // 欄位為 status（有效／無效／停權）；相容舊的 active 布林（true→有效、false→無效）
    const status: AccountStatus | null = isAccountStatus(body.status)
      ? body.status
      : typeof body.active === "boolean"
        ? body.active
          ? ACTIVE_STATUS
          : "無效"
        : null;
    if (!role || !uid || !status) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    if (status !== ACTIVE_STATUS) {
      if (role === "admin" && uid === session.uid) {
        return NextResponse.json(
          { success: false, message: "無法停用自己使用的管理員帳號" },
          { status: 400 }
        );
      }
      if (role === "admin") {
        // 停用管理員前先確認還有其他有效管理員，避免把自己鎖在門外
        const admins = await getAdminDb().collection(ROLE_COLLECTIONS.admin).get();
        const activeAdmins = admins.docs.filter((doc) => {
          if (doc.id === uid) return false;
          return isAccountActive(doc.data());
        });
        if (activeAdmins.length === 0) {
          return NextResponse.json(
            { success: false, message: "無法停用最後一位有效管理員" },
            { status: 400 }
          );
        }
      }
    }

    const ref = getAdminDb().collection(ROLE_COLLECTIONS[role]).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ success: false, message: "查無此筆資料" }, { status: 404 });
    }
    // 寫入 status 並清掉舊的 active 欄位（兩者不可並存）
    await ref.update({ status, active: FieldValue.delete() });

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "account_updated",
      ip: getClientIp(request),
      details: `將${rosterRoleLabel(role)}帳號 ${snap.data()?.account || uid} 狀態設為「${status}」`,
    });

    return NextResponse.json({
      success: true,
      message: status === ACTIVE_STATUS ? "帳號已啟用" : `帳號狀態已設為「${status}」`,
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

    const { session, denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { role, uid } = parseRosterBody(body);
    if (!role || !uid) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }

    if (role === "admin" && uid === session.uid) {
      return NextResponse.json(
        { success: false, message: "無法刪除自己使用的管理員帳號" },
        { status: 400 }
      );
    }

    const ref = getAdminDb().collection(ROLE_COLLECTIONS[role]).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ success: false, message: "查無此筆資料" }, { status: 404 });
    }
    const target = snap.data() || {};

    if (role === "admin") {
      const count = (await getAdminDb().collection(ROLE_COLLECTIONS.admin).count().get()).data().count;
      if (count <= 1) {
        return NextResponse.json(
          { success: false, message: "無法刪除最後一位管理員" },
          { status: 400 }
        );
      }
    }

    await ref.delete();

    // 帳號刪除時一併清掉各學年度學期的身分名冊條目
    const entrySnap = await getAdminDb()
      .collection(ROSTER_COLLECTION)
      .where("uid", "==", uid)
      .get();
    if (!entrySnap.empty) {
      const batch = getAdminDb().batch();
      for (const doc of entrySnap.docs) batch.delete(doc.ref);
      await batch.commit();
    }

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
