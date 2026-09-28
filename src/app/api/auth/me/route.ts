import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { getCurrentPeriod } from "@/lib/settings-server";
import { adminModulesOf, getRosterEntry } from "@/lib/roster";

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
  return NextResponse.json({
    success: true,
    user: { ...user, roles, ...(adminModules ? { adminModules } : {}) },
  });
}
