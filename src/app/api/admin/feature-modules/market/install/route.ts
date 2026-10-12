import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import AdmZip from "adm-zip";
import { isSuperAdmin, requireAdminModule, toAuthResponse } from "@/lib/dal";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, RATE } from "@/lib/rate-limit";
import { getClientIp, logActivity } from "@/lib/audit";
import { commitMarketplaceModuleInstall, resolveModuleMarketGithubConfig } from "@/lib/module-market-github";
import { resolveModuleMarketIndexUrl } from "@/lib/module-market";

export const dynamic = "force-dynamic";

/** 套件下載上限（bytes）：市集第一期上限 500KB＋緩衝＝1MB【附錄 A #11】 */
const MAX_ARCHIVE_BYTES = 1024 * 1024;

function buildManualInstallGuide(moduleId: string) {
  return {
    title: "可改用手動安裝流程",
    steps: [
      "在本機 clone 主程式 fork 與模組 repo。",
      "進入主程式資料夾後執行 npm install。",
      `執行 npm run module:install -- ../${moduleId}（以模組資料夾路徑為準）。`,
      "完成後 commit + push，等待部署。",
    ],
    command: `npm run module:install -- ../${moduleId}`,
    note: "手動安裝同樣會走掃描器與 lint 驗證鏈。",
  };
}

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

function runModuleCli(
  command: "install" | "uninstall",
  target: string,
  timeout = 300_000
): { ok: boolean; output: string; tail: string } {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "module-cli.mjs"), command, target],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout,
    }
  );

  const output = `${result.stderr || ""}${result.stdout || ""}`.trim();
  const tail = output.split("\n").slice(-3).join("；");
  return { ok: result.status === 0, output, tail };
}

async function resolveMarketHost(): Promise<string | null> {
  const candidate = await resolveModuleMarketIndexUrl();
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
async function assertSafeDownloadUrl(raw: string): Promise<URL> {
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
  const marketHost = await resolveMarketHost();
  if (!marketHost) {
    throw new Error("尚未設定模組市集來源 URL——無法核對下載來源主機，拒絕安裝");
  }
  if (url.hostname !== marketHost) {
    throw new Error(`downloadUrl 主機「${url.hostname}」與市集來源「${marketHost}」不一致，拒絕安裝`);
  }
  return url;
}

async function downloadToTemp(downloadUrl: string): Promise<{ filePath: string; extension: string; sha256: string }> {
  const url = await assertSafeDownloadUrl(downloadUrl);
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
    try {
      const zip = new AdmZip(filePath);
      zip.extractAllTo(dir, true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`ZIP 解壓失敗（adm-zip）：${detail}`);
    }
  } else {
    const result = spawnSync("tar", ["-xzf", filePath, "-C", dir], { encoding: "utf-8" });
    if (result.status !== 0) {
      const detail = result.error?.message || result.stderr?.toString() || result.stdout?.toString() || "";
      throw new Error(`tar 解壓失敗：${detail || "無可用錯誤輸出"}`);
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

    const isProduction = process.env.NODE_ENV === "production";
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const moduleId = typeof body.id === "string" ? body.id.trim() : "";
    const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
    const downloadUrl = typeof body.downloadUrl === "string" ? body.downloadUrl.trim() : "";
    const expectedSha256 =
      typeof body.checksumSha256 === "string" ? body.checksumSha256.trim().toLowerCase() : "";

    if (!moduleId) {
      return NextResponse.json({ success: false, message: "缺少模組 id" }, { status: 400 });
    }
    if (isProduction && sourcePath) {
      return NextResponse.json(
        {
          success: false,
          message: "正式環境僅接受市集下載安裝（downloadUrl），不接受 sourcePath",
        },
        { status: 400 }
      );
    }
    if (isProduction && !resolveModuleMarketGithubConfig()) {
      return NextResponse.json(
        {
          success: false,
          message:
            "尚未設定 MODULE_MARKET_GITHUB_TOKEN（或 MODULE_MARKET_GITHUB_REPO / VERCEL_GIT_REPO_OWNER+SLUG）——無法在正式環境自動安裝",
          manualInstallGuide: buildManualInstallGuide(moduleId || "<module-folder>"),
        },
        { status: 503 }
      );
    }
    if (isProduction && (!expectedSha256 || !/^[0-9a-f]{64}$/.test(expectedSha256))) {
      return NextResponse.json(
        { success: false, message: "正式環境安裝需提供 checksumSha256（64 碼小寫十六進位）" },
        { status: 400 }
      );
    }

    let workingDir = "";
    let downloadedSha256: string | null = null;
    if (sourcePath) {
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
      downloadedSha256 = downloaded.sha256;
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
      contractVersion?: unknown;
      minHostVersion?: unknown;
      author?: { version?: unknown };
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
    const manifestVersion =
      manifestParsed?.author && typeof manifestParsed.author.version === "string"
        ? manifestParsed.author.version
        : "";
    const contractVersion =
      typeof manifestParsed.contractVersion === "number" && Number.isFinite(manifestParsed.contractVersion)
        ? manifestParsed.contractVersion
        : 1;
    const minHostVersion =
      typeof manifestParsed.minHostVersion === "string" && manifestParsed.minHostVersion.trim()
        ? manifestParsed.minHostVersion.trim()
        : "0";

    if (isProduction) {
      if (!downloadUrl || !downloadedSha256) {
        return NextResponse.json(
          { success: false, message: "正式環境安裝需提供可下載的 downloadUrl" },
          { status: 400 }
        );
      }
      if (!manifestVersion) {
        return NextResponse.json(
          { success: false, message: "module.json 缺少 author.version，無法建立正式安裝提交" },
          { status: 400 }
        );
      }

      const committed = await commitMarketplaceModuleInstall({
        moduleId,
        moduleDir: workingDir,
        downloadUrl,
        archiveSha256: downloadedSha256,
        manifestVersion,
        contractVersion,
        minHostVersion,
      });

      await logActivity({
        userId: session.uid,
        role: "admin",
        action: "feature_module_updated",
        ip: getClientIp(request),
        details: committed.alreadyInstalled
          ? `市集安裝功能模組「${moduleId}」：版本與來源未變更（branch: ${committed.branch}）`
          : committed.updated
            ? `市集更新功能模組「${moduleId}」：提交至 ${committed.branch}（${committed.commitSha ?? "n/a"}）`
            : `市集安裝功能模組「${moduleId}」：提交至 ${committed.branch}（${committed.commitSha ?? "n/a"}）`,
      });

      return NextResponse.json({
        success: true,
        alreadyInstalled: committed.alreadyInstalled,
        message: committed.alreadyInstalled
          ? `模組「${moduleId}」目前版本已是最新，無需重複提交。`
          : committed.updated
            ? `模組「${moduleId}」更新提交已建立（branch: ${committed.branch}），請等待部署完成。`
            : `模組「${moduleId}」安裝提交已建立（branch: ${committed.branch}），請等待部署完成。`,
        branch: committed.branch,
        commitUrl: committed.commitUrl,
      });
    }

    const installed = readLockModules();
    const updating = installed.has(moduleId);
    let backupDir = "";
    let backupModuleDir = "";

    if (updating) {
      const installedDir = path.join(process.cwd(), "src", "modules", moduleId);
      if (!fs.existsSync(installedDir) || !fs.statSync(installedDir).isDirectory()) {
        return NextResponse.json(
          { success: false, message: `更新前檢查失敗：找不到既有模組目錄 src/modules/${moduleId}` },
          { status: 500 }
        );
      }

      backupDir = fs.mkdtempSync(path.join(os.tmpdir(), `campus-market-backup-${moduleId}-`));
      backupModuleDir = path.join(backupDir, moduleId);
      fs.cpSync(installedDir, backupModuleDir, { recursive: true });

      const uninstallResult = runModuleCli("uninstall", moduleId);
      if (!uninstallResult.ok) {
        fs.rmSync(backupDir, { recursive: true, force: true });
        return NextResponse.json(
          { success: false, message: `更新前卸載失敗：${uninstallResult.tail || "未知錯誤"}` },
          { status: 400 }
        );
      }
    }

    const installResult = runModuleCli("install", workingDir);
    if (!installResult.ok) {
      if (updating && backupDir) {
        const restoreResult = runModuleCli("install", backupModuleDir);
        fs.rmSync(backupDir, { recursive: true, force: true });
        return NextResponse.json(
          {
            success: false,
            message: restoreResult.ok
              ? `模組更新失敗，已自動回復舊版：${installResult.tail || "未知錯誤"}`
              : `模組更新失敗，且舊版回復失敗：${installResult.tail || "未知錯誤"}；回復錯誤：${
                  restoreResult.tail || "未知錯誤"
                }`,
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { success: false, message: `模組安裝失敗：${installResult.tail || "未知錯誤"}` },
        { status: 400 }
      );
    }
    if (backupDir) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }

    await logActivity({
      userId: session.uid,
      role: "admin",
      action: "feature_module_updated",
      ip: getClientIp(request),
      details: `市集${updating ? "更新" : "安裝"}功能模組「${moduleId}」（本機開發）`,
    });

    return NextResponse.json({
      success: true,
      message: `模組「${moduleId}」已${updating ? "更新" : "安裝"}完成（含掃描器與 lint 驗證鏈）`,
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
