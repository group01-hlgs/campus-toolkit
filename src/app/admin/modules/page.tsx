"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSession } from "@/lib/session";
import {
  FEATURE_MODULES,
  FEATURE_MODULE_KIND_LABELS,
  FEATURE_MODULE_STATUS_LABELS,
  type FeatureModuleMeta,
  type FeatureModulesEnabledMap,
} from "@/types/feature-modules";

type Flash = { type: "success" | "error"; text: string } | null;

interface FeatureModulesResponse {
  success?: boolean;
  message?: string;
  enabled?: FeatureModulesEnabledMap;
}

/** 小標籤（內建／選用、已上線／規劃中） */
function Badge({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`text-xs border border-themed rounded px-1.5 py-0.5 ${className}`}>
      {text}
    </span>
  );
}

/** 內建功能模組卡片：一律啟用；已上線且有入口者可直接進入 */
function BuiltinCard({ item, onOpen }: { item: FeatureModuleMeta; onOpen: (href: string) => void }) {
  const enterable = item.status === "live" && item.href !== "";
  return (
    <div
      className={`border border-themed rounded-lg bg-card p-5 flex flex-col gap-3${enterable ? "" : " opacity-70"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold text-t1">{item.label}</span>
        <Badge text={FEATURE_MODULE_KIND_LABELS[item.kind]} className="text-t2" />
        <Badge text={FEATURE_MODULE_STATUS_LABELS[item.status]} className="text-t3" />
      </div>
      <p className="text-sm text-t3 flex-1">{item.description}</p>
      <div>
        {enterable ? (
          <button
            type="button"
            onClick={() => onOpen(item.href)}
            className="text-sm text-t2 cursor-pointer hover:text-t1"
          >
            前往 →
          </button>
        ) : (
          <span className="text-sm text-t3">尚未提供，敬請期待。</span>
        )}
      </div>
    </div>
  );
}

/** 選用功能模組卡片：僅超級管理員可切換，且只有所上線者才能啟用 */
function OptionalCard({
  item,
  enabled,
  isSuper,
  saving,
  onToggle,
}: {
  item: FeatureModuleMeta;
  enabled: boolean;
  isSuper: boolean;
  saving: boolean;
  onToggle: (item: FeatureModuleMeta, next: boolean) => void;
}) {
  const live = item.status === "live";
  const canToggle = live && isSuper && !saving;
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
    <div className={`border border-themed rounded-lg bg-card p-5 flex flex-col gap-3${live ? "" : " opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold text-t1">{item.label}</span>
        <Badge text={FEATURE_MODULE_KIND_LABELS[item.kind]} className="text-t2" />
        <Badge text={FEATURE_MODULE_STATUS_LABELS[item.status]} className="text-t3" />
      </div>
      <p className="text-sm text-t3 flex-1">{item.description}</p>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-sm font-medium ${stateClass}`}>{stateText}</span>
        {live ? (
          <button
            type="button"
            onClick={() => onToggle(item, !enabled)}
            disabled={!canToggle}
            title={disabledReason}
            className={
              enabled
                ? "btn-danger rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                : "btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
            }
          >
            {saving ? "處理中..." : enabled ? "停用" : "啟用"}
          </button>
        ) : (
          <span className="text-sm text-t3">尚未提供</span>
        )}
      </div>
    </div>
  );
}

/** 「功能模組管理」入口：內建／選用兩區的功能模組總覽＋選用模組啟用開關 */
export default function ModulesPage() {
  const router = useRouter();
  // 選用模組啟用狀態：null＝載入中（fail-closed，先當全部未啟用）
  const [enabled, setEnabled] = useState<FeatureModulesEnabledMap | null>(null);
  const [isSuper, setIsSuper] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/feature-modules", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setEnabled(data?.success && data.enabled ? data.enabled : {});
      })
      .catch(() => {
        if (!cancelled) setEnabled({});
      });

    fetchSession().then((session) => {
      if (!cancelled) setIsSuper(session?.adminAttribute === "超級");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(item: FeatureModuleMeta, next: boolean) {
    if (saving) return;
    setSaving(item.value);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/feature-modules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: item.value, enabled: next }),
      });
      const data: FeatureModulesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `操作失敗（HTTP ${res.status}）`);
      }
      setEnabled(data.enabled ?? {});
      setFlash({ type: "success", text: data.message || "已更新" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "操作失敗" });
    } finally {
      setSaving(null);
    }
  }

  const builtins = FEATURE_MODULES.filter((item) => item.kind === "builtin");
  const optionals = FEATURE_MODULES.filter((item) => item.kind === "optional");

  return (
    <div className="w-full max-w-4xl mb-8 space-y-6">
      {/* 內建功能模組 */}
      <section>
        <div className="mb-3">
          <h3 className="text-lg font-bold text-t1">內建功能模組</h3>
          <p className="text-xs text-t3">隨主程式提供、一律啟用；已上線的模組可直接進入。</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {builtins.map((item) => (
            <BuiltinCard key={item.value} item={item} onOpen={(href) => router.push(href)} />
          ))}
        </div>
      </section>

      {/* 選用功能模組 */}
      <section>
        <div className="mb-3">
          <h3 className="text-lg font-bold text-t1">選用功能模組</h3>
          <p className="text-xs text-t3">
            由超級管理員啟用／停用；尚未上線的模組無法啟用。啟用狀態為現行設定，變更會記錄於稽核紀錄。
          </p>
        </div>

        {flash && (
          <p
            className={`text-sm mb-3 ${flash.type === "success" ? "text-success" : "text-danger"}`}
            role="status"
          >
            {flash.text}
          </p>
        )}

        {enabled === null ? (
          <p className="text-center text-t3 border border-themed rounded-lg bg-card p-8">
            啟用狀態載入中...
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {optionals.map((item) => (
              <OptionalCard
                key={item.value}
                item={item}
                enabled={enabled[item.value] === true}
                isSuper={isSuper}
                saving={saving === item.value}
                onToggle={toggle}
              />
            ))}
          </div>
        )}
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
            ：不需指派、每位管理員皆具備（系統設定、功能模組管理）。
          </li>
          <li>
            <span className="font-bold text-t1">可指派</span>
            ：由超級管理員在「身分名冊管理」或「使用者帳號管理」勾選授予。
          </li>
          <li>
            <span className="font-bold text-t1">僅超級管理員</span>
            ：不開放指派，只有超級屬性可用（學校基本設定）。
          </li>
          <li>
            此層權限決定管理員首頁卡片是否顯示，以及對應 API 是否放行（未具備一律 403）。
          </li>
        </ul>
      </section>
    </div>
  );
}
