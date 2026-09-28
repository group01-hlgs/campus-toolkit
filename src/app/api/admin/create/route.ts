import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { hashPassword } from "@/lib/auth";
import { requireRole, toAuthResponse } from "@/lib/dal";
import { logActivity, getClientIp } from "@/lib/audit";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import { normalizeEmail, normalizeAccount, isStrongPassword, PASSWORD_REQUIREMENT_MESSAGE } from "@/lib/validation";
import { serverErrorMessage } from "@/lib/api-error";

/** 供 /setup 判斷是否仍可建立首任管理員（不揭露環境變數名稱） */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "admin-create-status",
      RATE.ADMIN_CREATE_STATUS.limit,
      RATE.ADMIN_CREATE_STATUS.windowMs
    );
    if (limited) return limited;

    const existingCount = (await getAdminDb().collection("admins").count().get()).data().count;
    const available = existingCount === 0 && process.env.ALLOW_BOOTSTRAP_ADMIN === "true";
    return NextResponse.json(
      { success: true, available },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Admin create status error:", error);
    return NextResponse.json({ success: false, available: false }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "admin-create",
      RATE.ADMIN_CREATE.limit,
      RATE.ADMIN_CREATE.windowMs
    );
    if (limited) return limited;

    const ip = getClientIp(request);
    const adminsRef = getAdminDb().collection("admins");
    const existingCount = (await adminsRef.count().get()).data().count;
    const isBootstrap = existingCount === 0;
    const bootstrapEnabled = process.env.ALLOW_BOOTSTRAP_ADMIN === "true";

    // Bootstrap（首任管理員）需顯式開啟，避免資料被清空後免驗證建管
    if (isBootstrap && !bootstrapEnabled) {
      return NextResponse.json(
        { success: false, message: "初始管理員建立已停用" },
        { status: 403 }
      );
    }

    let session = null;
    if (!isBootstrap) {
      const { session: s, denial } = await requireRole("admin");
      if (denial) return toAuthResponse(denial);
      session = s;
    }

    const { email, account, password, displayName } = await request.json();

    const normEmail = normalizeEmail(email);
    const normAccount = normalizeAccount(account);
    if (!normEmail || !normAccount || !password) {
      return NextResponse.json(
        { success: false, message: "請填寫完整資訊" },
        { status: 400 }
      );
    }
    if (!isStrongPassword(password)) {
      return NextResponse.json(
        { success: false, message: PASSWORD_REQUIREMENT_MESSAGE },
        { status: 400 }
      );
    }

    const emailSnapshot = await adminsRef.where("email", "==", normEmail).limit(1).get();
    if (!emailSnapshot.empty) {
      return NextResponse.json(
        { success: false, message: "此電子郵件已被使用" },
        { status: 409 }
      );
    }

    const accountSnapshot = await adminsRef.where("account", "==", normAccount).limit(1).get();
    if (!accountSnapshot.empty) {
      return NextResponse.json(
        { success: false, message: "此帳號已被使用" },
        { status: 409 }
      );
    }

    // costFactor 不接受 request body 指定：固定使用預設 12，避免被降為弱成本雜湊
    const passwordHash = await hashPassword(password);

    const newAdmin = {
      email: normEmail,
      account: normAccount,
      displayName: typeof displayName === "string" ? displayName.slice(0, 64) : "",
      passwordHash,
      lastLogin: 0,
      lastLoginMethod: "",
      loginCount: 0,
      failedAttempts: 0,
      lockedUntil: 0,
      tokenVersion: 1,
      createdAt: Date.now(),
    };

    let docRef;
    if (isBootstrap) {
      // Transaction：再次確認仍無管理員才寫入，避免並發重複建管
      try {
        docRef = await getAdminDb().runTransaction(async (tx) => {
          const snap = await tx.get(adminsRef.limit(1));
          if (!snap.empty) {
            throw new Error("BOOTSTRAP_ALREADY_DONE");
          }
          const ref = adminsRef.doc();
          tx.set(ref, newAdmin);
          return ref;
        });
      } catch (txError) {
        if (txError instanceof Error && txError.message === "BOOTSTRAP_ALREADY_DONE") {
          return NextResponse.json(
            { success: false, message: "建立失敗，管理員可能已存在" },
            { status: 409 }
          );
        }
        throw txError;
      }
    } else {
      docRef = await adminsRef.add(newAdmin);
    }

    await logActivity({
      userId: session?.uid,
      role: "admin",
      action: "admin_created",
      ip,
      details: isBootstrap
        ? `建立初始管理員 ${newAdmin.account}`
        : `由 ${session?.account || "管理員"} 建立 ${newAdmin.account}`,
    });

    return NextResponse.json({
      success: true,
      uid: docRef.id,
      message: "管理員建立成功",
    });
  } catch (error) {
    console.error("Create admin error:", error);
    return NextResponse.json({
      success: false,
      message: serverErrorMessage(error, "系統錯誤，請稍後再試"),
    });
  }
}
