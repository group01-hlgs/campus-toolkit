"use client";

import { useRouter } from "next/navigation";
import ModuleIcon from "@/components/ModuleIcon";

export default function MiscSettingsPage() {
  const router = useRouter();

  return (
    <div className="w-full max-w-4xl mb-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => router.push("/admin/misc-settings/postal-codes")}
          className="border border-themed rounded-lg bg-card p-5 text-left flex flex-col gap-2 transition cursor-pointer hover:bg-hover"
        >
          <span className="text-t3"><ModuleIcon value="miscSettings" /></span>
          <span className="text-lg font-bold text-t1">郵遞區號設定</span>
          <span className="text-sm text-t3">維護台灣常用郵遞區號與鄉鎮市區選項。</span>
          <span className="text-sm text-t2 mt-1">進入設定 →</span>
        </button>
      </div>
    </div>
  );
}
