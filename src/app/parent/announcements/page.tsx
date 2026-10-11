import RoleLayout from "@/components/RoleLayout";
import RolePageShell from "@/components/RolePageShell";
import AnnouncementsInbox from "@/components/AnnouncementsInbox";

export default function ParentAnnouncementsPage() {
  return (
    <RoleLayout role="parent">
      <RolePageShell>
        <AnnouncementsInbox role="parent" />
      </RolePageShell>
    </RoleLayout>
  );
}
