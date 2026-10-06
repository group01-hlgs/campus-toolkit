"use client";

import { ReactNode } from "react";
import AdminSectionShell from "@/components/AdminSectionShell";

/**
 * 「統計儀表板」共用外殼（標題、權限閘門、頁尾）。
 * 本頁展示 Vercel 與 Firebase（Firestore）的使用量與免費額度對照；
 * 「統計儀表板」是超級專屬權限模組（stats 為 scope＝superOnly，
 * 一般管理員的 adminModules 不含它，卡片、頁面與 API 皆只對超級開放；
 * 頁面層以本 layout 擋一次，API 另以 requireAdminModule("stats") 把關）。
 */
export default function StatsLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSectionShell
      moduleKey="stats"
      title="統計儀表板"
      description="Vercel 與 Firebase（Firestore）的使用量對照免費額度，以及 Firestore 近 7 日讀寫趨勢。"
      deniedMessage="「統計儀表板」僅超級管理員可使用。若顯示此訊息但您具超級屬性，代表權限資料讀取失敗，請重新整理。"
    >
      {children}
    </AdminSectionShell>
  );
}
