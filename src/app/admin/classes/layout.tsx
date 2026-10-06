"use client";

import { ReactNode } from "react";
import AdminSectionShell from "@/components/AdminSectionShell";

/**
 * 「班級管理」共用外殼（標題、權限閘門、頁尾），版面比照「學校基本設定」。
 * 本模組為可指派模組（classes），頁面層以 adminModules 擋一次、
 * API 端以 requireAdminModule("classes") 再擋一次；
 * 版面與資料取得（session／設定）共用 AdminSectionShell。
 */
export default function ClassesLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSectionShell
      moduleKey="classes"
      title="班級管理"
      description="當期各年級班級與每班學生人數，班級名稱旁的名單圖示可查看該班學生名單；班級結構維護於「學校基本設定 → 年段班級設定」。"
      deniedMessage="「班級管理」未被指派給此帳號，請洽超級管理員在名冊或帳號頁指派。"
    >
      {children}
    </AdminSectionShell>
  );
}
