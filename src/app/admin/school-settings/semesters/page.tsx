"use client";

import { useRouter } from "next/navigation";
import SchoolSemesterSettingsEditor from "@/components/SchoolSemesterSettingsEditor";

/** 子功能頁：學期起訖設定（學校基本設定 → 學期起訖設定，危險區） */
export default function SchoolSemestersPage() {
  const router = useRouter();

  return (
    <div className="content-width mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-t3">學校基本設定 ／ 學期起訖設定</p>
        <button
          type="button"
          onClick={() => router.push("/admin/school-settings")}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回學校基本設定
        </button>
      </div>

      <section className="border border-danger rounded-lg bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold text-t1">學期起訖設定</h3>
          <span className="text-xs font-bold text-danger border border-danger rounded px-2 py-0.5">
            危險區
          </span>
        </div>
        <p className="text-sm text-t3 mt-1">
          設定目前的學年度、學年度起訖、學期、學期起訖、上課日，以及寒假與暑假的起訖日期。
          學年度與學期是全站的期間基準，名冊、個資、公告與行事曆等資料皆以它為鍵，
          <span className="text-danger">變更前請務必確認，以免各資料頁切換到非預期的期間</span>。
        </p>
        <SchoolSemesterSettingsEditor />
      </section>
    </div>
  );
}
