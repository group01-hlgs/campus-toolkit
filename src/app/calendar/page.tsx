import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import CalendarView from "@/components/CalendarView";
import { readSystemDoc } from "@/lib/settings-server";
import { defaultSettings, type Settings } from "@/types/settings";

export const dynamic = "force-dynamic";

/**
 * 全站統一行事曆頁（未登入與四種身分共用）：
 * 版面骨架比照登入首頁（標題區、裝飾角、廣告與版權機制）；
 * 行程可見性由 API 依 session 過濾——未登入＝公開行程，登入＝依身分＋班級。
 * 各身分舊路由（/{role}/calendar）redirect 到本頁。
 */
export default async function CalendarPage() {
  const raw = await readSystemDoc();
  const settings = { ...defaultSettings, ...(raw ?? {}) } as Settings;

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-3 sm:px-4 pt-[20px]">
      {/* 標題區域 */}
      <div className="text-center mb-6">
        <h1 className="text-4xl font-bold mb-2">數位校園工具箱</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">
          {settings.academicYear} 學年度 第{settings.semester}學期
        </p>
      </div>

      {/* 行事曆顯示區（統一版型；隨瀏覽器寬度響應） */}
      <div className="w-full mb-8">
        <CalendarView />
      </div>

      {/* 廣告區域（比照登入首頁：系統設定開關控制） */}
      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-md mt-4">
          <AdSense />
        </div>
      )}

      {/* 版權宣告（比照登入首頁：系統設定開關控制） */}
      <div className="w-full max-w-md mt-8">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );
}
