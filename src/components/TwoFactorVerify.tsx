"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { ROLE_HOME, UserRole, isUserRole } from "@/types/users";
import { setCachedSession } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import { fetchSettings } from "@/lib/settings-client";

type Mode = "email_otp" | "totp";

interface VerifyStatus {
  method: Mode;
  roleLabel: string;
  maskedEmail: string;
  /** 中途憑證到期時間（epoch ms） */
  expiresAt: number;
  /** 可重寄驗證碼的時間（epoch ms），非 email_otp 為 0 */
  resendAt: number;
}

function formatRemaining(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function TwoFactorVerify({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<VerifyStatus | null>(null);
  const [expired, setExpired] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const submittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/auth/2fa", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.success) {
          setExpired(true);
          return;
        }
        if (data.method !== mode) {
          // 方式與頁面不符（後端才知情）：以後端為準重新導向
          router.replace(data.method === "totp" ? "/verify-totp" : "/verify-code");
          return;
        }
        setStatus({
          method: data.method,
          roleLabel: typeof data.roleLabel === "string" ? data.roleLabel : "",
          maskedEmail: typeof data.maskedEmail === "string" ? data.maskedEmail : "",
          expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : 0,
          resendAt: typeof data.resendAt === "number" ? data.resendAt : 0,
        });
      } catch {
        if (!cancelled) setExpired(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [mode, router]);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const data = await fetchSettings();
        if (cancelled) return;
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

  // 每秒更新倒數（驗證碼到期／重送冷卻／TOTP 代碼週期）
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const submit = useCallback(
    async (value: string) => {
      if (submittingRef.current) return;
      if (!/^\d{6}$/.test(value)) {
        setError("請輸入 6 組數字");
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
      setError("");
      try {
        const res = await fetch("/api/auth/2fa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: value }),
        });
        const data = await res.json().catch(() => null);

        if (res.ok && data?.success && data.user?.uid) {
          const roles = Array.isArray(data.user.roles)
            ? data.user.roles.filter(isUserRole)
            : [];
          const user = {
            uid: data.user.uid,
            email: data.user.email || "",
            account: data.user.account || "",
            displayName: data.user.displayName || "",
            role: (isUserRole(data.user.role) ? data.user.role : "") as UserRole,
            roles: roles.length > 0 ? roles : undefined,
            // 首次登入須先改密碼：驗證通過後立即顯示全螢幕遮罩
            mustChangePassword: data.user.mustChangePassword === true,
          };
          if (!user.role) {
            setError("登入回應格式錯誤，請稍後再試");
            return;
          }
          setCachedSession(user);
          router.push(ROLE_HOME[user.role] || "/");
          return;
        }

        // 兩階段驗證已通過、但同一帳號有多個身分：導向選擇身分頁
        if (
          res.ok &&
          Array.isArray(data?.requiresRoleChoice) &&
          data.requiresRoleChoice.length > 0
        ) {
          router.push("/choose-role");
          return;
        }

        if (res.status === 401 && data?.message === "驗證階段已過期，請重新登入") {
          setExpired(true);
          return;
        }
        setError(
          typeof data?.message === "string" && data.message
            ? data.message
            : `驗證失敗（HTTP ${res.status}）`
        );
        setCode("");
      } catch {
        setError("系統錯誤，請稍後再試");
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [router]
  );

  function handleChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setError("");
    if (digits.length === 6) void submit(digits);
  }

  async function handleResend() {
    if (resending) return;
    setResending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setStatus((prev) =>
          prev ? { ...prev, resendAt: typeof data.resendAt === "number" ? data.resendAt : 0 } : prev
        );
      } else if (res.status === 401) {
        setExpired(true);
      } else {
        setError(
          typeof data?.message === "string" && data.message ? data.message : "重送失敗，請稍後再試"
        );
      }
    } catch {
      setError("系統錯誤，請稍後再試");
    } finally {
      setResending(false);
    }
  }

  const remainingSec = status
    ? Math.max(0, Math.ceil((status.expiresAt - now) / 1000))
    : 0;
  const resendSec = status
    ? Math.max(0, Math.ceil((status.resendAt - now) / 1000))
    : 0;
  const totpPeriodSec =
    mode === "totp" ? 30 - Math.floor((now / 1000) % 30) : 0;

  const title = mode === "email_otp" ? "電子郵件驗證碼" : "兩階段驗證";

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      <div className="w-full max-w-md mt-6 border border-themed rounded-lg p-6">
        <h2 className="text-xl font-bold text-t1 mb-1">{title}</h2>
        <p className="text-sm text-t3 mb-4">
          {status?.roleLabel ? `${status.roleLabel}・` : ""}
          {mode === "email_otp"
            ? `驗證碼已寄送至 ${status?.maskedEmail || "您的電子郵件"}`
            : "請輸入驗證器 App 目前顯示的 6 組數字"}
        </p>

        {expired ? (
          <>
            <p className="text-sm text-danger mb-4">驗證階段已過期，請重新登入</p>
            <button
              onClick={() => router.push("/")}
              className="w-full btn-theme rounded py-2 font-medium cursor-pointer"
            >
              返回登入頁
            </button>
          </>
        ) : (
          <>
            <label className="block text-sm text-t2 mb-1">驗證碼</label>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit(code);
              }}
              maxLength={6}
              autoFocus
              className="w-full input-theme rounded px-4 py-3 text-center text-2xl tracking-[0.5em] mb-2"
              placeholder="000000"
            />

            <div className="flex justify-between text-xs text-t3 mb-3">
              <span>
                {mode === "email_otp"
                  ? remainingSec > 0
                    ? `驗證碼尚餘 ${formatRemaining(remainingSec)}`
                    : "驗證碼已過期，請重新登入"
                  : `本組代碼尚餘 ${totpPeriodSec} 秒`}
              </span>
              {mode === "email_otp" && (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending || resendSec > 0 || remainingSec <= 0}
                  className="text-t2 hover:text-t1 underline disabled:no-underline disabled:opacity-50 cursor-pointer"
                >
                  {resendSec > 0 ? `重寄 (${resendSec}s)` : "重新寄送"}
                </button>
              )}
            </div>

            {error && <p className="text-sm text-danger mb-3">{error}</p>}

            <button
              onClick={() => void submit(code)}
              disabled={submitting || code.length !== 6}
              className="w-full btn-primary rounded py-2 font-medium transition-colors disabled:opacity-50 cursor-pointer mb-3"
            >
              {submitting ? "驗證中..." : "驗證並登入"}
            </button>

            <button
              onClick={() => router.push("/")}
              className="w-full btn-theme rounded py-2 text-sm cursor-pointer"
            >
              返回登入頁
            </button>
          </>
        )}
      </div>

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
