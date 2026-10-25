import AdminSectionShell from "@/components/AdminSectionShell";

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSectionShell
      moduleKey="calendar"
      title="行事曆"
      description="建立與管理校務行程，四種身分皆可檢視；其他模組可經接口掛勾行程。"
      deniedMessage="「行事曆」未被指派給此帳號，請洽管理員在「功能模組管理」指派管理人員與子權限。"
    >
      {children}
    </AdminSectionShell>
  );
}
