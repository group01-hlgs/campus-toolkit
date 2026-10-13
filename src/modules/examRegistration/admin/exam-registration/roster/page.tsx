"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  EXAM_FEE_CODE_LABELS,
  EXAM_REGISTRATION_MODE_LABELS,
  formatExamDateRange,
  resolveLocationLabel,
} from "../../../types/exam-registration";
import type { ExamEventRoster, ExamRegistration } from "../../../types/exam-registration";

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
            <p className="text-xs text-t3">以班級分頁檢視，匯出 CSV 已移至本頁。</p>
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
                <h3 className="text-base font-bold text-t1">{roster.event.title}</h3>
                <p className="text-xs text-t3">
                  應報名 {roster.summary.applicableCount} 人／完成報名 {roster.summary.registeredCount} 人；
                  {formatExamDateRange(roster.event)}・
                  {EXAM_REGISTRATION_MODE_LABELS[roster.event.registrationMode]}
                </p>
              </div>
              <a
                href={`/api/admin/exam-registration?eventId=${encodeURIComponent(roster.eventId)}&format=csv`}
                className="btn-soft rounded px-3 py-1 text-xs cursor-pointer"
                download
              >
                匯出 CSV
              </a>
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
