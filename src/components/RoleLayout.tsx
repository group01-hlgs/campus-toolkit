"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSession } from "@/lib/session";

/**
 * 系統開關狀態。
 * - open：系統啟用，照常做身分檢查
 * - closed：系統停用，非管理員的身分頁一律關閉（管理員走 /admin 自己的 layout）
 * - loading：尚未判定
 */
type GateState = "loading" | "open" | "closed";

/**
 * 讀取公開設定的 systemEnabled。
 * 讀不到時視為「啟用」（fail-open）：真正的關閉由 dal.verifySession 在伺服器端強制，
 * 前端這裡若因網路問題誤判成關閉，會把所有師生關在門外。
 */
async function fetchSystemEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (!res.ok) return true;
    const data = await res.json();
    const enabled = data?.settings?.systemEnabled;
    return typeof enabled === "boolean" ? enabled : true;
  } catch {
    return true;
  }
}

export default function RoleLayout({
  children,
  role,
}: {
  children: React.ReactNode;
  role: "student" | "parent" | "staff";
}) {
  const router = useRouter();
  const [gate, setGate] = useState<GateState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // 平行取得，避免正常情況下多等一輪
      const [session, systemEnabled] = await Promise.all([
        fetchSession(true),
        fetchSystemEnabled(),
      ]);
      if (cancelled) return;

      // 系統停用：此身分的所有功能關閉，只留說明與返回首頁
      if (!systemEnabled) {
        setGate("closed");
        return;
      }

      if (!session || session.role !== role) {
        router.push("/");
        return;
      }
      setGate("open");
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, [router, role]);

  // 判定完成前不渲染子頁，避免系統停用時先閃過一頁可操作的內容
  if (gate === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-t3">載入中...</p>
      </div>
    );
  }

  if (gate === "closed") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-page px-4 text-center">
        <h1 className="text-2xl font-bold mb-2">系統目前暫停服務</h1>
        <p className="text-t2 mb-6">此身分的所有功能已關閉，僅管理員可使用系統</p>
        <button
          onClick={() => router.push("/")}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回首頁
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
