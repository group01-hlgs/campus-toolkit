import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";
import type { UserRole } from "@/types/users";
import { publishFromModule, updateFromModule } from "@/lib/announcements";
import { publishScheduleFromModule } from "@/lib/calendar";
import { getCurrentPeriod } from "@/lib/settings-server";
import { schoolWideAudience } from "@/types/announcements";
import { getSettings, saveSettings } from "../../../lib/self-directed-learning";
import { parseSettingsInput } from "../../../types/self-directed-learning";

const noStore = { "Cache-Control": "no-store" };

const MODULE_VALUE = "selfDirectedLearning";
const ANNOUNCE_SOURCE_REF = "open-window";
const CALENDAR_SOURCE_REF = "open-window";

/** 主程式的 serverErrorMessage 等價小工具（模組不得依賴非公開面檔案 `@/lib/api-error`） */
function errorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV !== "production" && error instanceof Error) return error.message;
  return fallback;
}

function formatDateTime(epoch: number): string {
  const d = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 掛勾同步（§6 總則）：開放時間 → 公告（update→publish，固定 sourceRef 不重複發文）
 * ＋行事曆（publishScheduleFromModule 同 sourceRef 覆寫更新）。
 * 掛勾失敗不阻擋設定儲存——回 hookWarning 供頁面提示。
 */
async function syncWindowHooks(
  settings: Awaited<ReturnType<typeof getSettings>>,
  actor: { uid: string; name: string; role: "admin" }
): Promise<string | null> {
  const { openAt, closeAt } = settings;
  try {
    const period = await getCurrentPeriod();
    const audience = schoolWideAudience(["student", "parent"]);
    const calendarAudience = { roles: ["student", "parent"] as UserRole[], classCodes: [] as string[] };

    if (openAt !== null && closeAt !== null) {
      const title = "自主學習計畫開放撰寫";
      const window = `開放撰寫時間：${formatDateTime(openAt)} ～ ${formatDateTime(closeAt)}。`;
      const body = settings.instructions.trim()
        ? `${window}\n${settings.instructions.trim()}`
        : window;

      const updated = await updateFromModule({
        sourceModule: MODULE_VALUE,
        sourceRef: ANNOUNCE_SOURCE_REF,
        title,
        body,
        audience,
        publishAt: openAt,
        expireAt: closeAt,
        status: "published",
      });
      if (updated.updated === 0) {
        await publishFromModule({
          sourceModule: MODULE_VALUE,
          sourceRef: ANNOUNCE_SOURCE_REF,
          title,
          body,
          authorUid: actor.uid,
          authorName: actor.name,
          authorRole: actor.role,
          audience,
          publishAt: openAt,
          expireAt: closeAt,
        });
      }

      await publishScheduleFromModule({
        sourceModule: MODULE_VALUE,
        sourceRef: CALENDAR_SOURCE_REF,
        title,
        description: body,
        startAt: openAt,
        endAt: closeAt,
        audience: calendarAudience,
        createdBy: { uid: actor.uid, name: actor.name, role: actor.role },
        academicYear: period.academicYear,
        semester: period.semester === 2 ? 2 : 1,
      });
    } else {
      // 時間被清空：撤回公告（保留文件）與行程（取消）
      await updateFromModule({
        sourceModule: MODULE_VALUE,
        sourceRef: ANNOUNCE_SOURCE_REF,
        status: "archived",
      });
      await publishScheduleFromModule({
        sourceModule: MODULE_VALUE,
        sourceRef: CALENDAR_SOURCE_REF,
        status: "cancelled",
      }).catch(() => undefined);
    }
    return null;
  } catch (error) {
    console.warn("selfDirectedLearning hook sync failed:", error);
    return "設定已儲存，但公告／行事曆同步失敗——請重新儲存或至公告與行事曆頁手動確認";
  }
}

/** GET：回傳設定（含 lazy init 預設值） */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "self-directed-learning-admin",
      RATE.SELF_DIRECTED_LEARNING_ADMIN.limit,
      RATE.SELF_DIRECTED_LEARNING_ADMIN.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireAdminModule("selfDirectedLearning");
    if (denial) return toAuthResponse(denial);

    const settings = await getSettings();
    return NextResponse.json({ success: true, settings }, { headers: noStore });
  } catch (error) {
    console.error("selfDirectedLearning settings GET error:", error);
    return NextResponse.json({ success: false, message: errorMessage(error, "讀取設定失敗") }, { status: 500, headers: noStore });
  }
}

/** POST：儲存設定（限流＋CSRF＋權限＋稽核） */
export async function POST(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "self-directed-learning-admin-mutate",
      RATE.SELF_DIRECTED_LEARNING_ADMIN.limit,
      RATE.SELF_DIRECTED_LEARNING_ADMIN.windowMs
    );
    if (limited) return limited;
    if (!(await assertSameOrigin(request))) {
      return NextResponse.json({ success: false, message: "跨來源請求已被拒絕" }, { status: 403, headers: noStore });
    }

    const { session, denial } = await requireAdminModule("selfDirectedLearning");
    if (denial) return toAuthResponse(denial);

    const parsed = parseSettingsInput(await request.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ success: false, message: parsed.message }, { status: 400, headers: noStore });
    }

    const settings = await saveSettings(parsed.value);
    const hookWarning = await syncWindowHooks(settings, {
      uid: session.uid,
      name: session.displayName || session.account,
      role: "admin",
    });
    await logActivity({
      userId: session.uid,
      role: session.role,
      action: "self_directed_learning_settings_updated",
      ip: getClientIp(request),
      details: "更新自主學習計畫開放時間與審核設定",
    });
    return NextResponse.json(
      { success: true, settings, ...(hookWarning ? { hookWarning } : {}) },
      { headers: noStore }
    );
  } catch (error) {
    console.error("selfDirectedLearning settings POST error:", error);
    return NextResponse.json({ success: false, message: errorMessage(error, "儲存設定失敗") }, { status: 500, headers: noStore });
  }
}
