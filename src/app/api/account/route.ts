import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, FieldValue } from "@/lib/firebase-admin";
import { verifySession } from "@/lib/dal";
import {
  createSession,
  getSession,
  unauthorized,
} from "@/lib/server-session";
import { revokeJti } from "@/lib/revocation";
import { getClientIp, logActivity } from "@/lib/audit";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import { getTotpIssuer, isEmailChangeAllowed, getCurrentPeriod } from "@/lib/settings-server";
import { getRosterEntry, isActiveEntry, syncEntryIdentity } from "@/lib/roster";
import { buildOtpauthUrl } from "@/lib/totp";
import { readTwoFactorProfile } from "@/lib/two-factor";
import {
  ACCOUNT_EMAIL_REQUIRED_MESSAGE,
  normalizeAccount,
  normalizeEmail,
} from "@/lib/validation";
import {
  ALL_ROLES,
  ROLE_LABELS,
  USER_COLLECTION,
  UserRole,
  isUserRole,
  lastLoginOf,
} from "@/types/users";
import { ROLE_INFO_FIELDS, adminModuleLabels } from "@/types/roster";
import { serverErrorMessage } from "@/lib/api-error";

export interface AccountProfile {
  uid: string;
  role: string;
  roleLabel: string;
  name: string;
  email: string;
  account: string;
  loginCount: number;
  /** 最後一次登入時間（epoch ms，由登入紀錄推導），0 表示無紀錄 */
  lastLogin: number;
  lastLoginMethod: string;
  /** 最近登入紀錄（新→舊，最多 20 筆） */
  loginRecords: number[];
  twoFactor: string;
  /** TOTP Base32 密鑰（僅自身可讀；未啟用驗證碼APP時可能為空） */
  totpSecret: string;
  otpauthUrl: string;
  lockedUntil: number;
  failedAttempts: number;
  fields: Record<string, string>;
  /** 慣用身分：多身分共用帳號時登入預設進入的身分（空字串＝未設定） */
  preferredRole: string;
  /** 慣用身分可選範圍：當期名冊中有效的身分（僅一個時介面不顯示設定） */
  roleOptions: UserRole[];
}

async function buildProfile(
  role: UserRole,
  uid: string,
  sessionEmail: string,
  sessionAccount: string,
  sessionName: string,
  data: Record<string, unknown>
): Promise<AccountProfile> {
  // 名冊專屬欄位（學號、班級、職稱、管理員模組等）取目前學年度學期的條目
  const period = await getCurrentPeriod();
  const entry = await getRosterEntry(uid, role, period);
  const fields: Record<string, string> = {};
  for (const field of ROLE_INFO_FIELDS[role]) {
    if (field.key === "modules") {
      fields.modules = adminModuleLabels(entry?.modules);
      continue;
    }
    const value = entry ? entry[field.key] : "";
    fields[field.key] = typeof value === "string" ? value : "";
  }

  const { method, totpSecret } = readTwoFactorProfile(data);
  const records = Array.isArray(data.loginRecords)
    ? data.loginRecords.filter((value): value is number => typeof value === "number")
    : [];

  const effectiveEmail = typeof data.email === "string" ? data.email : sessionEmail;
  const effectiveAccount = typeof data.account === "string" ? data.account : sessionAccount;

  // 慣用身分的可選範圍：當期名冊中「有效」的身分（自身身分恆為首項）
  const activeOptions = await getActiveRoleOptions(uid, period, role);

  const entryName = entry && typeof entry.name === "string" ? entry.name : "";

  return {
    uid,
    role,
    roleLabel: ROLE_LABELS[role],
    name: entryName || (typeof data.name === "string" && data.name ? data.name : sessionName),
    email: effectiveEmail,
    account: effectiveAccount,
    loginCount: typeof data.loginCount === "number" ? data.loginCount : 0,
    lastLogin: lastLoginOf(data),
    lastLoginMethod: typeof data.lastLoginMethod === "string" ? data.lastLoginMethod : "",
    loginRecords: records.slice(-20).reverse(),
    twoFactor: method,
    totpSecret,
    otpauthUrl: totpSecret
      ? buildOtpauthUrl({
          secret: totpSecret,
          account: sessionAccount,
          issuer: await getTotpIssuer(),
        })
      : "",
    lockedUntil: typeof data.lockedUntil === "number" ? data.lockedUntil : 0,
    failedAttempts: typeof data.failedAttempts === "number" ? data.failedAttempts : 0,
    fields,
    preferredRole: isUserRole(data.preferredRole) ? data.preferredRole : "",
    roleOptions: activeOptions.length > 0 ? activeOptions : [role],
  };
}

/** 當期有效的身分清單（自身身分恆為首項） */
async function getActiveRoleOptions(
  uid: string,
  period: { academicYear: number; semester: number },
  selfRole: UserRole
): Promise<UserRole[]> {
  const roles = await Promise.all(
    ALL_ROLES.map(async (role) =>
      role === selfRole ? true : isActiveEntry(await getRosterEntry(uid, role, period))
    )
  );
  const list = ALL_ROLES.filter((_, index) => roles[index]);
  return [selfRole, ...list.filter((role) => role !== selfRole)];
}

/** GET：讀取自身帳號資料（帳號與安全管理頁三卡共用） */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "account-get",
      RATE.ACCOUNT_GET.limit,
      RATE.ACCOUNT_GET.windowMs
    );
    if (limited) return limited;

    const session = await verifySession();
    if (!session) return unauthorized();

    const snap = await getAdminDb()
      .collection(USER_COLLECTION)
      .doc(session.uid)
      .get();
    if (!snap.exists) {
      return NextResponse.json(
        { success: false, message: "找不到使用者資料" },
        { status: 404 }
      );
    }

    const profile = await buildProfile(
      session.role,
      session.uid,
      session.email,
      session.account,
      session.displayName,
      snap.data() ?? {}
    );

    return NextResponse.json(
      { success: true, profile },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Account load error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}

/**
 * PUT：儲存自身電子郵件地址／帳號／慣用身分。
 * - 兩欄可個別留空（空字串＝清除），但不可同時為空
 * - 全站查重（帳號與電子郵件唯一，四種身分共用同一張帳號表），排除自己
 * - 電子郵件變更時同步「當期」各身分名冊的展示信箱
 */
export async function PUT(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "account-put",
      RATE.ACCOUNT_UPDATE.limit,
      RATE.ACCOUNT_UPDATE.windowMs
    );
    if (limited) return limited;

    const session = await verifySession();
    if (!session) return unauthorized();

    let body: { email?: unknown; account?: unknown; preferredRole?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "請求內容無效" },
        { status: 400 }
      );
    }
    if (
      body.email === undefined &&
      body.account === undefined &&
      body.preferredRole === undefined
    ) {
      return NextResponse.json(
        { success: false, message: "沒有可儲存的變更" },
        { status: 400 }
      );
    }

    const users = getAdminDb().collection(USER_COLLECTION);
    const userRef = users.doc(session.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ success: false, message: "帳號不存在" }, { status: 404 });
    }
    const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
    const storedEmail =
      typeof userData.email === "string" ? userData.email.trim() : "";
    const currentEmail = typeof userData.email === "string" ? storedEmail : session.email || "";
    const currentAccount =
      typeof userData.account === "string"
        ? userData.account.trim()
        : session.account || "";

    const updateData: Record<string, unknown> = {};

    if (body.email !== undefined) {
      // 空字串＝清除電子郵件地址；電子郵件為必填，會於下方統一擋下
      const raw = typeof body.email === "string" ? body.email.trim() : "";
      let email = "";
      if (raw) {
        const normalized = normalizeEmail(raw);
        if (!normalized) {
          return NextResponse.json(
            { success: false, message: "電子郵件格式無效" },
            { status: 400 }
          );
        }
        email = normalized;
      }
      // 已有地址＝變更（含清空），受「開放使用者更換電子郵件地址」設定限制；
      // 尚無地址＝新增，不受限制（前端已提示日後是否可再修改）
      if (currentEmail && email !== currentEmail && !(await isEmailChangeAllowed())) {
        return NextResponse.json(
          { success: false, message: "系統設定不開放變更電子郵件地址" },
          { status: 403 }
        );
      }
      // 清空電子郵件：已啟用「電子郵件驗證碼」時無從寄信，先擋下以免把自己鎖在門外
      if (!email && currentEmail && readTwoFactorProfile(userData).method === "email_otp") {
        return NextResponse.json(
          {
            success: false,
            message: "已啟用電子郵件驗證碼兩階段驗證，請先改為其他驗證方式再清除電子郵件地址",
          },
          { status: 400 }
        );
      }
      // 僅在值真的變更時查重：值未變即為自己
      if (email && email !== currentEmail) {
        const dup = await users.where("email", "==", email).limit(1).get();
        if (!dup.empty && dup.docs[0].id !== session.uid) {
          return NextResponse.json(
            { success: false, message: "此電子郵件已被使用" },
            { status: 409 }
          );
        }
      }
      if (email !== currentEmail) updateData.email = email;
    }

    if (body.account !== undefined) {
      // 空字串＝清除帳號（帳號可留空；電子郵件仍必填）
      const raw = typeof body.account === "string" ? body.account.trim() : "";
      let account = "";
      if (raw) {
        const normalized = normalizeAccount(raw);
        if (!normalized) {
          return NextResponse.json(
            { success: false, message: "帳號格式無效（2-64 字元，限小寫英文、數字與 . _ @ -）" },
            { status: 400 }
          );
        }
        account = normalized;
      }
      // 僅在值真的變更時查重（值未變即為自己）
      if (account && account !== currentAccount) {
        const dup = await users.where("account", "==", account).limit(1).get();
        if (!dup.empty && dup.docs[0].id !== session.uid) {
          return NextResponse.json(
            { success: false, message: "此帳號已被使用" },
            { status: 409 }
          );
        }
      }
      if (account !== currentAccount) updateData.account = account;
    }

    // 慣用身分：空字串＝清除（多身分登入時改回每次詢問）
    if (body.preferredRole !== undefined) {
      if (body.preferredRole === "") {
        updateData.preferredRole = FieldValue.delete();
      } else if (isUserRole(body.preferredRole)) {
        updateData.preferredRole = body.preferredRole;
      } else {
        return NextResponse.json(
          { success: false, message: "慣用身分無效" },
          { status: 400 }
        );
      }
    }

    // 電子郵件必填（帳密登入、密碼重設、Google 登入與多身分偵測都仰賴它），帳號可留空
    const finalEmail =
      typeof updateData.email === "string" ? updateData.email : currentEmail;
    if (!finalEmail) {
      return NextResponse.json(
        { success: false, message: ACCOUNT_EMAIL_REQUIRED_MESSAGE },
        { status: 400 }
      );
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, message: "無變更" });
    }

    await userRef.update(updateData);

    // 電子郵件變更：同步當期各身分名冊的展示信箱（歷史學期保留當時資料）
    if (typeof updateData.email === "string") {
      await syncEntryIdentity(session.uid, await getCurrentPeriod(), {
        email: updateData.email,
      });
    }

    // session 內的 email／account 已過期：撤銷舊 session 並以新值重建（僅識別欄位變更時）
    const identityChanged =
      typeof updateData.email === "string" || typeof updateData.account === "string";
    if (identityChanged) {
      const priorSession = await getSession();
      if (priorSession?.jti) await revokeJti(priorSession.jti);
      await createSession({
        uid: session.uid,
        email: typeof updateData.email === "string" ? updateData.email : session.email,
        account:
          typeof updateData.account === "string" ? updateData.account : session.account,
        displayName: session.displayName,
        role: session.role,
        candidates: session.candidates?.length
          ? session.candidates
          : [{ role: session.role, id: session.uid }],
        tokenVersion: session.tokenVersion,
      });
    }

    await logActivity({
      userId: session.uid,
      role: session.role,
      action: "account_updated",
      ip: getClientIp(request),
      details: `更新自身帳號資料：${Object.keys(updateData)
        .map((key) => (key === "preferredRole" ? "慣用身分" : key))
        .join("、")}`,
    });

    const profile = await buildProfile(
      session.role,
      session.uid,
      typeof updateData.email === "string" ? updateData.email : session.email,
      typeof updateData.account === "string" ? updateData.account : session.account,
      session.displayName,
      (await userRef.get()).data() ?? {}
    );

    return NextResponse.json(
      { success: true, message: "儲存成功", profile },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Account update error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤，請稍後再試") },
      { status: 500 }
    );
  }
}
