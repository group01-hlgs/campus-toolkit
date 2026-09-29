import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import {
  createSession,
  setPending2FACookie,
  setPendingRoleCookie,
} from "@/lib/server-session";
import { logActivity, getClientIp } from "@/lib/audit";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import { getCurrentPeriod, isSystemEnabled } from "@/lib/settings-server";
import {
  maskEmail,
  readTwoFactorProfile,
  sendEmailOtp,
  sendLoginNotification,
} from "@/lib/two-factor";
import { isAccountActive, UserRole } from "@/types/users";
import {
  detectRoleCandidates,
  findAccountBy,
  orderRoles,
  preferredRoleAmong,
} from "@/lib/login-candidate";
import { getRosterEntry, resolveDisplayName } from "@/lib/roster";
import { serverErrorMessage } from "@/lib/api-error";

const GENERIC_LOGIN_ERROR = "登入失敗，請稍後再試";
const SYSTEM_DISABLED_MESSAGE = "系統目前暫停服務，請稍後再試";

export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(request, "google", RATE.GOOGLE.limit, RATE.GOOGLE.windowMs);
    if (limited) return limited;

    const { idToken } = await request.json();
    const ip = getClientIp(request);

    if (!idToken) {
      return NextResponse.json({ success: false, message: "參數錯誤" }, { status: 400 });
    }

    const systemEnabled = await isSystemEnabled();

    // 本機驗證 Firebase ID token（signInWithPopup 產生），不打 identitytoolkit
    let email: string | undefined;
    try {
      const decoded = await getAdminAuth().verifyIdToken(String(idToken));
      if (decoded.email_verified !== true) {
        return NextResponse.json(
          { success: false, message: "Google 電子郵件未經驗證" },
          { status: 401 }
        );
      }
      if (decoded.firebase?.sign_in_provider !== "google.com") {
        return NextResponse.json(
          { success: false, message: "僅支援 Google 帳號登入" },
          { status: 401 }
        );
      }
      email = decoded.email?.toLowerCase().trim();
    } catch (error) {
      console.error("verifyIdToken failed:", error);
      return NextResponse.json(
        { success: false, message: "Google 登入驗證失敗" },
        { status: 401 }
      );
    }

    if (!email) {
      return NextResponse.json({ success: false, message: "無法取得 Google 帳號資訊" }, { status: 401 });
    }

    // 以已驗證的 Google 信箱查找使用者帳號（身分由當期名冊決定）
    const hit = await findAccountBy("email", email);

    if (!hit) {
      if (!systemEnabled) {
        return NextResponse.json(
          { success: false, message: SYSTEM_DISABLED_MESSAGE },
          { status: 503 }
        );
      }
      await logActivity({
        action: "login_failed",
        ip,
        details: `Google 帳號未註冊：${email}`,
      });
      // 通用訊息：與密碼登入一致，避免帳號枚舉
      return NextResponse.json({
        success: false,
        message: GENERIC_LOGIN_ERROR,
      }, { status: 401 });
    }

    // 停用（無效）帳號不得以 Google 登入
    if (!isAccountActive(hit.data)) {
      await logActivity({
        userId: hit.id,
        action: "login_failed",
        ip,
        details: `停用帳號嘗試 Google 登入：${email}`,
      });
      return NextResponse.json(
        { success: false, message: "帳號已停用，無法登入" },
        { status: 401 }
      );
    }

    // 身分候選：當期名冊中有效的身分；系統停用（維護）時僅管理員可登入
    const candidates = await detectRoleCandidates(hit, { adminsOnly: !systemEnabled });
    if (candidates.length === 0) {
      if (!systemEnabled) {
        return NextResponse.json(
          { success: false, message: SYSTEM_DISABLED_MESSAGE },
          { status: 503 }
        );
      }
      await logActivity({
        userId: hit.id,
        action: "login_failed",
        ip,
        details: `Google 登入通過，但當期無可用身分：${email}`,
      });
      return NextResponse.json({
        success: false,
        message: GENERIC_LOGIN_ERROR,
      }, { status: 401 });
    }

    const preferred = preferredRoleAmong(candidates);
    const primary = candidates[0];

    // 鎖定：全域（lockIp 為空）或綁定來源 IP（與密碼登入一致）
    const data = hit.data;
    const lockedUntil = typeof data.lockedUntil === "number" ? data.lockedUntil : 0;
    const lockIp = typeof data.lockIp === "string" ? data.lockIp : "";
    const failedAttempts = typeof data.failedAttempts === "number" ? data.failedAttempts : 0;
    const lockActive = lockedUntil > Date.now() && (!lockIp || !ip || lockIp === ip);
    const globalLockActive = failedAttempts >= 20 && lockedUntil > Date.now();
    if (lockActive || globalLockActive) {
      return NextResponse.json({
        success: false,
        message: GENERIC_LOGIN_ERROR,
      }, { status: 401 });
    }

    const displayName = typeof data.name === "string" ? data.name : "";
    const primaryEmail = typeof data.email === "string" ? data.email : "";
    const primaryAccount = typeof data.account === "string" ? data.account : "";

    // 兩階段驗證：登入時驗證一次，與要進入的身分無關
    const { method: twoFactorMethod } = readTwoFactorProfile(data);

    if (twoFactorMethod === "email_otp" || twoFactorMethod === "totp") {
      const otpState =
        twoFactorMethod === "email_otp"
          ? await sendEmailOtp({
              ref: hit.ref,
              data,
              email: primaryEmail,
              displayName,
              account: primaryAccount,
              role: primary.role,
            })
          : "sent";

      if (otpState !== "smtp") {
        await setPending2FACookie({
          uid: hit.id,
          email: primaryEmail,
          account: primaryAccount,
          displayName,
          role: primary.role,
          candidates,
          preferred,
          method: twoFactorMethod,
          via: "google",
        });
        await logActivity({
          userId: hit.id,
          role: primary.role,
          action: twoFactorMethod === "email_otp" ? "email_otp_sent" : "login",
          ip,
          details:
            twoFactorMethod === "email_otp"
              ? "Google 登入請求 Email OTP，已寄出驗證碼"
              : "Google 帳號驗證通過，等待 TOTP 驗證",
        });
        return NextResponse.json({
          success: true,
          requires2FA: twoFactorMethod,
          maskedEmail: maskEmail(primaryEmail),
        });
      }

      await logActivity({
        userId: hit.id,
        role: primary.role,
        action: "login",
        ip,
        details: "Email OTP 無法寄出，略過兩階段驗證直接登入",
      });
    }

    // 多身分且未設定慣用身分：Google 驗證已通過，登入視為成功，交由選擇身分專頁決定
    if (!preferred && candidates.length > 1) {
      await setPendingRoleCookie({
        email: primaryEmail,
        account: primaryAccount,
        displayName,
        via: twoFactorMethod === "email_notify" ? "google+email_notify" : "google",
        candidates,
      });
      return NextResponse.json({
        success: false,
        requiresRoleChoice: orderRoles(candidates.map((candidate) => candidate.role)),
        message: "此帳號具備多個身分，請選擇要登入的身分",
      });
    }

    const role: UserRole = preferred ?? primary.role;

    // 稱謂以「當期該身分名冊的姓名」為準，沒有才退回帳號姓名
    const entry = await getRosterEntry(hit.id, role, await getCurrentPeriod());
    const finalDisplayName = resolveDisplayName(data, entry);

    const now = Date.now();
    const loginRecords = [
      ...((Array.isArray(data.loginRecords) ? data.loginRecords : []) as number[]),
      now,
    ].slice(-50);

    await hit.ref.update({
      failedAttempts: 0,
      lockedUntil: 0,
      lockIp: "",
      lastLoginMethod:
        twoFactorMethod === "email_notify" ? "google+email_notify" : "google",
      loginCount: (data.loginCount || 0) + 1,
      loginRecords,
    });

    const user = {
      uid: hit.id,
      email: primaryEmail,
      account: primaryAccount,
      displayName: finalDisplayName,
      role,
      roles: candidates.map((candidate) => candidate.role),
      tokenVersion: typeof data.tokenVersion === "number" ? data.tokenVersion : 1,
    };

    await createSession({ ...user, candidates });

    if (twoFactorMethod === "email_notify") {
      await sendLoginNotification({
        email: user.email,
        displayName: user.displayName,
        account: user.account,
        role,
      });
    }

    await logActivity({
      userId: user.uid,
      role,
      action: "login",
      ip,
      details:
        twoFactorMethod === "email_notify"
          ? "Google 登入成功（已寄送登入通知）"
          : "Google 登入成功",
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Google session error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤，請稍後再試") },
      { status: 500 }
    );
  }
}
