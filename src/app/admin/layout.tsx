"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchSession } from "@/lib/session";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetchSession(true).then((session) => {
      if (cancelled) return;
      // 管理員，或被指定管理任一模組的非管理員身分（政策修改書 G3）可進入 /admin
      const canEnter =
        session &&
        (session.role === "admin" ||
          (Array.isArray(session.delegatedModules) && session.delegatedModules.length > 0));
      if (!canEnter) {
        router.push("/");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return <>{children}</>;
}
