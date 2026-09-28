import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireRole, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { ROLE_COLLECTIONS } from "@/types/users";
import { isRosterRole, rosterRoleLabel, RosterInput, RosterRole } from "@/types/roster";
import {
  buildRosterRecord,
  checkRosterConflict,
  hashRosterPassword,
  loadRosterIndex,
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
        { success: false, message: "名冊身分無效" },
        { status: 400 }
      );
    }

    const snapshot = await getAdminDb().collection(ROLE_COLLECTIONS[role]).get();
    const members = snapshot.docs
      .map((doc) => toRosterMember(role, doc.id, doc.data()))
      .sort((a, b) =>
        a.name.localeCompare(b.name, "zh-Hant") || a.account.localeCompare(b.account)
      );

    return NextResponse.json(
      { success: true, members },
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
      return NextResponse.json({ success: false, message: "名冊身分無效" }, { status: 400 });
    }

    const result = validateRosterInput(role, input, { requirePassword: true });
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    const index = await loadRosterIndex(role);
    const conflict = checkRosterConflict(result.fields, index);
    if (conflict) {
      return NextResponse.json({ success: false, message: conflict }, { status: 409 });
    }

    const record = buildRosterRecord(
      role,
      result.fields,
      await hashRosterPassword(result.password as string)
    );
    const docRef = await getAdminDb().collection(ROLE_COLLECTIONS[role]).add(record);

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_created",
      ip: getClientIp(request),
      details: `建立${rosterRoleLabel(role)} ${result.fields.account || result.fields.email}（${result.fields.name}）`,
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

    const index = await loadRosterIndex(role, uid);
    const conflict = checkRosterConflict(result.fields, index);
    if (conflict) {
      return NextResponse.json({ success: false, message: conflict }, { status: 409 });
    }

    const { fields, password } = result;
    const updateData: Record<string, unknown> = {
      email: fields.email,
      account: fields.account,
      [nameKey(role)]: fields.name,
    };
    if (role === "student") {
      updateData.studentId = fields.studentId || "";
      updateData.grade = fields.grade || "";
      updateData.className = fields.className || "";
      updateData.classNumber = fields.classNumber || "";
    }
    if (role === "staff") {
      updateData.className = fields.className || "";
      updateData.title = fields.title || "";
      updateData.attribute = fields.attribute || "";
    }

    let passwordChanged = false;
    if (password) {
      const current = snap.data() || {};
      updateData.passwordHash = await hashRosterPassword(password);
      // 重設密碼即失效該帳號既有 session（文件沒有 tokenVersion 時視為 1）
      const currentVersion = typeof current.tokenVersion === "number" ? current.tokenVersion : 1;
      updateData.tokenVersion = currentVersion + 1;
      updateData.failedAttempts = 0;
      updateData.lockedUntil = 0;
      updateData.lockIp = "";
      passwordChanged = true;
    }

    await ref.update(updateData);

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_updated",
      ip: getClientIp(request),
      details: `更新${rosterRoleLabel(role)} ${fields.account || fields.email}${passwordChanged ? "（密碼已重設）" : ""}`,
    });

    return NextResponse.json({ success: true, message: "資料已更新" });
  } catch (error) {
    console.error("Roster update error:", error);
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
