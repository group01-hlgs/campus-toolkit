"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isUserRole, ROLE_HOME } from "@/types/users";
import { isStrongPassword, PASSWORD_REQUIREMENT_MESSAGE } from "@/lib/validation";
import { setCachedSession, UserSession } from "@/lib/session";
import { Settings, defaultSettings } from "@/types/settings";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import HomepageCornerWrench from "@/components/HomepageCornerWrench";
import HomepageCornerChangE from "@/components/HomepageCornerChangE";
import HomepageCornerExam from "@/components/HomepageCornerExam";
import { fetchSettings } from "@/lib/settings-client";

type VerifyResponse = {
  success?: boolean;
  valid?: boolean;
  /** 後端回的 token 狀態（ok / invalid / expired / used） */
  status?: string;
  message?: string;
  remainingSeconds?: number;
  expiresMinutes?: number;
  emailMasked?: string;
  displayName?: string;
};

type ApiResponse = {
  success?: boolean;
  message?: string;
  /** 後端回的 token 狀態（invalid / expired / used） */
  status?: string;
  user?: {
    uid?: string;
    email?: string;
    account?: string;
    displayName?: string;
    role?: string;
  };
};

function formatRemaining(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** 頁面狀態：used／expired 各自對應專屬警示畫面 */
type ResetStatus = "checking" | "valid" | "invalid" | "used" | "expired";

/** 後端 status 字串 → 頁面狀態（非已知狀態一律視為無效連結） */
function toResetStatus(value: string | undefined): "invalid" | "used" | "expired" {
  return value === "used" || value === "expired" ? value : "invalid";
}

/** 顯示／隱藏密碼切換鈕（SVG 圖示，配色跟隨主題的 --t3 / --t1） */
function PasswordToggleButton({
  visible,
  onToggle,
  label,
}: {
  visible: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-t3 hover:text-t1"
    >
      {visible ? (
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
          />
        </svg>
      ) : (
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        </svg>
      )}
    </button>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<ResetStatus>("checking");
  const [statusMessage, setStatusMessage] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [emailMasked, setEmailMasked] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((data) => {
        if (!cancelled && data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
      })
      .catch((err) => console.error("載入設定失敗:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // 進入頁面先驗證連結（不消耗 token）
  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      setStatusMessage("重設連結無效，請重新申請");
      return;
    }

    let cancelled = false;
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        let data: VerifyResponse | null = null;
        try {
          data = (await res.json()) as VerifyResponse;
        } catch {
          data = null;
        }
        if (cancelled) return;
        if (res.ok && data?.valid) {
          setStatus("valid");
          setRemaining(typeof data.remainingSeconds === "number" ? data.remainingSeconds : 0);
          setEmailMasked(data.emailMasked || "");
          setDisplayName(data.displayName || "");
        } else {
          setStatus(toResetStatus(data?.status));
          setStatusMessage(data?.message || "重設連結無效，請重新申請");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("invalid");
        setStatusMessage("驗證連結失敗，請稍後再試");
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // 剩餘有效時間倒數
  useEffect(() => {
    if (status !== "valid" || remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [status, remaining]);

  async function handleSubmit() {
    if (!password || !confirmPassword) {
      setError("請輸入新密碼與確認密碼");
      return;
    }
    if (password !== confirmPassword) {
      setError("兩次密碼不一致");
      return;
    }
    if (!isStrongPassword(password)) {
      setError(PASSWORD_REQUIREMENT_MESSAGE);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });

      let data: ApiResponse | null = null;
      const raw = await res.text();
      if (raw) {
        try {
          data = JSON.parse(raw) as ApiResponse;
        } catch (parseError) {
          console.error("API JSON 解析失敗:", parseError);
        }
      }

      if (!res.ok || !data?.success) {
        if (data?.status === "invalid" || data?.status === "expired" || data?.status === "used") {
          setStatus(toResetStatus(data.status));
          setStatusMessage(data.message || "重設連結已失效，請重新申請");
        } else {
          setError(data?.message || `重設失敗（HTTP ${res.status}）`);
        }
        setLoading(false);
        return;
      }

      const user: UserSession | null = data.user
        ? {
            uid: data.user.uid || "",
            email: data.user.email || "",
            account: data.user.account || "",
            displayName: data.user.displayName || "",
            role: isUserRole(data.user.role) ? data.user.role : "student",
          }
        : null;
      if (user) setCachedSession(user);
      setDone(true);
      setLoading(false);

      setTimeout(() => {
        router.push(user ? ROLE_HOME[user.role] || "/" : "/login");
      }, 2000);
    } catch {
      setError("系統錯誤，請稍後再試");
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSubmit();
    }
  }

  function renderContent() {
    if (status === "checking") {
      return (
        <div className="text-center py-6">
          <div className="flex justify-center mb-3">
            <svg
              className="animate-spin"
              viewBox="0 0 24 24"
              width={32}
              height={32}
              fill="none"
              stroke="var(--t1)"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" stroke="var(--bd)" strokeWidth={2} fill="none" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth={2} />
            </svg>
          </div>
          <p className="text-t2 mb-2">正在驗證重設連結...</p>
          <p className="text-sm text-t3">請稍候片刻</p>
        </div>
      );
    }

    // 已使用過／已過期：專屬警示畫面（圖示為 SVG，配色跟隨主題 --danger）
    if (status === "used" || status === "expired") {
      const used = status === "used";
      return (
        <>
          <div className="flex justify-center mb-4">
            <svg
              className="w-12 h-12 text-danger"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              {used ? (
                <>
                  {/* 盾牌＋驚嘆號：連結已被使用 */}
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 3l7 3v5.5c0 4.14-2.86 7.9-7 9-4.14-1.1-7-4.86-7-9V6l7-3z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8.5v3.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15h.01" />
                </>
              ) : (
                <>
                  {/* 時鐘：連結已超過 10 分鐘有效期 */}
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                </>
              )}
            </svg>
          </div>
          <p className="text-center text-t1 font-medium mb-2">
            {used ? "此重設連結已使用過" : "此重設連結已過期"}
          </p>
          <p className="text-center text-sm text-t2 mb-4">{statusMessage}</p>
          <div className="border border-themed rounded px-4 py-3 mb-6 text-sm text-t2">
            {used
              ? "每個重設連結僅能使用一次。若您剛剛已完成重設，密碼已經更新，可直接返回登入頁登入。"
              : "重設連結有效期為 10 分鐘，過期後即無法使用。為保護帳號安全，請重新申請一封新的重設信件。"}
          </div>
          <a
            href="/forgot-password"
            className="block w-full btn-primary rounded py-3 text-center font-medium cursor-pointer"
          >
            重新申請重設信件
          </a>
          <a
            href="/"
            className="block w-full text-center text-sm text-t3 hover:underline mt-4 cursor-pointer"
          >
            返回登入頁
          </a>
        </>
      );
    }

    if (status === "invalid") {
      return (
        <>
          <div className="flex justify-center mb-4">
            <svg
              className="w-12 h-12 text-danger"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15h.01" />
            </svg>
          </div>
          <p className="text-center text-t1 font-medium mb-2">無法使用此重設連結</p>
          <p className="text-center text-sm text-t2 mb-6">{statusMessage}</p>
          <a
            href="/forgot-password"
            className="block w-full btn-primary rounded py-3 text-center font-medium cursor-pointer"
          >
            重新申請重設信件
          </a>
          <a
            href="/"
            className="block w-full text-center text-sm text-t3 hover:underline mt-4 cursor-pointer"
          >
            返回登入頁
          </a>
        </>
      );
    }

    if (done) {
      return (
        <>
          <div className="flex justify-center mb-4">
            <svg
              className="w-12 h-12 text-success"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-center text-t1 font-medium mb-2">密碼已重設</p>
          <p className="text-center text-sm text-t2 mb-6">
            已自動為您登入，2 秒後導向首頁...
          </p>
          <a
            href="/"
            className="block w-full btn-theme rounded py-3 text-center font-medium cursor-pointer"
          >
            前往首頁
          </a>
        </>
      );
    }

    return (
      <>
        <p className="text-center text-t2 mb-1">重設密碼</p>
        <p className="text-center text-sm text-t3 mb-4">
          {displayName ? `${displayName}，請` : "請"}設定您的新密碼
        </p>

        <div className="flex items-center justify-between border-themed border rounded px-4 py-2 mb-4 text-sm">
          <span className="text-t3 break-all">
            帳戶：{emailMasked || "您的帳號"}
          </span>
          <span className="text-t3 whitespace-nowrap ml-2">
            剩餘 {formatRemaining(remaining)}
          </span>
        </div>

        <label className="block text-sm font-medium text-t2 mb-2">新密碼</label>
        <div className="relative mb-4">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full input-theme rounded px-4 py-3 pr-12"
            autoFocus
          />
          <PasswordToggleButton
            visible={showPassword}
            onToggle={() => setShowPassword(!showPassword)}
            label="顯示或隱藏新密碼"
          />
        </div>

        <label className="block text-sm font-medium text-t2 mb-2">確認新密碼</label>
        <div className="relative mb-2">
          <input
            type={showConfirmPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full input-theme rounded px-4 py-3 pr-12"
          />
          <PasswordToggleButton
            visible={showConfirmPassword}
            onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
            label="顯示或隱藏確認新密碼"
          />
        </div>
        <p className="text-xs text-t3 mb-4">{PASSWORD_REQUIREMENT_MESSAGE}</p>

        {remaining <= 0 && (
          <p className="text-danger text-sm text-center mb-4">
            重設連結已過期，請重新申請
          </p>
        )}
        {error && (
          <p className="text-danger text-sm text-center mb-4">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || remaining <= 0}
          className="w-full btn-primary rounded py-3 font-medium transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading ? "重設中..." : "重設密碼"}
        </button>

        <a
          href="/forgot-password"
          className="block w-full text-center text-sm text-t3 hover:underline mt-4 cursor-pointer"
        >
          改用新的重設連結
        </a>
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-page px-4 pt-[20px]">
      <HomepageCornerWrench />
      <HomepageCornerChangE />
      <HomepageCornerExam />

      {/* 標題區域（與首頁一致） */}
      <div className="text-center mb-6">
        <h1 className="text-4xl font-bold mb-2">數位校園工具箱</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      <hr className="w-full max-w-md border-themed mb-6" />

      <div className="w-full max-w-md border border-themed rounded-lg p-8">
        {renderContent()}
      </div>

      {/* 廣告區域 */}
      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-md mt-8">
          <AdSense />
        </div>
      )}

      <div className="w-full max-w-md mt-8">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>

      {loading && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
        >
          <div className="bg-card rounded-2xl p-8 text-center space-y-4 shadow-lg">
            <div className="flex justify-center">
              <svg
                className="animate-spin"
                viewBox="0 0 24 24"
                width={40}
                height={40}
                fill="none"
                stroke="var(--t1)"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="10" stroke="var(--bd)" strokeWidth={2} fill="none" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth={2} />
              </svg>
            </div>
            <p className="text-base font-semibold text-t1">正在重設密碼，請稍候…</p>
            <p className="text-xs text-t3">完成後將自動為您登入</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-t3">載入中...</p>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
