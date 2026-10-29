"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Toast, { type ToastMessage } from "@/components/Toast";
import {
  CONFIRMATION_STATUS_LABELS,
  IDENTITY_WINDOW_LABELS,
  TAX_INQUIRY_STATUS_LABELS,
  formatDateTime,
  fromDateTimeLocal,
  toDateTimeLocal,
  type IdentityTaxInquirySettings,
  type IdentityWindowState,
  type InquiryRow,
  type InquiryStats,
} from "../../types/identity-tax-inquiry";

interface SettingsForm {
  enabled: boolean;
  openAt: string;
  closeAt: string;
  instructions: string;
  identityOptions: string[];
  taxInquiryIdentities: string[];
  requireParentId: boolean;
}

const EMPTY_STATS: InquiryStats = {
  total: 0,
  confirmed: 0,
  draft: 0,
  missing: 0,
  taxPending: 0,
  taxDone: 0,
  taxExempt: 0,
};

function formOf(settings: IdentityTaxInquirySettings): SettingsForm {
  return {
    enabled: settings.enabled,
    openAt: toDateTimeLocal(settings.openAt),
    closeAt: toDateTimeLocal(settings.closeAt),
    instructions: settings.instructions,
    identityOptions: [...settings.identityOptions],
    taxInquiryIdentities: [...settings.taxInquiryIdentities],
    requireParentId: settings.requireParentId,
  };
}

const PAGE_SIZE = 20;

export default function IdentityTaxInquiryAdminPage() {
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [stats, setStats] = useState<InquiryStats>(EMPTY_STATS);
  const [period, setPeriod] = useState("");
  const [windowState, setWindowState] = useState<IdentityWindowState>("unset");
  const [rows, setRows] = useState<InquiryRow[] | null>(null);
  const [classCode, setClassCode] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optionInput, setOptionInput] = useState("");
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const applyPayload = useCallback(
    (data: {
      settings?: IdentityTaxInquirySettings;
      stats?: InquiryStats;
      period?: string;
      windowState?: IdentityWindowState;
      rows?: InquiryRow[];
    }) => {
      if (data.settings) setForm(formOf(data.settings));
      if (data.stats) setStats(data.stats);
      if (typeof data.period === "string") setPeriod(data.period);
      if (data.windowState) setWindowState(data.windowState);
      if (Array.isArray(data.rows)) {
        setRows(data.rows);
        setPage(1);
      }
    },
    []
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/identity-tax-inquiry", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "讀取設定失敗" });
        return;
      }
      applyPayload(data);
    } catch {
      setToast({ kind: "error", text: "讀取設定失敗" });
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadRows = useCallback(async () => {
    try {
      const query = new URLSearchParams({ mode: "records" });
      if (classCode.trim()) query.set("classCode", classCode.trim());
      const response = await fetch(`/api/admin/identity-tax-inquiry?${query.toString()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "讀取名冊失敗" });
        return;
      }
      applyPayload(data);
    } catch {
      setToast({ kind: "error", text: "讀取名冊失敗" });
    }
  }, [applyPayload, classCode]);

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/identity-tax-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: form.enabled,
          openAt: fromDateTimeLocal(form.openAt),
          closeAt: fromDateTimeLocal(form.closeAt),
          instructions: form.instructions,
          identityOptions: form.identityOptions,
          taxInquiryIdentities: form.taxInquiryIdentities,
          requireParentId: form.requireParentId,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "儲存失敗" });
        return;
      }
      applyPayload(data);
      setToast({ kind: "success", text: data.message || "已儲存設定" });
    } catch {
      setToast({ kind: "error", text: "儲存失敗" });
    } finally {
      setSaving(false);
    }
  };

  const addOption = () => {
    if (!form) return;
    const text = optionInput.trim().slice(0, 20);
    if (!text) return;
    if (form.identityOptions.includes(text)) {
      setToast({ kind: "error", text: "身分別已存在" });
      return;
    }
    setForm({ ...form, identityOptions: [...form.identityOptions, text] });
    setOptionInput("");
  };

  const removeOption = (value: string) => {
    if (!form) return;
    setForm({
      ...form,
      identityOptions: form.identityOptions.filter((item) => item !== value),
      taxInquiryIdentities: form.taxInquiryIdentities.filter((item) => item !== value),
    });
  };

  const toggleTax = (value: string, checked: boolean) => {
    if (!form) return;
    setForm({
      ...form,
      taxInquiryIdentities: checked
        ? [...new Set([...form.taxInquiryIdentities, value])]
        : form.taxInquiryIdentities.filter((item) => item !== value),
    });
  };

  const pageCount = useMemo(() => {
    if (!rows) return 0;
    return Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  }, [rows]);

  const pageRows = useMemo(() => {
    if (!rows) return [];
    return rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }, [rows, page]);

  if (loading) {
    return <p className="text-t2 p-4 text-sm">載入中…</p>;
  }
  if (!form) {
    return <p className="text-danger p-4 text-sm">無法載入設定，請重新整理。</p>;
  }

  return (
    <div className="space-y-4">
      <Toast message={toast} onClose={() => setToast(null)} />

      <section className="border border-themed bg-card rounded-lg p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-t1 text-lg font-semibold">管理規則</h2>
          <span className="text-t3 text-xs">{period ? `${period} 學期` : ""}</span>
        </div>

        <div className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            <span>
              <span className="text-t1 block font-medium">啟用本功能</span>
              <span className="text-t3 block text-xs">
                關閉後學生／教職員／家長端只顯示維護說明，資料仍保留。
              </span>
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-t2 mb-1 block">確認開放時間</span>
              <input
                type="datetime-local"
                className="input-theme w-full rounded px-3 py-2"
                value={form.openAt}
                onChange={(event) => setForm({ ...form, openAt: event.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="text-t2 mb-1 block">確認截止時間</span>
              <input
                type="datetime-local"
                className="input-theme w-full rounded px-3 py-2"
                value={form.closeAt}
                onChange={(event) => setForm({ ...form, closeAt: event.target.value })}
              />
            </label>
          </div>
          <p className="text-t3 text-xs">
            目前狀態：{IDENTITY_WINDOW_LABELS[windowState]}（未設定開放時間＝學生端唯讀）
          </p>

          <div>
            <p className="text-t2 mb-2 text-sm font-medium">身分別選項</p>
            <div className="flex flex-wrap gap-2">
              {form.identityOptions.map((option) => (
                <span
                  key={option}
                  className="border-themed bg-surface text-t1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                >
                  {option}
                  <button
                    type="button"
                    className="text-danger"
                    aria-label={`移除 ${option}`}
                    onClick={() => removeOption(option)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {form.identityOptions.length === 0 && (
                <span className="text-t3 text-xs">尚未設定，至少需要一個。</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="input-theme min-w-40 flex-1 rounded px-3 py-2 text-sm"
                placeholder="新增身分別（例：僑生）"
                value={optionInput}
                maxLength={20}
                onChange={(event) => setOptionInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addOption();
                  }
                }}
              />
              <button type="button" className="btn-theme rounded px-3 py-2 text-sm" onClick={addOption}>
                新增
              </button>
            </div>
          </div>

          <div>
            <p className="text-t2 mb-2 text-sm font-medium">需要財稅查調的身分別</p>
            <div className="flex flex-wrap gap-3">
              {form.identityOptions.map((option) => (
                <label key={option} className="text-t1 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.taxInquiryIdentities.includes(option)}
                    onChange={(event) => toggleTax(option, event.target.checked)}
                  />
                  {option}
                </label>
              ))}
            </div>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.requireParentId}
                onChange={(event) => setForm({ ...form, requireParentId: event.target.checked })}
              />
              <span>
                <span className="text-t1 block font-medium">查調時必填父或母身分證字號</span>
                <span className="text-t3 block text-xs">
                  取消勾選時，學生仍可自行填寫，但不會強制。
                </span>
              </span>
            </label>
          </div>

          <label className="block text-sm">
            <span className="text-t2 mb-1 block">實施說明</span>
            <textarea
              className="input-theme min-h-28 w-full rounded px-3 py-2"
              value={form.instructions}
              maxLength={5000}
              placeholder="提供給學生與家長閱讀的說明（純文字）"
              onChange={(event) => setForm({ ...form, instructions: event.target.value })}
            />
          </label>

          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary rounded px-4 py-2 text-sm disabled:opacity-50"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "儲存中…" : "儲存設定"}
            </button>
          </div>
        </div>
      </section>

      <section className="border border-themed bg-card rounded-lg p-4">
        <h2 className="text-t1 mb-3 text-lg font-semibold">確認進度</h2>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {[
            ["應確認", stats.total],
            ["已確認", stats.confirmed],
            ["草稿", stats.draft],
            ["未填寫", stats.missing],
            ["待查調", stats.taxPending],
            ["已查調", stats.taxDone],
            ["免查調", stats.taxExempt],
          ].map(([label, value]) => (
            <div key={String(label)} className="border-themed bg-surface rounded-md border px-3 py-2">
              <p className="text-t3 text-xs">{label}</p>
              <p className="text-t1 text-lg font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border border-themed bg-card rounded-lg p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-t1 text-lg font-semibold">確認名冊</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="text-t2 mb-1 block text-xs">班級代碼（可留空＝全部）</span>
              <input
                className="input-theme w-40 rounded px-3 py-2 text-sm"
                value={classCode}
                onChange={(event) => setClassCode(event.target.value)}
                placeholder="例：301"
              />
            </label>
            <button type="button" className="btn-theme rounded px-3 py-2 text-sm" onClick={() => void loadRows()}>
              載入名冊
            </button>
            <a
              className="btn-primary rounded px-3 py-2 text-sm"
              href={`/api/admin/identity-tax-inquiry?format=csv${
                classCode.trim() ? `&classCode=${encodeURIComponent(classCode.trim())}` : ""
              }`}
            >
              匯出查調名冊
            </a>
          </div>
        </div>

        {!rows ? (
          <p className="text-t3 text-sm">尚未載入名冊。</p>
        ) : rows.length === 0 ? (
          <p className="text-t3 text-sm">目前沒有資料。</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="bg-surface text-t2">
                    <th className="border border-themed px-2 py-2 text-left">班級</th>
                    <th className="border border-themed px-2 py-2 text-left">座號</th>
                    <th className="border border-themed px-2 py-2 text-left">姓名</th>
                    <th className="border border-themed px-2 py-2 text-left">註冊身分</th>
                    <th className="border border-themed px-2 py-2 text-left">確認</th>
                    <th className="border border-themed px-2 py-2 text-left">財稅查調</th>
                    <th className="border border-themed px-2 py-2 text-left">更新</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.studentUid}>
                      <td className="border border-themed px-2 py-2">{row.className || row.classCode}</td>
                      <td className="border border-themed px-2 py-2">{row.seatNo || "—"}</td>
                      <td className="border border-themed text-t1 px-2 py-2">{row.studentName || "—"}</td>
                      <td className="border border-themed px-2 py-2">
                        {row.identities.length ? row.identities.join("、") : "—"}
                      </td>
                      <td className="border border-themed px-2 py-2">
                        {row.status === "missing" ? "未填寫" : CONFIRMATION_STATUS_LABELS[row.status]}
                      </td>
                      <td className="border border-themed px-2 py-2">
                        {TAX_INQUIRY_STATUS_LABELS[row.taxInquiry.status]}
                      </td>
                      <td className="border border-themed px-2 py-2 text-xs">
                        {formatDateTime(row.updatedAt || null)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-t3">
                共 {rows.length} 筆，第 {page} / {pageCount} 頁
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-theme rounded px-3 py-1 text-xs disabled:opacity-50"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  上一頁
                </button>
                <button
                  type="button"
                  className="btn-theme rounded px-3 py-1 text-xs disabled:opacity-50"
                  disabled={page >= pageCount}
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                >
                  下一頁
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
