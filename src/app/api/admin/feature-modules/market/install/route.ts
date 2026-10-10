import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { isSuperAdmin, requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** 套件下載上限（bytes）：市集第一期上限 500KB＋緩衝＝1MB【附錄 A #11】 */
const MAX_ARCHIVE_BYTES = 1024 * 1024;

function readLockModules(): Set<string> {
  const lockPath = path.join(process.cwd(), "module.lock.json");
  if (!fs.existsSync(lockPath)) return new Set();

  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as { modules?: Array<{ value?: string }> };
    const modules = Array.isArray(lock?.modules) ? lock.modules : [];
    return new Set(
      modules
        .filter((item: { value?: string }) => item && typeof item.value === "string")
        .map((item: { value?: string }) => item.value as string)
    );
  } catch {
    return new Set();
  }
}

function resolveMarketHost(): string | null {
  const candidate =
    process.env.MODULE_MARKET_INDEX_URL?.trim() || process.env.MODULE_MARKET_URL?.trim() || "";
  if (!candidate) return null;
  try {
    return new URL(candidate).hostname;
  } catch {
    return null;
  }
}

/**
 * 下載 URL 安全檢查【審查加固】：
 * - https 唯一（dev 可放行 localhost/127.0.0.1 的 http）
 * - 主機必須＝市集 index 的主機（防 SSRF：不可指到內網/元數據端點）
 */
function assertSafeDownloadUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("downloadUrl 不是合法 URL");
  }
  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  const devLocalhostOk = process.env.NODE_ENV === "development" && url.protocol === "http:" && isLocalhost;
  if (!devLocalhostOk && url.protocol !== "https:") {
    throw new Error("downloadUrl 僅允許 https（本機開發可允 localhost http）");
  }
  const marketHost = resolveMarketHost();
  if (!marketHost) {
    throw new Error("尚未設定 MODULE_MARKET_INDEX_URL——無法核對下載來源主機，拒絕安裝");
  }
  if (url.hostname !== marketHost) {
    throw new Error(`downloadUrl 主機「${url.hostname}」與市集來源「${marketHost}」不一致，拒絕安裝`);
  }
  return url;
}

async function downloadToTemp(downloadUrl: string): Promise<{ filePath: string; extension: string; sha256: string }> {
  const url = assertSafeDownloadUrl(downloadUrl);
  const lowerPath = url.pathname.toLowerCase();
  const suffix = lowerPath.endsWith(".zip") ? ".zip" : lowerPath.endsWith(".tar.gz") ? ".tar.gz" : "";

  if (!suffix) {
    throw new Error("下載檔必須為 .zip 或 .tar.gz");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-market-"));
  const filePath = path.join(tempDir, `module${suffix}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: controller.signal, redirect: "error" });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`下載失敗（HTTP ${response.status}）`);
  }

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
    throw new Error(`套件過大（超過 1MB 上限）`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`套件過大（超過 1MB 上限）`);
  }
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(filePath, buffer);
  return {
    filePath,
    extension: suffix,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function extractArchive(filePath: string, extension: string): string {
  const dir = path.dirname(filePath);

  if (extension === ".zip") {
    if (process.platform === "win32") {
      const result = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Expand-Archive -Path '${filePath}' -DestinationPath '${dir}' -Force`,
        ],
        { encoding: "utf-8" }
      );
      if (result.status !== 0) {
        throw new Error(result.stderr?.toString() || "ZIP 解壓失敗");
      }
    } else {
      const result = spawnSync("unzip", ["-q", filePath, "-d", dir], { encoding: "utf-8" });
      if (result.status !== 0) {
        throw new Error(result.stderr?.toString() || "ZIP 解壓失敗");
      }
    }
  } else {
    const result = spawnSync("tar", ["-xzf", filePath, "-C", dir], { encoding: "utf-8" });
    if (result.status !== 0) {
      throw new Error(result.stderr?.toString() || "tar 解壓失敗");
    }
  }

  return dir;
}

function findModuleManifestRoot(sourceDir: string): string {
  const manifestPath = path.join(sourceDir, "module.json");
  if (fs.existsSync(manifestPath)) return sourceDir;

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(sourceDir, entry.name, "module.json"))) {
      return path.join(sourceDir, entry.name);
    }
  }

  throw new Error("來源資料夾中未找到 module.json");
}

export async function POST(request: NextRequest) {
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

    if (!(await isSuperAdmin(session))) {
      return NextResponse.json(
        { success: false, message: "僅超級管理員可安裝模組" },
        { status: 403 }
      );
    }

    // 部署環境檔案系統唯讀、版本受 git 控制：正式安裝走期 6 Git 管線，此路由僅供本機開發
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          success: false,
          message:
            "部署環境無法直接安裝（檔案受 git 版本控制）——請於本機開發環境安裝後 commit＋push，或等待期 6 市集 Git 安裝管線",
        },
        { status: 400 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const moduleId = typeof body.id === "string" ? body.id.trim() : "";
    const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
    const downloadUrl = typeof body.downloadUrl === "string" ? body.downloadUrl.trim() : "";
    const expectedSha256 =
      typeof body.checksumSha256 === "string" ? body.checksumSha256.trim().toLowerCase() : "";

    if (!moduleId) {
      return NextResponse.json({ success: false, message: "缺少模組 id" }, { status: 400 });
    }

    let workingDir = "";
    if (sourcePath) {
      // 本機開發便利通道：僅 dev（production 已在上方全擋）
      const normalized = path.resolve(sourcePath);
      if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
        return NextResponse.json(
          { success: false, message: `來源目錄不存在：${normalized}` },
          { status: 400 }
        );
      }
      workingDir = normalized;
    } else if (downloadUrl) {
      const downloaded = await downloadToTemp(downloadUrl);
      if (expectedSha256 && !/^[0-9a-f]{64}$/.test(expectedSha256)) {
        throw new Error("checksumSha256 需為 64 碼小寫十六進位");
      }
      if (expectedSha256 && downloaded.sha256 !== expectedSha256) {
        throw new Error(`套件完整性校驗失敗（sha256 不符）——拒絕安裝【附錄 A #13】`);
      }
      const extractedDir = extractArchive(downloaded.filePath, downloaded.extension);
      workingDir = findModuleManifestRoot(extractedDir);
    } else {
      return NextResponse.json(
        { success: false, message: "請提供 sourcePath 或 downloadUrl" },
        { status: 400 }
      );
    }

    const manifestPath = path.join(workingDir, "module.json");
    if (!fs.existsSync(manifestPath)) {
      return NextResponse.json(
        { success: false, message: "來源資料夾缺少 module.json" },
        { status: 400 }
      );
    }
    const manifestParsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8").replace(/^﻿/, "")) as {
      value?: unknown;
    };
    if (typeof manifestParsed.value !== "string" || manifestParsed.value !== moduleId) {
      return NextResponse.json(
        {
          success: false,
          message: `模組 id 與 manifest.value 不一致（id＝${moduleId}、value＝${String(manifestParsed.value)}）——拒絕安裝`,
        },
        { status: 400 }
      );
    }

    const installed = readLockModules();
    if (installed.has(moduleId)) {
      return NextResponse.json({
        success: true,
        message: `模組「${moduleId}」已安裝，請使用更新功能或直接檢查模組列表。`,
        alreadyInstalled: true,
      });
    }

    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "module-cli.mjs"), "install", workingDir],
      {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 300_000,
      }
    );

    if (result.status !== 0) {
      const tail = `${result.stderr || ""}${result.stdout || ""}`.trim().split("\n").slice(-3).join("；");
      return NextResponse.json(
        { success: false, message: `模組安裝失敗：${tail || "未知錯誤"}` },
        { status: 400 }
      );
    }

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "feature_module_updated",
      ip: getClientIp(request),
      details: `市集安裝功能模組「${moduleId}」（本機開發）`,
    });

    return NextResponse.json({
      success: true,
      message: `模組「${moduleId}」已安裝完成（含掃描器與 lint 驗證鏈）`,
    });
  } catch (error) {
    console.error("Market install error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "模組安裝失敗",
      },
      { status: 500 }
    );
  }
}
