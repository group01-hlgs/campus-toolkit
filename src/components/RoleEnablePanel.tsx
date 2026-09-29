"use client";

import { useEffect, useState } from "react";
import { defaultSettings, SchoolPeriod, Settings } from "@/types/settings";
import { ALL_ROLES, ROLE_LABELS, UserRole } from "@/types/users";
import { periodLabel, RoleEnabledMap } from "@/types/role-settings";

type Flash = { type: "success" | "error"; text: string } | null;

interface RolesResponse {
  success?: boolean;
  message?: string;
  period?: SchoolPeriod;
  roles?: RoleEnabledMap;
  aligned?: boolean;
  storedPeriod?: SchoolPeriod | null;
}

interface RolesView {
  period: SchoolPeriod;
  roles: RoleEnabledMap;
  aligned: boolean;
  storedPeriod: SchoolPeriod | null;
}

/** 各身分的用途說明（卡片上一併顯示停用效果） */
const ROLE_HINTS: Record<UserRole, string> = {
  student: "以學生身分進入系統",
  parent: "以家長身分進入系統",
  staff: "以教職員身分進入系統",
  admin: "以管理員身分進入系統，負責管理本系統",
};

/**
 * 每學期身分啟用／停用面板（原「身分管理」頁，併入身分名冊管理頁頂端）。
 * 自行讀取 /api/admin/roles，內含期間不一致的醒目警示與「對齊系統學期」。
 */
export default function RoleEnablePanel() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [view, setView] = useState<RolesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState<UserRole | "align" | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
      })
      .catch((error) => console.error("載入設定失敗:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  /** silent=true：背景重新整理（啟用／停用後不整頁跳回載入中） */
  async function loadView(silent = false) {
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/roles", { cache: "no-store" });
      const data: RolesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.period || !data.roles) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      setView({
        period: data.period,
        roles: data.roles,
        aligned: data.aligned === true,
        storedPeriod: data.storedPeriod ?? null,
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 啟用／停用該學期的身分 */
  async function toggle(role: UserRole, enabled: boolean) {
    if (saving || !view) return;
    setSaving(role);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, enabled }),
      });
      const data: RolesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `操作失敗（HTTP ${res.status}）`);
      }
      await loadView(true);
      setFlash({ type: "success", text: data.message || "已更新" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "操作失敗" });
    } finally {
      setSaving(null);
    }
  }

  /** 對齊系統學期：建立本期身分資料，消除期間不一致的警示 */
  async function align() {
    if (saving || !view) return;
    setSaving("align");
    setFlash(null);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ align: true }),
      });
      const data: RolesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `操作失敗（HTTP ${res.status}）`);
      }
      await loadView(true);
      setFlash({ type: "success", text: data.message || "已對齊系統學期" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "操作失敗" });
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <p className="mb-6 text-center text-t3">身分啟用狀態載入中...</p>;
  }

  if (loadError) {
    return (
      <div className="mb-6">
        <div className="alert-danger p-4 text-sm">
          <span className="font-bold text-danger">讀取失敗：</span>
          {loadError}
        </div>
        <button
          onClick={() => void loadView()}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer mt-3"
        >
          重新讀取
        </button>
      </div>
    );
  }

  if (!view) return null;

  return (
    <div className="mb-6">
      <h3 className="text-lg font-bold text-t1 mb-3">每學期身分啟用狀態</h3>

      {/* 期間對齊狀態：不一致時以醒目警示條提示 */}
      {view.aligned ? (
        <div className="alert-info p-3 mb-4 text-sm">
          本期身分資料：
          <span className="font-medium text-t1"> {periodLabel(view.period)} </span>
          （與系統設定一致）
        </div>
      ) : (
        <div className="alert-danger p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm flex-1">
            <span className="font-bold text-danger">學年度學期不一致：</span>
            身分資料
            {view.storedPeriod ? `仍為 ${periodLabel(view.storedPeriod)}` : "尚未建立"}
            ，與系統設定的 {periodLabel(view.period)} 不符。對齊前，本期四種身分一律視為啟用。
          </p>
          <button
            onClick={() => void align()}
            disabled={saving !== null}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer shrink-0 disabled:opacity-50"
          >
            {saving === "align" ? "對齊中..." : "對齊系統學期"}
          </button>
        </div>
      )}

      {flash && (
        <p
          className={`text-sm mb-4 ${flash.type === "success" ? "text-success" : "text-danger"}`}
          role="status"
        >
          {flash.text}
        </p>
      )}

      {/* 四種身分的啟用狀態 */}
      <div className="grid gap-4 sm:grid-cols-2">
        {ALL_ROLES.map((role) => {
          const enabled = view.roles[role];
          const adminLocked = role === "admin" && enabled;
          return (
            <div
              key={role}
              className="border border-themed rounded-lg p-5 bg-card flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-lg font-bold text-t1">{ROLE_LABELS[role]}</h4>
                <span
                  className={`text-sm font-medium ${enabled ? "text-success" : "text-danger"}`}
                >
                  {enabled ? "啟用中" : "已停用"}
                </span>
              </div>
              <p className="text-sm text-t3 flex-1">
                {ROLE_HINTS[role]}
                <br />
                {enabled
                  ? `${periodLabel(view.period)} 可使用此身分。`
                  : `${periodLabel(view.period)} 已停用，所有人都無法以此身分登入。`}
              </p>
              <button
                type="button"
                onClick={() => void toggle(role, !enabled)}
                disabled={saving !== null || adminLocked}
                title={adminLocked ? "無法停用管理員身分" : undefined}
                className={
                  enabled
                    ? "btn-danger rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                    : "btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                }
              >
                {saving === role
                  ? "處理中..."
                  : enabled
                    ? "停用此身分"
                    : "啟用此身分"}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-t3 mt-3">
        停用僅影響 {settings.academicYear} 學年度第{settings.semester}學期；學期轉換請按上方「對齊系統學期」。
      </p>
    </div>
  );
}
