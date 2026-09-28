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
import {
  AccountCandidate,
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
    const { account, password } = body;
    // 身分可省略：登入頁不再選身分，由伺服器查找帳號所在的身分；
    // 多身分選擇步驟再次送出時會帶 role，此時只查該身分
    const requestedRole = isUserRole(body.role) ? body.role : undefined;
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
    // 系統停用時僅允許管理員登入（以便重新啟用）；身分未知者待查找後於下方判定
    if (requestedRole && requestedRole !== "admin" && !systemEnabled) {
      return NextResponse.json(
        { success: false, message: SYSTEM_DISABLED_MESSAGE },
        { status: 503 }
      );
    }

    const input = String(account).toLowerCase().trim();

    // 帳號維度限流：不依賴 IP，擋針對單一帳號的爆破
    // 未指定身分時以共用鍵計算，避免靠省略 role 拆成四份額度
    const accountLimited = enforceAccountRateLimit(
      "login",
      requestedRole ?? "any",
      input,
      RATE.LOGIN_ACCOUNT.limit,
      RATE.LOGIN_ACCOUNT.windowMs
    );
    if (accountLimited) return accountLimited;

    const isEmail = input.includes("@");
    const field = isEmail ? "email" : "account";

    // 查找候選：指定身分只查該身分；未指定時四種身分一起查
    let candidates: AccountCandidate[];
    if (requestedRole) {
      const snapshot = await getAdminDb()
        .collection(ROLE_COLLECTIONS[requestedRole])
        .where(field, "==", input)
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
      candidates = await findAccountsBy(field, input);
    }

    // 解析出唯一要登入的身分；passwordVerified＝多身分流程已先驗過密碼
    let resolved: AccountCandidate;
    let passwordVerified = false;

    if (candidates.length === 0) {
      // 系統停用時一律回 503（與非管理員身分相同），不因回覆差異洩漏帳號是否存在
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

    if (candidates.length === 1) {
      resolved = candidates[0];
    } else {
      // 同一組帳號／信箱存在於多個身分：先以密碼篩出有效的身分
      const valid = await filterByPassword(password, candidates);
      if (valid.length === 0) {
        await logActivity({
          action: "login_failed",
          ip,
          details: `帳號不存在或錯誤：${input}`,
        });
        return NextResponse.json(
          { success: false, message: GENERIC_LOGIN_ERROR },
          { status: 401 }
        );
      }

      // 停用（無效／停權）者不列入選擇；全部停用時維持下方「帳號已停用」回覆
      const activePool = valid.filter((candidate) => isAccountActive(candidate.data));
      const selectable = activePool.length > 0 ? activePool : valid;

      const preferred = preferredRoleAmong(selectable);
      const match =
        selectable.length === 1
          ? selectable[0]
          : preferred
            ? selectable.find((candidate) => candidate.role === preferred)
            : undefined;

      if (match) {
        resolved = match;
        passwordVerified = true;
      } else {
        // 密碼驗證通過後才回身分清單，不構成帳號枚舉
        return NextResponse.json({
          success: false,
          requiresRoleChoice: orderRoles(selectable.map((candidate) => candidate.role)),
          message: "此帳號具備多個身分，請選擇要登入的身分",
        });
      }
    }

    const role = resolved.role;
    // 系統停用時僅管理員可登入（未指定身分者於此判定）
    if (!systemEnabled && role !== "admin") {
      return NextResponse.json(
        { success: false, message: SYSTEM_DISABLED_MESSAGE },
        { status: 503 }
      );
    }

    const userDoc = resolved;
    const userData = resolved.data;

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

    // 多身分流程已驗過密碼時不再重驗（passwordVerified）
    const isValid =
      passwordVerified ||
      (await verifyPassword(
        password,
        typeof userData.passwordHash === "string" ? userData.passwordHash : ""
      ));

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
