"use client";

import { useEffect, useState } from "react";
import { isStrongPassword, PASSWORD_REQUIREMENT_MESSAGE } from "@/lib/validation";
import { Settings, defaultSettings } from "@/types/settings";
import AdSense from "@/components/AdSense";

export default function SetupPage() {
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);

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
    let cancelled = false;
    fetch("/api/admin/create")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setAvailable(Boolean(data.available));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit() {
    setError("");
    setSuccess("");

    if (!email || !account || !password) {
      setError("請填寫完整資訊");
      return;
    }

    if (password !== confirmPassword) {
      setError("兩次密碼不一致");
      return;
    }

    if (password.length < 8 || !isStrongPassword(password)) {
      setError(PASSWORD_REQUIREMENT_MESSAGE);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/admin/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, account, password, displayName }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.message);
        setLoading(false);
        return;
      }

      setSuccess("管理員建立成功！3 秒後導向登入頁...");
      setTimeout(() => {
        window.location.href = "/";
      }, 3000);
    } catch {
      setError("系統錯誤，請稍後再試");
      setLoading(false);
    }
  }

  if (available === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-page px-4">
        <div className="w-full max-w-md text-center">
          <h1 className="text-3xl font-bold mb-2">數位校園工具箱</h1>
          <p className="text-t3">初始設定已停用</p>
          <a href="/" className="inline-block mt-6 underline">
            返回首頁
          </a>
        </div>

        {/* 廣告區域 */}
        {settings.sponsorAdEnabled && (
          <div className="w-full max-w-md mt-8">
            <AdSense />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">數位校園工具箱</h1>
          <p className="text-t3">首次設定 - 建立管理員帳號</p>
        </div>

        <div className="bg-card rounded-lg shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-t2 mb-1">電子郵件 *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full input-theme rounded px-3 py-2"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-t2 mb-1">登入帳號 *</label>
            <input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="w-full input-theme rounded px-3 py-2"
              placeholder="admin"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-t2 mb-1">顯示名稱</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full input-theme rounded px-3 py-2"
              placeholder="系統管理員"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-t2 mb-1">密碼 *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full input-theme rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-t2 mb-1">確認密碼 *</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full input-theme rounded px-3 py-2"
            />
          </div>

          {error && <p className="text-danger text-sm text-center">{error}</p>}
          {success && <p className="text-success text-sm text-center">{success}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full btn-primary py-3 rounded font-medium disabled:opacity-50 cursor-pointer"
          >
            {loading ? "建立中..." : "建立管理員"}
          </button>
        </div>

        {/* 廣告區域 */}
        {settings.sponsorAdEnabled && (
          <div className="mt-8">
            <AdSense />
          </div>
        )}
      </div>
    </div>
  );
}
