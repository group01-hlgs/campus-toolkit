"use client";

import { useCallback, useEffect, useState } from "react";
import PersonalInfoResultDialog from "@/components/PersonalInfoResultDialog";
import {
  DEFAULT_STUDENT_PERSONAL_INFO_SETTINGS,
  type StudentPersonalInfoSettings,
} from "@/types/personal-info";

interface SettingsResponse {
  success?: boolean;
  message?: string;
  settings?: StudentPersonalInfoSettings;
  period?: { academicYear: number; semester: number };
}

export default function PersonalInfoRulesPanel() {
  const [settings, setSettings] = useState<StudentPersonalInfoSettings>(
    DEFAULT_STUDENT_PERSONAL_INFO_SETTINGS
  );
  const [period, setPeriod] = useState<{ academicYear: number; semester: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/personal-info/settings", { cache: "no-store" });
      const data: SettingsResponse = await response.json();
      if (!response.ok || !data.success || !data.settings || !data.period) {
        throw new Error(data.message || "讀取個人資料管理規則失敗");
      }
      setSettings(data.settings);
      setPeriod(data.period);
    } catch (error) {
      const message = error instanceof Error ? error.message : "讀取個人資料管理規則失敗";
      setLoadError(message);
      setFeedback({ kind: "error", message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function saveSettings() {
    if (saving) return;
    if (settings.enabled && (!settings.startDate || !settings.endDate)) {
      setFeedback({ kind: "error", message: "開放填寫前，請先設定起始日期與結束日期。" });
      return;
    }
    if (settings.startDate && settings.endDate && settings.endDate < settings.startDate) {
      setFeedback({ kind: "error", message: "結束日期不可早於起始日期。" });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/personal-info/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data: SettingsResponse = await response.json();
      if (!response.ok || !data.success || !data.settings) {
        throw new Error(data.message || "儲存個人資料管理規則失敗");
      }
      setSettings(data.settings);
      if (data.period) setPeriod(data.period);
      setFeedback({ kind: "success", message: data.message || "管理規則已儲存。" });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "儲存個人資料管理規則失敗",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="border border-themed rounded-lg bg-card p-5 sm:p-6 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
          <div>
            <h3 className="text-lg font-bold text-t1">管理規則</h3>
            <p className="text-xs text-t3 mt-1">
              學生可填寫自己的個人基本資料；學號、年級、班級與座號等學籍名冊資料不在此修改。
            </p>
          </div>
          {period && (
            <span className="text-xs text-t3 shrink-0">
              {period.academicYear} 學年度第 {period.semester} 學期
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-t3" role="status">載入管理規則中…</p>
        ) : loadError ? (
          <div className="space-y-3">
            <p className="text-sm text-danger" role="alert">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadSettings()}
              className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
            >
              重新載入規則
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="flex items-start gap-2 text-sm text-t1">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
                className="mt-0.5 accent-current"
              />
              <span>開放填寫本學期的基本資料</span>
            </label>

            <div>
              <p className="text-xs text-t2 mb-2">開放填寫的起訖日期（配合上方開放設定）</p>
              <fieldset
                disabled={saving}
                aria-label="開放填寫的起訖日期"
                className="grid gap-3 sm:grid-cols-2"
              >
                <label className="space-y-1 text-xs text-t2">
                  <span className="block">起始日期</span>
                  <input
                    type="date"
                    value={settings.startDate}
                    onChange={(event) => setSettings({ ...settings, startDate: event.target.value })}
                    className="w-full input-theme rounded px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1 text-xs text-t2">
                  <span className="block">結束日期（含當日）</span>
                  <input
                    type="date"
                    value={settings.endDate}
                    onChange={(event) => setSettings({ ...settings, endDate: event.target.value })}
                    className="w-full input-theme rounded px-3 py-2 text-sm"
                  />
                </label>
              </fieldset>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void saveSettings()}
                disabled={saving}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
              >
                {saving ? "儲存中…" : "儲存管理規則"}
              </button>
            </div>
          </div>
        )}
      </section>
      <PersonalInfoResultDialog
        message={feedback?.message ?? null}
        kind={feedback?.kind ?? "success"}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}
