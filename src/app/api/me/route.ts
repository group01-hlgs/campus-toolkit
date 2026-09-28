import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { unauthorized } from "@/lib/server-session";
import { getCurrentPeriod } from "@/lib/settings-server";
import { getRosterEntry } from "@/lib/roster";
import { ROLE_INFO_FIELDS, adminModuleLabels } from "@/types/roster";
import { serverErrorMessage } from "@/lib/api-error";

export interface MeProfile {
  name: string;
  fields: Record<string, string>;
}

export async function GET() {
  const session = await verifySession();
  if (!session) return unauthorized();

  try {
    // 資訊卡顯示「當期該身分」的名冊資料
    const entry = await getRosterEntry(session.uid, session.role, await getCurrentPeriod());
    if (!entry) {
      return NextResponse.json({ success: false, message: "找不到身分資料" }, { status: 404 });
    }

    const fields: Record<string, string> = {};
    for (const f of ROLE_INFO_FIELDS[session.role]) {
      if (f.key === "modules") {
        fields.modules = adminModuleLabels(entry.modules);
        continue;
      }
      fields[f.key] = String(entry[f.key] ?? "");
    }
    const profile: MeProfile = {
      name: typeof entry.name === "string" && entry.name ? entry.name : session.displayName,
      fields,
    };
    return NextResponse.json({ success: true, profile });
  } catch (error) {
    console.error("Profile load error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
