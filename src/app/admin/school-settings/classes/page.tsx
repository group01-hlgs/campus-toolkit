"use client";

import { useRouter } from "next/navigation";
import SchoolClassesEditor from "@/components/SchoolClassesEditor";

/** 子功能頁：年段班級設定（學校基本設定 → 年段班級設定） */
export default function SchoolClassesPage() {
  const router = useRouter();

  return (
    <div className="content-width mb-8">
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

      <section className="border border-themed rounded-lg bg-card p-5">
        <h3 className="text-lg font-bold text-t1">年段班級設定</h3>
        <p className="text-sm text-t3 mt-1">
          設定年段（一個年段＝一個年級）的代碼與名稱，依學制分區管理，並維護各年級的班級清單。
        </p>
        <SchoolClassesEditor />
      </section>
    </div>
  );
}
