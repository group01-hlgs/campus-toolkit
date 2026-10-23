"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ACADEMIC_YEAR_MAX,
  ACADEMIC_YEAR_MIN,
  SEMESTER_OPTIONS,
  SemesterSettings,
  readSemesterSettings,
  validateSemesterSettings,
} from "@/types/school-semesters";
import Toast, { type ToastMessage } from "@/components/Toast";

type SemestersResponse = { success?: boolean; message?: string; settings?: unknown };

/**
 * 學期起訖設定編輯器（學校基本設定的子功能，危險區）。
 * 自行讀取與儲存 `GET/PUT /api/admin/school/semesters`（merge 部分更新）；
 * 沿用校務基本資料的 saved／draft 模式：還原與儲存共用同一份未儲存狀態。
 */
export default function SchoolSemesterSettingsEditor() {
  const [saved, setSaved] = useState<SemesterSettings | null>(null);
  const [draft, setDraft] = useState<SemesterSettings | null>(null);
  /** 學年度輸入框的暫存字串：允許清空後重打，失焦或輸入無效值時回復現值 */
  const [yearInput, setYearInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/school/semesters", { cache: "no-store" });
      const data: SemestersResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.settings) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      const settings = readSemesterSettings(data.settings);
      setSaved(settings);
      setDraft(settings);
      setYearInput(String(settings.academicYear));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validation = useMemo(() => (draft ? validateSemesterSettings(draft) : null), [draft]);
  const dirty = useMemo(() => {
    if (!saved || !draft) return false;
    return JSON.stringify(saved) !== JSON.stringify(draft);
  }, [saved, draft]);

  function changeYear(raw: string) {
    setYearInput(raw);
    if (!draft) return;
    setToast(null);
    const year = Number(raw);
    if (!Number.isInteger(year) || year < ACADEMIC_YEAR_MIN || year > ACADEMIC_YEAR_MAX) return;
    setDraft({ ...draft, academicYear: year });
  }

  function changeSemester(value: string) {
    if (!draft) return;
    setToast(null);
    setDraft({ ...draft, semester: Number(value) === 2 ? 2 : 1 });
  }

  function changeDate(
    field: "academicYearStart" | "academicYearEnd" | "semesterStart" | "semesterEnd",
    value: string
  ) {
    if (!draft) return;
    setToast(null);
    setDraft({ ...draft, [field]: value });
  }

  function reset() {
    if (!saved) return;
    setDraft(saved);
    setYearInput(String(saved.academicYear));
    setToast(null);
  }

  async function save() {
    if (!draft || !validation?.ok || saving) return;
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/admin/school/semesters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draft }),
      });
      const data: SemestersResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `儲存失敗（HTTP ${res.status}）`);
      }
      const settings = readSemesterSettings(data.settings ?? draft);
      setSaved(settings);
      setDraft(settings);
      setYearInput(String(settings.academicYear));
      setToast({ kind: "success", text: data.message || "學期起訖設定已儲存" });
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : "儲存失敗" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-t3 py-4">學期起訖設定載入中...</p>;
  }

  if (loadError) {
    return (
      <div className="alert-danger p-4 text-sm">
        <span className="font-bold text-danger">讀取失敗：</span>
        {loadError}
        <button
          type="button"
          onClick={() => void load()}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer mt-3 block"
        >
          重新讀取
        </button>
      </div>
    );
  }

  if (!draft || !validation) return null;

  return (
    <div className="mt-4">
      {/* 還原／儲存（危險區以紅鈕強調） */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={!dirty || saving}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            還原
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || !validation.ok || saving}
            className="btn-danger rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "儲存中..." : "儲存變更"}
          </button>
        </div>
      </div>

      {!validation.ok && (
        <p className="text-danger text-sm mb-2" role="alert">
          {validation.message}
        </p>
      )}
      <p className="text-xs text-t3 mb-3">
        {dirty ? "有尚未儲存的變更，記得按「儲存變更」。" : "已與伺服器同步。"}
      </p>

      {/* 學年度 */}
      <section className="border border-themed rounded-lg p-4 mb-4">
        <h4 className="font-bold text-t1">學年度</h4>
        <p className="text-sm text-t3 mt-1 mb-3">
          目前所屬的學年度（民國年）。此為全站的期間基準，名冊、個資、公告與行事曆等資料皆以它為鍵。
        </p>
        <label className="text-sm">
          <span className="block text-t2 mb-1">學年度</span>
          <input
            type="number"
            min={ACADEMIC_YEAR_MIN}
            max={ACADEMIC_YEAR_MAX}
            value={yearInput}
            onChange={(event) => changeYear(event.target.value)}
            placeholder="如：115"
            className="input-theme rounded px-3 py-2 text-sm w-full max-w-xs"
          />
        </label>
      </section>

      {/* 學年度起訖 */}
      <section className="border border-themed rounded-lg p-4 mb-4">
        <h4 className="font-bold text-t1">學年度起訖</h4>
        <p className="text-sm text-t3 mt-1 mb-3">
          本學年度的起日與訖日（可留空）。填寫時起日不得晚於訖日。
        </p>
        <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
          <label className="text-sm">
            <span className="block text-t2 mb-1">起日</span>
            <input
              type="date"
              value={draft.academicYearStart}
              onChange={(event) => changeDate("academicYearStart", event.target.value)}
              className="input-theme rounded px-3 py-2 text-sm w-full"
            />
          </label>
          <label className="text-sm">
            <span className="block text-t2 mb-1">訖日</span>
            <input
              type="date"
              value={draft.academicYearEnd}
              onChange={(event) => changeDate("academicYearEnd", event.target.value)}
              className="input-theme rounded px-3 py-2 text-sm w-full"
            />
          </label>
        </div>
      </section>

      {/* 學期 */}
      <section className="border border-themed rounded-lg p-4 mb-4">
        <h4 className="font-bold text-t1">學期</h4>
        <p className="text-sm text-t3 mt-1 mb-3">
          目前所屬的學期。同為全站的期間基準，變更後各資料頁會切換到該學期的資料。
        </p>
        <label className="text-sm">
          <span className="block text-t2 mb-1">學期</span>
          <select
            value={draft.semester}
            onChange={(event) => changeSemester(event.target.value)}
            className="input-theme rounded px-3 py-2 text-sm w-full max-w-xs"
          >
            {SEMESTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* 學期起訖 */}
      <section className="border border-themed rounded-lg p-4">
        <h4 className="font-bold text-t1">學期起訖</h4>
        <p className="text-sm text-t3 mt-1 mb-3">
          目前學期的起日與訖日（可留空）。填寫時起日不得晚於訖日。
        </p>
        <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
          <label className="text-sm">
            <span className="block text-t2 mb-1">起日</span>
            <input
              type="date"
              value={draft.semesterStart}
              onChange={(event) => changeDate("semesterStart", event.target.value)}
              className="input-theme rounded px-3 py-2 text-sm w-full"
            />
          </label>
          <label className="text-sm">
            <span className="block text-t2 mb-1">訖日</span>
            <input
              type="date"
              value={draft.semesterEnd}
              onChange={(event) => changeDate("semesterEnd", event.target.value)}
              className="input-theme rounded px-3 py-2 text-sm w-full"
            />
          </label>
        </div>
      </section>

      {/* 儲存遮罩：儲存期間覆蓋畫面、阻擋重複操作 */}
      {saving && <BlockingMask text="儲存中，請稍候…" />}

      {/* 儲存結果 Toast */}
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}

/** 全螢幕遮罩（儲存中）：淡入過場並擋住下方所有操作 */
function BlockingMask({ text }: { text: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
      role="status"
      aria-live="polite"
    >
      <svg
        className="w-10 h-10 animate-spin text-t2"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" d="M21 12a9 9 0 11-6.22-8.56" />
      </svg>
      <p className="text-sm text-t2">{text}</p>
    </div>
  );
}
