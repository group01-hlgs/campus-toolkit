import "server-only";
import { NextRequest, NextResponse } from "next/server";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * 同源檢查：mutating API 必須 Origin/Referer 主機 = 請求 host。
 * 搭配 SameSite=Lax cookie，補足 CSRF 防護。
 */
export function assertSameOrigin(request: NextRequest): NextResponse | null {
  if (!MUTATING.has(request.method)) return null;

  const url = new URL(request.url);
  // 反向代理（Vercel／Firebase App Hosting）可能改寫 Host，
  // X-Forwarded-Host 保留瀏覽器原始請求的網域，優先採用。
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host");
  if (!host) {
    return NextResponse.json(
      { success: false, message: "請求來源無效" },
      { status: 403 }
    );
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const source = origin || referer;

  // 無 Origin/Referer（非瀏覽器用戶端）→ 拒絕寫入請求
  if (!source) {
    return NextResponse.json(
      { success: false, message: "請求來源無效" },
      { status: 403 }
    );
  }

  try {
    const sourceHost = new URL(source).host;
    if (sourceHost !== host && sourceHost !== url.host) {
      return NextResponse.json(
        { success: false, message: "跨來源請求被拒絕" },
        { status: 403 }
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, message: "請求來源無效" },
      { status: 403 }
    );
  }

  return null;
}
