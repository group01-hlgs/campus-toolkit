import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { toAuthResponse, verifySession } from "@/lib/dal";
import { serverErrorMessage } from "@/lib/api-error";
import { createAnnouncement, getAnnouncementSettings, listInboxAnnouncements } from "@/lib/announcements";
import { isActiveEntry } from "@/lib/roster";
import { ALL_ROLES, type UserRole } from "@/types/users";
import type { AnnouncementAudience } from "@/types/announcements";
import { staffAudienceAllowed } from "@/types/announcements";

const noStore = { "Cache-Control": "no-store" };

function entryClassCode(entry: Record<string, unknown> | null | undefined): string {
  if (!entry) return "";
  return typeof entry.classCode === "string" ? entry.classCode : "";
}

/**
 * GET：角色收件匣
 * ?scope=inbox（預設）依 session 身分＋名冊班級過濾
 */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "announcements-inbox",
      RATE.ANNOUNCEMENTS_INBOX.limit,
      RATE.ANNOUNCEMENTS_INBOX.windowMs
    );
    if (limited) return limited;

    const session = await verifySession();
    if (!session) return toAuthResponse({ status: 401, message: "未登入或登入已失效" });
    if (!session.__entry || !isActiveEntry(session.__entry)) {
      // 無有效名冊條目仍可讀「針對該身分的校級公告」；班級公告需 classCode
    }
    const classCode = entryClassCode(session.__entry);
    const [items, settings] = await Promise.all([
      listInboxAnnouncements({
        role: session.role,
        classCode: classCode || null,
      }),
      getAnnouncementSettings(),
    ]);
    return NextResponse.json(
      {
        success: true,
        items,
        role: session.role,
        classCode: classCode || null,
        displayName: session.displayName,
        // 顯示方式與分類：收件匣套用置頂區／橫幅（期 B）
        displayMethod: settings.displayMethod,
        categories: settings.categories,
      },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Announcements inbox error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}

/**
 * POST：教職員（或管理員）發佈公告。
 * 教職員：對象限 student/parent/staff；若限定班級必須包含自己導師班。
 * 管理員：可任意身分與班級（管理端另有 /api/admin/announcements）。
 */
export async function POST(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "announcements-staff-post",
      RATE.ANNOUNCEMENTS_STAFF_POST.limit,
      RATE.ANNOUNCEMENTS_STAFF_POST.windowMs
    );
    if (limited) return limited;

    const session = await verifySession();
    if (!session) return toAuthResponse({ status: 401, message: "未登入或登入已失效" });
    if (session.role !== "staff" && session.role !== "admin") {
      return toAuthResponse({ status: 403, message: "僅教職員與管理員可發佈公告" });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const rawRoles = Array.isArray(body.roles) ? body.roles : [];
    const allowedRoles: UserRole[] =
      session.role === "admin"
        ? ALL_ROLES.filter((role) => rawRoles.includes(role))
        : (["student", "parent", "staff"] as UserRole[]).filter((role) =>
            rawRoles.includes(role)
          );
    if (allowedRoles.length === 0) {
      return NextResponse.json({ success: false, message: "請選擇公告對象身分" }, { status: 400 });
    }

    const ownClass = entryClassCode(session.__entry);
    const rawCodes = Array.isArray(body.classCodes)
      ? (body.classCodes as unknown[])
          .filter((code): code is string => typeof code === "string" && code.trim() !== "")
          .map((code) => code.trim().slice(0, 32))
      : [];
    // 教職員未填班級＝校級（僅限非班級受眾）；填了則必須含自己班
    let classCodes = rawCodes;
    if (session.role === "staff") {
      if (classCodes.length === 0) {
        classCodes = []; // school-wide
      } else if (!ownClass || !classCodes.includes(ownClass)) {
        return NextResponse.json(
          { success: false, message: "教職員班級公告須包含自己的導師班" },
          { status: 400 }
        );
      }
    }

    const audience: AnnouncementAudience =
      classCodes.length === 0
        ? { roles: allowedRoles, classCodes: ["*"] }
        : { roles: allowedRoles, classCodes };

    if (session.role === "staff" && !staffAudienceAllowed(audience, ownClass)) {
      return NextResponse.json(
        { success: false, message: "無權發佈至該班級" },
        { status: 403 }
      );
    }

    const { id } = await createAnnouncement({
      sourceModule: "announcements",
      title: typeof body.title === "string" ? body.title : "",
      body: typeof body.body === "string" ? body.body : "",
      categoryId: typeof body.categoryId === "string" ? body.categoryId : undefined,
      audience,
      authorUid: session.uid,
      authorName: session.displayName || session.account,
      authorRole: session.role,
      pinned: body.pinned === true && session.role === "admin",
    });

    await logActivity({
      userId: session.uid,
      role: session.role,
      action: session.role === "admin" ? "announcements_created" : "announcements_staff_posted",
      ip: getClientIp(request),
      details: `發佈公告 id=${id}（對象：${allowedRoles.join("、")}${
        classCodes.length > 0 ? `，班級 ${classCodes.join("、")}` : "，校級"
      }）`,
    });

    const items = await listInboxAnnouncements({
      role: session.role,
      classCode: ownClass || null,
    });
    const settings = await getAnnouncementSettings();
    return NextResponse.json(
      {
        success: true,
        message: "公告已發佈",
        id,
        items,
        displayMethod: settings.displayMethod,
        categories: settings.categories,
      },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Post announcement error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
