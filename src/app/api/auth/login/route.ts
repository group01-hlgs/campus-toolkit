import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, hashPassword } from "@/lib/auth";
import {
  createSession,
  setPending2FACookie,
  setPendingRoleCookie,
} from "@/lib/server-session";
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
import { isAccountActive, UserRole } from "@/types/users";
import {
  AccountCandidate,
  detectRoleCandidates,
  filterByPassword,
  findAccountsBy,
  orderRoles,
  preferredRoleAmong,
} from "@/lib/login-candidate";
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

/** 鎖定是否命中目前來源：lockIp 為空＝全域鎖定；全域門檻達標一律視為鎖定 */
function isLockedFor(data: Record<string, unknown>, ip: string): boolean {
  const lockedUntil = typeof data.lockedUntil === "number" ? data.lockedUntil : 0;
  const lockIp = typeof data.lockIp === "string" ? data.lockIp : "";
  const failedAttempts =
    typeof data.failedAttempts === "number" ? data.failedAttempts : 0;
  const lockActive = lockedUntil > Date.now() && (!lockIp || !ip || lockIp === ip);
  const globalLockActive =
    failedAttempts >= GLOBAL_LOCK_THRESHOLD && lockedUntil > Date.now();
  return lockActive || globalLockActive;
}

/**
 * 密碼錯誤：對所有「有效」候選累加失敗次數。
 * 同一組帳號（電子郵件）的多個身分視為同一個登入主體，一起累加、
 * 一起綁定來源 IP，避免只鎖其中一個身分而其他身分仍可被爆破。
 */
async function recordLoginFailure(
  candidates: AccountCandidate[],
  ip: string
): Promise<void> {
  let reported = 0;
  for (const candidate of candidates) {
    if (!isAccountActive(candidate.data)) continue;

    const lockedUntil =
      typeof candidate.data.lockedUntil === "number" ? candidate.data.lockedUntil : 0;
    const lockIp = typeof candidate.data.lockIp === "string" ? candidate.data.lockIp : "";
    const failedAttempts =
      typeof candidate.data.failedAttempts === "number" ? candidate.data.failedAttempts : 0;

    // 鎖定已過期：重設計數，讓使用者在冷卻後重新開始
    const lockExpired = lockedUntil > 0 && lockedUntil <= Date.now();
    const baseFailures = lockExpired ? 0 : failedAttempts;
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

    await candidate.ref.update({
      failedAttempts: newFailCount,
      lockedUntil: lockUntil,
      lockIp: lockUntil ? nextLockIp : "",
    });

    if (newFailCount >= GLOBAL_LOCK_THRESHOLD) {
      await logActivity({
        userId: candidate.id,
        role: candidate.role,
        action: "account_locked",
        ip,
        details: `連續失敗 ${GLOBAL_LOCK_THRESHOLD} 次，全域鎖定 ${GLOBAL_LOCK_DURATION_MS / 60_000} 分鐘`,
      });
    } else if (newFailCount === LOCK_THRESHOLD) {
      await logActivity({
        userId: candidate.id,
        role: candidate.role,
        action: "account_locked",
        ip,
        details: `連續失敗 ${LOCK_THRESHOLD} 次，鎖定 15 分鐘（限來源 ${ip || "未知"}）`,
      });
    }

    reported = Math.max(reported, newFailCount);
  }

  await logActivity({
    userId: candidates[0]?.id || "",
    role: candidates[0]?.role || "",
    action: "login_failed",
    ip,
    details: `密碼錯誤，失敗次數 ${reported}`,
  });
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

    let body: { account?: unknown; password?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "請求內容無效" },
        { status: 400 }
      );
    }
    const { account, password } = body;
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

    const systemEnabled = await isSystemEnabled();
    const input = String(account).toLowerCase().trim();

    // 帳號維度限流：不依賴 IP，擋針對單一帳號的爆破（不依身分拆額度）
    const accountLimited = enforceAccountRateLimit(
      "login",
      "any",
      input,
      RATE.LOGIN_ACCOUNT.limit,
      RATE.LOGIN_ACCOUNT.windowMs
    );
    if (accountLimited) return accountLimited;

    const isEmail = input.includes("@");
    const field = isEmail ? "email" : "account";

    // 找出以同一組登入識別建立的使用者帳號（身分由伺服器查找決定）
    const found = await findAccountsBy(field, input);
    // 系統停用（維護）時僅管理員可登入：先收斂候選再驗證，避免以回覆差異洩漏帳號狀態
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
      await verifyPassword(password, await getDummyHash());
      await logActivity({
        action: "login_failed",
        ip,
        details: `帳號不存在或錯誤：${input}`,
      });
      // 401 + 通用訊息：不證實帳號是否存在（防枚舉）
      return NextResponse.json(
        { success: false, message: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    // 鎖定：任一候選命中目前來源即以通用回覆拒絕（不透露鎖定狀態）
    if (scoped.some((candidate) => isLockedFor(candidate.data, ip))) {
      await logActivity({
        userId: scoped[0].id,
        role: scoped[0].role,
        action: "login_failed",
        ip,
        details: "帳號已鎖定期間嘗試登入",
      });
      return NextResponse.json(
        { success: false, message: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    const matches = await filterByPassword(password, scoped);
    if (matches.length === 0) {
      await recordLoginFailure(scoped, ip);
      return NextResponse.json(
        { success: false, message: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    // 通過帳密驗證的帳號：稱謂、兩階段驗證設定與預設身分都以它為準
    const primary = matches[0];

    // 停用（無效／停權）帳號不得登入。放在密碼驗證成功後才擋，
    // 不會在帳號不存在／密碼錯誤時透露帳號狀態（防枚舉）
    if (!isAccountActive(primary.data)) {
      await logActivity({
        userId: primary.id,
        role: primary.role,
        action: "login_failed",
        ip,
        details: `停用帳號（${typeof primary.data.status === "string" ? primary.data.status : "無效"}）嘗試登入`,
      });
      return NextResponse.json(
        { success: false, message: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    const displayName =
      primary.data.name || primary.data.displayName || "";
    const primaryEmail = typeof primary.data.email === "string" ? primary.data.email : "";
    const primaryAccount =
      typeof primary.data.account === "string" ? primary.data.account : "";

    // 多身分偵測：以 primary 的電子郵件跨四種身分比對。
    // 登入識別若是帳號名稱，還須另查同一組信箱的其他身分（身分各有各的帳號名稱）。
    const emailScoped =
      primaryEmail && !(field === "email" && input === primaryEmail)
        ? await findAccountsBy("email", primaryEmail)
        : scoped;
    const detectScope = systemEnabled
      ? emailScoped
      : emailScoped.filter((candidate) => candidate.role === "admin");
    const candidates = await detectRoleCandidates(primary, detectScope);

    // 候選中任一在本來源被鎖：以通用回覆拒絕（與單一帳號一致）
    if (candidates.some((candidate) => isLockedFor(candidate.data, ip))) {
      await logActivity({
        userId: primary.id,
        role: primary.role,
        action: "login_failed",
        ip,
        details: "帳號已鎖定期間嘗試登入",
      });
      return NextResponse.json(
        { success: false, message: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    const preferred = preferredRoleAmong(candidates);

    // 兩階段驗證：登入時驗證一次（設定取自通過帳密驗證的帳號），與要進入的身分無關
    const { method: twoFactorMethod } = readTwoFactorProfile(primary.data);
    if (twoFactorMethod === "email_otp" || twoFactorMethod === "totp") {
      // Email OTP 寄信不可用（SMTP 未設定）時不阻擋登入，避免把自己鎖在門外
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
          via: "password",
        });
        await logActivity({
          userId: primary.id,
          role: primary.role,
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

    // 多身分且未設定慣用身分：帳密已驗證，登入視為成功，交由選擇身分專頁決定要進入的身分
    if (!preferred && candidates.length > 1) {
      await setPendingRoleCookie({
        email: primaryEmail,
        account: primaryAccount,
        displayName,
        via: twoFactorMethod === "email_notify" ? "password+email_notify" : "password",
        candidates,
      });
      return NextResponse.json({
        success: false,
        requiresRoleChoice: orderRoles(candidates.map((candidate) => candidate.role)),
        message: "此帳號具備多個身分，請選擇要登入的身分",
      });
    }

    const role: UserRole = preferred ?? primary.role;
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
        twoFactorMethod === "email_notify" ? "password+email_notify" : "password",
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
      tokenVersion:
        typeof target.data.tokenVersion === "number" ? target.data.tokenVersion : 1,
    };

    await createSession({
      uid: user.uid,
      email: user.email,
      account: user.account,
      displayName: user.displayName,
      role,
      candidates,
      tokenVersion: user.tokenVersion,
    });


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
