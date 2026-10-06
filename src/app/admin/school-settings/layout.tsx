"use client";

import { ReactNode } from "react";
import AdminSectionShell from "@/components/AdminSectionShell";

/**
 * 「學校基本設定」共用外殼（標題、權限閘門、頁尾）。
 * 本模組僅超級管理員可用（schoolSettings 為超級專屬模組，頁面層擋一次，
 * API 端以 requireAdminModule("schoolSettings") 再擋一次）；
 * 子功能頁面（page.tsx 入口卡片、org 子頁）都包在這個 layout 裡。
 */
export default function SchoolSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSectionShell
      moduleKey="schoolSettings"
      title="學校基本設定"
      description="各項學校基本資料的子功能入口，請點選要設定的項目。"
      deniedMessage="「學校基本設定」僅超級管理員可使用。"
    >
      {children}
    </AdminSectionShell>
  );
}
