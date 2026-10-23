"use client";

import { useRouter } from "next/navigation";
import SchoolPeriodsEditor from "@/components/SchoolPeriodsEditor";

/** 子功能頁：課表作息時間（學校基本設定 → 課表作息時間） */
export default function SchoolPeriodsPage() {
  const router = useRouter();

  return (
    <div className="content-width mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-t3">學校基本設定 ／ 課表作息時間</p>
        <button
          type="button"
          onClick={() => router.push("/admin/school-settings")}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回學校基本設定
        </button>
      </div>

      <section className="border border-themed rounded-lg bg-card p-5">
        <h3 className="text-lg font-bold text-t1">課表作息時間</h3>
        <p className="text-sm text-t3 mt-1">
          設定上課星期，並維護每日節次的主要節次代碼、節次序號、節次名稱與起訖時間，
          含午休等非授課時段（節次填 0）。此為結構性資料，不隨學期變動。
        </p>
        <SchoolPeriodsEditor />
      </section>
    </div>
  );
}
