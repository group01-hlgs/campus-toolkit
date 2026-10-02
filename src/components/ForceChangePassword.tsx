"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSession, getCachedSession, logout, subscribeSession, UserSession } from "@/lib/session";
import { isStrongPassword, PASSWORD_REQUIREMENT_MESSAGE } from "@/lib/validation";
import PasswordToggleButton from "@/components/PasswordToggleButton";

/**
 * 首次登入強制修改密碼的全螢幕遮罩（掛在 ClientLayout，涵蓋所有身分頁）。
 * 旗標＝使用者文件的 mustChangePassword（管理員建立帳號／重設密碼時標記），
 * 本人改密或一次性連結重設後清除，重新取 session 即自動消失。
 * 只影響畫面：未取得 session、讀不到旗標時一律放行（不擋）。
 */
export default function ForceChangePassword() {
  const router = useRouter();
  // undefined＝尚未取得 session：先不顯示，避免每次載入閃一下遮罩
  const [session, setSession] = useState<UserSession | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (!cancelled) setSession(getCachedSession());
    };
    // 登入／改密／切換身分都會更新 session 快取：訂閱讓旗標變化即時反應
    const unsubscribe = subscribeSession(sync);
    fetchSession(true).then(sync);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (!isStrongPassword(password)) {
      setError(PASSWORD_REQUIREMENT_MESSAGE);
      return;
    }
    if (password !== confirm) {
      setError("兩次輸入的密碼不一致");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "修改失敗");
      }
      setPassword("");
      setConfirm("");
      // 改密 API 會撤銷舊 session 並重建；重新取 session 取得已清除的旗標
      setSession(await fetchSession(true));
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失敗");
    } finally {
      setSaving(false);
    }
  }

  function handleLogout() {
    void logout();
    router.push("/");
  }

  if (session?.mustChangePassword !== true) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-change-password-title"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-card border border-themed rounded-2xl p-8 space-y-4 shadow-lg animate-fade-in w-full max-w-md"
        style={{ boxShadow: "var(--sh)" }}
      >
        <div className="flex justify-center">
          <svg
            className="w-12 h-12 text-warning"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </div>

        <div className="text-center space-y-1">
          <p id="force-change-password-title" className="text-lg font-semibold text-t1">
            請先修改密碼
          </p>
          <p className="text-sm text-t2">
            您目前使用的是管理員代設的預設密碼。為保障帳號安全，請先設定新密碼後再繼續使用系統。
          </p>
          {(session?.displayName || session?.account) && (
            <p className="text-xs text-t3">
              目前帳號：{session?.displayName || session?.account}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm text-t2 mb-1" htmlFor="force-new-password">
            新密碼
          </label>
          <div className="relative">
            <input
              id="force-new-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              className="w-full input-theme rounded px-4 py-2 pr-12"
            />
            <PasswordToggleButton
              visible={showPassword}
              onToggle={() => setShowPassword((prev) => !prev)}
              label="顯示或隱藏新密碼"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-t2 mb-1" htmlFor="force-confirm-password">
            確認新密碼
          </label>
          <div className="relative">
            <input
              id="force-confirm-password"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full input-theme rounded px-4 py-2 pr-12"
            />
            <PasswordToggleButton
              visible={showPassword}
              onToggle={() => setShowPassword((prev) => !prev)}
              label="顯示或隱藏確認新密碼"
            />
          </div>
        </div>

        <p className="text-xs text-t3">{PASSWORD_REQUIREMENT_MESSAGE}</p>

        {error && (
          <p className="text-sm text-t1 border border-themed rounded px-3 py-2" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 btn-primary rounded-lg px-4 py-2 text-sm font-medium cursor-pointer disabled:opacity-50"
          >
            {saving ? "儲存中..." : "確認修改"}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="btn-danger rounded-lg px-4 py-2 text-sm font-medium cursor-pointer"
          >
            登出
          </button>
        </div>
      </form>
    </div>
  );
}
