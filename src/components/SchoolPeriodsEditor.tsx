"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PERIODS_CODE_MAX,
  PERIODS_MAX_NUMBER,
  PERIODS_MAX_ROWS,
  PERIODS_MIN_NUMBER,
  PERIODS_NAME_MAX,
  SchoolPeriodRow,
  SchoolPeriodsSetting,
  readSchoolPeriods,
  validateSchoolPeriods,
} from "@/types/school-periods";
import Toast, { type ToastMessage } from "@/components/Toast";

type PeriodsResponse = { success?: boolean; message?: string; setting?: unknown };

/** 新增列的起點：代碼／名稱／時間留空、節次給 -1（必填，驗證會擋下） */
function blankRow(): SchoolPeriodRow {
  return { code: "", period: -1, name: "", start: "", end: "" };
}

/**
 * 課表作息時間編輯器（學校基本設定的子功能）。
 * 自行讀取與儲存 `GET/PUT /api/admin/school/periods`；
 * saved／draft 模式與其他子功能一致，未存變更可用「還原」放棄。
 */
export default function SchoolPeriodsEditor() {
  const [saved, setSaved] = useState<SchoolPeriodsSetting | null>(null);
  const [draft, setDraft] = useState<SchoolPeriodsSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/school/periods", { cache: "no-store" });
      const data: PeriodsResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.setting) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      const setting = readSchoolPeriods(data.setting);
      setSaved(setting);
      setDraft(setting);
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

  const validation = useMemo(() => (draft ? validateSchoolPeriods(draft) : null), [draft]);
  const dirty = useMemo(() => {
    if (!saved || !draft) return false;
    return JSON.stringify(saved) !== JSON.stringify(draft);
  }, [saved, draft]);

  function changeRow(index: number, patch: Partial<SchoolPeriodRow>) {
    if (!draft) return;
    setToast(null);
    setDraft({
      ...draft,
      periods: draft.periods.map((row, position) =>
        position === index ? { ...row, ...patch } : row
      ),
    });
  }

  function addRow() {
    if (!draft || draft.periods.length >= PERIODS_MAX_ROWS) return;
    setToast(null);
    setDraft({ ...draft, periods: [...draft.periods, blankRow()] });
  }

  function removeRow(index: number) {
    if (!draft) return;
    setToast(null);
    setDraft({ ...draft, periods: draft.periods.filter((_, position) => position !== index) });
  }

  function reset() {
    if (!saved) return;
    setDraft(saved);
    setToast(null);
  }

  async function save() {
    if (!draft || !validation?.ok || saving) return;
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/admin/school/periods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setting: draft }),
      });
      const data: PeriodsResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `儲存失敗（HTTP ${res.status}）`);
      }
      const setting = readSchoolPeriods(data.setting ?? draft);
      setSaved(setting);
      setDraft(setting);
      setToast({ kind: "success", text: data.message || "課表作息時間已儲存" });
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : "儲存失敗" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-t3 py-4">課表作息時間載入中...</p>;
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

  const validationBlock = !validation.ok ? (
    <p className="text-danger text-sm mb-2" role="alert">
      {validation.message}
    </p>
  ) : null;

  const saveButtons = (
    <div className="flex gap-2">
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
        className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "儲存中..." : "儲存變更"}
      </button>
    </div>
  );

  return (
    <div className="mt-4">
      <Toast message={toast} onClose={() => setToast(null)} />

      {/* 頂部：筆數與操作 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="text-sm text-t3">
          共 {draft.periods.length} 筆（上限 {PERIODS_MAX_ROWS} 筆）；預設為每日八節＋午休，可自行增修。
        </p>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={addRow}
            disabled={draft.periods.length >= PERIODS_MAX_ROWS}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            新增一列
          </button>
          {saveButtons}
        </div>
      </div>

      {validationBlock}
      <p className="text-xs text-t3 mb-3">
        {dirty ? "有尚未儲存的變更，記得按「儲存變更」。" : "已與伺服器同步。"}
      </p>

      {/* 節次表格（過寬時橫向捲動） */}
      <div className="border border-themed rounded-lg bg-card overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-themed">
            <tr>
              <th className="px-3 py-2 font-medium whitespace-nowrap">主要節次代碼</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">節次</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">節次名稱</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">開始時間</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">結束時間</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {draft.periods.length === 0 && (
              <tr className="border-b border-themed last:border-0">
                <td colSpan={6} className="px-3 py-4 text-t3 text-center">
                  目前沒有節次，按「新增一列」建立第一筆。
                </td>
              </tr>
            )}
            {draft.periods.map((row, index) => (
              <tr key={index} className="border-b border-themed last:border-0 text-t1">
                <td className="px-3 py-2">
                  <input
                    type="text"
                    maxLength={PERIODS_CODE_MAX}
                    value={row.code}
                    onChange={(event) => changeRow(index, { code: event.target.value })}
                    placeholder="P1"
                    aria-label={`第 ${index + 1} 筆主要節次代碼`}
                    className="input-theme rounded px-3 py-2 text-sm w-28"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={PERIODS_MIN_NUMBER}
                    max={PERIODS_MAX_NUMBER}
                    value={row.period < 0 ? "" : row.period}
                    onChange={(event) => {
                      const text = event.target.value.trim();
                      const parsed = text === "" ? NaN : Number(text);
                      changeRow(index, { period: Number.isInteger(parsed) ? parsed : -1 });
                    }}
                    placeholder="1"
                    aria-label={`第 ${index + 1} 筆節次`}
                    className="input-theme rounded px-3 py-2 text-sm w-20"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    maxLength={PERIODS_NAME_MAX}
                    value={row.name}
                    onChange={(event) => changeRow(index, { name: event.target.value })}
                    placeholder="第一節"
                    aria-label={`第 ${index + 1} 筆節次名稱`}
                    className="input-theme rounded px-3 py-2 text-sm w-36"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="time"
                    value={row.start}
                    onChange={(event) => changeRow(index, { start: event.target.value })}
                    aria-label={`第 ${index + 1} 筆開始時間`}
                    className="input-theme rounded px-3 py-2 text-sm w-32"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="time"
                    value={row.end}
                    onChange={(event) => changeRow(index, { end: event.target.value })}
                    aria-label={`第 ${index + 1} 筆結束時間`}
                    className="input-theme rounded px-3 py-2 text-sm w-32"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    disabled={saving}
                    className="text-sm text-danger cursor-pointer disabled:opacity-50"
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 表格較長時底部也有一組，避免捲到下方找不到儲存鈕與訊息 */}
      <div className="mt-4 pt-3 border-t border-themed">
        {validationBlock}
        <div className="flex justify-end">{saveButtons}</div>
      </div>
    </div>
  );
}
