"use client";

import { useCallback, useEffect, useState } from "react";
import DisclosureArrow from "@/components/DisclosureArrow";
import PersonalInfoResultDialog from "@/components/PersonalInfoResultDialog";
import {
  DEFAULT_STUDENT_PERSONAL_INFO_SETTINGS,
  type StudentPersonalInfoSettings,
  type StudentPersonalInfoTargetOptions,
} from "@/types/personal-info";

interface SettingsResponse {
  success?: boolean;
  message?: string;
  settings?: StudentPersonalInfoSettings;
  period?: { academicYear: number; semester: number };
  targetOptions?: StudentPersonalInfoTargetOptions;
}

export default function PersonalInfoRulesPanel() {
  const [expanded, setExpanded] = useState(false);
  const [settings, setSettings] = useState<StudentPersonalInfoSettings>(
    DEFAULT_STUDENT_PERSONAL_INFO_SETTINGS
  );
  const [targetOptions, setTargetOptions] = useState<StudentPersonalInfoTargetOptions>({ grades: [] });
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
      if (!response.ok || !data.success || !data.settings || !data.period || !data.targetOptions) {
        throw new Error(data.message || "讀取個人資料管理規則失敗");
      }
      setSettings(data.settings);
      setPeriod(data.period);
      setTargetOptions(data.targetOptions);
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
      setFeedback({ kind: "error", message: "開放填寫前，請先設定起始日期時間與結束日期時間。" });
      return;
    }
    if (settings.startDate && settings.endDate && settings.endDate < settings.startDate) {
      setFeedback({ kind: "error", message: "結束日期時間不可早於起始日期時間。" });
      return;
    }
    if (settings.enabled && settings.target.mode === "grades" && settings.target.grades.length === 0) {
      setFeedback({ kind: "error", message: "請至少選擇一個開放填寫的年級。" });
      return;
    }
    if (settings.enabled && settings.target.mode === "classes" && settings.target.classes.length === 0) {
      setFeedback({ kind: "error", message: "請至少選擇一個開放填寫的班級。" });
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
      <details
        open={expanded}
        onToggle={(event) => {
          if (event.currentTarget.open !== expanded) setExpanded(event.currentTarget.open);
        }}
        className="border border-themed rounded-lg bg-card p-5 sm:p-6 mb-4"
      >
        <summary
          aria-controls="personal-info-rules-content"
          className="flex list-none cursor-pointer flex-wrap items-center justify-between gap-2"
        >
          <div>
            <h3 className="text-lg font-bold text-t1">管理規則</h3>
            {period && (
              <p className="text-xs text-t3 mt-1">
                {period.academicYear} 學年度第 {period.semester} 學期
              </p>
            )}
          </div>
          <DisclosureArrow />
        </summary>

        {expanded && (
          <div id="personal-info-rules-content" className="mt-4">
            <p className="text-xs text-t3 mb-4">
              學生可填寫自己的個人資料；學號、年級、班級與座號等學籍名冊資料不在此修改。
            </p>
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

            <div className="space-y-3">
              <label className="block space-y-1 text-xs text-t2">
                <span>開放填寫的學生對象</span>
                <select
                  value={settings.target.mode}
                  onChange={(event) => {
                    const mode = event.target.value as StudentPersonalInfoSettings["target"]["mode"];
                    setSettings({
                      ...settings,
                      target: { mode, grades: [], classes: [] },
                    });
                  }}
                  className="w-full sm:w-72 input-theme rounded px-3 py-2 text-sm"
                >
                  <option value="all">全校學生</option>
                  <option value="grades">指定年級</option>
                  <option value="classes">指定班級</option>
                </select>
              </label>

              {settings.target.mode === "grades" && (
                <fieldset className="rounded border border-themed p-3">
                  <legend className="px-1 text-xs text-t2">選擇年級</legend>
                  {targetOptions.grades.length > 0 ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {targetOptions.grades.map((grade) => (
                        <label key={grade.value} className="inline-flex items-center gap-1.5 text-sm text-t1">
                          <input
                            type="checkbox"
                            checked={settings.target.grades.includes(grade.value)}
                            onChange={(event) => {
                              const grades = new Set(settings.target.grades);
                              if (event.target.checked) grades.add(grade.value);
                              else grades.delete(grade.value);
                              setSettings({
                                ...settings,
                                target: { mode: "grades", grades: [...grades], classes: [] },
                              });
                            }}
                            className="accent-current"
                          />
                          {grade.label}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-t3">尚未設定年級，請先至「學校基本設定」建立年級。</p>
                  )}
                </fieldset>
              )}

              {settings.target.mode === "classes" && (
                <fieldset className="space-y-3 rounded border border-themed p-3">
                  <legend className="px-1 text-xs text-t2">選擇班級</legend>
                  {targetOptions.grades.some((grade) => grade.classes.length > 0) ? (
                    targetOptions.grades.map((grade) =>
                      grade.classes.length === 0 ? null : (
                        <div key={grade.value} className="space-y-2">
                          <p className="text-xs font-medium text-t2">{grade.label}</p>
                          <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {grade.classes.map((classRow) => (
                              <label key={classRow.value} className="inline-flex items-center gap-1.5 text-sm text-t1">
                                <input
                                  type="checkbox"
                                  checked={settings.target.classes.includes(classRow.value)}
                                  onChange={(event) => {
                                    const classes = new Set(settings.target.classes);
                                    if (event.target.checked) classes.add(classRow.value);
                                    else classes.delete(classRow.value);
                                    setSettings({
                                      ...settings,
                                      target: { mode: "classes", grades: [], classes: [...classes] },
                                    });
                                  }}
                                  className="accent-current"
                                />
                                {classRow.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    )
                  ) : (
                    <p className="text-xs text-t3">尚未設定班級，請先至「學校基本設定」建立班級。</p>
                  )}
                </fieldset>
              )}
            </div>

            <fieldset className="space-y-2 rounded border border-themed p-3">
              <legend className="px-1 text-xs text-t2">證件照規則</legend>
              <label className="flex items-start gap-2 text-sm text-t1">
                <input
                  type="checkbox"
                  checked={settings.allowAdmissionPhotoReplacement}
                  onChange={(event) =>
                    setSettings({ ...settings, allowAdmissionPhotoReplacement: event.target.checked })
                  }
                  className="mt-0.5 accent-current"
                />
                <span>開放更換入學時證件照</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-t1">
                <input
                  type="checkbox"
                  checked={settings.allowGraduationPhotoUpload}
                  onChange={(event) =>
                    setSettings({ ...settings, allowGraduationPhotoUpload: event.target.checked })
                  }
                  className="mt-0.5 accent-current"
                />
                <span>開放上傳或更換畢業證件照</span>
              </label>
            </fieldset>

            <div>
              <p className="text-xs text-t2 mb-2">開放填寫的起訖日期與時間（台北時間，配合上方開放設定）</p>
              <fieldset
                disabled={saving}
                aria-label="開放填寫的起訖日期"
                className="grid gap-3 sm:grid-cols-2"
              >
                <label className="space-y-1 text-xs text-t2">
                  <span className="block">起始日期時間</span>
                  <input
                    type="datetime-local"
                    value={settings.startDate}
                    onChange={(event) => setSettings({ ...settings, startDate: event.target.value })}
                    className="w-full input-theme rounded px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1 text-xs text-t2">
                  <span className="block">結束日期時間</span>
                  <input
                    type="datetime-local"
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
          </div>
        )}
      </details>
      <PersonalInfoResultDialog
        message={feedback?.message ?? null}
        kind={feedback?.kind ?? "success"}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}
