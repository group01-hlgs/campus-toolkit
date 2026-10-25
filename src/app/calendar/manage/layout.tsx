import AdminSectionShell from "@/components/AdminSectionShell";

export default function CalendarManageLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSectionShell
      moduleKey="calendar"
      title="行事曆管理"
      description="建立與管理校務行程、批次匯入與刪除；可操作範圍依被指派的子權限。"
      deniedMessage="「行事曆」未被指派給此帳號，請洽管理員在「功能模組管理」指派行事曆管理人員與子權限。"
    >
      {children}
    </AdminSectionShell>
  );
}
