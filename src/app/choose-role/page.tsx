"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { ROLE_HOME, ROLE_LABELS, UserRole, isUserRole } from "@/types/users";
import { setCachedSession, UserSession } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";

type ApiResponse = {
  success?: boolean;
  message?: string;
  email?: string;
  account?: string;
  displayName?: string;
  roles?: string[];
  user?: {
    uid?: string;
    email?: string;
    account?: string;
    displayName?: string;
    role?: string;
    roles?: string[];
    /** 首次登入須先改密碼（管理員代設的預設密碼） */
    mustChangePassword?: boolean;
  };
};

const EXPIRED_MESSAGE = "驗證階段已過期，請重新登入";

/** 全螢幕遮罩（選擇身分進入中）：淡入過場並擋住下方所有操作 */
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

export default function ChooseRolePage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [identity, setIdentity] = useState("");
  const [roles, setRoles] = useState<UserRole[]>([]);

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/auth/role-choice", { cache: "no-store" });
        const data: ApiResponse | null = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.status === 503) {
          setPaused(true);
          setLoading(false);
          return;
        }
        if (!res.ok || !data?.success) {
          setExpired(true);
          setLoading(false);
          return;
        }
        const list = Array.isArray(data.roles) ? data.roles.filter(isUserRole) : [];
        if (list.length === 0) {
          setExpired(true);
          setLoading(false);
          return;
        }
        setRoles(list);
        setIdentity(
          typeof data.displayName === "string" && data.displayName
            ? data.displayName
            : typeof data.account === "string" && data.account
              ? data.account
              : typeof data.email === "string"
                ? data.email
                : ""
        );
        setLoading(false);
      } catch {
        if (!cancelled) {
          setExpired(true);
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(role: UserRole) {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    // 成功導向功能頁後不關閉遮罩：維持到新頁面渲染完成、本頁卸載為止
    let navigating = false;
    try {
      const res = await fetch("/api/auth/role-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data: ApiResponse | null = await res.json().catch(() => null);

      if (res.status === 503) {
        setPaused(true);
        return;
      }
      if (res.status === 401 || data?.message === EXPIRED_MESSAGE) {
        setExpired(true);
        return;
      }
      if (!res.ok || !data?.success || !data.user || !isUserRole(data.user.role)) {
        setError(
          typeof data?.message === "string" && data.message
            ? data.message
            : `選擇身分失敗（HTTP ${res.status}）`
        );
        return;
      }

      const user: UserSession = {
        uid: data.user.uid || "",
        email: data.user.email || "",
        account: data.user.account || "",
        displayName: data.user.displayName || "",
        role: data.user.role,
        roles: Array.isArray(data.user.roles)
          ? (data.user.roles.filter(isUserRole) as UserRole[])
          : [data.user.role],
        // 首次登入須先改密碼：選完身分後立即顯示全螢幕遮罩
        mustChangePassword: data.user.mustChangePassword === true,
      };
      if (!user.uid) {
        setError("登入回應格式錯誤，請稍後再試");
        return;
      }
      setCachedSession(user);
      navigating = true;
      router.push(ROLE_HOME[user.role] || "/");
    } catch {
      setError("系統錯誤，請稍後再試");
    } finally {
      if (!navigating) setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      <div className="text-center mt-4">
        <h2 className="text-2xl font-bold text-t1">使用身分</h2>
        <p className="text-t2 mt-1">{identity ? `${identity}，您好` : "您好"}</p>
      </div>

      <div className="w-full max-w-md mt-6 border border-themed rounded-lg p-6">
        <h2 className="text-xl font-bold text-t1 mb-4">選擇要進入的身分</h2>

        {loading ? (
          <p className="text-center text-t3 py-6">載入中...</p>
        ) : paused ? (
          <p className="text-sm text-danger">系統目前暫停服務，請稍後再試</p>
        ) : expired ? (
          <p className="text-sm text-danger">{EXPIRED_MESSAGE}</p>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {roles.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => void choose(role)}
                  disabled={submitting}
                  className="w-full btn-soft rounded py-3 font-medium transition-colors cursor-pointer"
                >
                  {`以「${ROLE_LABELS[role]}」身分進入`}
                </button>
              ))}
            </div>

            {error && <p className="text-sm text-danger text-center mt-3">{error}</p>}
          </>
        )}
      </div>

      <p className="w-full max-w-md text-center text-xs text-t3 mt-3">
        提示：登入後可至「帳號、身分與安全管理」設定慣用身分，之後登入將直接使用所選身分，不需再選擇。
      </p>

      <button
        onClick={() => router.push("/")}
        className="w-full max-w-md mt-3 btn-theme rounded py-2 font-medium cursor-pointer"
      >
        返回登入頁
      </button>

      {/* 選擇身分進入中：全螢幕遮罩過場，避免按鈕上做動畫 */}
      {submitting && <BlockingMask text="進入中，請稍候…" />}

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
