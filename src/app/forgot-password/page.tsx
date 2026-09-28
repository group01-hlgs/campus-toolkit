"use client";

import { useEffect, useState } from "react";
import { Settings, defaultSettings } from "@/types/settings";
import { normalizeEmail } from "@/lib/validation";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import HomepageCornerWrench from "@/components/HomepageCornerWrench";
import HomepageCornerChangE from "@/components/HomepageCornerChangE";
import HomepageCornerExam from "@/components/HomepageCornerExam";

type ApiResponse = {
  success?: boolean;
  message?: string;
};

const RESEND_COOLDOWN_SECONDS = 60;

export default function ForgotPasswordPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
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

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleSubmit() {
    if (!normalizeEmail(email)) {
      setError("請輸入有效的電子郵件地址");
      return;
    }
    if (cooldown > 0) {
      setError(`請稍候 ${cooldown} 秒後再重新寄送`);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
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
        // 429 等後端訊息對使用者有意義，直接顯示；其餘給一般化提示
        setError(
          res.status === 429 && data?.message
            ? data.message
            : data?.message || "系統錯誤，請稍後再試"
        );
        setLoading(false);
        return;
      }

      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setLoading(false);
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
        {!sent ? (
          <>
            <p className="text-center text-t2 mb-1">忘記密碼</p>
            <p className="text-center text-sm text-t3 mb-4">
              請輸入您的電子郵件地址，我們將寄送密碼重設信件
            </p>

            {/* 身分不在此選擇：同一信箱具備多個身分時由伺服器依慣用身分決定 */}
            <label className="block text-sm font-medium text-t2 mb-2">
              電子郵件地址
            </label>
            <input
              type="email"
              placeholder="example@mail.edu.tw"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full input-theme rounded px-4 py-3 mb-4"
              autoFocus
            />

            {error && (
              <p className="text-danger text-sm text-center mb-4">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full btn-primary rounded py-3 font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? "寄送中..." : "寄送重設密碼信件"}
            </button>

            <p className="text-center text-xs text-t3 mt-3">
              信件中的重設連結有效期為 10 分鐘，且僅能使用一次
            </p>

            <div className="flex items-center gap-3 my-6">
              <hr className="flex-1 border-themed" />
              <span className="text-t3 text-sm">或</span>
              <hr className="flex-1 border-themed" />
            </div>

            <a
              href="/"
              className="block w-full btn-theme rounded py-3 text-center font-medium cursor-pointer"
            >
              返回登入頁
            </a>
          </>
        ) : (
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

            <p className="text-center text-t1 font-medium mb-2">信件已寄出</p>
            <p className="text-center text-sm text-t2 mb-1">
              若該電子郵件已註冊，我們已將密碼重設信件寄至
            </p>
            <p className="text-center text-sm font-medium text-t1 break-all mb-1">
              {email}
            </p>
            <p className="text-center text-xs text-t3 mb-6">
              請於 10 分鐘內依信件指示重設密碼。沒收到嗎？請檢查垃圾郵件匣，
              或確認電子郵件地址後重新寄送。
            </p>

            {error && (
              <p className="text-danger text-sm text-center mb-4">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={cooldown > 0}
              className="w-full btn-primary rounded py-3 font-medium transition-colors disabled:opacity-50 cursor-pointer mb-3"
            >
              {cooldown > 0 ? `重新寄送（${cooldown} 秒後）` : "重新寄送信件"}
            </button>

            <button
              onClick={() => {
                setSent(false);
                setError("");
              }}
              className="w-full btn-theme rounded py-3 font-medium cursor-pointer mb-3"
            >
              更改電子郵件地址
            </button>

            <a
              href="/"
              className="block w-full text-center text-sm text-t3 hover:underline cursor-pointer"
            >
              返回登入頁
            </a>
          </>
        )}
      </div>

      {/* 廣告區域 */}
      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-md mt-8">
          <AdSense />
        </div>
      )}

      {/* 版權宣告 */}
      <div className="w-full max-w-md mt-8">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>

      {/* 寄信 Loading 遮罩（與首頁登入遮罩一致） */}
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
            <p className="text-base font-semibold text-t1">正在寄送信件，請稍候…</p>
            <p className="text-xs text-t3">若該電子郵件已註冊，將收到重設密碼信件</p>
          </div>
        </div>
      )}
    </div>
  );
}
