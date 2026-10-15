"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DisclosureArrow from "@/components/DisclosureArrow";
import { fetchSession } from "@/lib/session";
import {
  FEATURE_MODULES,
  FEATURE_MODULE_STATUS_LABELS,
  type FeatureModuleMeta,
  type FeatureModuleRoleSwitches,
  type FeatureModuleRolesMap,
  type FeatureModulesEnabledMap,
} from "@/types/feature-modules";
import { ALL_ROLES, ROLE_LABELS, type UserRole } from "@/types/users";
import Toast, { type ToastMessage } from "@/components/Toast";

interface FeatureModulesResponse {
  success?: boolean;
  message?: string;
  enabled?: FeatureModulesEnabledMap;
  roles?: FeatureModuleRolesMap;
  canUninstall?: boolean;
  branch?: string;
  commitUrl?: string;
}

interface MarketInstalledResponse {
  success?: boolean;
  modules?: Array<{ id: string; version: string; latestVersion?: string }>;
  installedModules?: Record<string, string>;
}

function parseComparableVersion(value: string): { parts: number[]; prerelease: string[] } | null {
  const match = value
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    parts: match[1].split(".").map(Number),
    prerelease: match[2] ? match[2].split(".") : [],
  };
}

/** 回傳市集版本相對目前版本的順序；非標準版本字串不做自動判斷。 */
function compareModuleVersions(current: string, latest: string): number | null {
  const currentVersion = parseComparableVersion(current);
  const latestVersion = parseComparableVersion(latest);
  if (!currentVersion || !latestVersion) return null;

  const length = Math.max(currentVersion.parts.length, latestVersion.parts.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = currentVersion.parts[index] ?? 0;
    const latestPart = latestVersion.parts[index] ?? 0;
    if (latestPart !== currentPart) return latestPart > currentPart ? 1 : -1;
  }

  const currentPre = currentVersion.prerelease;
  const latestPre = latestVersion.prerelease;
  if (currentPre.length === 0 || latestPre.length === 0) {
    if (currentPre.length === latestPre.length) return 0;
    return currentPre.length === 0 ? -1 : 1;
  }

  const preLength = Math.max(currentPre.length, latestPre.length);
  for (let index = 0; index < preLength; index += 1) {
    const currentPart = currentPre[index];
    const latestPart = latestPre[index];
    if (currentPart === undefined || latestPart === undefined) {
      return latestPart === undefined ? -1 : 1;
    }
    if (currentPart === latestPart) continue;

    const currentNumeric = /^\d+$/.test(currentPart);
    const latestNumeric = /^\d+$/.test(latestPart);
    if (currentNumeric && latestNumeric) {
      return Number(latestPart) > Number(currentPart) ? 1 : -1;
    }
    if (currentNumeric !== latestNumeric) return latestNumeric ? -1 : 1;
    return latestPart.localeCompare(currentPart) > 0 ? 1 : -1;
  }
  return 0;
}

/** 小標籤（已上線／開發中／規劃中） */
function Badge({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`text-xs border border-themed rounded px-1.5 py-0.5 ${className}`}>
      {text}
    </span>
  );
}

/** 模組名稱旁的說明展開箭頭，控制該列下方的說明列 */
function HelpToggle({
  id,
  label,
  open,
  onToggle,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <details
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) onToggle();
      }}
      className="inline-flex align-middle"
    >
      <summary
        aria-label={`查看「${label}」說明`}
        aria-controls={`module-description-${id}`}
        title="查看說明"
        className="flex h-5 w-5 list-none cursor-pointer items-center justify-center"
      >
        <DisclosureArrow className="h-3.5 w-3.5" />
      </summary>
      <span className="sr-only">說明內容顯示於模組列下方</span>
    </details>
  );
}

/**
 * 展開時插在該列下方的說明列（只在展開時渲染）：
 * 模組說明＋作者／版本資訊＋「提供功能」唯讀矩陣。
 */
function DescriptionRow({
  item,
  open,
  colSpan,
}: {
  item: FeatureModuleMeta;
  open: boolean;
  colSpan: number;
}) {
  if (!open) return null;
  return (
    <tr id={`module-description-${item.value}`} className="border-b border-themed last:border-0">
      <td colSpan={colSpan} className="px-3 py-2 text-xs text-t3 bg-surface space-y-1.5">
        <p>{item.description}</p>
        <p>
          作者：
          <a
            href={item.author.authorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-t1"
          >
            {item.author.author}
          </a>
          ｜版本 {item.author.version}｜發布 {item.author.releasedAt}
        </p>
        <p>
          提供功能（由模組作者決定，僅供檢視）：
          {ALL_ROLES.map((role) => (
            <span key={role} className="mr-2">
              {ROLE_LABELS[role]}＝{item.provides[role] ? "是" : "否"}
            </span>
          ))}
        </p>
      </td>
    </tr>
  );
}

/**
 * 四種身分欄：同時顯示「提供功能」圖示＋「顯示與否」勾選。
 * 提供功能＝否 → 文字「未提供」（不可操作）；＝是 → 綠勾「提供」與「顯示」勾選上下排列。
 */
function RoleCells({
  item,
  switches,
  disabled,
  disabledTitle,
  onToggle,
}: {
  item: FeatureModuleMeta;
  switches: FeatureModuleRoleSwitches | undefined;
  disabled: boolean;
  /** 禁用原因覆寫（如狀態載入失敗）；缺省＝超級管理員／處理中 */
  disabledTitle?: string;
  onToggle: (item: FeatureModuleMeta, role: UserRole, next: boolean) => void;
}) {
  return (
    <>
      {ALL_ROLES.map((role) => {
        const provided = item.provides[role] === true;
        if (!provided) {
          return (
            <td key={role} className="px-3 py-2 text-center text-xs text-t3">
              未提供
            </td>
          );
        }
        return (
          <td key={role} className="px-3 py-2 text-center align-middle">
            <span className="inline-flex flex-col items-center justify-center gap-1">
              <span
                className="inline-flex items-center gap-0.5 text-xs text-success whitespace-nowrap"
                title="提供功能（由模組作者決定，唯讀）"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                提供
              </span>
              <label className="inline-flex items-center justify-center gap-1 text-xs text-t3">
                <span>顯示</span>
                <input
                  type="checkbox"
                  checked={switches?.[role] === true}
                  disabled={disabled}
                  onChange={(event) => onToggle(item, role, event.target.checked)}
                  aria-label={`「${item.label}」對${ROLE_LABELS[role]}身分的顯示與否`}
                  title={
                    disabled
                      ? (disabledTitle ?? "僅超級管理員可調整，且同一時間只能處理一筆變更")
                      : "顯示與否（關閉＝暫時不顯示、禁止進入）"
                  }
                  className="accent-current cursor-pointer disabled:opacity-50"
                />
              </label>
            </span>
          </td>
        );
      })}
    </>
  );
}

/** 內建功能模組列表列：一律啟用；已上線且有入口者可直接進入；身分欄＝顯示與否 */
function BuiltinRow({
  item,
  open,
  onToggleHelp,
  switches,
  disabled,
  disabledTitle,
  onToggleRole,
  onOpen,
}: {
  item: FeatureModuleMeta;
  open: boolean;
  onToggleHelp: (value: string) => void;
  switches: FeatureModuleRoleSwitches | undefined;
  disabled: boolean;
  disabledTitle?: string;
  onToggleRole: (item: FeatureModuleMeta, role: UserRole, next: boolean) => void;
  onOpen: (href: string) => void;
}) {
  const enterable = item.status === "live" && item.href !== "";
  return (
    <>
      <tr className={`border-b border-themed last:border-0 text-t1${enterable ? "" : " opacity-70"}`}>
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="flex items-center gap-2">
            <span className="font-medium">{item.label}</span>
            <HelpToggle
              id={item.value}
              label={item.label}
              open={open}
              onToggle={() => onToggleHelp(item.value)}
            />
          </span>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <Badge text={FEATURE_MODULE_STATUS_LABELS[item.status]} className="text-t3" />
        </td>
        <RoleCells item={item} switches={switches} disabled={disabled} disabledTitle={disabledTitle} onToggle={onToggleRole} />
        <td className="px-3 py-2 whitespace-nowrap text-right">
          {enterable ? (
            <button
              type="button"
              onClick={() => onOpen(item.href)}
              className="btn-theme rounded px-3 py-1 text-xs cursor-pointer"
            >
              前往 →
            </button>
          ) : (
            <span className="text-xs text-t3">尚未提供，敬請期待</span>
          )}
        </td>
      </tr>
      <DescriptionRow item={item} open={open} colSpan={7} />
    </>
  );
}

/** 選用功能模組列表列：總開關＋四種身分顯示與否＋操作（卸載），僅超級管理員可操作 */
function OptionalRow({
  item,
  open,
  onToggleHelp,
  enabled,
  switches,
  isSuper,
  loadFailed,
  canUninstall,
  pendingUninstall,
  saving,
  onToggleMaster,
  onToggleRole,
  onUninstall,
  marketLatestVersion,
}: {
  item: FeatureModuleMeta;
  open: boolean;
  onToggleHelp: (value: string) => void;
  enabled: boolean;
  switches: FeatureModuleRoleSwitches | undefined;
  isSuper: boolean;
  /** 開關狀態載入失敗：勾選／總開關不可信，一律禁用 */
  loadFailed?: boolean;
  canUninstall: boolean;
  pendingUninstall?: { branch?: string; commitUrl?: string };
  saving: boolean;
  onToggleMaster: (item: FeatureModuleMeta, next: boolean) => void;
  onToggleRole: (item: FeatureModuleMeta, role: UserRole, next: boolean) => void;
  onUninstall: (item: FeatureModuleMeta) => void;
  marketLatestVersion?: string;
}) {
  const stateText = enabled ? "已啟用" : "未啟用";
  const hasNewerVersion =
    !!marketLatestVersion && compareModuleVersions(item.author.version, marketLatestVersion) === 1;
  const loadFailedReason = "開關狀態載入失敗，請重新整理頁面";
  const disabledReason = loadFailed
    ? loadFailedReason
    : !isSuper
      ? "僅超級管理員可操作"
      : saving
        ? "處理中..."
        : undefined;
  const switchesDisabled = !isSuper || saving || loadFailed === true;
  const uninstallDisabledReason = !canUninstall
    ? "目前環境尚未完成卸載管線設定"
    : disabledReason ?? "移除模組程式碼；資料庫資料預設保留";
  return (
    <>
      <tr className="border-b border-themed last:border-0 text-t1">
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="flex items-center gap-2">
            <span className="font-medium">{item.label}</span>
            <HelpToggle
              id={item.value}
              label={item.label}
              open={open}
              onToggle={() => onToggleHelp(item.value)}
            />
          </span>
        </td>
        <td className="px-3 py-2 text-center text-xs whitespace-nowrap">
          <span className="text-t2">v{item.author.version || "—"}</span>
          {hasNewerVersion && (
            <span className="block mt-1 text-warning" role="status">
              有新版：v{marketLatestVersion}
            </span>
          )}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <Badge text={FEATURE_MODULE_STATUS_LABELS[item.status]} className="text-t3" />
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="flex flex-col items-center gap-1">
            <span className="flex items-center justify-center gap-2">
              <span className={`text-xs font-medium ${enabled ? "text-t3" : "text-t2"}`}>
                關
              </span>
              <button
                type="button"
                onClick={() => onToggleMaster(item, !enabled)}
                disabled={switchesDisabled}
                role="switch"
                aria-checked={enabled}
                aria-label={`「${item.label}」總開關：${stateText}`}
                title={disabledReason}
                className={`inline-flex h-6 w-11 items-center rounded-full border border-themed transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? "bg-primary" : "bg-surface"}`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
              <span className={`text-xs font-medium ${enabled ? "text-success" : "text-t3"}`}>
                開
              </span>
            </span>
            {saving && <span className="text-xs text-t3">處理中...</span>}
          </span>
        </td>
        <RoleCells
          item={item}
          switches={switches}
          disabled={switchesDisabled}
          disabledTitle={loadFailed ? loadFailedReason : undefined}
          onToggle={onToggleRole}
        />
        <td className="px-3 py-2 whitespace-nowrap text-right">
          {pendingUninstall ? (
            <span className="text-xs text-warning inline-flex items-center gap-2">
              部署中…
              {pendingUninstall.commitUrl ? (
                <a
                  href={pendingUninstall.commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-warning"
                >
                  查看提交
                </a>
              ) : null}
            </span>
          ) : canUninstall ? (
            <button
              type="button"
              onClick={() => onUninstall(item)}
              disabled={!isSuper || saving || !canUninstall}
              title={uninstallDisabledReason}
              className="btn-danger rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
            >
              卸載
            </button>
          ) : (
            <span className="text-xs text-t3">—</span>
          )}
        </td>
      </tr>
      <DescriptionRow item={item} open={open} colSpan={9} />
    </>
  );
}

/**
 * 「功能模組管理」入口（僅超級管理員）：
 * 內建／選用兩份功能模組列表，說明與作者／版本／提供功能由名稱旁箭頭就地展開；
 * 選用模組有總開關；四種身分欄＝**顯示與否**（提供功能＝否顯示「未提供」）。
 */
export default function ModulesPage() {
  const router = useRouter();
  // 總開關與顯示開關：null＝載入中（fail-closed，先當全部未啟用）
  const [enabled, setEnabled] = useState<FeatureModulesEnabledMap | null>(null);
  const [roles, setRoles] = useState<FeatureModuleRolesMap | null>(null);
  const [isSuper, setIsSuper] = useState(false);
  // 處理中的鍵：總開關＝模組代碼；顯示開關＝「模組代碼:身分」
  const [saving, setSaving] = useState<string | null>(null);
  // 開關狀態載入失敗訊息：非空＝頁面勾選／總開關不可信（禁止默默呈現全未勾選）
  const [loadError, setLoadError] = useState("");
  const [openDesc, setOpenDesc] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // 卸載確認視窗（modal）：null＝關閉；否則為待卸載的模組
  const [confirmUninstall, setConfirmUninstall] = useState<FeatureModuleMeta | null>(null);
  const [canUninstall, setCanUninstall] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [pendingUninstalls, setPendingUninstalls] = useState<
    Record<string, { branch?: string; commitUrl?: string }>
  >({});
  const [marketLatestVersions, setMarketLatestVersions] = useState<Record<string, string>>({});
  const pollTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      Object.values(pollTimersRef.current).forEach((timerId) => window.clearInterval(timerId));
      pollTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/feature-modules", { cache: "no-store" })
      .then(async (res) => {
        const data: FeatureModulesResponse | null = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && data?.success && data.enabled && data.roles) {
          setEnabled(data.enabled);
          setRoles(data.roles);
          setCanUninstall(data.canUninstall === true);
          setLoadError("");
          return;
        }
        // 取得失敗仍以空值結束載入，但明確標示狀態不可信：
        // 否則所有開關會默默呈現「未勾選」，被誤讀為權限已關閉
        setEnabled({});
        setRoles({});
        setCanUninstall(false);
        setLoadError(data?.message || `開關狀態載入失敗（HTTP ${res.status}）`);
      })
      .catch(() => {
        if (cancelled) return;
        setEnabled({});
        setRoles({});
        setCanUninstall(false);
        setLoadError("開關狀態載入失敗（網路錯誤）");
      });

    fetchSession().then((session) => {
      if (!cancelled) setIsSuper(session?.adminAttribute === "超級");
    });

    fetch("/api/admin/feature-modules/market", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MarketInstalledResponse | null) => {
        if (cancelled || !data?.success || !Array.isArray(data.modules)) return;
        const versions: Record<string, string> = {};
        for (const module of data.modules) {
          const latest = module.latestVersion || module.version;
          if (module.id && latest) versions[module.id] = latest;
        }
        setMarketLatestVersions(versions);
      })
      .catch(() => {
        // 市集來源未設定或暫時無法連線時，仍顯示本機模組版本，不中斷模組管理。
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** 送出 PATCH，成功後依回應更新總開關或顯示開關 */
  async function patch(body: Record<string, unknown>, key: string) {
    if (saving) return;
    setSaving(key);
    setToast(null);
    try {
      const res = await fetch("/api/admin/feature-modules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: FeatureModulesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `操作失敗（HTTP ${res.status}）`);
      }
      if (data.enabled) setEnabled(data.enabled);
      if (data.roles) setRoles(data.roles);
      setToast({ kind: "success", text: data.message || "已更新" });
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : "操作失敗" });
    } finally {
      setSaving(null);
    }
  }

  /** 選用模組總開關 */
  function toggleMaster(item: FeatureModuleMeta, next: boolean) {
    void patch({ value: item.value, enabled: next }, item.value);
  }

  /** 模組 × 身分顯示與否 */
  function toggleRole(item: FeatureModuleMeta, role: UserRole, next: boolean) {
    void patch({ value: item.value, role, enabled: next }, `${item.value}:${role}`);
  }

  /** 卸載確認：開啟 modal（不使用瀏覽器原生 confirm） */
  function uninstallModule(item: FeatureModuleMeta) {
    if (saving) return;
    setConfirmUninstall(item);
    setBackupConfirmed(false);
  }

  /** 確認卸載後執行（正式環境送出提交並等待部署；本機開發直接生效） */
  async function runUninstall(item: FeatureModuleMeta) {
    setConfirmUninstall(null);
    if (saving) return;
    setSaving(`${item.value}:uninstall`);
    setToast(null);
    try {
      const res = await fetch("/api/admin/feature-modules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: item.value, confirmedBackup: backupConfirmed }),
      });
      const data: FeatureModulesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `操作失敗（HTTP ${res.status}）`);
      }
      setSaving(null);
      if (data.commitUrl || data.branch) {
        setPendingUninstalls((current) => ({
          ...current,
          [item.value]: { branch: data.branch, commitUrl: data.commitUrl },
        }));
        setToast({
          kind: "success",
          text: `${data.message || "已送出卸載提交"}（部署完成後此頁會自動刷新）`,
        });
        startUninstallPolling(item.value);
      } else {
        setToast({ kind: "success", text: data.message || "已卸載" });
        window.location.reload();
      }
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : "操作失敗" });
      setSaving(null);
    }
  }

  function startUninstallPolling(moduleValue: string) {
    if (pollTimersRef.current[moduleValue]) return;

    let attempts = 0;
    const maxAttempts = 60;
    const timerId = window.setInterval(async () => {
      attempts += 1;
      try {
        const res = await fetch("/api/admin/feature-modules/market", { cache: "no-store" });
        const data: MarketInstalledResponse | null = await res.json().catch(() => null);
        const installed = data?.success && data.installedModules ? data.installedModules : {};
        if (!installed[moduleValue]) {
          window.clearInterval(timerId);
          delete pollTimersRef.current[moduleValue];
          window.location.reload();
          return;
        }
      } catch {
        // 忽略暫時的輪詢失敗，讓下一次重試
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(timerId);
        delete pollTimersRef.current[moduleValue];
        setSaving(null);
        setToast({ kind: "success", text: "卸載提交已送出；部署時間較長，請稍後手動重新整理。" });
      }
    }, 8000);

    pollTimersRef.current[moduleValue] = timerId;
  }

  function toggleHelp(value: string) {
    setOpenDesc((current) => (current === value ? null : value));
  }

  const builtins = FEATURE_MODULES.filter((item) => item.kind === "builtin");
  const optionals = FEATURE_MODULES.filter((item) => item.kind === "optional");
  const loading = enabled === null || roles === null;
  const loadingText = loading ? "啟用狀態載入中..." : "";

  return (
    <div className="w-full max-w-5xl mb-8 space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => router.push("/admin/modules/market")}
          className="btn-theme rounded px-4 py-2 text-sm cursor-pointer"
        >
          開啟模組市集
        </button>
      </div>

      <Toast message={toast} onClose={() => setToast(null)} />

      {/* 開關狀態載入失敗：明確標示，避免「全數未勾選」被誤讀為權限已關閉 */}
      {loadError && (
        <div className="alert-danger p-4 text-sm" role="alert">
          <span className="font-bold text-danger">開關狀態載入失敗：</span>
          {loadError}
          。目前顯示的勾選與總開關狀態不可信，已暫停操作，請重新整理後再試。
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer mt-3"
          >
            重新整理
          </button>
        </div>
      )}

      {/* 卸載確認視窗（modal，樣式比照 IdleTimeout 對話框） */}
      {confirmUninstall && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
          role="presentation"
          onClick={() => {
            setConfirmUninstall(null);
            setBackupConfirmed(false);
          }}
        >
          <div
            className="bg-card border border-themed rounded-2xl p-8 text-center space-y-4 shadow-lg animate-fade-in w-full max-w-md"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="uninstall-confirm-title"
            aria-describedby="uninstall-confirm-desc"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-center">
              <svg
                className="w-12 h-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                style={{ color: "var(--danger)" }}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            </div>
            <div>
              <p id="uninstall-confirm-title" className="text-lg font-semibold text-t1 mb-2">
                確定卸載「{confirmUninstall.label}」？
              </p>
              <p id="uninstall-confirm-desc" className="text-sm text-t2">
                將移除模組資料夾與安裝清單；Firestore 模組資料預設保留。
              </p>
              <p className="text-xs text-t3 mt-2">
                卸載前請先備份模組關聯資料（例如 Firestore 集合與匯出檔）；資料清理需人工執行。
              </p>
              <label className="mt-3 inline-flex items-start gap-2 text-xs text-t2 text-left">
                <input
                  type="checkbox"
                  checked={backupConfirmed}
                  onChange={(event) => setBackupConfirmed(event.target.checked)}
                  className="mt-0.5 accent-current"
                />
                我已完成備份，並理解卸載後需重新部署才會生效。
              </label>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmUninstall(null);
                  setBackupConfirmed(false);
                }}
                className="border border-themed rounded-lg px-6 py-2 text-sm font-medium text-t2 hover:text-t1 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!backupConfirmed}
                onClick={() => void runUninstall(confirmUninstall)}
                className="btn-danger rounded-lg px-6 py-2 text-sm font-medium cursor-pointer disabled:opacity-50"
              >
                確定卸載
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 內建功能模組 */}
      <section>
        <div className="mb-3">
          <h3 className="text-lg font-bold text-t1">內建功能模組</h3>
          <p className="text-xs text-t3">
            隨主程式提供、一律啟用；已上線的模組可直接進入。名稱旁的箭頭可展開說明與作者版本資訊；
            四種身分欄：綠勾「提供」＝模組作者提供此功能（唯讀）；旁邊勾選＝顯示與否
            （關閉＝暫時不顯示、禁止進入）。
          </p>
        </div>
        <div className="border border-themed rounded-lg bg-card overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="border-b border-themed">
              <tr className="text-t2">
                <th className="px-3 py-2 font-medium whitespace-nowrap">模組名稱</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">狀態</th>
                {ALL_ROLES.map((role) => (
                  <th key={role} className="px-3 py-2 font-medium whitespace-nowrap text-center">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium whitespace-nowrap text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-t3">
                    {loadingText}
                  </td>
                </tr>
              ) : builtins.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-t3">
                    沒有內建功能模組
                  </td>
                </tr>
              ) : (
                builtins.map((item) => (
                  <BuiltinRow
                    key={item.value}
                    item={item}
                    open={openDesc === item.value}
                    onToggleHelp={toggleHelp}
                    switches={roles[item.value]}
                    disabled={!isSuper || saving !== null || loadError !== ""}
                    disabledTitle={loadError ? "開關狀態載入失敗，請重新整理頁面" : undefined}
                    onToggleRole={toggleRole}
                    onOpen={(href) => router.push(href)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 選用功能模組 */}
      <section>
        <div className="mb-3">
          <h3 className="text-lg font-bold text-t1">選用功能模組</h3>
          <p className="text-xs text-t3">
            已安裝的模組各有一個總開關（預設未啟用），由超級管理員啟用／停用；
            「狀態」為模組作者宣告的進度資訊，不影響開關。
            四種身分欄上下排列：綠勾「提供」與「顯示」勾選（提供功能＝否者顯示「未提供」）；版本欄顯示模組版本。
            操作欄「卸載」在卸載管線設定完成時可用（部署環境會建立 Git 提交）。
            設定為現行狀態，變更會記錄於稽核紀錄。
          </p>
        </div>

        <div className="border border-themed rounded-lg bg-card overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="border-b border-themed">
              <tr className="text-t2">
                <th className="px-3 py-2 font-medium whitespace-nowrap">模組名稱</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">版本</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">狀態</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">總開關</th>
                {ALL_ROLES.map((role) => (
                  <th key={role} className="px-3 py-2 font-medium whitespace-nowrap text-center">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium whitespace-nowrap text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-t3">
                    {loadingText}
                  </td>
                </tr>
              ) : optionals.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-t3">
                    沒有選用功能模組
                  </td>
                </tr>
              ) : (
                optionals.map((item) => (
                  <OptionalRow
                    key={item.value}
                    item={item}
                    open={openDesc === item.value}
                    onToggleHelp={toggleHelp}
                    enabled={enabled[item.value] === true}
                    switches={roles[item.value]}
                    isSuper={isSuper}
                    loadFailed={loadError !== ""}
                    canUninstall={canUninstall}
                    pendingUninstall={pendingUninstalls[item.value]}
                    saving={
                      saving === item.value ||
                      saving === `${item.value}:uninstall` ||
                      !!pendingUninstalls[item.value]
                    }
                    onToggleMaster={toggleMaster}
                    onToggleRole={toggleRole}
                    onUninstall={uninstallModule}
                    marketLatestVersion={marketLatestVersions[item.value]}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 管理端權限（指定功能模組）說明：屬主程式模組的子功能權限 */}
      <section className="border border-themed rounded-lg bg-card p-5">
        <h3 className="text-lg font-bold text-t1 mb-2">管理端權限（指定功能模組）說明</h3>
        <p className="text-xs text-t3 mb-2">
          內建的管理端模組（帳號、身分與安全管理、使用者帳號管理…）另有管理權限層，
          由超級管理員在名冊或帳號頁以「指定功能模組」指派：
        </p>
        <ul className="text-sm text-t2 space-y-1.5 list-disc pl-5">
          <li>
            <span className="font-bold text-t1">核心</span>
            ：不需指派、每位管理員皆具備（系統設定）。
          </li>
          <li>
            <span className="font-bold text-t1">可指派</span>
            ：由超級管理員在「身分名冊管理」或「使用者帳號管理」勾選授予。
          </li>
          <li>
            <span className="font-bold text-t1">僅超級管理員</span>
            ：不開放指派，只有超級屬性可用（學校基本設定、功能模組管理、統計儀表板）。
          </li>
          <li>
            此層權限決定管理員首頁卡片是否顯示，以及對應 API 是否放行（未具備一律 403）。
          </li>
          <li>
            「顯示與否」關閉時，該身分首頁不顯示此模組入口；
            API 仍以「指定功能模組」權限把關（不因顯示關閉而額外阻擋）。
          </li>
        </ul>
      </section>
    </div>
  );
}
