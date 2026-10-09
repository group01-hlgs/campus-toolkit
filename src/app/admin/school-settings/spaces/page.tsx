"use client";

import { useRouter } from "next/navigation";
import SchoolSpacesEditor from "@/components/SchoolSpacesEditor";

/** 子功能頁：樓層空間設定（學校基本設定 → 樓層空間設定） */
export default function SchoolSpacesPage() {
  const router = useRouter();

  // 表格欄位多，容器放寬到 max-w-7xl：寬螢幕一次看完整張表，水平卷軸只在真正放不下的窄螢幕出現
  return (
    <div className="w-full max-w-7xl mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-t3">學校基本設定 ／ 樓層空間設定</p>
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
          自訂空間層級分類（如「校區 → 大樓 → 樓層 → 空間」），並維護每個空間的中英文名稱、
          隸屬單位（選自單位層級設定）、是否開放借用、容納人數與空間設備說明，
          供日後空間預約、行事曆地點等欄位引用。結構性資料，不隨學期變動。
        </p>
        <SchoolSpacesEditor />
      </section>
    </div>
  );
}
