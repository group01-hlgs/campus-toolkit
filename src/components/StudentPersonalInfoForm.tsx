"use client";

import { useCallback, useEffect, useState } from "react";
import PersonalInfoResultDialog from "@/components/PersonalInfoResultDialog";
import {
  EMPTY_STUDENT_PERSONAL_INFO,
  STUDENT_PERSONAL_INFO_FIELD_DEFS,
  type StudentPersonalInfoFields,
} from "@/types/personal-info";

interface StudentPersonalInfoResponse {
  success?: boolean;
  message?: string;
  fields?: StudentPersonalInfoFields;
  canEdit?: boolean;
  period?: { academicYear: number; semester: number };
}

export default function StudentPersonalInfoForm({
  academicYear,
  semester,
}: {
  academicYear: number;
  semester: number;
}) {
  const [fields, setFields] = useState<StudentPersonalInfoFields>({ ...EMPTY_STUDENT_PERSONAL_INFO });
  const [canEdit, setCanEdit] = useState(false);
  const [activePeriod, setActivePeriod] = useState({ academicYear, semester });
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const loadFields = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/student/personal-info", { cache: "no-store" });
      const data: StudentPersonalInfoResponse = await response.json();
      if (!response.ok || !data.success || !data.fields) {
        throw new Error(data.message || "讀取本學期個人資料失敗");
      }
      setFields(data.fields);
      setCanEdit(data.canEdit === true);
      setAvailabilityMessage(data.message || "");
      if (data.period) setActivePeriod(data.period);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "讀取本學期個人資料失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFields();
  }, [loadFields]);

  async function saveFields() {
    if (saving || !canEdit) return;
    setSaving(true);
    try {
      const response = await fetch("/api/student/personal-info", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const data: StudentPersonalInfoResponse = await response.json();
      if (!response.ok || !data.success || !data.fields) {
        throw new Error(data.message || "儲存個人資料失敗");
      }
      setFields(data.fields);
      setFeedback({ kind: "success", message: data.message || "個人資料已儲存。" });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "儲存個人資料失敗",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="mt-4 border border-themed rounded-lg bg-card p-5 sm:p-7">
        <header className="mb-4 border-b border-themed pb-3">
          <h3 className="text-lg font-bold text-t1">本學期個人資料</h3>
          <p className="text-xs text-t3 mt-1">
            {activePeriod.academicYear} 學年度第 {activePeriod.semester} 學期；資料僅供本人查看與填寫。
          </p>
        </header>

        {loading ? (
          <p className="text-sm text-t3" role="status">載入個人資料中…</p>
        ) : loadError ? (
          <div className="space-y-3" role="alert">
            <p className="text-sm text-danger">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadFields()}
              className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
            >
              重新載入
            </button>
          </div>
        ) : (
          <>
            <p className={`mb-4 text-sm ${canEdit ? "text-success" : "text-t2"}`} role="status">
              {availabilityMessage}
            </p>
            {canEdit ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {STUDENT_PERSONAL_INFO_FIELD_DEFS.map((field) => (
                  <label
                    key={field.key}
                    className={`block space-y-1 text-sm text-t2 ${field.type === "textarea" ? "sm:col-span-2" : ""}`}
                  >
                    <span>{field.label}</span>
                    {field.type === "select" ? (
                      <select
                        value={fields[field.key]}
                        onChange={(event) => setFields({ ...fields, [field.key]: event.target.value })}
                        className="w-full input-theme rounded px-3 py-2 text-sm"
                      >
                        <option value="">請選擇</option>
                        {field.options?.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : field.type === "textarea" ? (
                      <textarea
                        value={fields[field.key]}
                        onChange={(event) => setFields({ ...fields, [field.key]: event.target.value })}
                        maxLength={field.maxLength}
                        rows={2}
                        className="w-full input-theme rounded px-3 py-2 text-sm"
                      />
                    ) : (
                      <input
                        type={field.type}
                        value={fields[field.key]}
                        onChange={(event) => setFields({ ...fields, [field.key]: event.target.value })}
                        maxLength={field.maxLength}
                        className="w-full input-theme rounded px-3 py-2 text-sm"
                      />
                    )}
                  </label>
                ))}
                <div className="sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveFields()}
                    disabled={saving}
                    className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                  >
                    {saving ? "儲存中…" : "儲存個人資料"}
                  </button>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                {STUDENT_PERSONAL_INFO_FIELD_DEFS.map((field) => (
                  <div key={field.key} className="border-b border-themed py-3">
                    <dt className="text-xs text-t3">{field.label}</dt>
                    <dd className="text-sm text-t1 mt-1 whitespace-pre-wrap break-words">
                      {fields[field.key].trim() || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </>
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
