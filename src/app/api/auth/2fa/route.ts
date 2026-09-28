import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  clearPending2FACookie,
  createSession,
  getPending2FAPayload,
} from "@/lib/server-session";
import { getClientIp, logActivity } from "@/lib/audit";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import { isSystemEnabled } from "@/lib/settings-server";
import { ROLE_COLLECTIONS, ROLE_LABELS } from "@/types/users";
import {
  EMAIL_OTP_COOLDOWN_MS,
  checkTwoFactorAttempt,
  clearOtpState,
  maskEmail,
  resetTwoFactorAttempts,
  verifyEmailOtp,
  verifyTotpWithReplay,
} from "@/lib/two-factor";
import { serverErrorMessage } from "@/lib/api-error";

const EXPIRED_MESSAGE = "驗證階段已過期，請重新登入";

function expired() {
  return NextResponse.json(
    { success: false, message: EXPIRED_MESSAGE },
    { status: 401 }
  );
}

/** GET：驗證頁初始化（目前方式、遮蔽信箱、到期時間、可否重送） */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "2fa-status",
      RATE.TWO_FA_STATUS.limit,
      RATE.TWO_FA_STATUS.windowMs
    );
    if (limited) return limited;

    const pending = await getPending2FAPayload();
    if (!pending) return expired();

    const snap = await getAdminDb()
      .collection(ROLE_COLLECTIONS[pending.role])
      .doc(pending.uid)
      .get();
    if (!snap.exists) return expired();

    const data = snap.data();
    const sentAt = typeof data?.otpSentAt === "number" ? data.otpSentAt : 0;

    return NextResponse.json(
      {
        success: true,
        method: pending.method,
        roleLabel: ROLE_LABELS[pending.role],
        maskedEmail: maskEmail(pending.email),
        expiresAt: pending.expiresAt,
        resendAt: pending.method === "email_otp" && sentAt ? sentAt + EMAIL_OTP_COOLDOWN_MS : 0,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("2FA status error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}

/** POST：驗證第二階段，成功才建立 session */
export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "2fa-verify",
      RATE.TWO_FA_VERIFY.limit,
      RATE.TWO_FA_VERIFY.windowMs
    );
    if (limited) return limited;

    const ip = getClientIp(request);
    const pending = await getPending2FAPayload();
    if (!pending) return expired();

    // 系統停用時僅管理員可完成登入（與密碼登入一致）
    if (pending.role !== "admin" && !(await isSystemEnabled())) {
      await clearPending2FACookie();
      return NextResponse.json(
        { success: false, message: "系統目前暫停服務，請稍後再試" },
        { status: 503 }
      );
    }

    let body: { code?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "請求內容無效" },
        { status: 400 }
      );
    }

    const attemptKey = `2fa:${pending.uid}`;
    if (!checkTwoFactorAttempt(attemptKey)) {
      return NextResponse.json(
        { success: false, message: "驗證失敗次數過多，請稍後再試或重新登入" },
        { status: 429, headers: { "Retry-After": "900" } }
      );
    }

    const userRef = getAdminDb()
      .collection(ROLE_COLLECTIONS[pending.role])
      .doc(pending.uid);
    const snap = await userRef.get();
    if (!snap.exists) return expired();
    const userData = snap.data()!;

    const passed =
      pending.method === "email_otp"
        ? verifyEmailOtp(userData, pending.uid, body.code)
        : await verifyTotpWithReplay(userRef, userData, body.code);

    if (!passed) {
      await logActivity({
        userId: pending.uid,
        role: pending.role,
        action: "two_factor_failed",
        ip,
        details:
          pending.method === "email_otp"
            ? "Email OTP 驗證失敗（錯誤或已過期）"
            : "TOTP 驗證失敗（錯誤、已過期或重複使用）",
      });
      return NextResponse.json(
        {
          success: false,
          message:
            pending.method === "email_otp"
              ? "驗證碼錯誤或已過期"
              : "驗證碼錯誤，請確認驗證器 App 的最新代碼",
        },
        { status: 401 }
      );
    }

    // 帳號在等待第二階段期間被停用：驗證碼通過也不建立 session
    if (userData.active === false) {
      await clearPending2FACookie();
      await logActivity({
        userId: pending.uid,
        role: pending.role,
        action: "login_failed",
        ip,
        details: "停用帳號完成第二階段驗證，拒絕登入",
      });
      return NextResponse.json(
        { success: false, message: "帳號已停用，無法登入" },
        { status: 401 }
      );
    }

    // 通過：清除中途憑證、OTP 暫存與失敗計數
    await clearOtpState(userRef);
    await clearPending2FACookie();
    resetTwoFactorAttempts(attemptKey);

    const now = Date.now();
    const loginRecords = [
      ...((Array.isArray(userData.loginRecords) ? userData.loginRecords : []) as number[]),
      now,
    ].slice(-50);

    await userRef.update({
      failedAttempts: 0,
      lockedUntil: 0,
      lockIp: "",
      lastLogin: now,
      lastLoginMethod: `${pending.via}+${pending.method}`,
      loginCount: (userData.loginCount || 0) + 1,
      loginRecords,
    });

    const user = {
      uid: pending.uid,
      email: userData.email,
      account: userData.account,
      displayName: userData.name || userData.displayName || "",
      role: pending.role,
      tokenVersion: typeof userData.tokenVersion === "number" ? userData.tokenVersion : 1,
    };

    await createSession(user);

    await logActivity({
      userId: pending.uid,
      role: pending.role,
      action: "two_factor_verified",
      ip,
      details:
        pending.method === "email_otp"
          ? "Email OTP 驗證成功，登入完成"
          : "TOTP 驗證成功，登入完成",
    });
    await logActivity({
      userId: pending.uid,
      role: pending.role,
      action: "login",
      ip,
      details: `兩階段驗證登入成功（${ROLE_LABELS[pending.role]}）`,
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("2FA verify error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤，請稍後再試") },
      { status: 500 }
    );
  }
}
