"use client";

import { useEffect, useMemo, useRef, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import {
  ROSTER_COLUMNS,
  ROSTER_FIELDS,
  ROSTER_ROLES,
  RosterFieldKey,
  RosterInput,
  RosterMember,
  RosterRole,
  rosterImportHint,
} from "@/types/roster";
import {
  ACCOUNT_EMAIL_REQUIRED_MESSAGE,
  ACCOUNT_FORMAT_MESSAGE,
  EMAIL_FORMAT_MESSAGE,
  isStrongPassword,
  isValidAccount,
  isValidEmail,
  PASSWORD_REQUIREMENT_MESSAGE,
} from "@/lib/validation";
import { logout } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import PasswordToggleButton from "@/components/PasswordToggleButton";

type Flash = { type: "success" | "error"; text: string } | null;

interface ImportSkipped {
  row: number;
  reason: string;
}

interface ImportResult {
  created: number;
  skipped: ImportSkipped[];
}

const EMPTY_FORM: Record<RosterFieldKey, string> = {
  email: "",
  account: "",
  password: "",
  name: "",
  studentId: "",
  grade: "",
  className: "",
  classNumber: "",
  title: "",
  attribute: "",
};

function formatDateTime(value?: number): string {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 清單儲格值：該身分沒有這個欄位時顯示破折號 */
function cellValue(member: RosterMember, key: RosterFieldKey): string {
  const record = member as unknown as Record<string, string | undefined>;
  return record[key] || "—";
}

export default function RosterPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [role, setRole] = useState<RosterRole>("student");
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [flash, setFlash] = useState<Flash>(null);

  // 新增／編輯表單
  const [formOpen, setFormOpen] = useState(false);
  const [editingUid, setEditingUid] = useState("");
  const [form, setForm] = useState<Record<RosterFieldKey, string>>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Excel 匯入
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadMembers = async (targetRole: RosterRole) => {
    setLoading(true);
    setListError("");
    try {
      const res = await fetch(`/api/admin/roster?role=${targetRole}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || "名冊載入失敗");
      }
      setMembers(Array.isArray(data.members) ? data.members : []);
    } catch (error) {
      setMembers([]);
      setListError(error instanceof Error ? error.message : "名冊載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
      })
      .catch((error) => console.error("載入設定失敗:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setKeyword("");
    closeForm();
    setImportResult(null);
    void loadMembers(role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  function closeForm() {
    setFormOpen(false);
    setEditingUid("");
    setForm(EMPTY_FORM);
    setFormError("");
    setShowPassword(false);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingUid("");
    setFormError("");
    setShowPassword(false);
    setFormOpen(true);
  }

  function openEdit(member: RosterMember) {
    setForm({
      ...EMPTY_FORM,
      email: member.email,
      account: member.account,
      name: member.name,
      studentId: member.studentId || "",
      grade: member.grade || "",
      className: member.className || "",
      classNumber: member.classNumber || "",
      title: member.title || "",
      attribute: member.attribute || "",
    });
    setEditingUid(member.uid);
    setFormError("");
    setShowPassword(false);
    setFormOpen(true);
  }

  function handleField(key: RosterFieldKey, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** 客戶端先擋一次，與伺服器 /api/admin/roster 的規則一致 */
  function validateForm(): string | null {
    if (!form.name.trim()) return "請填寫姓名";
    const hasEmail = Boolean(form.email.trim());
    const hasAccount = Boolean(form.account.trim());
    if (!hasEmail && !hasAccount) return ACCOUNT_EMAIL_REQUIRED_MESSAGE;
    if (hasEmail && !isValidEmail(form.email.trim())) return EMAIL_FORMAT_MESSAGE;
    if (hasAccount && !isValidAccount(form.account.trim())) return ACCOUNT_FORMAT_MESSAGE;
    if (role === "student" && !form.studentId.trim()) return "請填寫學號";

    const password = form.password;
    if (password) {
      if (!isStrongPassword(password)) return PASSWORD_REQUIREMENT_MESSAGE;
    } else if (!editingUid) {
      return `請填寫密碼，${PASSWORD_REQUIREMENT_MESSAGE}`;
    }
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const message = validateForm();
    if (message) {
      setFormError(message);
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const input: RosterInput = { ...form };
      const isEdit = Boolean(editingUid);
      const res = await fetch("/api/admin/roster", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, uid: editingUid, input }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFormError(data?.message || "儲存失敗");
        return;
      }
      setFlash({ type: "success", text: data.message || "已儲存" });
      closeForm();
      await loadMembers(role);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(member: RosterMember) {
    const label = `${member.name}（${member.account || member.email}）`;
    if (!window.confirm(`確定刪除 ${label}？刪除後無法復原。`)) return;
    try {
      const res = await fetch("/api/admin/roster", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, uid: member.uid }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFlash({ type: "error", text: data?.message || "刪除失敗" });
        return;
      }
      setFlash({ type: "success", text: data.message || "已刪除" });
      if (editingUid === member.uid) closeForm();
      await loadMembers(role);
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "刪除失敗" });
    }
  }

  async function handleImport(file: File) {
    if (importing) return;
    setImporting(true);
    setImportResult(null);
    setFlash(null);
    try {
      const body = new FormData();
      body.append("role", role);
      body.append("file", file);
      const res = await fetch("/api/admin/roster/import", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFlash({ type: "error", text: data?.message || "匯入失敗" });
        return;
      }
      setImportResult({
        created: typeof data.created === "number" ? data.created : 0,
        skipped: Array.isArray(data.skipped) ? data.skipped : [],
      });
      setFlash({ type: "success", text: data.message || "匯入完成" });
      await loadMembers(role);
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "匯入失敗" });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleBack() {
    router.push("/admin");
  }

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return members;
    return members.filter((member) =>
      [
        member.name,
        member.email,
        member.account,
        member.studentId,
        member.grade,
        member.className,
        member.classNumber,
        member.title,
        member.attribute,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(key))
    );
  }, [members, keyword]);

  const columns = ROSTER_COLUMNS[role];
  const actionButtons = (
    <>
      <button onClick={handleBack} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
        返回功能首頁
      </button>
      <button
        onClick={() => void logout()}
        className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
      >
        登出
      </button>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      {/* 標題區域 */}
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度</p>
      </div>

      {/* 功能標題 */}
      <div className="w-full max-w-5xl mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">名冊管理</h2>
        <p className="text-t2 mt-1 text-sm">新增、編輯、刪除與匯入學生／教職員／管理員名冊</p>
      </div>

      {/* 操作按鈕 */}
      <div className="w-full max-w-5xl flex justify-end gap-3 mb-4">{actionButtons}</div>

      <hr className="w-full max-w-5xl border-themed mb-4" />

      {/* 身分分頁 */}
      <div className="w-full max-w-5xl flex flex-wrap gap-2 mb-4">
        {ROSTER_ROLES.map((item) => (
          <button
            key={item.value}
            onClick={() => setRole(item.value)}
            className={`rounded-lg px-4 py-2 text-sm cursor-pointer border ${
              role === item.value
                ? "btn-theme"
                : "border-themed text-t2 bg-card hover:text-t1"
            }`}
          >
            {item.tab}
          </button>
        ))}
      </div>

      {/* 工具列：搜尋、新增、匯入 */}
      <div className="w-full max-w-5xl flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜尋姓名、帳號、信箱、學號或班級"
          className="flex-1 min-w-[200px] input-theme rounded px-3 py-2"
        />
        <button
          onClick={openCreate}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          新增{ROSTER_ROLES.find((item) => item.value === role)?.label}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
        >
          {importing ? "匯入中..." : "Excel 匯入"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImport(file);
          }}
        />
      </div>

      {/* 匯入格式說明 */}
      <div className="w-full max-w-5xl mb-4 text-sm text-t3">
        匯入欄位：{rosterImportHint(role)}；電子郵件地址與帳號至少填一項，單次最多 100 列。
      </div>

      {/* 提示訊息 */}
      {flash && (
        <div
          className="w-full max-w-5xl mb-4 rounded-lg border border-themed px-4 py-3 text-sm text-t1 bg-card"
          role="status"
        >
          {flash.text}
        </div>
      )}

      {/* 匯入結果 */}
      {importResult && (
        <div className="w-full max-w-5xl mb-4 border border-themed rounded-lg p-4 bg-card text-sm">
          <p className="font-bold text-t1 mb-2">
            匯入結果：新增 {importResult.created} 筆，略過 {importResult.skipped.length} 筆
          </p>
          {importResult.skipped.length > 0 && (
            <ul className="space-y-1 text-t2">
              {importResult.skipped.map((item) => (
                <li key={item.row}>
                  第 {item.row} 列：{item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 新增／編輯表單 */}
      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-5xl border border-themed rounded-lg p-6 mb-4 bg-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-t1">
              {editingUid ? "編輯" : "新增"}
              {ROSTER_ROLES.find((item) => item.value === role)?.label}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="btn-theme rounded-lg px-3 py-1.5 text-sm cursor-pointer"
            >
              取消
            </button>
          </div>

          <div className="space-y-4">
            {ROSTER_FIELDS[role].map((field) => (
              <div key={field.key} className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0 flex items-center gap-1">
                  {field.label}
                  {field.required && <span className="text-t1">*</span>}
                </label>
                {field.key === "password" ? (
                  <div className="relative flex-1">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => handleField("password", e.target.value)}
                      autoComplete="new-password"
                      placeholder={
                        editingUid ? "留空表示不變更密碼" : `至少 8 碼，需含大寫、小寫與數字`
                      }
                      className="w-full input-theme rounded px-3 py-2 pr-10"
                    />
                    <PasswordToggleButton
                      visible={showPassword}
                      onToggle={() => setShowPassword((prev) => !prev)}
                      label="顯示密碼"
                    />
                  </div>
                ) : (
                  <input
                    type={field.key === "email" ? "email" : "text"}
                    value={form[field.key] ?? ""}
                    onChange={(e) => handleField(field.key, e.target.value)}
                    autoComplete="off"
                    className="flex-1 input-theme rounded px-3 py-2"
                  />
                )}
              </div>
            ))}
          </div>

          <p className="text-sm text-t3 mt-3">{ACCOUNT_EMAIL_REQUIRED_MESSAGE}</p>

          {formError && (
            <p className="text-sm text-t1 mt-3 border border-themed rounded px-3 py-2" role="alert">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button
              type="submit"
              disabled={saving}
              className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
            >
              {saving ? "儲存中..." : "儲存"}
            </button>
          </div>
        </form>
      )}

      {/* 名冊清單 */}
      <div className="w-full max-w-5xl border border-themed rounded-lg bg-card mb-4 overflow-x-auto">
        {loading ? (
          <p className="p-6 text-center text-t3">名冊載入中...</p>
        ) : listError ? (
          <p className="p-6 text-center text-t1">{listError}</p>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="border-b border-themed">
              <tr className="text-t2">
                {columns.map((column) => (
                  <th key={column.key} className="px-3 py-2 font-medium whitespace-nowrap">
                    {column.label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium whitespace-nowrap">最後登入</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + 2}
                    className="px-3 py-6 text-center text-t3"
                  >
                    {members.length === 0 ? "目前沒有資料" : "沒有符合的資料"}
                  </td>
                </tr>
              )}
              {filtered.map((member) => (
                <tr key={member.uid} className="border-b border-themed last:border-0 text-t1">
                  {columns.map((column) => (
                    <td key={column.key} className="px-3 py-2 whitespace-nowrap">
                      {cellValue(member, column.key)}
                    </td>
                  ))}
                  <td className="px-3 py-2 whitespace-nowrap text-t2">
                    {formatDateTime(member.lastLogin)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button
                      onClick={() => openEdit(member)}
                      className="btn-theme rounded px-3 py-1 text-xs cursor-pointer mr-2"
                    >
                      編輯
                    </button>
                    <button
                      onClick={() => void handleDelete(member)}
                      className="btn-theme rounded px-3 py-1 text-xs cursor-pointer"
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <hr className="w-full max-w-5xl border-themed mb-4" />

      {/* 底部操作按鈕 */}
      <div className="w-full max-w-5xl flex justify-start gap-3 mb-8">{actionButtons}</div>

      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-5xl">
          <AdSense />
        </div>
      )}

      <div className="w-full max-w-5xl mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );
}
