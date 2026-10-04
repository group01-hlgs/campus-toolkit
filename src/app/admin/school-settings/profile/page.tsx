"use client";

import { useRouter } from "next/navigation";
import SchoolProfileEditor from "@/components/SchoolProfileEditor";

/** 子功能頁：校務基本資料（學校基本設定 → 校務基本資料） */
export default function SchoolProfilePage() {
  const router = useRouter();

  return (
    <div className="w-full max-w-4xl mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-t3">學校基本設定 ／ 校務基本資料</p>
        <button
          type="button"
          onClick={() => router.push("/admin/school-settings")}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回學校基本設定
        </button>
      </div>

      <section className="border border-themed rounded-lg bg-card p-5">
        <h3 className="text-lg font-bold text-t1">校務基本資料</h3>
        <p className="text-sm text-t3 mt-1">
          登記本校的教育階段與學校年制、現任校長與副校長、各校區的地址與電話，以及學校官網。
          此為結構性資料，不隨學期變動。
        </p>
        <SchoolProfileEditor />
      </section>
    </div>
  );
}
