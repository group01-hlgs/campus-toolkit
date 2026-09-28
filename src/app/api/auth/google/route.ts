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
import { isSystemEnabled } from "@/lib/settings-server";
import {
  maskEmail,
  readTwoFactorProfile,
  sendEmailOtp,
  sendLoginNotification,
} from "@/lib/two-factor";
import { isAccountActive, UserRole } from "@/types/users";
import {
  detectRoleCandidates,
  findAccountsBy,
  orderRoles,
  preferredRoleAmong,
} from "@/lib/login-candidate";
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

    // 以已驗證的 Google 信箱查找四種身分的帳號（登入頁不選身分）
    const found = await findAccountsBy("email", email);
    // 系統停用（維護）時僅管理員可登入：先收斂候選，避免以回覆差異洩漏帳號狀態
    const scoped = systemEnabled
      ? found
      : found.filter((candidate) => candidate.role === "admin");

    if (scoped.length === 0) {
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

    // 停用（無效／停權）帳號不得以 Google 登入：只在「有效」帳號間解析
    const pool = scoped.filter((candidate) => isAccountActive(candidate.data));
    if (pool.length === 0) {
      await logActivity({
        userId: scoped[0].id,
        role: scoped.length === 1 ? scoped[0].role : undefined,
        action: "login_failed",
        ip,
        details: `停用帳號嘗試 Google 登入：${email}`,
      });
      return NextResponse.json(
        { success: false, message: "帳號已停用，無法登入" },
        { status: 401 }
      );
    }

    // 多身分偵測：以已驗證信箱比對其他身分（有效＋當期名冊條目）
    const primary = pool[0];
    const candidates = await detectRoleCandidates(primary, scoped);
    const preferred = preferredRoleAmong(candidates);

    // 鎖定：全域（lockIp 為空）或綁定來源 IP（與密碼登入一致）
    const locked = candidates.some((candidate) => {
      const data = candidate.data;
      const lockedUntil = typeof data.lockedUntil === "number" ? data.lockedUntil : 0;
      const lockIp = typeof data.lockIp === "string" ? data.lockIp : "";
      const failedAttempts =
        typeof data.failedAttempts === "number" ? data.failedAttempts : 0;
      const lockActive =
        lockedUntil > Date.now() && (!lockIp || !ip || lockIp === ip);
      const globalLockActive = failedAttempts >= 20 && lockedUntil > Date.now();
      return lockActive || globalLockActive;
    });
    if (locked) {
      return NextResponse.json({
        success: false,
        message: GENERIC_LOGIN_ERROR,
      }, { status: 401 });
    }

    const displayName = primary.data.name || primary.data.displayName || "";
    const primaryEmail = typeof primary.data.email === "string" ? primary.data.email : "";
    const primaryAccount =
      typeof primary.data.account === "string" ? primary.data.account : "";

    // 兩階段驗證：登入時驗證一次，與要進入的身分無關
    const { method: twoFactorMethod } = readTwoFactorProfile(primary.data);

    if (twoFactorMethod === "email_otp" || twoFactorMethod === "totp") {
      const otpState =
        twoFactorMethod === "email_otp"
          ? await sendEmailOtp({
              ref: primary.ref,
              data: primary.data,
              email: primaryEmail,
              displayName,
              account: primaryAccount,
              role: primary.role,
            })
          : "sent";

      if (otpState !== "smtp") {
        await setPending2FACookie({
          uid: primary.id,
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
          userId: primary.id,
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
        userId: primary.id,
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
    // 系統停用時僅管理員可登入（於此判定）
    if (!systemEnabled && role !== "admin") {
      return NextResponse.json(
        { success: false, message: SYSTEM_DISABLED_MESSAGE },
        { status: 503 }
      );
    }

    const target = candidates.find((candidate) => candidate.role === role) ?? primary;

    const now = Date.now();
    const loginRecords = [
      ...((Array.isArray(target.data.loginRecords) ? target.data.loginRecords : []) as number[]),
      now,
    ].slice(-50);

    await target.ref.update({
      failedAttempts: 0,
      lockedUntil: 0,
      lockIp: "",
      lastLogin: now,
      lastLoginMethod:
        twoFactorMethod === "email_notify" ? "google+email_notify" : "google",
      loginCount: (target.data.loginCount || 0) + 1,
      loginRecords,
    });

    const user = {
      uid: target.id,
      email: target.data.email,
      account: target.data.account,
      displayName: target.data.name || target.data.displayName || "",
      role,
      roles: candidates.map((candidate) => candidate.role),
      tokenVersion: typeof target.data.tokenVersion === "number" ? target.data.tokenVersion : 1,
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
