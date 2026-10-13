"use client";

import { useCallback, useEffect, useState } from "react";
import PersonalInfoResultDialog from "@/components/PersonalInfoResultDialog";
import {
  EMPTY_STUDENT_PERSONAL_IDENTITY,
  EMPTY_STUDENT_PERSONAL_INFO_TERM,
  STUDENT_PERSONAL_PHOTO_SOURCE_MAX_BYTES,
  STUDENT_PERSONAL_PHOTO_STORED_MAX_BYTES,
  STUDENT_PERSONAL_GENDER_OPTIONS,
  STUDENT_PERSONAL_IDENTITY_FIELD_DEFS,
  STUDENT_PERSONAL_ID_TYPE_OPTIONS,
  STUDENT_PERSONAL_INFO_TERM_FIELD_DEFS,
  validateStudentPersonalId,
  type StudentPersonalPhotoKind,
  type StudentPersonalIdentityFields,
  type StudentPersonalInfoTermFields,
} from "@/types/personal-info";
import type { PostalCodeOption } from "@/types/postal-codes";
import { prepareStudentPhotoFile } from "@/lib/photo-downscale";

interface StudentPersonalInfoResponse {
  success?: boolean;
  message?: string;
  entries?: StudentPersonalInfoEntry[];
  identity?: StudentPersonalIdentityFields;
  photoPermissions?: Record<StudentPersonalPhotoKind, boolean>;
  postalCodeOptions?: PostalCodeOption[];
  canEdit?: boolean;
  period?: { academicYear: number; semester: number };
}

interface StudentPersonalInfoEntry {
  academicYear: number;
  semester: number;
  fields: StudentPersonalInfoTermFields;
  photos: Record<StudentPersonalPhotoKind, { updatedAt: number } | null>;
}

interface SavePersonalInfoResponse {
  success?: boolean;
  message?: string;
  fields?: StudentPersonalInfoTermFields;
}

interface SaveIdentityResponse {
  success?: boolean;
  message?: string;
  identity?: StudentPersonalIdentityFields;
}

export default function StudentPersonalInfoForm({
  academicYear,
  semester,
}: {
  academicYear: number;
  semester: number;
}) {
  const [identity, setIdentity] = useState<StudentPersonalIdentityFields>({ ...EMPTY_STUDENT_PERSONAL_IDENTITY });
  const [fields, setFields] = useState<StudentPersonalInfoTermFields>({ ...EMPTY_STUDENT_PERSONAL_INFO_TERM });
  const [previousEntries, setPreviousEntries] = useState<StudentPersonalInfoEntry[]>([]);
  const [expandedPeriods, setExpandedPeriods] = useState<string[]>([]);
  const [photos, setPhotos] = useState<Record<StudentPersonalPhotoKind, { updatedAt: number } | null>>({
    admission: null,
    graduation: null,
  });
  const [photoPermissions, setPhotoPermissions] = useState<Record<StudentPersonalPhotoKind, boolean>>({
    admission: false,
    graduation: false,
  });
  const [uploadingPhoto, setUploadingPhoto] = useState<StudentPersonalPhotoKind | null>(null);
  const [postalCodeOptions, setPostalCodeOptions] = useState<PostalCodeOption[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [activePeriod, setActivePeriod] = useState({ academicYear, semester });
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const loadFields = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/student/personal-info", { cache: "no-store" });
      const data: StudentPersonalInfoResponse = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.entries) || !data.period) {
        throw new Error(data.message || "讀取本學期個人資料失敗");
      }
      const currentEntry = data.entries.find(
        (entry) => entry.academicYear === data.period!.academicYear && entry.semester === data.period!.semester
      );
      setPreviousEntries(
        data.entries.filter(
          (entry) => entry.academicYear !== data.period!.academicYear || entry.semester !== data.period!.semester
        )
      );
      setExpandedPeriods([]);
      setIdentity(data.identity ?? { ...EMPTY_STUDENT_PERSONAL_IDENTITY });
      setFields(currentEntry?.fields ?? { ...EMPTY_STUDENT_PERSONAL_INFO_TERM });
      setPhotos({
        admission: currentEntry?.photos.admission ? { updatedAt: currentEntry.photos.admission.updatedAt } : null,
        graduation: currentEntry?.photos.graduation ? { updatedAt: currentEntry.photos.graduation.updatedAt } : null,
      });
      setPhotoPermissions(data.photoPermissions ?? { admission: false, graduation: false });
      setPostalCodeOptions(data.postalCodeOptions ?? []);
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
      const data: SavePersonalInfoResponse = await response.json();
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

  async function saveIdentity() {
    if (savingIdentity || !canEdit) return;
    const idValidation = validateStudentPersonalId(identity.idType, identity.nationalId);
    if (!idValidation.ok) {
      setFeedback({ kind: "error", message: idValidation.message });
      return;
    }
    setSavingIdentity(true);
    try {
      const response = await fetch("/api/student/personal-info", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity }),
      });
      const data: SaveIdentityResponse = await response.json();
      if (!response.ok || !data.success || !data.identity) {
        throw new Error(data.message || "儲存固定個人資料失敗");
      }
      setIdentity(data.identity);
      setFeedback({ kind: "success", message: data.message || "固定個人資料已儲存。" });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "儲存固定個人資料失敗",
      });
    } finally {
      setSavingIdentity(false);
    }
  }

  async function uploadPhoto(kind: StudentPersonalPhotoKind, file: File) {
    if (!photoPermissions[kind] || uploadingPhoto) return;
    if (file.size <= 0 || file.size > STUDENT_PERSONAL_PHOTO_SOURCE_MAX_BYTES) {
      setFeedback({ kind: "error", message: "照片不可為空，且原始檔不可超過 20 MB。" });
      return;
    }

    setUploadingPhoto(kind);
    try {
      // 學生常直接選照相館原檔：先在瀏覽器縮圖，避免超過 Firestore 的實存上限
      const prepared = await prepareStudentPhotoFile(file, STUDENT_PERSONAL_PHOTO_STORED_MAX_BYTES);
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", prepared);
      const response = await fetch("/api/student/personal-info/photo", {
        method: "POST",
        body: form,
      });
      const data: { success?: boolean; message?: string; photo?: { updatedAt: number } } =
        await response.json();
      if (!response.ok || !data.success || !data.photo) {
        throw new Error(data.message || "上傳證件照失敗");
      }
      setPhotos((current) => ({ ...current, [kind]: data.photo! }));
      setFeedback({ kind: "success", message: data.message || "證件照已上傳。" });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "上傳證件照失敗",
      });
    } finally {
      setUploadingPhoto(null);
    }
  }

  function onTogglePeriod(key: string, isOpen: boolean) {
    setExpandedPeriods((current) => {
      if (isOpen) return current.includes(key) ? current : [...current, key];
      return current.filter((item) => item !== key);
    });
  }

  const periodRows = [
    ...previousEntries.map((entry) => ({
      key: `${entry.academicYear}_${entry.semester}`,
      academicYear: entry.academicYear,
      semester: entry.semester,
      fields: entry.fields,
      isCurrent: false,
    })),
    {
      key: `${activePeriod.academicYear}_${activePeriod.semester}`,
      academicYear: activePeriod.academicYear,
      semester: activePeriod.semester,
      fields,
      isCurrent: true,
    },
  ].sort((a, b) => b.academicYear - a.academicYear || b.semester - a.semester);

  const idValidation = validateStudentPersonalId(identity.idType, identity.nationalId);
  const showIdError = (Boolean(identity.idType) || Boolean(identity.nationalId)) && !idValidation.ok;

  return (
    <>
      {!loading && !loadError && (
        <details className="group/card mt-4 border border-themed rounded-lg bg-card">
          <summary className="cursor-pointer list-none px-5 sm:px-7 py-5 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-t1">基礎資料</h3>
            <Chevron card />
          </summary>
          <div className="px-5 sm:px-7 pb-5">
            <p className="mb-4 border-b border-themed pb-3 text-xs text-t3">
              性別、生日與證件資訊跨學期共用，不會因年度或學期改變。
            </p>
            {canEdit ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1 text-sm text-t2">
                  <span>性別</span>
                  <select
                    value={identity.gender}
                    onChange={(event) => setIdentity({ ...identity, gender: event.target.value })}
                    className="w-full input-theme rounded px-3 py-2 text-sm"
                  >
                    <option value="">請選擇</option>
                    {STUDENT_PERSONAL_GENDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-sm text-t2">
                  <span>生日</span>
                  <input
                    type="date"
                    value={identity.birthday}
                    onChange={(event) => setIdentity({ ...identity, birthday: event.target.value })}
                    maxLength={10}
                    className="w-full input-theme rounded px-3 py-2 text-sm"
                  />
                </label>
                <label className="block space-y-1 text-sm text-t2">
                  <span>證件類型</span>
                  <select
                    value={identity.idType}
                    onChange={(event) => setIdentity({ ...identity, idType: event.target.value })}
                    className="w-full input-theme rounded px-3 py-2 text-sm"
                  >
                    <option value="">請選擇</option>
                    {STUDENT_PERSONAL_ID_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-sm text-t2">
                  <span>身分證統一編號</span>
                  <input
                    type="text"
                    value={identity.nationalId}
                    onChange={(event) =>
                      setIdentity({ ...identity, nationalId: event.target.value.toUpperCase() })
                    }
                    maxLength={10}
                    className="w-full input-theme rounded px-3 py-2 text-sm"
                  />
                  {showIdError ? (
                    <span className="text-xs text-danger" role="alert">{idValidation.message}</span>
                  ) : (
                    <span className="text-xs text-t3">
                      國民身分證或居留證（新式統一證號），格式為 1 碼大寫英文＋9 碼數字。
                    </span>
                  )}
                </label>
                <div className="sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveIdentity()}
                    disabled={savingIdentity}
                    className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                  >
                    {savingIdentity ? "儲存中…" : "儲存基礎資料"}
                  </button>
                </div>
              </div>
            ) : (
              <StudentPersonalIdentityFieldsView identity={identity} />
            )}
          </div>
        </details>
      )}
      {!loading && !loadError && (
        <details className="group/card mt-4 border border-themed rounded-lg bg-card">
          <summary className="cursor-pointer list-none px-5 sm:px-7 py-5 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-t1">個人證件照</h3>
            <Chevron card />
          </summary>
          <div className="px-5 sm:px-7 pb-5">
            <p className="mb-4 border-b border-themed pb-3 text-xs text-t3">
              須為高彩彩色 JPG、至少 450 × 600 pixels。系統會自動縮圖並移除拍攝資訊，原始檔不超過 20 MB、縮圖後不超過 900 KB。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StudentPhotoTile
                key={photos.admission?.updatedAt ?? "admission-empty"}
                kind="admission"
                photo={photos.admission}
                canUpload={photoPermissions.admission}
                uploading={uploadingPhoto === "admission"}
                onSelect={(file) => void uploadPhoto("admission", file)}
              />
              <StudentPhotoTile
                key={photos.graduation?.updatedAt ?? "graduation-empty"}
                kind="graduation"
                photo={photos.graduation}
                canUpload={photoPermissions.graduation}
                uploading={uploadingPhoto === "graduation"}
                onSelect={(file) => void uploadPhoto("graduation", file)}
              />
            </div>
          </div>
        </details>
      )}
      <details className="group/card mt-4 border border-themed rounded-lg bg-card">
        <summary className="cursor-pointer list-none px-5 sm:px-7 py-5 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-t1">各學期基本資料</h3>
          <Chevron card />
        </summary>
        <div className="px-5 sm:px-7 pb-5">
          <p className="mb-4 border-b border-themed pb-3 text-xs text-t3">
            每學期一筆，非本學期資料預設收合；資料僅供本人查看。
          </p>

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
            <div className="space-y-3">
              {periodRows.map((row) => (
                <details
                  key={row.key}
                  open={expandedPeriods.includes(row.key)}
                  onToggle={(event) => onTogglePeriod(row.key, event.currentTarget.open)}
                  className="group border border-themed rounded-lg bg-card"
                >
                  <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3 text-t1">
                    <span className="font-medium">
                      {row.academicYear} 學年度第 {row.semester} 學期
                    </span>
                    <Chevron />
                  </summary>
                  {row.isCurrent ? (
                    <div className="border-t border-themed p-4">
                      <p className={`mb-4 text-sm ${canEdit ? "text-success" : "text-t2"}`} role="status">
                        {availabilityMessage}
                      </p>
                      {canEdit ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {STUDENT_PERSONAL_INFO_TERM_FIELD_DEFS.map((field) => (
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
                                  <option key={option.value} value={option.value}>{option.label}</option>
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
                                  list={field.key.endsWith("PostalCode") ? "student-postal-code-options" : undefined}
                                  className="w-full input-theme rounded px-3 py-2 text-sm"
                                />
                              )}
                            </label>
                          ))}
                          <datalist id="student-postal-code-options">
                            {postalCodeOptions.map((option, index) => (
                              <option
                                key={`${index}-${option.code}-${option.district}`}
                                value={option.code}
                                label={option.district}
                              />
                            ))}
                          </datalist>
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
                        <StudentPersonalInfoFieldsView fields={fields} />
                      )}
                    </div>
                  ) : (
                    <div className="border-t border-themed px-4 pb-3">
                      <StudentPersonalInfoFieldsView fields={row.fields} />
                    </div>
                  )}
                </details>
              ))}
            </div>
          )}
        </div>
      </details>
      <PersonalInfoResultDialog
        message={feedback?.message ?? null}
        kind={feedback?.kind ?? "success"}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}

function Chevron({ card = false }: { card?: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-t3 transition-transform ${card ? "group-open/card:rotate-90" : "group-open:rotate-90"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function StudentPersonalInfoFieldsView({ fields }: { fields: StudentPersonalInfoTermFields }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
      {STUDENT_PERSONAL_INFO_TERM_FIELD_DEFS.map((field) => (
        <div key={field.key} className="border-b border-themed py-3">
          <dt className="text-xs text-t3">{field.label}</dt>
          <dd className="text-sm text-t1 mt-1 whitespace-pre-wrap break-words">
            {fields[field.key].trim() || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StudentPersonalIdentityFieldsView({ identity }: { identity: StudentPersonalIdentityFields }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6">
      {STUDENT_PERSONAL_IDENTITY_FIELD_DEFS.map((field) => {
        const raw = identity[field.key];
        const value = field.display ? field.display(raw) : raw;
        return (
          <div key={field.key} className="border-b border-themed py-3">
            <dt className="text-xs text-t3">{field.label}</dt>
            <dd className="text-sm text-t1 mt-1 whitespace-pre-wrap break-words">
              {value || "—"}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function StudentPhotoTile({
  kind,
  photo,
  canUpload,
  uploading,
  onSelect,
}: {
  kind: StudentPersonalPhotoKind;
  photo: { updatedAt: number } | null;
  canUpload: boolean;
  uploading: boolean;
  onSelect: (file: File) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = kind === "admission" ? "入學時證件照" : "畢業證件照";
  const inputId = `student-${kind}-photo-file`;
  const src = photo
    ? `/api/student/personal-info/photo?kind=${kind}&v=${photo.updatedAt}`
    : "";

  return (
    <article className="border border-themed rounded-lg p-4 flex flex-col items-center gap-3 text-center">
      <h4 className="font-semibold text-t1">{title}</h4>
      {photo && !imageFailed ? (
        <img
          src={src}
          alt={title}
          onError={() => setImageFailed(true)}
          className="h-56 w-44 rounded border border-themed bg-surface object-cover"
        />
      ) : (
        <div className="h-56 w-44 rounded border border-themed bg-surface flex flex-col items-center justify-center gap-2 text-t3">
          <svg viewBox="0 0 64 80" className="h-24 w-20" fill="none" aria-hidden="true">
            <circle cx="32" cy="22" r="14" stroke="currentColor" strokeWidth="3" />
            <path
              d="M7 72c1-18 10-28 25-28s24 10 25 28H7z"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-xs">尚未上傳照片</span>
        </div>
      )}
      {canUpload ? (
        <label
          htmlFor={inputId}
          className={`btn-theme rounded-lg px-4 py-2 text-sm ${uploading ? "cursor-wait opacity-60" : "cursor-pointer"}`}
        >
          {uploading ? "上傳中…" : photo ? "選擇照片更換" : "選擇照片上傳"}
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,.jpg,.jpeg"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onSelect(file);
              event.target.value = "";
            }}
            className="sr-only"
          />
        </label>
      ) : (
        <p className="text-xs text-t3">目前未開放上傳或更換</p>
      )}
    </article>
  );
}
