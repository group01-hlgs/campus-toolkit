import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { unauthorized } from "@/lib/server-session";
import { getCurrentPeriod } from "@/lib/settings-server";
import { getRosterEntry } from "@/lib/roster";
import { ROSTER_ENTRY_FIELDS } from "@/types/roster";
import { ROLE_LABELS } from "@/types/users";
import { serverErrorMessage } from "@/lib/api-error";

export interface MeProfile {
  role: string;
  roleLabel: string;
  name: string;
  email: string;
  account: string;
  academicYear: number;
  semester: number;
  fields: Record<string, string>;
}

export async function GET() {
  const session = await verifySession();
  if (!session) return unauthorized();

  try {
    // 資訊卡顯示「當期該身分」的名冊資料（優先復用 verifySession 已讀的條目，避免重複查詢）
    const entry =
      session.__entry ??
      (await getRosterEntry(session.uid, session.role, await getCurrentPeriod()));
    if (!entry) {
      return NextResponse.json({ success: false, message: "找不到身分資料" }, { status: 404 });
    }

    const fields: Record<string, string> = {};
    for (const key of ROSTER_ENTRY_FIELDS[session.role]) {
      // 管理員的授權模組屬權限資訊，不列入個人基本資料。
      if (key === "modules") continue;
      if (key === "attribute" && session.role === "admin") {
        fields[key] = String(entry[key] ?? "一般");
        continue;
      }
      fields[key] = String(entry[key] ?? "");
    }
    const profile: MeProfile = {
      role: session.role,
      roleLabel: ROLE_LABELS[session.role],
      name: typeof entry.name === "string" && entry.name ? entry.name : session.displayName,
      email: typeof session.__user?.email === "string" ? session.__user.email : "",
      account: typeof session.__user?.account === "string" ? session.__user.account : "",
      academicYear: typeof entry.academicYear === "number" ? entry.academicYear : 0,
      semester: typeof entry.semester === "number" ? entry.semester : 0,
      fields,
    };
    return NextResponse.json(
      { success: true, profile },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Profile load error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
