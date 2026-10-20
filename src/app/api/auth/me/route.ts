import { NextResponse } from "next/server";
import { delegatedModuleGrants, verifySession } from "@/lib/dal";
import { adminModulesOf, getRosterEntry } from "@/lib/roster";
import { getCurrentPeriod } from "@/lib/settings-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { USER_COLLECTION } from "@/types/users";

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ success: false, message: "未登入" }, { status: 401 });
  }
  // __user／__entry 是 verifySession 掛上的伺服器端快取（含 passwordHash 等敏感欄位），
  // 必須與 jti、candidates 一併剝除，不得出現在回應（見 docs/資料庫讀取規範.md 鐵律 5）
  const { jti: _jti, candidates, __user: _cachedUser, __entry: _cachedEntry, ...user } = session;
  // 可用身分清單（多身分切換選單用），舊 token 無 candidates 時以目前身分回補
  const roles = (candidates?.length ? candidates : [{ role: session.role }]).map(
    (candidate) => candidate.role
  );
  // 管理員功能模組（首頁卡片顯示用）：管理員恆全權＝全部；讀不到時為 undefined，前端視為全部隱藏
  let adminModules: string[] | undefined;
  // 非管理員身分被指定管理的模組（導覽入口顯示用；政策修改書 G3）
  let delegatedModules: Array<{ module: string; permissions: string[] }> | undefined;
  if (session.role === "admin") {
    try {
      // 優先復用 verifySession 已讀的當期管理員條目，避免同請求重複讀取
      const entry =
        session.__entry ??
        (await getRosterEntry(session.uid, "admin", await getCurrentPeriod()));
      adminModules = adminModulesOf(entry);
    } catch {
      adminModules = [];
    }
  } else {
    try {
      const grants = await delegatedModuleGrants(session);
      if (grants.length > 0) delegatedModules = grants;
    } catch {
      delegatedModules = undefined;
    }
  }
  // 首次登入須先改密碼（管理員代設的預設密碼）：供全螢幕強制改密碼遮罩判斷
  // 讀不到＝false（不擋）；session 本身已通過 users 文件校驗，此處失敗屬例外情況
  let mustChangePassword = false;
  try {
    if (session.__user !== undefined) {
      // 復用 verifySession 已讀的使用者文件，不再重複查詢
      mustChangePassword = session.__user?.mustChangePassword === true;
    } else {
      const snap = await getAdminDb().collection(USER_COLLECTION).doc(session.uid).get();
      mustChangePassword = Boolean(snap.exists && snap.data()?.mustChangePassword === true);
    }
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
      ...(delegatedModules ? { delegatedModules } : {}),
    },
  });
}
