import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
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
import { getSiteName, isEmailChangeAllowed } from "@/lib/settings-server";
import { buildOtpauthUrl } from "@/lib/totp";
import { readTwoFactorProfile } from "@/lib/two-factor";
import { normalizeAccount, normalizeEmail } from "@/lib/validation";
import {
  ROLE_COLLECTIONS,
  ROLE_LABELS,
  ROLE_SPECIFIC_FIELDS,
  UserRole,
} from "@/types/users";
import { serverErrorMessage } from "@/lib/api-error";

export interface AccountProfile {
  uid: string;
  role: string;
  roleLabel: string;
  name: string;
  email: string;
  account: string;
  loginCount: number;
  /** 最後一次登入時間（epoch ms），0 表示無紀錄 */
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
}

async function buildProfile(
  role: UserRole,
  uid: string,
  sessionEmail: string,
  sessionAccount: string,
  sessionName: string,
  data: Record<string, unknown>
): Promise<AccountProfile> {
  const fields: Record<string, string> = {};
  for (const field of ROLE_SPECIFIC_FIELDS[role]) {
    fields[field.key] = String(data[field.key] ?? "");
  }

  const { method, totpSecret } = readTwoFactorProfile(data);
  const records = Array.isArray(data.loginRecords)
    ? data.loginRecords.filter((value): value is number => typeof value === "number")
    : [];

  return {
    uid,
    role,
    roleLabel: ROLE_LABELS[role],
    name:
      typeof data.name === "string" && data.name
        ? data.name
        : typeof data.displayName === "string" && data.displayName
          ? data.displayName
          : sessionName,
    email: typeof data.email === "string" && data.email ? data.email : sessionEmail,
    account:
      typeof data.account === "string" && data.account ? data.account : sessionAccount,
    loginCount: typeof data.loginCount === "number" ? data.loginCount : 0,
    lastLogin: typeof data.lastLogin === "number" ? data.lastLogin : 0,
    lastLoginMethod: typeof data.lastLoginMethod === "string" ? data.lastLoginMethod : "",
    loginRecords: records.slice(-20).reverse(),
    twoFactor: method,
    totpSecret,
    otpauthUrl: totpSecret
      ? buildOtpauthUrl({
          secret: totpSecret,
          account: sessionAccount,
          issuer: await getSiteName(),
        })
      : "",
    lockedUntil: typeof data.lockedUntil === "number" ? data.lockedUntil : 0,
    failedAttempts: typeof data.failedAttempts === "number" ? data.failedAttempts : 0,
    fields,
  };
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
      .collection(ROLE_COLLECTIONS[session.role])
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

/** PUT：儲存自身電子郵件地址／帳號（同身分內查重，排除自己） */
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

    let body: { email?: unknown; account?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "請求內容無效" },
        { status: 400 }
      );
    }
    if (body.email === undefined && body.account === undefined) {
      return NextResponse.json(
        { success: false, message: "沒有可儲存的變更" },
        { status: 400 }
      );
    }

    const collection = getAdminDb().collection(ROLE_COLLECTIONS[session.role]);
    const userRef = collection.doc(session.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ success: false, message: "帳號不存在" }, { status: 404 });
    }
    const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
    const storedEmail =
      typeof userData.email === "string" ? userData.email.trim() : "";
    // 與 buildProfile 同邏輯：檔案無 email 時以 session 帶的地址為準
    const currentEmail = storedEmail || session.email;

    const updateData: Record<string, unknown> = {};

    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (!email) {
        return NextResponse.json(
          { success: false, message: "電子郵件格式無效" },
          { status: 400 }
        );
      }
      // 已有地址＝變更，受「開放使用者更換電子郵件地址」設定限制；
      // 尚無地址＝新增，不受限制（前端已提示日後是否可再修改）
      if (currentEmail && email !== currentEmail && !(await isEmailChangeAllowed())) {
        return NextResponse.json(
          { success: false, message: "系統設定不開放變更電子郵件地址" },
          { status: 403 }
        );
      }
      const dup = await collection.where("email", "==", email).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== session.uid) {
        return NextResponse.json(
          { success: false, message: "此電子郵件已被使用" },
          { status: 409 }
        );
      }
      updateData.email = email;
    }

    if (body.account !== undefined) {
      const account = normalizeAccount(body.account);
      if (!account) {
        return NextResponse.json(
          { success: false, message: "帳號格式無效（2-64 字元，限小寫英文、數字與 . _ @ -）" },
          { status: 400 }
        );
      }
      const dup = await collection.where("account", "==", account).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== session.uid) {
        return NextResponse.json(
          { success: false, message: "此帳號已被使用" },
          { status: 409 }
        );
      }
      updateData.account = account;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, message: "無變更" });
    }

    await userRef.update(updateData);

    // session 內的 email／account 已過期：撤銷舊 session 並以新值重建
    const priorSession = await getSession();
    if (priorSession?.jti) await revokeJti(priorSession.jti);
    await createSession({
      uid: session.uid,
      email: typeof updateData.email === "string" ? updateData.email : session.email,
      account:
        typeof updateData.account === "string" ? updateData.account : session.account,
      displayName: session.displayName,
      role: session.role,
      tokenVersion: session.tokenVersion,
    });

    await logActivity({
      userId: session.uid,
      role: session.role,
      action: "account_updated",
      ip: getClientIp(request),
      details: `更新自身帳號資料：${Object.keys(updateData).join("、")}`,
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
