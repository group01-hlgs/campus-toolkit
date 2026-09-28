import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, FieldValue } from "@/lib/firebase-admin";
import { hashPassword } from "@/lib/auth";
import { requireRole, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { normalizeEmail, normalizeAccount, isStrongPassword, PASSWORD_REQUIREMENT_MESSAGE } from "@/lib/validation";
import { serverErrorMessage } from "@/lib/api-error";

async function requireAdmin() {
  const { session, denial } = await requireRole("admin");
  if (denial) return toAuthResponse(denial);
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "admin-list",
      RATE.ADMIN_LIST.limit,
      RATE.ADMIN_LIST.windowMs
    );
    if (limited) return limited;

    const denied = await requireAdmin();
    if (denied) return denied;

    const snapshot = await getAdminDb().collection("admins").get();

    const admins = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        uid: doc.id,
        email: data.email,
        account: data.account,
        // 統一為 name；舊管理員文件用 displayName，遷移前先回退
        name: data.name || data.displayName || "",
        lastLogin: data.lastLogin,
        loginCount: data.loginCount,
        createdAt: data.createdAt,
      };
    });

    return NextResponse.json(
      { success: true, admins },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("List admins error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "admin-put",
      RATE.ADMIN_MUTATE.limit,
      RATE.ADMIN_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const { uid, email, account, name, displayName, password } = await request.json();

    if (!uid || typeof uid !== "string") {
      return NextResponse.json(
        { success: false, message: "缺少管理員 ID" },
        { status: 400 }
      );
    }

    const adminRef = getAdminDb().collection("admins").doc(uid);
    const adminSnap = await adminRef.get();
    if (!adminSnap.exists) {
      return NextResponse.json({ success: false, message: "管理員不存在" }, { status: 404 });
    }
    const target = adminSnap.data();

    const updateData: Record<string, unknown> = {};
    const adminsRef = getAdminDb().collection("admins");
    if (email !== undefined) {
      const normEmail = normalizeEmail(email);
      if (!normEmail) {
        return NextResponse.json(
          { success: false, message: "電子郵件格式無效" },
          { status: 400 }
        );
      }
      // 查重（排除自身），與 create 流程一致
      const dupEmail = await adminsRef.where("email", "==", normEmail).limit(1).get();
      if (!dupEmail.empty && dupEmail.docs[0].id !== uid) {
        return NextResponse.json(
          { success: false, message: "此電子郵件已被使用" },
          { status: 409 }
        );
      }
      updateData.email = normEmail;
    }
    if (account !== undefined) {
      const normAccount = normalizeAccount(account);
      if (!normAccount) {
        return NextResponse.json(
          { success: false, message: "帳號格式無效" },
          { status: 400 }
        );
      }
      // 查重（排除自身），與 create 流程一致
      const dupAccount = await adminsRef.where("account", "==", normAccount).limit(1).get();
      if (!dupAccount.empty && dupAccount.docs[0].id !== uid) {
        return NextResponse.json(
          { success: false, message: "此帳號已被使用" },
          { status: 409 }
        );
      }
      updateData.account = normAccount;
    }
    // 統一寫 name；相容舊欄位 displayName
    if (name !== undefined || displayName !== undefined) {
      const raw = name !== undefined ? name : displayName;
      updateData.name = typeof raw === "string" ? raw.slice(0, 64) : "";
      // 舊欄位一併清除，避免同一份文件同時存在兩種姓名
      if (target && "displayName" in target) updateData.displayName = FieldValue.delete();
    }
    let passwordChanged = false;
    if (password) {
      if (!isStrongPassword(password)) {
        return NextResponse.json(
          { success: false, message: PASSWORD_REQUIREMENT_MESSAGE },
          { status: 400 }
        );
      }
      // costFactor 不接受 request body 指定：固定使用預設 12
      updateData.passwordHash = await hashPassword(password);
      // 重設他人密碼必須失效該帳號現有的所有 JWT
      const currentVersion =
        typeof target?.tokenVersion === "number" ? target.tokenVersion : 1;
      updateData.tokenVersion = currentVersion + 1;
      updateData.failedAttempts = 0;
      updateData.lockedUntil = 0;
      updateData.lockIp = "";
      passwordChanged = true;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, message: "無變更" });
    }

    await adminRef.update(updateData);

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "admin_updated",
      ip: getClientIp(request),
      details: `更新管理員 ${target?.account || uid}${passwordChanged ? "（密碼已重設，tokenVersion+1）" : ""}`,
    });

    return NextResponse.json({ success: true, message: "更新成功" });
  } catch (error) {
    console.error("Update admin error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "admin-delete",
      RATE.ADMIN_MUTATE.limit,
      RATE.ADMIN_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const { uid } = await request.json();

    if (!uid || typeof uid !== "string") {
      return NextResponse.json(
        { success: false, message: "缺少管理員 ID" },
        { status: 400 }
      );
    }

    const adminRef = getAdminDb().collection("admins").doc(uid);
    const targetSnap = await adminRef.get();
    if (!targetSnap.exists) {
      return NextResponse.json({ success: false, message: "管理員不存在" }, { status: 404 });
    }
    const target = targetSnap.data();

    const snapshot = await getAdminDb().collection("admins").count().get();
    if (snapshot.data().count <= 1) {
      return NextResponse.json(
        { success: false, message: "無法刪除最後一位管理員" },
        { status: 400 }
      );
    }

    await adminRef.delete();

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "admin_deleted",
      ip: getClientIp(request),
      details: `刪除管理員 ${target?.account || uid}`,
    });

    return NextResponse.json({ success: true, message: "刪除成功" });
  } catch (error) {
    console.error("Delete admin error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}
