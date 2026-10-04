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

      <section className="border border-themed rounded-lg bg-card p-5">
        <h3 className="text-lg font-bold text-t1">年段班級設定</h3>
        <p className="text-sm text-t3 mt-1">
          設定本校的年段（一個年段＝一個年級，學制由年級編號自動推導）與各年級的代碼、名稱，
          以及每年級的班級清單；畫面依校務基本資料的學制分區。
          可建立的年段數受校務基本資料的年制總和限制。此為結構性資料，不隨學期變動。
        </p>
        <SchoolClassesEditor />
      </section>
    </div>
  );
}
