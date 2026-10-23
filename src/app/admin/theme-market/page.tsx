"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";
import {
  InstalledThemeRecord,
  listInstalledThemes,
  removeInstalledTheme,
  saveInstalledTheme,
  syncInstalledThemesToAccount,
} from "@/lib/theme-store";
import ThemeSubmissionForm from "@/components/ThemeSubmissionForm";
import DisclosureArrow from "@/components/DisclosureArrow";
import { ThemeColors } from "@/types/theme";

interface ThemeMarketEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  latestVersion?: string;
  minHostVersion?: string;
  repoUrl?: string;
  previewUrl?: string;
  downloadUrl?: string;
  checksumSha256?: string;
  category?: string;
  tags?: string[];
}

interface MarketResponse {
  success: boolean;
  message?: string;
  themes?: ThemeMarketEntry[];
  marketUrl?: string;
  generatedAt?: string;
  marketplaceVersion?: string;
}

interface InstallPackage {
  theme: {
    id: string;
    name: string;
    version: string;
    themeId: string;
    author: string;
    description: string;
  };
  themeId: string;
  colors: ThemeColors;
  preview: string;
  checksumSha256: string;
  installedAt: string;
}

interface InstallResponse {
  success: boolean;
  message?: string;
  package?: InstallPackage;
}

interface MarketConfigResponse {
  success: boolean;
  message?: string;
  marketUrl?: string;
}

export default function ThemeMarketPage() {
  const router = useRouter();
  const { currentTheme, setTheme, availableThemes } = useTheme();
  const [themes, setThemes] = useState<ThemeMarketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionKind, setActionKind] = useState<"success" | "error" | null>(null);
  const [installedTick, setInstalledTick] = useState(0);
  const [marketUrlInput, setMarketUrlInput] = useState("");
  const [savingMarketUrl, setSavingMarketUrl] = useState(false);
  const [marketUrlMessage, setMarketUrlMessage] = useState<string | null>(null);
  const [marketUrlKind, setMarketUrlKind] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/admin/theme-market", { cache: "no-store" });
        const data: MarketResponse = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || "主題市集讀取失敗");
        }

        if (!cancelled) {
          setThemes(data.themes ?? []);
          setMarketUrlInput(data.marketUrl ?? "");
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "主題市集讀取失敗");
          setThemes([]);
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

  async function handleInstall(entry: ThemeMarketEntry) {
    if (!entry.downloadUrl || !entry.checksumSha256) {
      setActionKind("error");
      setActionMessage("該主題沒有可安裝來源（缺少 downloadUrl 或 checksumSha256）");
      return;
    }

    setInstallingId(entry.id);
    setActionKind(null);
    setActionMessage(null);

    try {
      const response = await fetch("/api/admin/theme-market/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: entry.id,
          downloadUrl: entry.downloadUrl,
          checksumSha256: entry.checksumSha256,
          version: entry.version,
        }),
      });

      const data: InstallResponse = await response.json();
      if (!response.ok || !data.success || !data.package) {
        throw new Error(data.message || "安裝失敗");
      }

      const pkg = data.package;
      saveInstalledTheme(
        {
          id: pkg.themeId,
          name: pkg.theme.name,
          version: pkg.theme.version,
          source: "market",
          installedAt: pkg.installedAt,
        },
        { colors: pkg.colors, preview: pkg.preview }
      );

      setInstalledTick((tick) => tick + 1);
      void syncInstalledThemesToAccount();
      setActionKind("success");
      setActionMessage(data.message || "安裝完成");
    } catch (installError) {
      setActionKind("error");
      setActionMessage(installError instanceof Error ? installError.message : "主題安裝失敗");
    } finally {
      setInstallingId(null);
    }
  }

  function handleApply(entry: ThemeMarketEntry) {
    setTheme(`market:${entry.id}`);
    setActionKind("success");
    setActionMessage(`已套用主題「${entry.name}」`);
  }

  function installedRecord(entry: ThemeMarketEntry): InstalledThemeRecord | undefined {
    void installedTick;
    return listInstalledThemes().find((item) => item.id === `market:${entry.id}`);
  }

  function isInstalled(entry: ThemeMarketEntry): boolean {
    return !!installedRecord(entry);
  }

  function hasUpdate(entry: ThemeMarketEntry): boolean {
    const record = installedRecord(entry);
    if (!record || !entry.latestVersion) return false;
    return record.version !== entry.latestVersion;
  }

  function handleUninstall(entry: ThemeMarketEntry) {
    removeInstalledTheme(`market:${entry.id}`);
    void syncInstalledThemesToAccount();
    setInstalledTick((tick) => tick + 1);
    setActionKind("success");
    setActionMessage(`已卸載主題「${entry.name}」`);
  }

  function isCurrent(entry: ThemeMarketEntry): boolean {
    return currentTheme.id === `market:${entry.id}`;
  }

  async function handleSaveMarketUrl() {
    setSavingMarketUrl(true);
    setMarketUrlKind(null);
    setMarketUrlMessage(null);
    try {
      const response = await fetch("/api/admin/theme-market", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketUrl: marketUrlInput.trim() }),
      });
      const data: MarketConfigResponse = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "儲存主題市集來源失敗");
      }
      setMarketUrlKind("success");
      setMarketUrlMessage(data.message || "主題市集來源已儲存");
      setMarketUrlInput(data.marketUrl ?? "");

      setLoading(true);
      setError(null);
      const refreshed = await fetch("/api/admin/theme-market", { cache: "no-store" });
      const refreshedData: MarketResponse = await refreshed.json();
      if (!refreshed.ok || !refreshedData.success) {
        throw new Error(refreshedData.message || "重新讀取主題市集失敗");
      }
      setThemes(refreshedData.themes ?? []);
      setMarketUrlInput(refreshedData.marketUrl ?? "");
    } catch (saveError) {
      setMarketUrlKind("error");
      setMarketUrlMessage(saveError instanceof Error ? saveError.message : "儲存主題市集來源失敗");
    } finally {
      setSavingMarketUrl(false);
      setLoading(false);
    }
  }

  void availableThemes;

  return (
    <div className="content-width space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-t1">主題市集</h1>
          <p className="text-sm text-t3">
            安裝前會自動驗證 checksum、主機版本與下載來源；安裝完成後可在右上角主題選單啟用。
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/admin/modules")}
          className="btn-theme rounded px-4 py-2 text-sm cursor-pointer"
        >
          返回功能模組管理
        </button>
      </div>

      <div className="border border-themed rounded-lg bg-card p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-t1">主題市集來源設定</h2>
          <p className="text-xs text-t3">
            可在此設定 index.json URL；留空代表回退環境變數（THEME_MARKET_INDEX_URL）。
          </p>
        </div>
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={marketUrlInput}
            onChange={(event) => setMarketUrlInput(event.target.value)}
            placeholder="https://example.com/index.json"
            className="flex-1 rounded border border-themed bg-card px-3 py-2 text-sm text-t1"
          />
          <button
            type="button"
            onClick={() => void handleSaveMarketUrl()}
            disabled={savingMarketUrl}
            className={`rounded px-3 py-2 text-xs ${
              savingMarketUrl ? "border border-themed bg-muted text-t3 cursor-wait" : "btn-theme cursor-pointer"
            }`}
          >
            {savingMarketUrl ? "儲存中..." : "儲存市集來源"}
          </button>
        </div>
        {marketUrlMessage && (
          <div
            className={`rounded border px-3 py-2 text-xs ${
              marketUrlKind === "success"
                ? "border-success/60 bg-success/10 text-success"
                : "border-danger/60 bg-danger/10 text-danger"
            }`}
          >
            {marketUrlMessage}
          </div>
        )}
      </div>

      {actionMessage && (
        <div
          className={`border rounded-lg p-3 text-sm ${
            actionKind === "success"
              ? "border-success/60 bg-success/10 text-success"
              : "border-danger/60 bg-danger/10 text-danger"
          }`}
        >
          {actionMessage}
        </div>
      )}

      {loading ? (
        <div className="border border-themed rounded-lg bg-card p-6 text-sm text-t3">
          讀取主題市集中...
        </div>
      ) : error ? (
        <div className="border border-danger/60 rounded-lg bg-card p-6 text-sm text-t2">
          <p className="font-medium text-danger">主題市集讀取失敗</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : themes.length === 0 ? (
        <div className="border border-themed rounded-lg bg-card p-6 text-sm text-t3">
          目前沒有可用的主題，請稍後再試。
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {themes.map((entry) => (
            <div key={entry.id} className="border border-themed rounded-lg bg-card p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-t1">{entry.name}</h2>
                  <p className="text-xs text-t3">market:{entry.id}</p>
                </div>
                <span className="text-xs border border-themed rounded px-2 py-1 text-t2">
                  v{entry.version}
                </span>
              </div>

              {entry.previewUrl && (
                <img
                  src={entry.previewUrl}
                  alt={`${entry.name} 主題預覽`}
                  loading="lazy"
                  className="w-full h-32 object-cover rounded-lg border border-themed bg-muted"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              )}

              <p className="text-sm text-t2">{entry.description || "沒有說明"}</p>

              <div className="flex flex-wrap gap-2 text-xs text-t3">
                {entry.minHostVersion && (
                  <span className="border border-themed rounded px-2 py-1">
                    最低主程式版本：{entry.minHostVersion}
                  </span>
                )}
                {isInstalled(entry) && (
                  <span className="border border-success/60 rounded px-2 py-1 text-success">
                    {isCurrent(entry) ? "使用中" : "已安裝"}
                  </span>
                )}
                {hasUpdate(entry) && (
                  <span className="border border-warning/60 rounded px-2 py-1 text-warning">
                    有新版本 v{entry.latestVersion}
                  </span>
                )}
              </div>

              {entry.tags && entry.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {entry.tags.map((tag) => (
                    <span
                      key={`${entry.id}-${tag}`}
                      className="text-xs text-t3 border border-themed rounded px-2 py-1"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-themed">
                <div className="text-xs text-t3">
                  {entry.latestVersion && entry.latestVersion !== entry.version
                    ? `最新：${entry.latestVersion}`
                    : "已為最新版本"}
                </div>
                <div className="flex gap-2">
                  {entry.repoUrl && (
                    <a
                      href={entry.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-theme rounded px-3 py-1.5 text-xs"
                    >
                      查看 Repo
                    </a>
                  )}
                  {isInstalled(entry) && !isCurrent(entry) && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleApply(entry)}
                        className="btn-theme rounded px-3 py-1.5 text-xs cursor-pointer"
                        title="套用此主題"
                      >
                        套用
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUninstall(entry)}
                        className="rounded px-3 py-1.5 text-xs border border-danger/60 text-danger cursor-pointer"
                        title="從本機移除主題"
                      >
                        卸載
                      </button>
                    </>
                  )}
                  {!isInstalled(entry) || isCurrent(entry) ? (
                    <button
                      type="button"
                      disabled={installingId === entry.id || isCurrent(entry)}
                      onClick={() => void handleInstall(entry)}
                      className={`rounded px-3 py-1.5 text-xs ${
                        installingId === entry.id
                          ? "border border-themed bg-muted text-t3 cursor-wait"
                          : "btn-theme cursor-pointer"
                      }`}
                      title={installingId === entry.id ? "安裝中..." : "安裝主題"}
                    >
                      {installingId === entry.id
                        ? "安裝中..."
                        : isCurrent(entry)
                          ? "使用中"
                          : hasUpdate(entry)
                            ? "更新"
                            : "安裝"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="border border-themed rounded-lg bg-card p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-t1">
          <span>上架新主題（管理員發佈 → PR 審核 → merge 上架）</span>
          <DisclosureArrow />
        </summary>
        <p className="mt-2 mb-4 text-xs text-t3">
          發佈會以服務帳號對市集 repo 建立 PR；CI 驗證通過並經您 merge 後，主題即出現在市集索引中。
          此功能需伺服器設定 THEME_MARKET_GITHUB_TOKEN。
        </p>
        <ThemeSubmissionForm endpoint="/api/admin/theme-market/publish" submitLabel="建立發佈 PR" />
      </details>
    </div>
  );
}
