import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { createSession, setPending2FACookie } from "@/lib/server-session";
import { logActivity, getClientIp } from "@/lib/audit";
import {
  enforceRateLimit,
  enforceAccountRateLimit,
  RATE,
} from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import { isSystemEnabled } from "@/lib/settings-server";
import {
  maskEmail,
  readTwoFactorProfile,
  sendEmailOtp,
  sendLoginNotification,
} from "@/lib/two-factor";
import { ROLE_COLLECTIONS, isAccountActive, isUserRole } from "@/types/users";
import { serverErrorMessage } from "@/lib/api-error";

const LOCK_THRESHOLD = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
/** 全域鎖定門檻：不綁 IP，跨來源累計失敗即鎖，擋 botnet／換 IP 爆破 */
const GLOBAL_LOCK_THRESHOLD = 20;
const GLOBAL_LOCK_DURATION_MS = 60 * 60 * 1000;
const GENERIC_LOGIN_ERROR = "帳號或密碼錯誤";
const SYSTEM_DISABLED_MESSAGE = "系統目前暫停服務，請稍後再試";

// 帳號不存在時也跑一次同成本 bcrypt，消除「有無帳號」的時序差（帳號枚舉）
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword("timing-equalization-placeholder", 12);
  }
  return dummyHashPromise;
}

export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "login",
      RATE.LOGIN.limit,
      RATE.LOGIN.windowMs
    );
    if (limited) return limited;

    let body: { account?: unknown; password?: unknown; role?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "請求內容無效" },
        { status: 400 }
      );
    }
    const { account, password, role } = body;
    const ip = getClientIp(request);

    if (
      typeof account !== "string" ||
      typeof password !== "string" ||
      !account ||
      !password
    ) {
      return NextResponse.json(
        { success: false, message: "請輸入帳號與密碼" },
        { status: 400 }
      );
    }

    if (!isUserRole(role)) {
      return NextResponse.json({ success: false, message: "請選擇身分" }, { status: 400 });
    }

    // 系統停用時僅允許管理員登入（以便重新啟用）
    if (role !== "admin" && !(await isSystemEnabled())) {
      return NextResponse.json(
        { success: false, message: SYSTEM_DISABLED_MESSAGE },
        { status: 503 }
      );
    }

    const input = String(account).toLowerCase().trim();

    // 帳號維度限流：不依賴 IP，擋針對單一帳號的爆破
    const accountLimited = enforceAccountRateLimit(
      "login",
      role,
      input,
      RATE.LOGIN_ACCOUNT.limit,
      RATE.LOGIN_ACCOUNT.windowMs
    );
    if (accountLimited) return accountLimited;

    const isEmail = input.includes("@");
    const collectionName = ROLE_COLLECTIONS[role];
    const usersRef = getAdminDb().collection(collectionName);

    const snapshot = await usersRef
      .where(isEmail ? "email" : "account", "==", input)
      .limit(1)
      .get();

    if (snapshot.empty) {
      await verifyPassword(password, await getDummyHash());
      await logActivity({
        action: "login_failed",
        role,
        ip,
        details: `帳號不存在或錯誤：${input}`,
      });
      // 401 + 通用訊息：不證實帳號是否存在（防枚舉）
      return NextResponse.json(
        { success: false, message: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    const lockedUntil = typeof userData.lockedUntil === "number" ? userData.lockedUntil : 0;
    const lockIp = typeof userData.lockIp === "string" ? userData.lockIp : "";
    const failedAttempts =
      typeof userData.failedAttempts === "number" ? userData.failedAttempts : 0;

    // 鎖定規則：
    // ① lockIp 為空字串 → 全域鎖定（fail closed），所有 IP 皆受限
    // ② lockIp 有值 → 僅綁定來源 IP（防跨 IP 鎖號 DoS）
    const lockActive =
      lockedUntil > Date.now() && (!lockIp || !ip || lockIp === ip);
    // 全域鎖定門檻：即使 lockIp 不符，失敗次數達標仍視為鎖定
    const globalLockActive =
      failedAttempts >= GLOBAL_LOCK_THRESHOLD && lockedUntil > Date.now();

    if (lockActive || globalLockActive) {
      await logActivity({
        userId: userDoc.id,
        role,
        action: "login_failed",
        ip,
        details: "帳號已鎖定期間嘗試登入",
      });
      // 回覆與一般失敗相同，不證實帳號是否存在、也不透露鎖定狀態
      return NextResponse.json(
        { success: false, message: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    // 鎖定已過期：重設計數，讓使用者在冷卻後重新開始
    const lockExpired = lockedUntil > 0 && lockedUntil <= Date.now();
    const baseFailures = lockExpired ? 0 : failedAttempts;

    const isValid = await verifyPassword(
      password,
      typeof userData.passwordHash === "string" ? userData.passwordHash : ""
    );

    if (!isValid) {
      const newFailCount = baseFailures + 1;
      let lockUntil = 0;
      let nextLockIp = ip;

      if (newFailCount >= GLOBAL_LOCK_THRESHOLD) {
        lockUntil = Date.now() + GLOBAL_LOCK_DURATION_MS;
        nextLockIp = ""; // 全域鎖定：清空 lockIp，對所有來源生效
      } else if (newFailCount >= LOCK_THRESHOLD) {
        const existingLockActive = lockedUntil > Date.now();
        if (!existingLockActive || !lockIp || lockIp === ip) {
          lockUntil = Date.now() + LOCK_DURATION_MS;
          nextLockIp = ip;
        } else {
          // 鎖定綁在其他 IP：保留原鎖定，僅累加計數，避免換 IP 釋放原鎖
          lockUntil = lockedUntil;
          nextLockIp = lockIp;
        }
      } else if (lockExpired) {
        lockUntil = 0;
        nextLockIp = "";
      }

      await userDoc.ref.update({
        failedAttempts: newFailCount,
        lockedUntil: lockUntil,
        lockIp: lockUntil ? nextLockIp : "",
      });

      await logActivity({
        userId: userDoc.id,
        role,
        action: "login_failed",
        ip,
        details: `密碼錯誤，失敗次數 ${newFailCount}`,
      });

      if (newFailCount >= GLOBAL_LOCK_THRESHOLD) {
        await logActivity({
          userId: userDoc.id,
          role,
          action: "account_locked",
          ip,
          details: `連續失敗 ${GLOBAL_LOCK_THRESHOLD} 次，全域鎖定 ${GLOBAL_LOCK_DURATION_MS / 60_000} 分鐘`,
        });
      } else if (newFailCount >= LOCK_THRESHOLD) {
        await logActivity({
          userId: userDoc.id,
          role,
          action: "account_locked",
          ip,
          details: `連續失敗 ${LOCK_THRESHOLD} 次，鎖定 15 分鐘（限來源 ${ip || "未知"}）`,
        });
      }

      return NextResponse.json(
        { success: false, message: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    // 停用（無效／停權）帳號不得登入。放在密碼驗證成功後才擋，
    // 不會在帳號不存在／密碼錯誤時透露帳號狀態（防枚舉）
    if (!isAccountActive(userData)) {
      await logActivity({
        userId: userDoc.id,
        role,
        action: "login_failed",
        ip,
        details: `停用帳號（${typeof userData.status === "string" ? userData.status : "無效"}）嘗試登入`,
      });
      return NextResponse.json(
        { success: false, message: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    // 兩階段驗證：帳密通過後先不建立 session，交由 /api/auth/2fa 完成第二階段
    const { method: twoFactorMethod } = readTwoFactorProfile(userData);
    const displayName = userData.name || userData.displayName || "";

    if (twoFactorMethod === "email_otp" || twoFactorMethod === "totp") {
      // Email OTP 寄信不可用（SMTP 未設定）時不阻擋登入，避免把自己鎖在門外
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
          via: "password",
        });
        await logActivity({
          userId: userDoc.id,
          role,
          action: twoFactorMethod === "email_otp" ? "email_otp_sent" : "login",
          ip,
          details:
            twoFactorMethod === "email_otp"
              ? otpState === "cooldown"
                ? "登入請求 Email OTP（120 秒節流內，沿用既有驗證碼）"
                : "登入請求 Email OTP，已寄出驗證碼"
              : "帳密通過，等待 TOTP 驗證",
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
        twoFactorMethod === "email_notify" ? "password+email_notify" : "password",
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
          ? "帳密登入成功（已寄送登入通知）"
          : "帳密登入成功",
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      {
        success: false,
        message: serverErrorMessage(error, "系統錯誤，請稍後再試"),
      },
      { status: 500 }
    );
  }
}
