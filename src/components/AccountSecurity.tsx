"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import {
  ROLE_LABELS,
  ROLE_SPECIFIC_FIELDS,
  TWO_FACTOR_METHODS,
  UserRole,
} from "@/types/users";
import { fetchSession, logout } from "@/lib/session";
import {
  ACCOUNT_EMAIL_REQUIRED_MESSAGE,
  ACCOUNT_FORMAT_MESSAGE,
  EMAIL_FORMAT_MESSAGE,
  isStrongPassword,
  isValidAccount,
  isValidEmail,
  PASSWORD_REQUIREMENT_MESSAGE,
} from "@/lib/validation";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import PasswordToggleButton from "@/components/PasswordToggleButton";

/** /api/account 回傳的自身帳號資料（三卡版型共用） */
interface AccountProfile {
  uid: string;
  role: string;
  roleLabel: string;
  name: string;
  email: string;
  account: string;
  loginCount: number;
  lastLogin: number;
  lastLoginMethod: string;
  loginRecords: number[];
  twoFactor: string;
  totpSecret: string;
  otpauthUrl: string;
  lockedUntil: number;
  failedAttempts: number;
  fields: Record<string, string>;
}

type Flash = { type: "success" | "error"; text: string } | null;

/**
 * 即時查重狀態：idle（值未變動／不需查）｜checking 查詢中
 * ｜available 同身分無人使用｜taken 已被同身分其他使用者占用
 */
type DupState = "idle" | "checking" | "available" | "taken";

function formatDateTime(value: number): string {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export default function AccountSecurityPage({ role }: { role: UserRole }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [profile, setProfile] = useState<AccountProfile | null>(null);

  // 帳密管理
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [accountFlash, setAccountFlash] = useState<Flash>(null);
  const [savingAccount, setSavingAccount] = useState(false);
  // 即時查重（電子郵件地址／帳號，同身分內比對）
  const [emailDup, setEmailDup] = useState<DupState>("idle");
  const [accountDup, setAccountDup] = useState<DupState>("idle");
  const [name, setName] = useState("");

  // 兩階段驗證
  const [twoFactor, setTwoFactor] = useState<string>("off");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [twoFactorFlash, setTwoFactorFlash] = useState<Flash>(null);
  const [savingTwoFactor, setSavingTwoFactor] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSession(true).then((session) => {
      if (cancelled) return;
      if (!session || session.role !== role) {
        router.push("/");
        return;
      }
      setEmail(session.email);
      setAccount(session.account);
      void loadProfile();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, role]);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
      } catch (error) {
        console.error("載入設定失敗:", error);
      }
    }
    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadProfile() {
    try {
      const res = await fetch("/api/account", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.success && data.profile) {
        applyProfile(data.profile);
      }
    } catch (error) {
      console.error("載入帳號資料失敗:", error);
    }
  }

  function applyProfile(next: AccountProfile) {
    setProfile(next);
    if (next.name) setName(next.name);
    setEmail(next.email);
    setAccount(next.account);
    setTwoFactor(next.twoFactor || "off");
    setOtpauthUrl(next.otpauthUrl || "");
    setTotpSecret(next.totpSecret || "");
  }

  // ── 帳密管理：欄位的即時驗證資料（四個身分共用同一份元件） ──
  const emailValue = email.trim();
  const accountValue = account.trim();
  // 已存的值：用來判斷「是否已被修改」，未修改的值（＝自己的值）不查重
  const storedEmail = profile ? profile.email.trim() : "";
  const storedAccount = profile ? profile.account.trim() : "";
  const loaded = Boolean(profile);
  // 兩欄可個別留空，但不可同時為空（至少保留一項作為登入識別）
  const bothEmpty = loaded && !emailValue && !accountValue;
  // 格式錯誤：空白欄位交由「不可同時為空」規則判定，不重複報錯
  const emailFormatInvalid = Boolean(emailValue) && !isValidEmail(emailValue);
  const accountFormatInvalid = Boolean(accountValue) && !isValidAccount(accountValue);
  // 是否與已存值不同
  const emailChanged = loaded && emailValue !== storedEmail;
  const accountChanged = loaded && accountValue !== storedAccount;
  // 即時查重結果（僅在值真的變更時才算數）
  const emailTaken = emailChanged && emailDup === "taken";
  const accountTaken = accountChanged && accountDup === "taken";
  // 清空電子郵件時，若兩階段驗證仍是「電子郵件驗證碼」，伺服器會擋下（無從寄信）
  const emailCleared = loaded && !emailValue && Boolean(storedEmail);
  const emailOtpBlocked = emailCleared && twoFactor === "email_otp";
  // 有阻斷性問題時不可送出（說明文字即時顯示在各欄位下方）
  const accountBlocked =
    bothEmpty ||
    emailFormatInvalid ||
    accountFormatInvalid ||
    emailTaken ||
    accountTaken ||
    emailOtpBlocked;
  const emailInputInvalid =
    bothEmpty || emailFormatInvalid || emailTaken || emailOtpBlocked;
  const accountInputInvalid = bothEmpty || accountFormatInvalid || accountTaken;

  // 即時查重：輸入停止 450ms 後，對「已修改且格式正確」的欄位
  // 向 /api/account/check 查同身分（排除自己）是否重複
  useEffect(() => {
    if (!profile) return;
    const checkEmail = emailChanged && Boolean(emailValue) && !emailFormatInvalid;
    const checkAccount =
      accountChanged && Boolean(accountValue) && !accountFormatInvalid;

    if (!checkEmail && !checkAccount) {
      setEmailDup("idle");
      setAccountDup("idle");
      return;
    }
    if (checkEmail) setEmailDup("checking");
    if (checkAccount) setAccountDup("checking");

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams();
      if (checkEmail) query.set("email", emailValue);
      if (checkAccount) query.set("account", accountValue);
      fetch(`/api/account/check?${query.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`check failed: ${res.status}`);
          const data = await res.json();
          if (checkEmail) setEmailDup(data.emailTaken ? "taken" : "available");
          if (checkAccount) setAccountDup(data.accountTaken ? "taken" : "available");
        })
        .catch((error: unknown) => {
          // 中途改輸入（AbortError）不處理；限流／系統錯誤回到 idle，
          // 不顯示可能誤導的查重結果，交由儲存時的伺服器檢查把關
          if ((error as Error)?.name === "AbortError") return;
          if (checkEmail) setEmailDup("idle");
          if (checkAccount) setAccountDup("idle");
        });
    }, 450);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    profile,
    emailValue,
    accountValue,
    emailChanged,
    accountChanged,
    emailFormatInvalid,
    accountFormatInvalid,
  ]);

  /** TOTP QR Code：前端本地產生（不經外部 QR 服務） */
  useEffect(() => {
    if (twoFactor !== "totp" || !otpauthUrl) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(otpauthUrl, {
          margin: 1,
          width: 240,
          color: { dark: "#111827", light: "#ffffff" },
        });
        if (!cancelled) setQrDataUrl(url);
      } catch (error) {
        console.error("QR Code 產生失敗:", error);
        if (!cancelled) setQrDataUrl("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [twoFactor, otpauthUrl]);

  /** 帳密管理：儲存電子郵件地址／帳號（可一併變更密碼） */
  async function handleSaveAccount(e: FormEvent) {
    e.preventDefault();
    setAccountFlash(null);

    // 身分識別欄位：兩欄可個別留空，但不可同時為空；格式與同身分查重即時把關
    if (bothEmpty) {
      setAccountFlash({ type: "error", text: ACCOUNT_EMAIL_REQUIRED_MESSAGE });
      return;
    }
    if (emailFormatInvalid) {
      setAccountFlash({ type: "error", text: EMAIL_FORMAT_MESSAGE });
      return;
    }
    if (accountFormatInvalid) {
      setAccountFlash({ type: "error", text: ACCOUNT_FORMAT_MESSAGE });
      return;
    }
    if (emailTaken) {
      setAccountFlash({
        type: "error",
        text: "此電子郵件地址已被同身分的其他使用者使用",
      });
      return;
    }
    if (accountTaken) {
      setAccountFlash({
        type: "error",
        text: "此帳號已被同身分的其他使用者使用",
      });
      return;
    }
    if (emailOtpBlocked) {
      setAccountFlash({
        type: "error",
        text: "已啟用電子郵件驗證碼兩階段驗證，請先改為其他驗證方式再清除電子郵件地址",
      });
      return;
    }

    const wantPassword = newPassword.length > 0 || confirmPassword.length > 0;
    if (wantPassword) {
      if (!oldPassword) {
        setAccountFlash({ type: "error", text: "變更密碼需先輸入目前密碼" });
        return;
      }
      if (!isStrongPassword(newPassword)) {
        setAccountFlash({ type: "error", text: PASSWORD_REQUIREMENT_MESSAGE });
        return;
      }
      if (newPassword !== confirmPassword) {
        setAccountFlash({ type: "error", text: "兩次輸入的新密碼不一致" });
        return;
      }
    }

    setSavingAccount(true);
    try {
      let saved: AccountProfile | null = null;
      let putMessage = "";

      const unchanged =
        Boolean(profile) &&
        emailValue === storedEmail &&
        accountValue === storedAccount;
      if (!unchanged) {
        const res = await fetch("/api/account", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, account }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setAccountFlash({ type: "error", text: data.message || "儲存失敗" });
          return;
        }
        putMessage = typeof data.message === "string" ? data.message : "";
        if (data.profile) {
          saved = data.profile;
          applyProfile(data.profile);
        }
      }

      if (wantPassword) {
        // 帳號可能已被清空：變更密碼 API 同時接受帳號或電子郵件地址作為自身識別
        const identifier = saved
          ? saved.account || saved.email
          : accountValue || emailValue;
        const res = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account: identifier,
            oldPassword,
            newPassword,
            role,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setAccountFlash({ type: "error", text: data.message || "密碼更新失敗" });
          return;
        }
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setShowOld(false);
        setShowNew(false);
        setShowConfirm(false);
        setAccountFlash({
          type: "success",
          text: saved ? "帳號資料與密碼已更新" : data.message || "密碼已更新",
        });
        return;
      }

      setAccountFlash({
        type: "success",
        text: putMessage || (unchanged ? "沒有變更" : "儲存成功"),
      });
    } catch {
      setAccountFlash({ type: "error", text: "系統錯誤，請稍後再試" });
    } finally {
      setSavingAccount(false);
    }
  }

  /** 兩階段驗證：儲存驗證方式（選「驗證碼APP」時後端自動產生密鑰） */
  async function handleSaveTwoFactor(e: FormEvent) {
    e.preventDefault();
    setTwoFactorFlash(null);
    setSavingTwoFactor(true);
    try {
      const res = await fetch("/api/account/two-factor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: twoFactor }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTwoFactor(data.twoFactor || twoFactor);
        setTotpSecret(data.totpSecret || "");
        setOtpauthUrl(data.otpauthUrl || "");
        if (profile) {
          setProfile({ ...profile, twoFactor: data.twoFactor || twoFactor });
        }
        setTwoFactorFlash({ type: "success", text: data.message || "設定已儲存" });
      } else {
        setTwoFactorFlash({ type: "error", text: data.message || "儲存失敗" });
      }
    } catch {
      setTwoFactorFlash({ type: "error", text: "系統錯誤，請稍後再試" });
    } finally {
      setSavingTwoFactor(false);
    }
  }

  async function handleRegenerateSecret() {
    setTwoFactorFlash(null);
    setSavingTwoFactor(true);
    try {
      const res = await fetch("/api/account/two-factor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTotpSecret(data.totpSecret || "");
        setOtpauthUrl(data.otpauthUrl || "");
        setTwoFactorFlash({ type: "success", text: data.message || "已產生新的 TOTP 密鑰" });
      } else {
        setTwoFactorFlash({ type: "error", text: data.message || "產生失敗" });
      }
    } catch {
      setTwoFactorFlash({ type: "error", text: "系統錯誤，請稍後再試" });
    } finally {
      setSavingTwoFactor(false);
    }
  }

  function handleLogout() {
    void logout();
    router.push("/");
  }

  const roleLabel = ROLE_LABELS[role];
  const backHref = `/${role}`;
  // 語意色：跟隨主題變數 --success／--danger
  const messageClass = (type: "success" | "error") =>
    type === "success" ? "text-success" : "text-danger";

  // 電子郵件地址可編輯性（受系統設定「開放使用者更換電子郵件地址」控制）：
  // 一律以「已存的值」判斷，避免輸入途中清空欄位就被誤判為尚未設定／解除鎖定
  // 已有地址 → 依設定開放／不開放；尚無地址 → 僅能新增一次，並提示日後是否可再修改
  const hasStoredEmail = Boolean(storedEmail);
  const emailLocked = loaded && hasStoredEmail && !settings.emailChangeAllowed;
  const emailNotice: { className: string; text: string } | null = !profile
    ? null
    : emailLocked
      ? {
          // 語意色：跟隨主題變數 --danger（與全站警示文案一致）
          className: "text-danger font-medium",
          text: "系統設定不開放變更電子郵件地址，此欄位僅供檢視。",
        }
      : emailValue
        ? null
        : settings.emailChangeAllowed
          ? {
              className: "text-t3",
              text: "尚未設定電子郵件地址：新增後，日後仍可再修改。",
            }
          : {
              // 語意色：跟隨主題變數 --danger（與全站警示文案一致）
              className: "text-danger font-medium",
              text: "尚未設定電子郵件地址：系統設定不開放變更，新增後將無法再修改，請謹慎填寫。",
            };

  // 欄位下方的即時回饋：語意色一律走主題變數 --danger／--success／--t3，隨 CSS 主題切換
  const emailFeedback: { className: string; text: string } | null =
    emailFormatInvalid
      ? { className: "text-danger", text: EMAIL_FORMAT_MESSAGE }
      : emailTaken
        ? {
            className: "text-danger",
            text: "此電子郵件地址已被同身分的其他使用者使用",
          }
        : emailOtpBlocked
          ? {
              // 語意色：跟隨主題變數 --danger（與全站警示文案一致）
              className: "text-danger font-medium",
              text: "已啟用「電子郵件驗證碼」兩階段驗證，請先在下方改為其他方式，才能清除電子郵件地址。",
            }
          : emailChanged && emailDup === "available"
            ? { className: "text-success", text: "此電子郵件地址可以使用" }
            : emailChanged && emailDup === "checking"
              ? { className: "text-t3", text: "查重中..." }
              : null;

  const accountFeedback: { className: string; text: string } | null =
    accountFormatInvalid
      ? { className: "text-danger", text: ACCOUNT_FORMAT_MESSAGE }
      : accountTaken
        ? {
            className: "text-danger",
            text: "此帳號已被同身分的其他使用者使用",
          }
        : accountChanged && accountDup === "available"
          ? { className: "text-success", text: "此帳號可以使用" }
          : accountChanged && accountDup === "checking"
            ? { className: "text-t3", text: "查重中..." }
            : null;

  // 返回功能首頁／登出按鈕組：頁首與最後一張卡片下方各擺一組
  const actionButtons = (
    <>
      <button onClick={() => router.push(backHref)} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
        返回功能首頁
      </button>
      <button onClick={handleLogout} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
        登出
      </button>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度</p>
      </div>

      <div className="w-full max-w-2xl mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">帳號與安全管理</h2>
        <p className="text-t3 text-sm mt-1">{roleLabel}</p>
      </div>

      <div className="w-full max-w-2xl flex justify-end gap-2 mb-4">{actionButtons}</div>

      <hr className="w-full max-w-2xl border-themed mb-4" />

      {/* 資訊卡 */}
      <div className="w-full max-w-2xl border border-themed rounded-lg p-6 mb-4">
        <h3 className="font-bold text-t1 mb-4">資訊</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-t3">姓名：</span>
            <span className="text-t1">{name || "—"}</span>
          </div>
          <div>
            <span className="text-t3">身分：</span>
            <span className="text-t1">{roleLabel}</span>
          </div>
          <div>
            <span className="text-t3">登入次數：</span>
            <span className="text-t1">
              {profile ? (profile.loginCount || 0).toLocaleString() : "—"}
            </span>
          </div>
          <div>
            <span className="text-t3">最後登入：</span>
            <span className="text-t1">{profile ? formatDateTime(profile.lastLogin) : "—"}</span>
          </div>
          {ROLE_SPECIFIC_FIELDS[role].map((f) => (
            <div key={f.key}>
              <span className="text-t3">{f.label}：</span>
              <span className="text-t1">{profile?.fields?.[f.key] || "—"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 帳密管理卡 */}
      <form
        onSubmit={handleSaveAccount}
        noValidate
        className="w-full max-w-2xl border border-themed rounded-lg p-6 mb-4"
      >
        <h3 className="font-bold text-t1 mb-4">帳密管理</h3>

        {accountFlash && (
          <p className={`text-sm mb-3 ${messageClass(accountFlash.type)}`}>{accountFlash.text}</p>
        )}

        <label className="block text-sm text-t2 mb-1">電子郵件地址</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={emailLocked}
          aria-readonly={emailLocked}
          aria-invalid={emailInputInvalid || undefined}
          placeholder={emailValue ? "" : "請輸入電子郵件地址"}
          className={`w-full input-theme rounded px-4 py-2 mb-1${emailLocked ? " opacity-60 cursor-not-allowed" : ""}${emailInputInvalid ? " is-invalid" : ""}`}
          autoComplete="email"
        />
        <div className="mb-4 space-y-1">
          <p className="text-xs text-t3">可留空；電子郵件若為 Gmail，可以透過 Google 登入</p>
          {emailNotice && <p className={`text-xs ${emailNotice.className}`}>{emailNotice.text}</p>}
          {emailFeedback && <p className={`text-xs ${emailFeedback.className}`}>{emailFeedback.text}</p>}
        </div>

        <label className="block text-sm text-t2 mb-1">帳號</label>
        <input
          type="text"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          aria-invalid={accountInputInvalid || undefined}
          className={`w-full input-theme rounded px-4 py-2 mb-1${accountInputInvalid ? " is-invalid" : ""}`}
          autoComplete="username"
        />
        <div className="mb-4 space-y-1">
          <p className="text-xs text-t3">可留空；限 2-64 字元的小寫英文、數字與 . _ @ -</p>
          {accountFeedback && <p className={`text-xs ${accountFeedback.className}`}>{accountFeedback.text}</p>}
          {bothEmpty && (
            <p className="text-xs text-danger font-medium">{ACCOUNT_EMAIL_REQUIRED_MESSAGE}</p>
          )}
        </div>

        <h4 className="font-bold text-t1 mb-3">變更密碼</h4>

        <label className="block text-sm text-t2 mb-1">目前密碼</label>
        <div className="relative mb-3">
          <input
            type={showOld ? "text" : "password"}
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            className="w-full input-theme rounded px-4 py-2 pr-12"
            autoComplete="current-password"
          />
          <PasswordToggleButton
            visible={showOld}
            onToggle={() => setShowOld(!showOld)}
            label="顯示或隱藏目前密碼"
          />
        </div>

        <label className="block text-sm text-t2 mb-1">新密碼（留空則不變更）</label>
        <div className="relative mb-3">
          <input
            type={showNew ? "text" : "password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full input-theme rounded px-4 py-2 pr-12"
            autoComplete="new-password"
          />
          <PasswordToggleButton
            visible={showNew}
            onToggle={() => setShowNew(!showNew)}
            label="顯示或隱藏新密碼"
          />
        </div>

        <label className="block text-sm text-t2 mb-1">確認新密碼</label>
        <div className="relative mb-2">
          <input
            type={showConfirm ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full input-theme rounded px-4 py-2 pr-12"
            autoComplete="new-password"
          />
          <PasswordToggleButton
            visible={showConfirm}
            onToggle={() => setShowConfirm(!showConfirm)}
            label="顯示或隱藏確認新密碼"
          />
        </div>
        <p className="text-xs text-t3 mb-4">{PASSWORD_REQUIREMENT_MESSAGE}</p>

        <button
          type="submit"
          disabled={savingAccount || accountBlocked}
          className="w-full btn-primary rounded py-2 font-medium transition-colors disabled:opacity-50 cursor-pointer"
        >
          {savingAccount ? "儲存中..." : "儲存帳密資料"}
        </button>
      </form>

      {/* 兩階段驗證卡 */}
      <form onSubmit={handleSaveTwoFactor} className="w-full max-w-2xl border border-themed rounded-lg p-6 mb-4">
        <h3 className="font-bold text-t1 mb-4">兩階段驗證</h3>

        {twoFactorFlash && (
          <p className={`text-sm mb-3 ${messageClass(twoFactorFlash.type)}`}>{twoFactorFlash.text}</p>
        )}

        <label className="block text-sm text-t2 mb-1">驗證方式</label>
        <select
          value={twoFactor}
          onChange={(e) => setTwoFactor(e.target.value)}
          className="w-full input-theme rounded px-4 py-2 mb-2"
        >
          {TWO_FACTOR_METHODS.map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-t3 mb-4">
          {twoFactor === "email_otp" && profile
            ? `驗證碼將寄送至 ${profile.email || "您的電子郵件地址"}`
            : twoFactor === "email_notify"
              ? "每次登入成功後寄送通知信，不影響登入流程"
              : twoFactor === "totp"
                ? "請使用驗證器 App（如 Google Authenticator、Microsoft Authenticator）掃描下方 QR Code"
                : "關閉後僅以帳號密碼登入"}
        </p>

        {twoFactor === "totp" && (
          <div className="mb-4 border border-themed rounded p-4">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="TOTP QR Code"
                className="w-40 h-40 mx-auto mb-3 rounded"
                style={{ background: "#ffffff" }}
              />
            ) : (
              <p className="text-sm text-t3 text-center mb-3">
                {otpauthUrl ? "QR Code 產生中..." : "儲存後將自動產生 TOTP 密鑰"}
              </p>
            )}
            <p className="text-xs text-t3 mb-1 break-all">
              金鑰：<span className="font-mono text-t1">{totpSecret || "（尚未產生）"}</span>
            </p>
            <p className="text-xs text-t3 mb-3">
              無法掃描時，可手動將金鑰與帳號加入驗證器 App（型別 TOTP、6 碼、30 秒）。
            </p>
            <button
              type="button"
              onClick={handleRegenerateSecret}
              disabled={savingTwoFactor || !totpSecret}
              className="btn-theme rounded px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
            >
              重新產生密鑰
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={savingTwoFactor}
          className="w-full btn-primary rounded py-2 font-medium transition-colors disabled:opacity-50 cursor-pointer"
        >
          {savingTwoFactor ? "儲存中..." : "儲存設定"}
        </button>
      </form>

      <hr className="w-full max-w-2xl border-themed mb-4" />
      <div className="w-full max-w-2xl flex justify-start gap-2 mb-4">{actionButtons}</div>

      {/* 廣告區域 */}
      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-2xl mt-8">
          <AdSense />
        </div>
      )}

      <div className="w-full max-w-2xl mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );
}
