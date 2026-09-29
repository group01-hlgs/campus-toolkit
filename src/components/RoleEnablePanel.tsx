"use client";

import { useEffect, useState } from "react";
import { ALL_ROLES, ROLE_LABELS, UserRole } from "@/types/users";
import { RoleEnabledMap } from "@/types/role-settings";

type Flash = { type: "success" | "error"; text: string } | null;

interface RolesResponse {
  success?: boolean;
  message?: string;
  roles?: RoleEnabledMap;
}

interface RolesView {
  roles: RoleEnabledMap;
}

/** 各身分的用途說明（卡片上一併顯示停用效果） */
const ROLE_HINTS: Record<UserRole, string> = {
  student: "以學生身分進入系統",
  parent: "以家長身分進入系統",
  staff: "以教職員身分進入系統",
  admin: "以管理員身分進入系統，負責管理本系統",
};

/**
 * 身分啟用／停用面板（原「身分管理」頁，併入身分名冊管理頁頂端）。
 * 開關存於系統設定（settings/system 的 roleEnabled），屬現行狀態、跨學期沿用。
 * 自行讀取 /api/admin/roles。
 */
export default function RoleEnablePanel() {
  const [view, setView] = useState<RolesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState<UserRole | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  /** silent=true：背景重新整理（啟用／停用後不整頁跳回載入中） */
  async function loadView(silent = false) {
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/roles", { cache: "no-store" });
      const data: RolesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.roles) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      setView({ roles: data.roles });
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

  /** 啟用／停用身分 */
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
      <h3 className="text-lg font-bold text-t1 mb-1">身分啟用狀態</h3>
      <p className="text-sm text-t3 mb-3">
        全校層開關：停用後該身分無法登入、無法切換，已登入者立即失效。設定為現行狀態，學期轉換沿用。
      </p>

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
                  ? "全校開放以此身分登入。"
                  : "已停用，所有人都無法以此身分登入。"}
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
    </div>
  );
}
