import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isSuperAdmin, requireAdminModule, toAuthResponse } from "@/lib/dal";

export const dynamic = "force-dynamic";

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

function ensureExtractedDir(sourceDir: string): string {
  const normalized = path.resolve(sourceDir);
  if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
    return normalized;
  }
  throw new Error(`來源目錄不存在：${normalized}`);
}

function findModuleManifestRoot(sourceDir: string): string {
  const manifestPath = path.join(sourceDir, "module.json");
  if (fs.existsSync(manifestPath)) return sourceDir;

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const childManifest = path.join(sourceDir, entry.name, "module.json");
    if (fs.existsSync(childManifest)) return path.join(sourceDir, entry.name);
  }

  throw new Error("來源資料夾中未找到 module.json");
}

async function downloadToTemp(downloadUrl: string): Promise<{ filePath: string; extension: string }> {
  const url = new URL(downloadUrl);
  const lowerPath = url.pathname.toLowerCase();
  const suffix = lowerPath.endsWith(".zip") ? ".zip" : lowerPath.endsWith(".tar.gz") ? ".tar.gz" : ".bin";

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-market-"));
  const filePath = path.join(tempDir, `module${suffix}`);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`下載失敗（HTTP ${response.status}）`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  return { filePath, extension: suffix };
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

export async function POST(request: NextRequest) {
  try {
    const { session, denial } = await requireAdminModule("modules");
    if (denial) return toAuthResponse(denial);

    if (!(await isSuperAdmin(session))) {
      return NextResponse.json(
        { success: false, message: "僅超級管理員可安裝模組" },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const moduleId = typeof body.id === "string" ? body.id.trim() : "";
    const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
    const downloadUrl = typeof body.downloadUrl === "string" ? body.downloadUrl.trim() : "";

    if (!moduleId) {
      return NextResponse.json({ success: false, message: "缺少模組 id" }, { status: 400 });
    }

    let workingDir = "";
    if (sourcePath) {
      workingDir = ensureExtractedDir(sourcePath);
    } else if (downloadUrl) {
      const downloaded = await downloadToTemp(downloadUrl);
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
        { success: false, message: `來源資料夾缺少 module.json：${workingDir}` },
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
      }
    );

    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    if (result.status !== 0) {
      return NextResponse.json(
        {
          success: false,
          message: (stderr || stdout || "模組安裝失敗").trim() || "模組安裝失敗",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `模組「${moduleId}」已安裝完成`,
      output: `${stdout}\n${stderr}`.trim(),
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
