"use client";

import { useRouter } from "next/navigation";
import SchoolCodesEditor from "@/components/SchoolCodesEditor";

/** 子功能頁：各式代碼表（學校基本設定 → 各式代碼表） */
export default function SchoolCodesPage() {
  const router = useRouter();

  return (
    <div className="w-full max-w-4xl mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-t3">學校基本設定 ／ 各式代碼表</p>
        <button
          type="button"
          onClick={() => router.push("/admin/school-settings")}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回學校基本設定
        </button>
      </div>

      <section className="border border-themed rounded-lg bg-card p-5">
        <p className="text-sm text-t3">
          維護高級中等學校類型、群別與科別三份代碼清單（系統的基礎資料庫），
          內建預設取自教育部「高級中等學校課程計畫平臺」的官方代碼表，可增修列或還原官方預設。
          「年段班級設定」的班級會用這裡的群別、科別代碼帶入名稱；各份清單預設收合，按標題展開。
        </p>
        <SchoolCodesEditor />
      </section>
    </div>
  );
}
