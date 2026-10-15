"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import OfficialExamLabel from "../../../components/official-exam-label";
import {
  EXAM_REGISTRATION_NUMBER_FIELDS,
  EXAM_FEE_CODE_LABELS,
  EXAM_REGISTRATION_MODE_LABELS,
  formatExamDateRange,
  resolveLocationLabel,
} from "../../../types/exam-registration";
import type {
  ExamEventRoster,
  ExamRegistration,
  ExamRegistrationNumberField,
} from "../../../types/exam-registration";

interface AdminRosterResponse {
  success?: boolean;
  message?: string;
  roster?: ExamEventRoster;
}

function formatListDateTime(value: number): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classKeyOf(row: ExamRegistration): string {
  return row.studentClass || "__no_class__";
}

function classLabelOf(code: string): string {
  return code === "__no_class__" ? "未填班級" : code;
}

export default function ExamRegistrationRosterPage() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [roster, setRoster] = useState<ExamEventRoster | null>(null);
  const [activeClass, setActiveClass] = useState("");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportScope, setExportScope] = useState("");
  const [schoolExamCode, setSchoolExamCode] = useState("");
  const [registrationNumberField, setRegistrationNumberField] = useState<ExamRegistrationNumberField>("rollNo");

  const loadRoster = useCallback(async () => {
    if (!eventId) {
      setRoster(null);
      setError("缺少場次 id");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/exam-registration?eventId=${encodeURIComponent(eventId)}`, {
        cache: "no-store",
      });
      const data: AdminRosterResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.roster) {
        throw new Error(data?.message || "載入名單失敗");
      }
      setRoster(data.roster);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入名單失敗");
      setRoster(null);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const classTabs = useMemo(() => {
    if (!roster) return [] as Array<{ key: string; label: string; count: number }>;
    const entries = Object.entries(roster.summary.byClass)
      .map(([classCode, count]) => ({
        key: classCode || "__no_class__",
        label: classLabelOf(classCode || "__no_class__"),
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-Hant", { numeric: true }));
    return entries;
  }, [roster]);

  useEffect(() => {
    if (!classTabs.length) {
      setActiveClass("");
      return;
    }
    if (!activeClass || !classTabs.some((item) => item.key === activeClass)) {
      setActiveClass(classTabs[0].key);
    }
  }, [activeClass, classTabs]);

  const classOptions = useMemo(() => {
    if (!roster) return [] as string[];
    const codes = new Set<string>();
    roster.event.target.classes.forEach((code) => {
      if (code) codes.add(code);
    });
    Object.keys(roster.summary.byClass).forEach((code) => {
      if (code) codes.add(code);
    });
    return Array.from(codes).sort((a, b) => a.localeCompare(b, "zh-Hant", { numeric: true }));
  }, [roster]);

  useEffect(() => {
    if (!classOptions.length) {
      setExportFrom("");
      setExportTo("");
      return;
    }
    if (!classOptions.includes(exportFrom)) setExportFrom(classOptions[0]);
    if (!classOptions.includes(exportTo)) setExportTo(classOptions[classOptions.length - 1]);
  }, [classOptions, exportFrom, exportTo]);

  async function downloadScopeXlsx(scope: string, includeRegistrationNumber = false) {
    if (!roster) return;
    const params = new URLSearchParams({
      eventId: roster.eventId,
      format: includeRegistrationNumber ? "official-xlsx" : "xlsx",
      scope,
      from: exportFrom,
      to: exportTo,
    });
    if (includeRegistrationNumber) {
      const code = schoolExamCode.trim();
      if (!code) {
        setError("請輸入學校升學代碼");
        return;
      }
      params.set("schoolExamCode", code);
      params.set("registrationNumberField", registrationNumberField);
    }
    try {
      setError("");
      const res = await fetch(`/api/admin/exam-registration?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const data: AdminRosterResponse | null = await res.json().catch(() => null);
        throw new Error(data?.message || "下載名單失敗");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      const filename = match ? decodeURIComponent(match[1]) : "名單.xlsx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "下載名單失敗");
    }
  }

  const filteredRows = useMemo(() => {
    if (!roster || !activeClass) return [] as ExamRegistration[];
    return roster.registrations.filter((row) => classKeyOf(row) === activeClass);
  }, [roster, activeClass]);

  async function unarchiveRegistration(studentUid: string) {
    if (!roster || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/exam-registration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: roster.eventId, registrationId: studentUid, unarchive: true }),
      });
      const data: AdminRosterResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "解除封存失敗");
      }
      await loadRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "解除封存失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-4xl mb-8 space-y-4">
      <section className="border border-themed rounded-lg bg-card px-5 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-t1">查看名單</h2>
            <p className="text-xs text-t3">以班級分頁檢視，匯出檔案請使用下方「資料整理」。</p>
          </div>
          <a href="/admin/exam-registration" className="btn-soft rounded px-3 py-1 text-xs cursor-pointer">
            返回場次清單
          </a>
        </div>

        {loading ? <p className="text-sm text-t2">載入中…</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {roster && !loading ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-t1">
                  {roster.event.title}
                  <OfficialExamLabel title={roster.event.title} />
                </h3>
                <p className="text-xs text-t3">
                  應報名 {roster.summary.applicableCount} 人／完成報名 {roster.summary.registeredCount} 人；
                  {formatExamDateRange(roster.event)}・
                  {EXAM_REGISTRATION_MODE_LABELS[roster.event.registrationMode]}
                </p>
              </div>
            </div>

            <div className="border border-themed rounded-lg p-4 space-y-3">
              <div>
                <h4 className="text-sm font-bold text-t1">資料整理</h4>
                <p className="text-xs text-t3">設定班級範圍與名單類型，產生報名資料檔。</p>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                  <span className="block text-xs text-t2">起始班級</span>
                  <select
                    value={exportFrom}
                    onChange={(event) => setExportFrom(event.target.value)}
                    disabled={!classOptions.length}
                    className="input-theme rounded px-3 py-2 text-sm cursor-pointer disabled:opacity-50"
                  >
                    {classOptions.length ? (
                      classOptions.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))
                    ) : (
                      <option value="">（尚無班級）</option>
                    )}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block text-xs text-t2">結束班級</span>
                  <select
                    value={exportTo}
                    onChange={(event) => setExportTo(event.target.value)}
                    disabled={!classOptions.length}
                    className="input-theme rounded px-3 py-2 text-sm cursor-pointer disabled:opacity-50"
                  >
                    {classOptions.length ? (
                      classOptions.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))
                    ) : (
                      <option value="">（尚無班級）</option>
                    )}
                  </select>
                </label>
                <span className="text-t3 self-end pb-2.5">/</span>
                <label className="space-y-1">
                  <span className="block text-xs text-t2">名單類型</span>
                  <select
                    value={exportScope}
                    onChange={(event) => {
                      const scope = event.target.value;
                      setExportScope(scope);
                      if (!scope) return;
                      void downloadScopeXlsx(scope).finally(() => setExportScope(""));
                    }}
                    className="input-theme rounded px-3 py-2 text-sm cursor-pointer"
                  >
                    <option value="">請選擇報表</option>
                    <option value="all">全部情形名單</option>
                    <option value="registered">完成報名名單</option>
                    <option value="pending">未完成報名名單</option>
                  </select>
                </label>
                <span className="text-t3 self-end pb-2.5">/</span>
                <label className="space-y-1">
                  <span className="block text-xs text-t2">學校升學代碼</span>
                  <input
                    type="text"
                    size={6}
                    value={schoolExamCode}
                    onChange={(event) => setSchoolExamCode(event.target.value)}
                    className="input-theme rounded px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs text-t2">報名序號欄位</span>
                  <select
                    value={registrationNumberField}
                    onChange={(event) => setRegistrationNumberField(event.target.value as ExamRegistrationNumberField)}
                    className="input-theme rounded px-3 py-2 text-sm cursor-pointer"
                  >
                    {EXAM_REGISTRATION_NUMBER_FIELDS.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void downloadScopeXlsx("registered", true)}
                  className="btn-theme rounded px-3 py-1.5 text-sm cursor-pointer"
                >
                  報名資料檔
                </button>
              </div>
              <p className="text-xs text-t3">
                官方報名序號＝學校升學代碼＋所選學生名冊欄位；例如 931＋班號 30101＝93130101。
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {classTabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveClass(item.key)}
                  className={`rounded border px-3 py-1 text-xs cursor-pointer ${
                    activeClass === item.key
                      ? "border-primary text-primary bg-themed"
                      : "border-themed text-t2 hover:text-t1"
                  }`}
                >
                  {item.label}（{item.count}）
                </button>
              ))}
            </div>

            <div className="overflow-x-auto border border-themed rounded">
              <table className="w-full text-sm text-left">
                <thead className="border-b border-themed">
                  <tr className="text-t2">
                    <th className="px-3 py-2 font-medium">班級</th>
                    <th className="px-3 py-2 font-medium">座號</th>
                    <th className="px-3 py-2 font-medium">姓名</th>
                    <th className="px-3 py-2 font-medium">報名情形</th>
                    <th className="px-3 py-2 font-medium">選考科目</th>
                    {roster.event.locationOptions?.length ? (
                      <th className="px-3 py-2 font-medium">試場</th>
                    ) : null}
                    <th className="px-3 py-2 font-medium">繳費</th>
                    <th className="px-3 py-2 font-medium">更新時間</th>
                    <th className="px-3 py-2 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8 + (roster.event.locationOptions?.length ? 1 : 0)}
                        className="px-3 py-6 text-center text-t3"
                      >
                        此班級尚無學生登錄
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      const labels = row.optOut
                        ? []
                        : roster.event.subjects
                            .filter((subject) => row.subjectKeys.includes(subject.key))
                            .map((subject) => {
                              const selectedCode = row.subjectAdvancedOptionCodes?.[subject.key] ?? "";
                              const selectedLabel =
                                selectedCode && subject.advancedOptions?.length
                                  ? subject.advancedOptions.find((option) => option.code === selectedCode)?.label ?? selectedCode
                                  : "";
                              return selectedLabel ? `${subject.label}（${selectedLabel}）` : subject.label;
                            });
                      return (
                        <tr key={row.id} className="border-b border-themed last:border-0 text-t1">
                          <td className="px-3 py-2 whitespace-nowrap">{row.studentClass || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-t2">{row.seatNo || "—"}</td>
                          <td className="px-3 py-2">
                            {row.studentName}
                            {row.archived && <span className="ml-1.5 text-xs text-t3">（已封存）</span>}
                          </td>
                          <td className="px-3 py-2">
                            {row.optOut ? (
                              <span className="text-xs text-t2" title={row.optOutReason}>
                                不報名
                              </span>
                            ) : (
                              <span className="text-xs text-success">完成報名</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-t2">{row.optOut ? "—" : labels.join("、") || "—"}</td>
                          {roster.event.locationOptions?.length ? (
                            <td className="px-3 py-2 text-t2 whitespace-nowrap">
                              {row.optOut || !row.locationCode
                                ? "—"
                                : resolveLocationLabel(roster.event.locationOptions, row.locationCode)}
                            </td>
                          ) : null}
                          <td className="px-3 py-2 text-t2 whitespace-nowrap">
                            {row.optOut
                              ? "—"
                              : `${EXAM_FEE_CODE_LABELS[row.feeCode] ?? row.feeCode} ${row.feeAmount} 元`}
                          </td>
                          <td className="px-3 py-2 text-t3 whitespace-nowrap">{formatListDateTime(row.updatedAt)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {row.archived ? (
                              <button
                                type="button"
                                onClick={() => void unarchiveRegistration(row.studentUid)}
                                disabled={saving}
                                className="btn-soft rounded px-2 py-1 text-xs cursor-pointer disabled:opacity-50"
                              >
                                解除封存
                              </button>
                            ) : (
                              <span className="text-xs text-t3">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
