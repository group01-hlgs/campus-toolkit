"use client";

import { useRouter } from "next/navigation";
import OrgUnitEditor from "@/components/OrgUnitEditor";

/** 子功能頁：單位層級設定（學校基本設定 → 單位層級設定） */
export default function OrgUnitSettingsPage() {
  const router = useRouter();

  return (
    <div className="w-full max-w-4xl mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-t3">學校基本設定 ／ 單位層級設定</p>
        <button
          type="button"
          onClick={() => router.push("/admin/school-settings")}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回學校基本設定
        </button>
      </div>

      <section className="border border-themed rounded-lg bg-card p-5">
        <h3 className="text-lg font-bold text-t1">單位層級設定</h3>
        <p className="text-sm text-t3 mt-1">
          決定本校的單位層級數與每層名稱，並設定各單位（處室、組別）的層級與上級單位。
          此為結構性資料，不隨學期變動。
        </p>
        <OrgUnitEditor />
      </section>
    </div>
  );
}
