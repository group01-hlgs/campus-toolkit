import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, getAdminAuth } from "@/lib/firebase-admin";
import { createSession, setPending2FACookie } from "@/lib/server-session";
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
import { ROLE_COLLECTIONS, isAccountActive, isUserRole } from "@/types/users";
import {
  AccountCandidate,
  findAccountsBy,
  orderRoles,
  preferredRoleAmong,
} from "@/lib/login-candidate";
import { serverErrorMessage } from "@/lib/api-error";

const GENERIC_LOGIN_ERROR = "登入失敗，請稍後再試";

export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(request, "google", RATE.GOOGLE.limit, RATE.GOOGLE.windowMs);
    if (limited) return limited;

    const { idToken, role: requestedRoleRaw } = await request.json();
    const ip = getClientIp(request);

    if (!idToken) {
      return NextResponse.json({ success: false, message: "參數錯誤" }, { status: 400 });
    }
    // 身分可省略：登入頁不再選身分，由伺服器查找信箱所在的身分；
    // 多身分選擇步驟再次送出時會帶 role，此時只查該身分
    const requestedRole = isUserRole(requestedRoleRaw) ? requestedRoleRaw : undefined;

    const systemEnabled = await isSystemEnabled();
    // 系統停用時僅允許管理員登入（以便重新啟用）；身分未知者待查找後於下方判定
    if (requestedRole && requestedRole !== "admin" && !systemEnabled) {
      return NextResponse.json(
        { success: false, message: "系統目前暫停服務，請稍後再試" },
        { status: 503 }
      );
    }

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

    // 查找候選：指定身分只查該身分；未指定時四種身分一起查
    let candidates: AccountCandidate[];
    if (requestedRole) {
      const snapshot = await getAdminDb()
        .collection(ROLE_COLLECTIONS[requestedRole])
        .where("email", "==", email)
        .limit(1)
        .get();
      candidates = snapshot.empty
        ? []
        : [
            {
              role: requestedRole,
              id: snapshot.docs[0].id,
              ref: snapshot.docs[0].ref,
              data: snapshot.docs[0].data(),
            },
          ];
    } else {
      candidates = await findAccountsBy("email", email);
    }

    if (candidates.length === 0) {
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

    // 多個身分命中時只在「有效」帳號間解析（停用者不列入選擇）
    const pool = candidates.filter((candidate) => isAccountActive(candidate.data));
    if (pool.length === 0) {
      await logActivity({
        userId: candidates[0].id,
        role: candidates.length === 1 ? candidates[0].role : undefined,
        action: "login_failed",
        ip,
        details: `停用帳號嘗試 Google 登入：${email}`,
      });
      return NextResponse.json(
        { success: false, message: "帳號已停用，無法登入" },
        { status: 401 }
      );
    }

    const preferred = preferredRoleAmong(pool);
    const resolved =
      pool.length === 1
        ? pool[0]
        : preferred
          ? pool.find((candidate) => candidate.role === preferred)
          : undefined;

    if (!resolved) {
      // 多個有效身分且未設定慣用身分：回身分清單讓前端顯示選擇步驟
      return NextResponse.json({
        success: false,
        requiresRoleChoice: orderRoles(pool.map((candidate) => candidate.role)),
        message: "此帳號具備多個身分，請選擇要登入的身分",
      });
    }

    const role = resolved.role;
    // 系統停用時僅管理員可登入（未指定身分者於此判定）
    if (!systemEnabled && role !== "admin") {
      return NextResponse.json(
        { success: false, message: "系統目前暫停服務，請稍後再試" },
        { status: 503 }
      );
    }

    const userDoc = resolved;
    const userData = resolved.data;

    // 鎖定：全域（lockIp 為空）或綁定來源 IP（與密碼登入一致）
    const lockedUntil = typeof userData.lockedUntil === "number" ? userData.lockedUntil : 0;
    const lockIp = typeof userData.lockIp === "string" ? userData.lockIp : "";
    const failedAttempts =
      typeof userData.failedAttempts === "number" ? userData.failedAttempts : 0;
    const lockActive =
      lockedUntil > Date.now() && (!lockIp || !ip || lockIp === ip);
    const globalLockActive =
      failedAttempts >= 20 && lockedUntil > Date.now();
    if (lockActive || globalLockActive) {
      return NextResponse.json({
        success: false,
        message: GENERIC_LOGIN_ERROR,
      }, { status: 401 });
    }

    // 停用（無效／停權）帳號不得以 Google 登入
    if (!isAccountActive(userData)) {
      await logActivity({
        userId: userDoc.id,
        role,
        action: "login_failed",
        ip,
        details: "停用帳號嘗試 Google 登入",
      });
      return NextResponse.json(
        { success: false, message: "帳號已停用，無法登入" },
        { status: 401 }
      );
    }

    // 兩階段驗證：Google 登入同樣要完成第二階段才建立 session
    const { method: twoFactorMethod } = readTwoFactorProfile(userData);
    const displayName = userData.name || userData.displayName || "";

    if (twoFactorMethod === "email_otp" || twoFactorMethod === "totp") {
      const otpState =
        twoFactorMethod === "email_otp"
          ? await sendEmailOtp({
              ref: userDoc.ref,
              data: userData,
              email: userData.email,
              displayName,
              account: userData.account,
              role,
            })
          : "sent";

      if (otpState !== "smtp") {
        await setPending2FACookie({
          uid: userDoc.id,
          email: userData.email,
          account: userData.account,
          displayName,
          role,
          method: twoFactorMethod,
          via: "google",
        });
        await logActivity({
          userId: userDoc.id,
          role,
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
          maskedEmail: maskEmail(userData.email),
        });
      }

      await logActivity({
        userId: userDoc.id,
        role,
        action: "login",
        ip,
        details: "Email OTP 無法寄出，略過兩階段驗證直接登入",
      });
    }

    const now = Date.now();
    const loginRecords = [
      ...((Array.isArray(userData.loginRecords) ? userData.loginRecords : []) as number[]),
      now,
    ].slice(-50);

    await userDoc.ref.update({
      failedAttempts: 0,
      lockedUntil: 0,
      lockIp: "",
      lastLogin: now,
      lastLoginMethod:
        twoFactorMethod === "email_notify" ? "google+email_notify" : "google",
      loginCount: (userData.loginCount || 0) + 1,
      loginRecords,
    });

    const user = {
      uid: userDoc.id,
      email: userData.email,
      account: userData.account,
      displayName,
      role,
      tokenVersion: typeof userData.tokenVersion === "number" ? userData.tokenVersion : 1,
    };

    await createSession(user);

    if (twoFactorMethod === "email_notify") {
      await sendLoginNotification({
        email: userData.email,
        displayName,
        account: userData.account,
        role,
      });
    }

    await logActivity({
      userId: userDoc.id,
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
