"use client";

import { useEffect, useMemo, useRef, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import {
  AccountStatus,
  AccountSummary,
  ALL_ROLES,
  ROLE_LABELS,
  twoFactorLabel,
  UserRole,
} from "@/types/users";
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

/** 狀態標籤配色：有效＝綠、無效＝黃、停權＝紅 */
const STATUS_STYLE: Record<AccountStatus, string> = {
  有效: "text-success",
  無效: "text-warning",
  停權: "text-danger",
};

function formatDateTime(value?: number): string {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface AccountForm {
  email: string;
  account: string;
  name: string;
  password: string;
}

const EMPTY_FORM: AccountForm = { email: "", account: "", name: "", password: "" };

/** 全螢幕遮罩（儲存／刪除中）：淡入過場並擋住下方所有操作 */
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

export default function AccountsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [flash, setFlash] = useState<Flash>(null);

  // 新增／編輯表單
  const [formOpen, setFormOpen] = useState(false);
  const [editingUid, setEditingUid] = useState("");
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [formPreferredRole, setFormPreferredRole] = useState<UserRole | "">("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // 重設密碼 modal
  const [resetTarget, setResetTarget] = useState<AccountSummary | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetting, setResetting] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  // 儲存成功提示 modal：完成時跳出，1 秒後自動消失
  const [successModal, setSuccessModal] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const loadAccounts = async () => {
    setLoading(true);
    setListError("");
    try {
      const res = await fetch("/api/admin/accounts", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || "帳號清單載入失敗");
      }
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (error) {
      setAccounts([]);
      setListError(error instanceof Error ? error.message : "帳號清單載入失敗");
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
    void loadAccounts();
  }, []);

  /** 儲存成功訊息：跳出 modal，1 秒後自動消失（重複呼叫會重置計時） */
  function showSuccessModal(text: string) {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSuccessModal(text);
    successTimerRef.current = setTimeout(() => {
      setSuccessModal(null);
      successTimerRef.current = null;
    }, 1000);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingUid("");
    setForm(EMPTY_FORM);
    setFormPreferredRole("");
    setFormError("");
    setShowPassword(false);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormPreferredRole("");
    setEditingUid("");
    setFormError("");
    setShowPassword(false);
    setFormOpen(true);
  }

  function openEdit(target: AccountSummary) {
    setForm({
      email: target.email,
      account: target.account,
      name: target.name,
      password: "",
    });
    setFormPreferredRole(target.preferredRole || "");
    setEditingUid(target.uid);
    setFormError("");
    setShowPassword(false);
    setFormOpen(true);
  }

  function handleField(key: keyof AccountForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** 與伺服器 /api/admin/accounts 的規則一致 */
  function validateForm(): string | null {
    if (!form.name.trim()) return "請填寫姓名";
    if (!form.email.trim()) return ACCOUNT_EMAIL_REQUIRED_MESSAGE;
    if (!isValidEmail(form.email.trim())) return EMAIL_FORMAT_MESSAGE;
    if (form.account.trim() && !isValidAccount(form.account.trim())) {
      return ACCOUNT_FORMAT_MESSAGE;
    }
    if (form.password) {
      if (!isStrongPassword(form.password)) return PASSWORD_REQUIREMENT_MESSAGE;
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
      const isEdit = Boolean(editingUid);
      const res = await fetch("/api/admin/accounts", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { uid: editingUid } : {}),
          input: { ...form },
          preferredRole: formPreferredRole,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFormError(data?.message || "儲存失敗");
        return;
      }
      setFlash({ type: "success", text: data.message || "已儲存" });
      showSuccessModal(data.message || "已儲存");
      closeForm();
      await loadAccounts();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  /** 重設密碼：以既有帳號欄位＋新密碼送出（PUT 會一併讓舊 session 失效） */
  async function handleResetSubmit(event: FormEvent) {
    event.preventDefault();
    if (resetting || !resetTarget) return;
    if (!isStrongPassword(resetPassword)) {
      setResetError(PASSWORD_REQUIREMENT_MESSAGE);
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError("兩次輸入的密碼不一致");
      return;
    }

    setResetting(true);
    setResetError("");
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: resetTarget.uid,
          input: {
            email: resetTarget.email,
            account: resetTarget.account,
            name: resetTarget.name,
            password: resetPassword,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setResetError(data?.message || "重設失敗");
        return;
      }
      setFlash({ type: "success", text: `已重設 ${resetTarget.name} 的密碼` });
      showSuccessModal("密碼已重設");
      setResetTarget(null);
      setResetPassword("");
      setResetConfirm("");
      await loadAccounts();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "重設失敗");
    } finally {
      setResetting(false);
    }
  }

  /** 帳號狀態（擋整個帳戶能否登入） */
  async function handleSetStatus(target: AccountSummary, status: AccountStatus) {
    if (toggling) return;
    if (status === target.status) return;
    const label = `${target.name}（${target.account || target.email}）`;
    const question =
      status === "有效"
        ? `確定恢復 ${label} 的帳號狀態為「有效」？`
        : status === "無效"
          ? `確定停用 ${label} 的帳號？停用後無法登入（含所有身分）。`
          : `確定將 ${label} 的帳號停權？原有資料不會刪除。`;
    if (!window.confirm(question)) return;

    setToggling(true);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: target.uid, status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFlash({ type: "error", text: data?.message || "狀態更新失敗" });
        return;
      }
      setFlash({ type: "success", text: data.message || "狀態已更新" });
      showSuccessModal(data.message || "狀態已更新");
      if (editingUid === target.uid) closeForm();
      await loadAccounts();
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "狀態更新失敗",
      });
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete(target: AccountSummary) {
    const label = `${target.name}（${target.account || target.email}）`;
    if (
      !window.confirm(
        `確定刪除 ${label}？將刪除帳號與所有學期的身分名冊資料，刪除後無法復原。`
      )
    ) {
      return;
    }
    if (deleting) return;
    setDeleting(true);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: target.uid }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFlash({ type: "error", text: data?.message || "刪除失敗" });
        return;
      }
      setFlash({ type: "success", text: data.message || "已刪除" });
      showSuccessModal(data.message || "已刪除");
      if (editingUid === target.uid) closeForm();
      await loadAccounts();
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "刪除失敗" });
    } finally {
      setDeleting(false);
    }
  }

  function handleBack() {
    router.push("/admin");
  }

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return accounts;
    return accounts.filter((item) => {
      const parts = [
        item.name,
        item.email,
        item.account,
        item.status,
        item.preferredRole ? ROLE_LABELS[item.preferredRole] : "",
        twoFactorLabel(item.twoFactor),
        item.roles.map((role) => ROLE_LABELS[role]).join(" "),
      ];
      return parts.some((value) => value.toLowerCase().includes(key));
    });
  }, [accounts, keyword]);

  const actionButtons = (
    <>
      <button onClick={handleBack} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
        返回功能首頁
      </button>
      <button
        onClick={() => router.push("/admin/admins")}
        className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
      >
        管理我的帳號、身分與安全
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
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      {/* 功能標題 */}
      <div className="w-full max-w-6xl mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">使用者帳號管理</h2>
        <p className="text-t2 mt-1 text-sm">
          全部使用者帳號集中在同一張工作表；帳號狀態決定能否登入，具備身分與名冊資料請至「身分名冊管理」
        </p>
      </div>

      {/* 操作按鈕 */}
      <div className="w-full max-w-6xl flex justify-end gap-3 mb-4">{actionButtons}</div>

      <hr className="w-full max-w-6xl border-themed mb-4" />

      {/* 工具列：搜尋、新增 */}
      <div className="w-full max-w-6xl flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜尋姓名、帳號、信箱、身分或狀態"
          className="flex-1 min-w-[200px] input-theme rounded px-3 py-2"
        />
        <button
          onClick={openCreate}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          新增帳號
        </button>
      </div>

      {/* 提示訊息 */}
      {flash && (
        <div
          className="w-full max-w-6xl mb-4 rounded-lg border border-themed px-4 py-3 text-sm text-t1 bg-card"
          role="status"
        >
          {flash.text}
        </div>
      )}

      {/* 新增／編輯表單 */}
      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-6xl border border-themed rounded-lg p-6 mb-4 bg-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-t1">
              {editingUid ? "編輯帳號" : "新增帳號"}
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
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-t2 sm:w-40 shrink-0 flex items-center gap-1">
                姓名<span className="text-t1">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => handleField("name", e.target.value)}
                autoComplete="off"
                className="flex-1 input-theme rounded px-3 py-2"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-t2 sm:w-40 shrink-0 flex items-center gap-1">
                電子郵件地址<span className="text-t1">*</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleField("email", e.target.value)}
                autoComplete="off"
                className="flex-1 input-theme rounded px-3 py-2"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-t2 sm:w-40 shrink-0">帳號</label>
              <input
                type="text"
                value={form.account}
                onChange={(e) => handleField("account", e.target.value)}
                autoComplete="off"
                className="flex-1 input-theme rounded px-3 py-2"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-t2 sm:w-40 shrink-0 flex items-center gap-1">
                密碼{!editingUid && <span className="text-t1">*</span>}
              </label>
              <div className="relative flex-1">
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => handleField("password", e.target.value)}
                  autoComplete="new-password"
                  placeholder={editingUid ? "留空表示不變更密碼" : "至少 8 碼，需含大寫、小寫與數字"}
                  className="w-full input-theme rounded px-3 py-2 pr-10"
                />
                <PasswordToggleButton
                  visible={showPassword}
                  onToggle={() => setShowPassword((prev) => !prev)}
                  label="顯示密碼"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-t2 sm:w-40 shrink-0">慣用身分</label>
              <select
                value={formPreferredRole}
                onChange={(e) => setFormPreferredRole(e.target.value as UserRole | "")}
                className="flex-1 input-theme rounded px-3 py-2"
              >
                <option value="">未設定（登入時詢問）</option>
                {ALL_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-t3">
              {ACCOUNT_EMAIL_REQUIRED_MESSAGE}（登入識別與多身分偵測都仰賴它）；同一組帳號具備多個身分時，
              登入依慣用身分決定預設身分。建立帳號後，請至「身分名冊管理」指定身分。
            </p>
          </div>

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

      {/* 帳號工作表（單一功能頁面，無分頁） */}
      <div className="w-full max-w-6xl border border-themed rounded-lg bg-card mb-4 overflow-x-auto">
        {loading ? (
          <p className="p-6 text-center text-t3">帳號清單載入中...</p>
        ) : listError ? (
          <p className="p-6 text-center text-t1">{listError}</p>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="border-b border-themed">
              <tr className="text-t2">
                <th className="px-3 py-2 font-medium whitespace-nowrap">姓名</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">電子郵件地址</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">帳號</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">狀態</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">慣用身分</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">兩階段驗證</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">最後登入</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">登入次數</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">具備身分</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-t3">
                    {accounts.length === 0 ? "目前沒有帳號" : "沒有符合的資料"}
                  </td>
                </tr>
              )}
              {filtered.map((item) => (
                <tr key={item.uid} className="border-b border-themed last:border-0 text-t1">
                  <td className="px-3 py-2 whitespace-nowrap">{item.name || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{item.email || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{item.account || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`inline-block rounded-full border border-themed px-2 py-0.5 text-xs ${STATUS_STYLE[item.status]}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.preferredRole ? ROLE_LABELS[item.preferredRole] : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{twoFactorLabel(item.twoFactor)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-t2">
                    {formatDateTime(item.lastLogin)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{item.loginCount ?? 0}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.roles.length
                      ? item.roles.map((role) => ROLE_LABELS[role]).join("、")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button
                      onClick={() => openEdit(item)}
                      className="btn-theme rounded px-3 py-1 text-xs cursor-pointer mr-2"
                    >
                      編輯
                    </button>
                    <button
                      onClick={() => {
                        setResetTarget(item);
                        setResetPassword("");
                        setResetConfirm("");
                        setResetError("");
                      }}
                      className="btn-theme rounded px-3 py-1 text-xs cursor-pointer mr-2"
                    >
                      重設密碼
                    </button>
                    {item.status === "有效" ? (
                      <>
                        <button
                          onClick={() => void handleSetStatus(item, "無效")}
                          disabled={toggling}
                          className="btn-theme rounded px-3 py-1 text-xs cursor-pointer mr-2 disabled:opacity-50"
                        >
                          停用帳號
                        </button>
                        <button
                          onClick={() => void handleSetStatus(item, "停權")}
                          disabled={toggling}
                          className="btn-theme rounded px-3 py-1 text-xs cursor-pointer mr-2 disabled:opacity-50"
                        >
                          停權
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => void handleSetStatus(item, "有效")}
                        disabled={toggling}
                        className="btn-theme rounded px-3 py-1 text-xs cursor-pointer mr-2 disabled:opacity-50"
                      >
                        啟用帳號
                      </button>
                    )}
                    <button
                      onClick={() => void handleDelete(item)}
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

      <hr className="w-full max-w-6xl border-themed mb-4" />

      {/* 底部操作按鈕 */}
      <div className="w-full max-w-6xl flex justify-start gap-3 mb-8">{actionButtons}</div>

      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-6xl">
          <AdSense />
        </div>
      )}

      <div className="w-full max-w-6xl mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>

      {/* 作業遮罩：儲存／刪除／狀態切換／重設密碼期間覆蓋畫面、阻擋重複操作 */}
      {(saving || deleting || toggling || resetting) && (
        <BlockingMask
          text={
            toggling
              ? "更新狀態中，請稍候…"
              : resetting
                ? "重設密碼中，請稍候…"
                : deleting
                  ? "刪除中，請稍候…"
                  : "儲存中，請稍候…"
          }
        />
      )}

      {/* 重設密碼 modal */}
      {resetTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
        >
          <form
            onSubmit={handleResetSubmit}
            className="bg-card rounded-2xl p-6 w-full max-w-md space-y-4 shadow-lg animate-fade-in"
          >
            <div>
              <h3 className="text-lg font-bold text-t1">重設密碼</h3>
              <p className="text-sm text-t2 mt-1">
                {resetTarget.name}（{resetTarget.account || resetTarget.email}）
              </p>
              <p className="text-xs text-t3 mt-1">
                重設後該帳號的既有登入狀態會全部失效，需重新登入。
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-t2 text-sm flex items-center gap-1">
                新密碼<span className="text-t1">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="至少 8 碼，需含大寫、小寫與數字"
                  className="w-full input-theme rounded px-3 py-2 pr-10"
                />
                <PasswordToggleButton
                  visible={showPassword}
                  onToggle={() => setShowPassword((prev) => !prev)}
                  label="顯示密碼"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-t2 text-sm flex items-center gap-1">
                再輸入一次<span className="text-t1">*</span>
              </label>
              <input
                type={showPassword ? "text" : "password"}
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full input-theme rounded px-3 py-2"
              />
            </div>
            {resetError && (
              <p className="text-sm text-t1 border border-themed rounded px-3 py-2" role="alert">
                {resetError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={resetting}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
              >
                {resetting ? "重設中..." : "重設密碼"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 儲存成功 modal：完成時跳出，1 秒後自動消失 */}
      {successModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
        >
          <div className="bg-card rounded-2xl p-8 text-center space-y-4 shadow-lg animate-fade-in">
            <div className="flex justify-center">
              <svg
                className="w-12 h-12 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <p className="text-lg font-semibold text-t1">{successModal}</p>
            <p className="text-xs text-t3">視窗將自動關閉</p>
          </div>
        </div>
      )}
    </div>
  );
}
