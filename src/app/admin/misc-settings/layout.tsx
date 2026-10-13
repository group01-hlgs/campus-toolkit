"use client";

import { ReactNode } from "react";
import AdminSectionShell from "@/components/AdminSectionShell";

export default function MiscSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSectionShell
      moduleKey="miscSettings"
      title="雜項設定"
      description="維護供校務功能共用的其他設定項目。"
      deniedMessage="「雜項設定」僅超級管理員可使用。"
    >
      {children}
    </AdminSectionShell>
  );
}
