import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminModule, toAuthResponse } from "@/lib/dal";

/**
 * docs/ 內的批次作業範例檔下載（管理員專用）。
 * 檔案存放在 docs/ 而非 public/，故以本 API 讀取回傳；
 * 白名單只放行「範例_*.xlsx」，避免任意檔案被取走。
 */
const SAMPLE_PATTERN = /^範例_[^/\\]*\.xlsx$/;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function notFound(): NextResponse {
  return NextResponse.json({ success: false, message: "找不到檔案" }, { status: 404 });
}

/** params 可能已是解碼後的中文檔名，避免重複解碼出錯 */
function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ file: string }> }
) {
  try {
    const { file } = await params;
    const name = decodeSafe(file);
    if (!SAMPLE_PATTERN.test(name)) return notFound();

    // 權限依範例所屬功能分流：名冊範例給「身分名冊管理」，其餘給「使用者帳號管理」
    const { denial } = await requireAdminModule(
      name.startsWith("範例_身分名冊") ? "roster" : "users"
    );
    if (denial) return toAuthResponse(denial);

    const docsDir = path.resolve(process.cwd(), "docs");
    const fullPath = path.resolve(docsDir, name);
    if (path.dirname(fullPath) !== docsDir) return notFound();

    const body = await fs.readFile(fullPath).catch(() => null);
    if (!body) return notFound();

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="sample.xlsx"; filename*=UTF-8''${encodeURIComponent(
          name
        )}`,
        "Cache-Control": "private, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Sample download error:", error);
    return NextResponse.json({ success: false, message: "下載失敗" }, { status: 500 });
  }
}
