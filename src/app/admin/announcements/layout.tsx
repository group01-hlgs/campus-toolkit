import AdminSectionShell from "@/components/AdminSectionShell";

export default function AnnouncementsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSectionShell
      moduleKey="announcements"
      title="公告管理"
      description="發佈與管理校園公告，可依身分與班級設定可見範圍；其他模組可經接口掛勾發文。"
      deniedMessage="「公告管理」未被指派給此帳號，請洽超級管理員在名冊或帳號頁指派。"
    >
      {children}
    </AdminSectionShell>
  );
}
