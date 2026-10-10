"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface MarketModuleEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  latestVersion?: string;
  minHostVersion?: string;
  repoUrl?: string;
  downloadUrl?: string;
  checksumSha256?: string;
  category?: string;
  tags?: string[];
}

interface MarketResponse {
  success: boolean;
  message?: string;
  modules?: MarketModuleEntry[];
  marketUrl?: string;
}

interface InstallResponse {
  success: boolean;
  message?: string;
  alreadyInstalled?: boolean;
}

export default function ModuleMarketPage() {
  const router = useRouter();
  const [modules, setModules] = useState<MarketModuleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [installKind, setInstallKind] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/admin/feature-modules/market", { cache: "no-store" });
        const data: MarketResponse = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || "市集讀取失敗");
        }

        if (!cancelled) {
          setModules(data.modules ?? []);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "市集讀取失敗");
          setModules([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInstall(module: MarketModuleEntry) {
    if (!module.downloadUrl && !module.repoUrl) {
      setInstallKind("error");
      setInstallMessage("該模組沒有可安裝來源，請先提供 downloadUrl");
      return;
    }

    setInstallingId(module.id);
    setInstallKind(null);
    setInstallMessage(null);

    try {
      const response = await fetch("/api/admin/feature-modules/market/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: module.id,
          downloadUrl: module.downloadUrl,
          sourcePath: module.repoUrl,
        }),
      });

      const data: InstallResponse = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "安裝失敗");
      }

      setInstallKind("success");
      setInstallMessage(data.message || "安裝成功");
      setInstallingId(null);
      window.location.reload();
    } catch (installError) {
      setInstallKind("error");
      setInstallMessage(
        installError instanceof Error ? installError.message : "模組安裝失敗"
      );
      setInstallingId(null);
    }
  }

  return (
    <div className="w-full max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-t1">模組市集</h1>
          <p className="text-sm text-t3">市集只提供模組資訊，實際安裝與更新仍由主程式管理。</p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/admin/modules")}
          className="btn-theme rounded px-4 py-2 text-sm cursor-pointer"
        >
          返回功能模組管理
        </button>
      </div>

      {installMessage && (
        <div
          className={`border rounded-lg p-3 text-sm ${
            installKind === "success" ? "border-success/60 bg-success/10 text-success" : "border-danger/60 bg-danger/10 text-danger"
          }`}
        >
          {installMessage}
        </div>
      )}

      {loading ? (
        <div className="border border-themed rounded-lg bg-card p-6 text-sm text-t3">
          讀取模組市集中...
        </div>
      ) : error ? (
        <div className="border border-danger/60 rounded-lg bg-card p-6 text-sm text-t2">
          <p className="font-medium text-danger">市集讀取失敗</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : modules.length === 0 ? (
        <div className="border border-themed rounded-lg bg-card p-6 text-sm text-t3">
          目前沒有可用的模組，請稍後再試。
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {modules.map((module) => (
            <div key={module.id} className="border border-themed rounded-lg bg-card p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-t1">{module.name}</h2>
                  <p className="text-xs text-t3">{module.id}</p>
                </div>
                <span className="text-xs border border-themed rounded px-2 py-1 text-t2">
                  v{module.version}
                </span>
              </div>

              <p className="text-sm text-t2">{module.description || "沒有說明"}</p>

              <div className="flex flex-wrap gap-2 text-xs text-t3">
                {module.minHostVersion && (
                  <span className="border border-themed rounded px-2 py-1">
                    最低主程式版本：{module.minHostVersion}
                  </span>
                )}
                {module.category && (
                  <span className="border border-themed rounded px-2 py-1">
                    類別：{module.category}
                  </span>
                )}
              </div>

              {module.tags && module.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {module.tags.map((tag) => (
                    <span key={`${module.id}-${tag}`} className="text-xs text-t3 border border-themed rounded px-2 py-1">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-themed">
                <div className="text-xs text-t3">
                  {module.latestVersion && module.latestVersion !== module.version
                    ? `最新：${module.latestVersion}`
                    : "已為最新版本"}
                </div>
                <div className="flex gap-2">
                  {module.repoUrl && (
                    <a
                      href={module.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-theme rounded px-3 py-1.5 text-xs"
                    >
                      查看 Repo
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={installingId === module.id}
                    onClick={() => void handleInstall(module)}
                    className={`rounded px-3 py-1.5 text-xs ${
                      installingId === module.id
                        ? "border border-themed bg-muted text-t3 cursor-wait"
                        : "btn-theme cursor-pointer"
                    }`}
                    title={installingId === module.id ? "安裝中..." : "安裝模組"}
                  >
                    {installingId === module.id ? "安裝中..." : "安裝"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
