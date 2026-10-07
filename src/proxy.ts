import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";
import { ROLE_HOME, isUserRole } from "@/types/users";

const PROTECTED_PREFIXES = ["/admin", "/student", "/parent", "/staff"] as const;

function requiredRole(pathname: string): string | null {
  for (const prefix of PROTECTED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return prefix.slice(1);
    }
  }
  return null;
}

// 依 Next.js CSP 文件於 proxy 產 nonce（script-src 不再放行 unsafe-inline／unsafe-eval）。
// AdSense 等第三方以 script-src 的 host 來源隔離放行，Next 框架內聯 script 走 nonce。
function buildContentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const scriptHosts = [
    "https://pagead2.googlesyndication.com",
    "https://googleads.g.doubleclick.net",
    "https://www.googletagmanager.com",
    "https://apis.google.com",
    "https://www.gstatic.com",
    "https://www.google.com",
    // Google Identity Services（gsi/client）
    "https://accounts.google.com",
  ].join(" ");

  const directives = [
    "default-src 'self'",
    // dev 需 'unsafe-eval'（React 偵錯）；production 不放行
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""} ${scriptHosts}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.gstatic.com https://accounts.google.com",
    "img-src 'self' data: blob: https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://www.google.com https://www.gstatic.com https://lh3.googleusercontent.com https://drive.google.com",
    "font-src 'self' data: https://fonts.gstatic.com https://www.gstatic.com",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://www.googleapis.com https://pagead2.googlesyndication.com https://firebaseinstallations.googleapis.com https://*.firebaseapp.com https://*.googleapis.com https://accounts.google.com",
    "frame-src 'self' https://accounts.google.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://*.firebaseapp.com https://*.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // 本機 http 開發若啟用會把 /api/* 升級成 https 導致登入失敗；僅 production HTTPS 加
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const role = requiredRole(pathname);

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  if (role) {
    // 快取層／導覽檢查：此處只驗 JWT 簽章、有效期與角色，刻意不查 DB
    // （撤銷 jti、tokenVersion、閒置逾時）。頁面資料請一律走 dal.verifySession，
    // 由那裡做完整的權威驗證；本檢查僅用於避免未登入者看到受保護頁面殼。
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    const session = await verifySessionToken(token);
    if (!session) {
      const response = NextResponse.redirect(new URL("/", request.url));
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }

    if (!isUserRole(session.role) || session.role !== role) {
      return NextResponse.redirect(new URL(ROLE_HOME[session.role], request.url));
    }
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", csp);
  // 重設密碼連結的 token 以 query string 傳遞；no-referrer 防止離開頁面時
  // token 經 Referer 洩漏給第三方（規格書 §驗證清單「token 洩漏於 Referer」）
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = {
  matcher: [
    /*
     * 所有頁面請求皆需帶 CSP nonce（排除 API 與靜態資源）；
     * 依文件略過 prefetch，避免無謂重產 nonce。
     */
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
