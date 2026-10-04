"use client";

import { useRouter } from "next/navigation";
import SchoolClassesEditor from "@/components/SchoolClassesEditor";

/** 子功能頁：年段班級設定（學校基本設定 → 年段班級設定） */
export default function SchoolClassesPage() {
  const router = useRouter();

  return (
    <div className="w-full max-w-4xl mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-t3">學校基本設定 ／ 年段班級設定</p>
        <button
          type="button"
          onClick={() => router.push("/admin/school-settings")}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回學校基本設定
        </button>
      </div>

      <SchoolClassesEditor />
    </div>
  );
}
