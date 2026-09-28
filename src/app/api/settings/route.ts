import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireRole, toAuthResponse, verifySession } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { Settings, defaultSettings } from "@/types/settings";
import { serverErrorMessage } from "@/lib/api-error";
import { invalidateSettingsCache } from "@/lib/settings-server";

const SETTINGS_DOC = { collection: "settings", id: "system" };
const MAX_SETTINGS = 200_000;

// 公開 GET 只回傳展示用白名單欄位；
// contactPerson／contactEmail 等僅 admin 完整可見
const PUBLIC_SETTINGS_KEYS: (keyof Settings)[] = [
  "systemEnabled",
  "systemName",
  "schoolFullName",
  "schoolShortName",
  "schoolOtherNames",
  "academicYear",
  "semester",
  "cssThemeId",
  "copyrightNotice",
  "sponsorAdEnabled",
  "sessionTimeout",
  // 使用者帳號與安全管理頁需顯示「是否開放變更電子郵件」提示
  "emailChangeAllowed",
];

function pickPublicSettings(settings: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_SETTINGS_KEYS) {
    out[key] = settings[key];
  }
  return out as Partial<Settings>;
}

function pickSettings(raw: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = { ...defaultSettings };
  const keys = Object.keys(defaultSettings) as (keyof Settings)[];
  for (const key of keys) {
    if (!(key in raw)) continue;
    const def = defaultSettings[key] as unknown;
    const val = raw[key];
    if (typeof def === "boolean") {
      out[key] = Boolean(val);
    } else if (typeof def === "number") {
      const n = Number(val);
      out[key] = Number.isFinite(n) ? n : def;
    } else {
      out[key] = typeof val === "string" ? val.slice(0, 500) : def;
    }
  }
  return out as unknown as Settings;
}

export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "settings-get",
      RATE.SETTINGS_GET.limit,
      RATE.SETTINGS_GET.windowMs
    );
    if (limited) return limited;

    const noStore = { "Cache-Control": "no-store" };
    const session = await verifySession();
    const isAdmin = session?.role === "admin";

    const snap = await getAdminDb()
      .collection(SETTINGS_DOC.collection)
      .doc(SETTINGS_DOC.id)
      .get();
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    const settings = pickSettings(data ?? {});
    return NextResponse.json(
      {
        success: true,
        settings: isAdmin ? settings : pickPublicSettings(settings),
      },
      { headers: noStore }
    );
  } catch {
    return NextResponse.json(
      {
        success: true,
        settings: pickPublicSettings(defaultSettings),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "settings-put",
      30,
      60_000
    );
    if (limited) return limited;

    const { session, denial } = await requireRole("admin");
    if (denial) return toAuthResponse(denial);

    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ success: false, message: "無效的設定內容" }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    if (JSON.stringify(body).length > MAX_SETTINGS) {
      return NextResponse.json({ success: false, message: "設定過大" }, { status: 413 });
    }

    const settings = pickSettings(body);
    if (settings.sessionTimeout < 1) settings.sessionTimeout = 1;

    // 不使用 merge：整份覆寫，讓已廢棄欄位（例如 oauthClientId）
    // 在下次儲存設定時自動從 Firestore settings/system 清除
    await getAdminDb()
      .collection(SETTINGS_DOC.collection)
      .doc(SETTINGS_DOC.id)
      .set(settings);
    invalidateSettingsCache();

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "settings_change",
      ip: getClientIp(request),
      details: "系統設定已更新",
    });

    return NextResponse.json({ success: true, settings, message: "設定已儲存" });
  } catch (error) {
    console.error("Settings PUT error:", error);
    return NextResponse.json(
      { success: false, message: serverErrorMessage(error, "系統錯誤") },
      { status: 500 }
    );
  }
}
