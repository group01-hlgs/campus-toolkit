"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AdSense from "@/components/AdSense";
import Copyright from "@/components/Copyright";
import Toast, { type ToastMessage } from "@/components/Toast";
import { fetchSettings } from "@/lib/settings-client";
import { logout } from "@/lib/session";
import { defaultSettings, type Settings } from "@/types/settings";
import {
  CONFIRMATION_STATUS_LABELS,
  IDENTITY_WINDOW_LABELS,
  MAINTENANCE_HINT,
  MAINTENANCE_TITLE,
  TAX_INQUIRY_STATUS_LABELS,
  formatDateTime,
  isValidIdNumber,
  needsTaxInquiry,
  type IdentityTaxInquiryRecord,
  type IdentityTaxInquirySettings,
  type IdentityWindowState,
} from "../../types/identity-tax-inquiry";

interface StudentPayload {
  student: { name: string; className: string };
}

export default function IdentityTaxInquiryStudentPage() {
  const router = useRouter();
  const [systemSettings, setSystemSettings] = useState<Settings>(defaultSettings);
  const [settings, setSettings] = useState<IdentityTaxInquirySettings | null>(null);
  const [record, setRecord] = useState<IdentityTaxInquiryRecord | null>(null);
  const [student, setStudent] = useState<StudentPayload["student"] | null>(null);
  const [windowState, setWindowState] = useState<IdentityWindowState>("unset");
  const [period, setPeriod] = useState("");
  const [maintenance, setMaintenance] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"draft" | "confirm" | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [identities, setIdentities] = useState<string[]>([]);
  const [father, setFather] = useState({ name: "", idNumber: "" });
  const [mother, setMother] = useState({ name: "", idNumber: "" });
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchSettings();
        if (!cancelled && data?.success && data.settings) {
          setSystemSettings({ ...defaultSettings, ...data.settings });
        }
      } catch {
        // 設定讀取失敗時沿用預設值顯示
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/student/identity-tax-inquiry", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "讀取資料失敗" });
        return;
      }
      setMaintenance(Boolean(data.maintenance));
      setSettings((data.settings as IdentityTaxInquirySettings) ?? null);
      setWindowState((data.windowState as IdentityWindowState) ?? "unset");
      setPeriod(typeof data.period === "string" ? data.period : "");
      setStudent((data.student as StudentPayload["student"]) ?? null);
      const current = (data.record as IdentityTaxInquiryRecord | null) ?? null;
      setRecord(current);
      setIdentities(current?.identities ?? []);
      setFather(current?.father ?? { name: "", idNumber: "" });
      setMother(current?.mother ?? { name: "", idNumber: "" });
      setNote(current?.note ?? "");
    } catch {
      setToast({ kind: "error", text: "讀取資料失敗" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (action: "draft" | "confirm") => {
    if (saving) return;
    if (action === "confirm") {
      if (identities.length === 0) {
        setToast({ kind: "error", text: "請至少選擇一個註冊身分別" });
        return;
      }
      for (const parent of [father, mother]) {
        if (parent.idNumber && !isValidIdNumber(parent.idNumber)) {
          setToast({ kind: "error", text: "父母身分證字號格式不正確（例：A123456789）" });
          return;
        }
      }
    }
    setSaving(action);
    try {
      const response = await fetch("/api/student/identity-tax-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action === "confirm" ? "confirm" : "save",
          identities,
          father,
          mother,
          note,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "儲存失敗" });
        return;
      }
      setRecord((data.record as IdentityTaxInquiryRecord) ?? record);
      setToast({
        kind: "success",
        text: data.message || (action === "confirm" ? "已送出確認" : "已儲存草稿"),
      });
      await load();
    } catch {
      setToast({ kind: "error", text: "儲存失敗" });
    } finally {
      setSaving(null);
    }
  };

  const canEdit = !maintenance && windowState === "open" && Boolean(settings);
  const taxRequired = settings ? needsTaxInquiry(identities, settings) : false;

  const actionButtons = (
    <>
      <button
        type="button"
        onClick={() => router.push("/student")}
        className="btn-theme rounded-lg px-4 py-2 text-sm"
      >
        返回功能首頁
      </button>
      <button
        type="button"
        onClick={() => {
          void logout();
          router.push("/");
        }}
        className="btn-theme rounded-lg px-4 py-2 text-sm"
      >
        登出
      </button>
    </>
  );

  const renderShell = (inner: ReactNode) => (
    <div className="bg-page flex min-h-screen flex-col items-center px-4 pt-[20px]">
      <Toast message={toast} onClose={() => setToast(null)} />
      <div className="mb-2 text-center">
        <h1 className="mb-2 text-4xl font-bold">
          {systemSettings.systemName || "數位校園工具箱"}
        </h1>
        <p className="text-t2 text-xl">{systemSettings.schoolFullName || "學校名稱"}</p>
        <p className="text-t3 text-lg">
          {systemSettings.academicYear} 學年度 第{systemSettings.semester}學期
        </p>
      </div>
      <div className="content-width mt-4 mb-2 text-center">
        <h2 className="text-t1 text-2xl font-bold">註冊身分與財稅查調</h2>
      </div>
      <div className="content-width mb-4 flex justify-end gap-2">{actionButtons}</div>
      <hr className="content-width border-themed mb-4" />
      <main className="content-width mb-6 space-y-4">{inner}</main>
      <hr className="content-width border-themed mb-4" />
      <div className="content-width mb-4 flex justify-start gap-2">{actionButtons}</div>
      {systemSettings.sponsorAdEnabled && (
        <div className="content-width mt-8">
          <AdSense />
        </div>
      )}
      <div className="content-width mt-auto">
        <Copyright mode={systemSettings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );

  if (loading) {
    return renderShell(<p className="text-t2 text-sm">載入中…</p>);
  }

  if (maintenance) {
    return renderShell(
      <div className="border-themed bg-card space-y-2 rounded-lg p-6 text-center">
        <p className="text-t1 text-lg font-medium">{MAINTENANCE_TITLE}</p>
        <p className="text-t2 text-sm">{MAINTENANCE_HINT}</p>
      </div>
    );
  }

  if (!settings) {
    return renderShell(<p className="text-danger text-sm">無法載入設定，請重新整理。</p>);
  }

  return renderShell(
    <>
      <section className="border-themed bg-card rounded-lg p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-t1 font-medium">
              {student?.name || "—"}
              <span className="text-t3 ml-2 text-sm font-normal">{student?.className || ""}</span>
            </p>
            <p className="text-t3 mt-1 text-sm">{period} 學期</p>
          </div>
          <div className="text-right text-sm">
            <span
              className={
                windowState === "open"
                  ? "text-success"
                  : windowState === "upcoming"
                    ? "text-warning"
                    : "text-t2"
              }
            >
              {IDENTITY_WINDOW_LABELS[windowState]}
            </span>
            {record && (
              <span
                className={`mt-1 block text-xs ${
                  record.status === "confirmed" ? "text-success" : "text-t3"
                }`}
              >
                {CONFIRMATION_STATUS_LABELS[record.status]}
                {record.confirmedAt ? `（${formatDateTime(record.confirmedAt)}）` : ""}
              </span>
            )}
          </div>
        </div>
        {settings.instructions.trim() && (
          <div className="border-themed bg-surface mt-3 rounded-md border p-3">
            <p className="text-t1 text-xs font-medium">實施說明</p>
            <p className="text-t2 mt-1 whitespace-pre-line text-sm">{settings.instructions}</p>
          </div>
        )}
      </section>

      {record?.taxInquiry.required && (
        <section className="border-themed bg-card rounded-lg p-4 text-sm">
          <p className="text-t1 font-medium">財稅查調</p>
          <p className="text-t2 mt-1">
            查調狀態：{TAX_INQUIRY_STATUS_LABELS[record.taxInquiry.status]}
            {record.taxInquiry.updatedAt
              ? `（${formatDateTime(record.taxInquiry.updatedAt)} 由 ${record.taxInquiry.updatedByName || "承辦"} 更新）`
              : ""}
          </p>
          {record.taxInquiry.note && (
            <p className="text-t3 mt-1 whitespace-pre-line text-xs">{record.taxInquiry.note}</p>
          )}
        </section>
      )}

      <section className="border-themed bg-card rounded-lg p-4">
        <h3 className="text-t1 mb-3 font-medium">註冊身分別（可複選）</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {settings.identityOptions.map((option) => (
            <label key={option} className="text-t1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={identities.includes(option)}
                onChange={(event) =>
                  setIdentities((prev) =>
                    event.target.checked
                      ? [...prev.filter((item) => item !== option), option]
                      : prev.filter((item) => item !== option)
                  )
                }
              />
              {option}
              {settings.taxInquiryIdentities.includes(option) && (
                <span className="text-warning text-xs">（需查調）</span>
              )}
            </label>
          ))}
        </div>
        <p className="text-t3 mt-2 text-xs">
          請依實際情形勾選；需要財稅查調的身分別，請續填下方父母資料。
        </p>
      </section>

      <section className="border-themed bg-card rounded-lg p-4">
        <h3 className="text-t1 mb-1 font-medium">父母資料（財稅查調用）</h3>
        <p className="text-t3 mb-3 text-xs">
          {taxRequired
            ? settings.requireParentId
              ? "你勾選的身分別需要財稅查調，請至少填寫父或母的姓名與身分證字號。"
              : "你勾選的身分別需要財稅查調，建議填寫父或母的姓名與身分證字號。"
            : "目前勾選的身分別不需要財稅查調，本區可留空。"}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["父", father, setFather],
              ["母", mother, setMother],
            ] as const
          ).map(([label, value, setter]) => (
            <div key={label} className="space-y-2">
              <p className="text-t2 text-sm font-medium">{label}親</p>
              <input
                className="input-theme w-full rounded px-3 py-2 text-sm"
                placeholder={`${label}親姓名`}
                maxLength={40}
                disabled={!canEdit}
                value={value.name}
                onChange={(event) => setter({ ...value, name: event.target.value })}
              />
              <input
                className="input-theme w-full rounded px-3 py-2 text-sm"
                placeholder={`${label}親身分證字號（例：A123456789）`}
                maxLength={10}
                disabled={!canEdit}
                value={value.idNumber}
                onChange={(event) =>
                  setter({ ...value, idNumber: event.target.value.toUpperCase() })
                }
              />
            </div>
          ))}
        </div>
        <label className="mt-3 block text-sm">
          <span className="text-t2 mb-1 block">備註（選填）</span>
          <textarea
            className="input-theme min-h-24 w-full rounded px-3 py-2"
            maxLength={500}
            disabled={!canEdit}
            value={note}
            placeholder="如有特殊情形，可在此說明"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        {canEdit ? (
          <>
            <button
              type="button"
              className="btn-theme rounded px-4 py-2 text-sm disabled:opacity-50"
              disabled={saving !== null}
              onClick={() => void submit("draft")}
            >
              {saving === "draft" ? "儲存中…" : "儲存草稿"}
            </button>
            <button
              type="button"
              className="btn-primary rounded px-4 py-2 text-sm disabled:opacity-50"
              disabled={saving !== null}
              onClick={() => void submit("confirm")}
            >
              {saving === "confirm" ? "送出中…" : "送出確認"}
            </button>
          </>
        ) : (
          <p className="text-t3 text-sm">
            {windowState === "upcoming"
              ? "尚未開放，開放後即可填寫。"
              : "確認期間已結束，如需修改請洽教務處。"}
          </p>
        )}
      </div>
    </>
  );
}
