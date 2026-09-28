import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";

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
  return NextResponse.json({ success: true, user: { ...user, roles } });
}
