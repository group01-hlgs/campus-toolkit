"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_HOME, ROLE_LABELS, UserRole, isUserRole } from "@/types/users";
import {
  clearSession,
  fetchSession,
  getCachedSession,
  setCachedSession,
  UserSession,
} from "@/lib/session";

/**
 * 身分切換下拉選單：顯示在各身分功能首頁問候語下方。
 * 僅在本次登入偵測到多個身分時出現；切換不需重新驗證（兩階段驗證屬帳號層級、於登入時完成）。
 */
export default function RoleSwitcher({ role }: { role: UserRole }) {
  const router = useRouter();
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedSession();
    if (cached) {
      setRoles(cached.roles?.length ? cached.roles : [cached.role]);
      return;
    }
    fetchSession(true).then((session) => {
      if (cancelled || !session) return;
      setRoles(session.roles?.length ? session.roles : [session.role]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function switchTo(next: UserRole) {
    if (busy || next === role) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/switch-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 401) {
        clearSession();
        router.push("/");
        return;
      }
      if (!res.ok || !data?.success || !data.user || !isUserRole(data.user.role)) {
        setError(
          typeof data?.message === "string" && data.message
            ? data.message
            : `切換失敗（HTTP ${res.status}）`
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
      };
      if (!user.uid) {
        setError("切換回應格式錯誤，請稍後再試");
        return;
      }
      setCachedSession(user);
      router.push(ROLE_HOME[user.role] || "/");
    } catch {
      setError("系統錯誤，請稍後再試");
    } finally {
      setBusy(false);
    }
  }

  if (roles.length < 2) return null;

  return (
    <div className="mt-2">
      <label className="flex items-center justify-center gap-2 text-sm text-t2">
        <span>切換身分</span>
        <select
          value={role}
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value;
            if (isUserRole(value)) void switchTo(value);
          }}
          className="input-theme rounded px-2 py-1 text-sm cursor-pointer disabled:opacity-50"
        >
          {roles.map((option) => (
            <option key={option} value={option}>
              {ROLE_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-xs text-danger text-center mt-1">{error}</p>}
      {busy && <p className="text-xs text-t3 text-center mt-1">切換中...</p>}
    </div>
  );
}
