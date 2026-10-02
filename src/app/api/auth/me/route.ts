import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { getCurrentPeriod } from "@/lib/settings-server";
import { adminModulesOf, getRosterEntry } from "@/lib/roster";
import { getAdminDb } from "@/lib/firebase-admin";
import { USER_COLLECTION } from "@/types/users";

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ success: false, message: "未登入" }, { status: 401 });
  }
  const { jti: _jti, candidates, ...user } = session;
  // 可用身分清單（多身分切換選單用），舊 token 無 candidates 時以目前身分回補
  const roles = (candidates?.length ? candidates : [{ role: session.role }]).map(
    (candidate) => candidate.role
  );
  // 管理員功能模組（首頁卡片顯示用）：讀不到時為 undefined，前端視為全部隱藏
  let adminModules: string[] | undefined;
  if (session.role === "admin") {
    try {
      const entry = await getRosterEntry(session.uid, "admin", await getCurrentPeriod());
      adminModules = adminModulesOf(entry);
    } catch {
      adminModules = [];
    }
  }
  // 首次登入須先改密碼（管理員代設的預設密碼）：供全螢幕強制改密碼遮罩判斷
  // 讀不到＝false（不擋）；session 本身已通過 users 文件校驗，此處失敗屬例外情況
  let mustChangePassword = false;
  try {
    const snap = await getAdminDb().collection(USER_COLLECTION).doc(session.uid).get();
    mustChangePassword = Boolean(snap.exists && snap.data()?.mustChangePassword === true);
  } catch {
    mustChangePassword = false;
  }
  return NextResponse.json({
    success: true,
    user: {
      ...user,
      roles,
      mustChangePassword,
      ...(adminModules ? { adminModules } : {}),
    },
  });
}
