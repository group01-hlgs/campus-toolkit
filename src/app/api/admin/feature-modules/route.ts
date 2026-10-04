import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { isSuperAdmin, requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { serverErrorMessage } from "@/lib/api-error";
import { SETTINGS_COLLECTION, SETTINGS_DOC_ID } from "@/lib/settings-server";
import {
  getFeatureModulesEnabled,
  invalidateFeatureModulesCache,
} from "@/lib/feature-modules";
import {
  FEATURE_MODULES_FIELD,
  FeatureModulesEnabledMap,
  featureModuleMeta,
  isTogglableFeatureModule,
} from "@/types/feature-modules";

/** GET：讀取選用功能模組的現行啟用狀態（所有管理員可讀，頁面顯示用） */
export async function GET(request: NextRequest) {
  try {
    const limited = enforceRateLimit(
      request,
      "feature-modules",
      RATE.FEATURE_MODULES_GET.limit,
      RATE.FEATURE_MODULES_GET.windowMs
    );
    if (limited) return limited;

    const { denial } = await requireAdminModule("modules");
    if (denial) return toAuthResponse(denial);

    const enabled = await getFeatureModulesEnabled();
    return NextResponse.json(
      { success: true, enabled },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Feature modules list error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}

/** PATCH：啟用／停用單一選用功能模組（僅超級管理員；未上線的模組不可啟用） */
export async function PATCH(request: NextRequest) {
  try {
    const originDenied = assertSameOrigin(request);
    if (originDenied) return originDenied;

    const limited = enforceRateLimit(
      request,
      "feature-modules",
      RATE.FEATURE_MODULES_MUTATE.limit,
      RATE.FEATURE_MODULES_MUTATE.windowMs
    );
    if (limited) return limited;

    const { session, denial } = await requireAdminModule("modules");
    if (denial) return toAuthResponse(denial);

    // 啟用選用模組等同開放全校功能，只有超級管理員可以決定
    if (!(await isSuperAdmin(session))) {
      return NextResponse.json(
        { success: false, message: "僅超級管理員可啟用／停用功能模組" },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const value = typeof body.value === "string" ? body.value : "";
    const enabled = typeof body.enabled === "boolean" ? body.enabled : null;
    const meta = value ? featureModuleMeta(value) : undefined;
    if (!meta || enabled === null) {
      return NextResponse.json({ success: false, message: "請求內容無效" }, { status: 400 });
    }
    if (meta.kind !== "optional") {
      return NextResponse.json(
        { success: false, message: "內建功能模組一律啟用，無法停用" },
        { status: 400 }
      );
    }
    if (!isTogglableFeatureModule(meta)) {
      return NextResponse.json(
        { success: false, message: `「${meta.label}」尚未上線，無法啟用` },
        { status: 400 }
      );
    }

    const current = await getFeatureModulesEnabled();
    const next: FeatureModulesEnabledMap = { ...current, [meta.value]: enabled };
    await getAdminDb()
      .collection(SETTINGS_COLLECTION)
      .doc(SETTINGS_DOC_ID)
      .set({ [FEATURE_MODULES_FIELD]: next }, { merge: true });
    invalidateFeatureModulesCache();

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "feature_module_updated",
      ip: getClientIp(request),
      details: `將「${meta.label}」功能模組設為「${enabled ? "啟用" : "停用"}」`,
    });

    return NextResponse.json({
      success: true,
      message: `${meta.label}已${enabled ? "啟用" : "停用"}`,
      enabled: next,
    });
  } catch (error) {
    console.error("Feature modules update error:", error);
    return NextResponse.json({ success: false, message: serverErrorMessage(error, "系統錯誤") });
  }
}
