"use client";

import { ReactNode } from "react";
import AdminSectionShell from "@/components/AdminSectionShell";

/**
 * 「功能模組管理」共用外殼（標題、權限閘門、頁尾）。
 * 本頁展示產品層級的功能模組（內建／選用列表、總開關與各身分開關），
 * 「功能模組管理」是超級專屬權限模組（modules 為 scope＝superOnly，
 * 一般管理員的 adminModules 不含它，卡片、頁面與 API 皆只對超級開放；
 * 頁面層仍擋一次，寫入 API 另以 requireAdminModule("modules")＋isSuperAdmin 把關）。
 */
export default function ModulesLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSectionShell
      moduleKey="modules"
      title="功能模組管理"
      description="系統的功能模組架構：內建與選用的分類、選用模組的總開關，以及每個模組對四種身分的開關。"
      deniedMessage="「功能模組管理」僅超級管理員可使用。若顯示此訊息但您具超級屬性，代表權限資料讀取失敗，請重新整理。"
    >
      {children}
    </AdminSectionShell>
  );
}
