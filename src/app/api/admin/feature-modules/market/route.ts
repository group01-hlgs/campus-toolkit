import { NextRequest, NextResponse } from "next/server";
import { isSuperAdmin, requireAdminModule, toAuthResponse } from "@/lib/dal";
import { parseModuleMarketIndex } from "@/types/module-market";

export const dynamic = "force-dynamic";

const MAX_INDEX_BYTES = 512 * 1024;

function resolveMarketIndexUrl(): string | null {
  const candidate =
    process.env.MODULE_MARKET_INDEX_URL?.trim() ||
    process.env.MODULE_MARKET_URL?.trim() ||
    "";

  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    const allowedProtocols = new Set(["https:"]);
    const isLocalhostDev =
      process.env.NODE_ENV === "development" &&
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");

    if (isLocalhostDev) {
      return parsed.toString();
    }

    if (!allowedProtocols.has(parsed.protocol)) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { session, denial } = await requireAdminModule("modules");
    if (denial) return toAuthResponse(denial);

    if (!(await isSuperAdmin(session))) {
      return NextResponse.json(
        { success: false, message: "僅超級管理員可查看模組市集" },
        { status: 403 }
      );
    }

    const marketUrl = resolveMarketIndexUrl();
    if (!marketUrl) {
      return NextResponse.json(
        {
          success: false,
          message: "尚未設定 MODULE_MARKET_INDEX_URL，請先在 .env.local 或環境變數中填入市集 index.json URL",
        },
        { status: 503 }
      );
    }

    const response = await fetch(marketUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: `市集來源回應失敗（HTTP ${response.status}）` },
        { status: 502 }
      );
    }

    const text = await response.text();
    const contentBytes = new TextEncoder().encode(text).length;
    if (contentBytes > MAX_INDEX_BYTES) {
      return NextResponse.json(
        { success: false, message: "市集資料過大，超過 512KB 限制" },
        { status: 413 }
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { success: false, message: "市集 index.json 格式錯誤，無法解析 JSON" },
        { status: 400 }
      );
    }

    const index = parseModuleMarketIndex(payload);
    if (!index) {
      return NextResponse.json(
        { success: false, message: "市集 index.json 缺少有效的 modules 清單" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      marketUrl,
      generatedAt: index.generatedAt,
      marketplaceVersion: index.marketplaceVersion,
      modules: index.modules,
    });
  } catch (error) {
    console.error("Market modules fetch error:", error);
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "讀取市集資訊失敗",
    });
  }
}
