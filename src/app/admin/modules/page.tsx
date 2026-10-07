"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

type Flash = { type: "success" | "error"; text: string } | null;

interface FeatureModulesResponse {
  success?: boolean;
  message?: string;
  enabled?: FeatureModulesEnabledMap;
  roles?: FeatureModuleRolesMap;
}

/** 小標籤（已上線／開發中／規劃中） */
function Badge({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`text-xs border border-themed rounded px-1.5 py-0.5 ${className}`}>
      {text}
    </span>
  );
}

/** 模組名稱旁的「說明」按鈕（? 圓圈 SVG）：點擊展開／收合該列下方的說明列 */
function HelpToggle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`查看「${label}」說明`}
      title="查看說明"
      className="inline-flex items-center justify-center align-middle w-5 h-5 rounded-full border border-themed text-t3 hover:text-t1 hover:border-t1 cursor-pointer"
    >
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M9.2 9.2a2.9 2.9 0 1 1 3.9 2.7c-.7.3-1.1.9-1.1 1.7v.4" />
        <path d="M12 17.4v.01" />
      </svg>
      <span className="sr-only">{open ? "收合說明" : "展開說明"}</span>
    </button>
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
    <tr className="border-b border-themed last:border-0">
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
 * 提供功能＝否 → 文字「未提供」（不可操作）；＝是 → 綠勾「提供」＋ checkbox。
 */
function RoleCells({
  item,
  switches,
  disabled,
  onToggle,
}: {
  item: FeatureModuleMeta;
  switches: FeatureModuleRoleSwitches | undefined;
  disabled: boolean;
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
          <td key={role} className="px-3 py-2">
            <span className="inline-flex items-center justify-center gap-1.5">
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
              <input
                type="checkbox"
                checked={switches?.[role] === true}
                disabled={disabled}
                onChange={(event) => onToggle(item, role, event.target.checked)}
                aria-label={`「${item.label}」對${ROLE_LABELS[role]}身分的顯示與否`}
                title={
                  disabled
                    ? "僅超級管理員可調整，且同一時間只能處理一筆變更"
                    : "顯示與否（關閉＝暫時不顯示、禁止進入）"
                }
                className="accent-current cursor-pointer disabled:opacity-50"
              />
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
  onToggleRole,
  onOpen,
}: {
  item: FeatureModuleMeta;
  open: boolean;
  onToggleHelp: (value: string) => void;
  switches: FeatureModuleRoleSwitches | undefined;
  disabled: boolean;
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
              label={item.label}
              open={open}
              onToggle={() => onToggleHelp(item.value)}
            />
          </span>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <Badge text={FEATURE_MODULE_STATUS_LABELS[item.status]} className="text-t3" />
        </td>
        <RoleCells item={item} switches={switches} disabled={disabled} onToggle={onToggleRole} />
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

/** 選用功能模組列表列：總開關＋四種身分顯示與否，僅超級管理員可切換 */
function OptionalRow({
  item,
  open,
  onToggleHelp,
  enabled,
  switches,
  isSuper,
  saving,
  onToggleMaster,
  onToggleRole,
}: {
  item: FeatureModuleMeta;
  open: boolean;
  onToggleHelp: (value: string) => void;
  enabled: boolean;
  switches: FeatureModuleRoleSwitches | undefined;
  isSuper: boolean;
  saving: boolean;
  onToggleMaster: (item: FeatureModuleMeta, next: boolean) => void;
  onToggleRole: (item: FeatureModuleMeta, role: UserRole, next: boolean) => void;
}) {
  const live = item.status === "live";
  const stateText = !live ? "未上線" : enabled ? "已啟用" : "未啟用";
  const stateClass = !live ? "text-t3" : enabled ? "text-success" : "text-t2";
  const disabledReason = !live
    ? "模組尚未上線"
    : !isSuper
      ? "僅超級管理員可啟用／停用"
      : saving
        ? "處理中..."
        : undefined;
  return (
    <>
      <tr className={`border-b border-themed last:border-0 text-t1${live ? "" : " opacity-70"}`}>
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="flex items-center gap-2">
            <span className="font-medium">{item.label}</span>
            <HelpToggle
              label={item.label}
              open={open}
              onToggle={() => onToggleHelp(item.value)}
            />
          </span>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <Badge text={FEATURE_MODULE_STATUS_LABELS[item.status]} className="text-t3" />
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="flex items-center gap-2">
            <span className={`text-sm font-medium ${stateClass}`}>{stateText}</span>
            {live ? (
              <button
                type="button"
                onClick={() => onToggleMaster(item, !enabled)}
                disabled={!isSuper || saving}
                title={disabledReason}
                className={
                  enabled
                    ? "btn-danger rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
                    : "btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
                }
              >
                {saving ? "處理中..." : enabled ? "停用" : "啟用"}
              </button>
            ) : (
              <span className="text-xs text-t3">尚未提供</span>
            )}
          </span>
        </td>
        <RoleCells item={item} switches={switches} disabled={!isSuper || saving} onToggle={onToggleRole} />
      </tr>
      <DescriptionRow item={item} open={open} colSpan={7} />
    </>
  );
}

/**
 * 「功能模組管理」入口（僅超級管理員）：
 * 內建／選用兩份功能模組列表，說明與作者／版本／提供功能由名稱旁 ? 就地展開；
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
  const [openDesc, setOpenDesc] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  // 儲存訊息：固定於畫面下方中央，約 3 秒後自動淡出（列表過長也看得到）
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/feature-modules", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setEnabled(data?.success && data.enabled ? data.enabled : {});
        setRoles(data?.success && data.roles ? data.roles : {});
      })
      .catch(() => {
        if (!cancelled) {
          setEnabled({});
          setRoles({});
        }
      });

    fetchSession().then((session) => {
      if (!cancelled) setIsSuper(session?.adminAttribute === "超級");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /** 送出 PATCH，成功後依回應更新總開關或顯示開關 */
  async function patch(body: Record<string, unknown>, key: string) {
    if (saving) return;
    setSaving(key);
    setFlash(null);
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
      setFlash({ type: "success", text: data.message || "已更新" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "操作失敗" });
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

  function toggleHelp(value: string) {
    setOpenDesc((current) => (current === value ? null : value));
  }

  const builtins = FEATURE_MODULES.filter((item) => item.kind === "builtin");
  const optionals = FEATURE_MODULES.filter((item) => item.kind === "optional");
  const loading = enabled === null || roles === null;
  const loadingText = loading ? "啟用狀態載入中..." : "";

  return (
    <div className="w-full max-w-5xl mb-8 space-y-6">
      {/* 固定位置儲存訊息（下方中央 toast，自動淡出） */}
      {flash && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white"
          style={{
            background: `var(${flash.type === "success" ? "--success" : "--danger"})`,
          }}
          role="status"
          aria-live="polite"
        >
          {flash.text}
        </div>
      )}

      {/* 內建功能模組 */}
      <section>
        <div className="mb-3">
          <h3 className="text-lg font-bold text-t1">內建功能模組</h3>
          <p className="text-xs text-t3">
            隨主程式提供、一律啟用；已上線的模組可直接進入。名稱旁的 ? 可展開說明與作者版本資訊；
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
                    disabled={!isSuper || saving !== null}
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
            每個模組有一個總開關，由超級管理員啟用／停用（尚未上線者不可啟用）；
            四種身分欄：綠勾「提供」＋顯示與否勾選（提供功能＝否者顯示「未提供」）。
            設定為現行狀態，變更會記錄於稽核紀錄。
          </p>
        </div>

        <div className="border border-themed rounded-lg bg-card overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="border-b border-themed">
              <tr className="text-t2">
                <th className="px-3 py-2 font-medium whitespace-nowrap">模組名稱</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">狀態</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">總開關</th>
                {ALL_ROLES.map((role) => (
                  <th key={role} className="px-3 py-2 font-medium whitespace-nowrap text-center">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-t3">
                    {loadingText}
                  </td>
                </tr>
              ) : optionals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-t3">
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
                    saving={saving === item.value}
                    onToggleMaster={toggleMaster}
                    onToggleRole={toggleRole}
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
