import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { logActivity, getClientIp } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { findAccountByKey, moveEntriesUid } from "@/lib/roster";
import { USER_COLLECTION } from "@/types/users";

/**
 * POST：手動銜接孤兒名冊條目（帳號已刪除、名冊條目保留）。
 * body：`{ uid（孤兒的 uid）, key（目標帳號的電子郵件地址或帳號）}`
 * 以 uid 為準整批改掛；目標帳號已有的同學期同身分條目跳過不覆寫。
 */
export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "roster-mutate",
      RATE.ROSTER_MUTATE.limit,
      RATE.ROSTER_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("roster");
    if (denial) return toAuthResponse(denial);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const fromUid = typeof body.uid === "string" ? body.uid : "";
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!fromUid || !key) {
      return NextResponse.json(
        { success: false, message: "缺少要銜接的名冊資料或目標帳號" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    if ((await db.collection(USER_COLLECTION).doc(fromUid).get()).exists) {
      return NextResponse.json(
        { success: false, message: "該筆資料已有對應帳號，無需銜接" },
        { status: 409 }
      );
    }

    const target = await findAccountByKey(key);
    if (!target) {
      return NextResponse.json({ success: false, message: "查無此帳號" }, { status: 404 });
    }

    const moved = await moveEntriesUid(fromUid, target.uid);
    if (moved === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "沒有可改掛的名冊條目（目標帳號已有同學期同身分資料，或查無該筆資料）",
        },
        { status: 409 }
      );
    }

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "roster_linked",
      ip: getClientIp(request),
      details: `手動銜接名冊條目 ${moved} 筆至 ${target.account || target.email}（${target.name}）`,
    });

    return NextResponse.json({
      success: true,
      moved,
      message: `已銜接 ${moved} 筆名冊條目至 ${target.account || target.email}（${target.name}）`,
    });
  } catch (error) {
    console.error("Roster link error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}
