import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, FieldValue } from "@/lib/firebase-admin";
import { hashPassword } from "@/lib/auth";
import { verifySession } from "@/lib/dal";
import { unauthorized, forbidden } from "@/lib/server-session";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import {
  ROLE_COLLECTIONS,
  BaseUserRecord,
  StudentRecord,
  ParentRecord,
  StaffRecord,
} from "@/types/users";
import { serverErrorMessage } from "@/lib/api-error";

function seedCredentials(): { email: string; account: string; password: string } | null {
  const email = process.env.SEED_EMAIL;
  const account = process.env.SEED_ACCOUNT;
  const password = process.env.SEED_PASSWORD;
  if (!email || !account || !password) return null;
  return { email, account, password };
}

async function existsIn(collectionName: string, account: string, email: string): Promise<boolean> {
  const col = getAdminDb().collection(collectionName);
  const [a, e] = await Promise.all([
    col.where("account", "==", account).limit(1).get(),
    col.where("email", "==", email).limit(1).get(),
  ]);
  return !a.empty || !e.empty;
}

export async function seedRoles() {
  try {
    // 生產環境預設拒絕；需顯式 ALLOW_SEED_ROLES=true 才允許（與 bootstrap 同級防護）
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED_ROLES !== "true") {
      return NextResponse.json(
        { success: false, message: "生產環境已停用種子角色（ALLOW_SEED_ROLES 未啟用）" },
        { status: 403 }
      );
    }

    const creds = seedCredentials();
    if (!creds) {
      return NextResponse.json(
        { success: false, message: "種子帳號未設定（SEED_ACCOUNT/SEED_EMAIL/SEED_PASSWORD）" },
        { status: 403 }
      );
    }
    const { email: DEFAULT_EMAIL, account: DEFAULT_ACCOUNT, password: DEFAULT_PASSWORD } = creds;
    const passwordHash = await hashPassword(DEFAULT_PASSWORD, 12);
    const now = Date.now();

    const base: BaseUserRecord = {
      email: DEFAULT_EMAIL,
      account: DEFAULT_ACCOUNT,
      passwordHash,
      name: "",
      loginRecords: [],
      lastLoginMethod: "",
      loginCount: 0,
      cssThemeId: "",
      installedThemes: "[]",
      lockedUntil: 0,
      failedAttempts: 0,
      createdAt: now,
    };

    const created: string[] = [];
    const skipped: string[] = [];

    const studentCol = ROLE_COLLECTIONS.student;
    if (await existsIn(studentCol, DEFAULT_ACCOUNT, DEFAULT_EMAIL)) {
      skipped.push("student");
    } else {
      const student: StudentRecord = {
        ...base,
        name: "張同學",
        studentId: "910999",
        className: "101",
        classNumber: "10101",
      };
      await getAdminDb().collection(studentCol).add(student);
      created.push("student");
    }

    const parentCol = ROLE_COLLECTIONS.parent;
    if (await existsIn(parentCol, DEFAULT_ACCOUNT, DEFAULT_EMAIL)) {
      skipped.push("parent");
    } else {
      const parent: ParentRecord = {
        ...base,
        name: "張爸爸",
        studentName: "張同學",
        studentId: "910999",
        className: "101",
        classNumber: "10101",
      };
      await getAdminDb().collection(parentCol).add(parent);
      created.push("parent");
    }

    const staffCol = ROLE_COLLECTIONS.staff;
    if (await existsIn(staffCol, DEFAULT_ACCOUNT, DEFAULT_EMAIL)) {
      skipped.push("staff");
    } else {
      const staff: StaffRecord = {
        ...base,
        name: "張老師",
        className: "101",
        title: "導師",
        attribute: "教師",
      };
      await getAdminDb().collection(staffCol).add(staff);
      created.push("staff");
    }

    return NextResponse.json({
      success: true,
      created,
      skipped,
      cleaned: await removeWrenchFieldFromUsers(),
      message: `建立 ${created.length} 筆，略過 ${skipped.length} 筆`,
    });
  } catch (error) {
    console.error("Seed roles error:", error);
    return NextResponse.json({
      success: false,
      message: serverErrorMessage(error, "系統錯誤，請稍後再試"),
    });
  }
}

async function removeWrenchFieldFromUsers(): Promise<number> {
  let cleaned = 0;
  for (const col of Object.values(ROLE_COLLECTIONS)) {
    const snap = await getAdminDb().collection(col).get();
    for (const d of snap.docs) {
      if ("丟板手" in d.data()) {
        await d.ref.update({ 丟板手: FieldValue.delete() });
        cleaned += 1;
      }
    }
  }
  return cleaned;
}

// 僅接受 POST：GET 是安全動詞，sameSite=lax 下頂層導航跨站 GET 會帶 cookie，
// 若開放 GET 將可被誘導連結觸發寫入（CSRF），故不提供 GET handler。
export async function POST(request: NextRequest) {
  const originDenied = assertSameOrigin(request);
  if (originDenied) return originDenied;
  const limited = enforceRateLimit(request, "seed-roles", RATE.SEED_ROLES.limit, RATE.SEED_ROLES.windowMs);
  if (limited) return limited;
  const session = await verifySession();
  if (!session) return unauthorized();
  if (session.role !== "admin") return forbidden();
  return seedRoles();
}
