"use client";

import { useCallback, useEffect, useState } from "react";
import PersonalInfoResultDialog from "@/components/PersonalInfoResultDialog";
import {
  EMPTY_STUDENT_PERSONAL_INFO,
  STUDENT_PERSONAL_PHOTO_MAX_BYTES,
  STUDENT_PERSONAL_INFO_FIELD_DEFS,
  type StudentPersonalPhotoKind,
  type StudentPersonalInfoFields,
} from "@/types/personal-info";
import type { PostalCodeOption } from "@/types/postal-codes";

interface StudentPersonalInfoResponse {
  success?: boolean;
  message?: string;
  fields?: StudentPersonalInfoFields;
  photos?: Record<StudentPersonalPhotoKind, { updatedAt: number; contentType: string } | null>;
  photoPermissions?: Record<StudentPersonalPhotoKind, boolean>;
  postalCodeOptions?: PostalCodeOption[];
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
      setPhotos({
        admission: data.photos?.admission ? { updatedAt: data.photos.admission.updatedAt } : null,
        graduation: data.photos?.graduation ? { updatedAt: data.photos.graduation.updatedAt } : null,
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

  async function uploadPhoto(kind: StudentPersonalPhotoKind, file: File) {
    if (!photoPermissions[kind] || uploadingPhoto) return;
    if (file.size <= 0 || file.size > STUDENT_PERSONAL_PHOTO_MAX_BYTES) {
      setFeedback({ kind: "error", message: "照片不可為空，且檔案大小不可超過 5 MB。" });
      return;
    }

    setUploadingPhoto(kind);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
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
      {!loading && !loadError && (
        <section className="mt-4 border border-themed rounded-lg bg-card p-5 sm:p-7">
          <header className="mb-4 border-b border-themed pb-3">
            <h3 className="text-lg font-bold text-t1">個人證件照</h3>
            <p className="text-xs text-t3 mt-1">限 JPG、PNG 或 WebP，單張不可超過 5 MB。</p>
          </header>
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
        </section>
      )}
      <PersonalInfoResultDialog
        message={feedback?.message ?? null}
        kind={feedback?.kind ?? "success"}
        onClose={() => setFeedback(null)}
      />
    </>
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
            accept="image/jpeg,image/png,image/webp"
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
