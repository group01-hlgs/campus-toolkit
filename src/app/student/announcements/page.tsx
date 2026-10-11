import RoleLayout from "@/components/RoleLayout";
import RolePageShell from "@/components/RolePageShell";
import AnnouncementsInbox from "@/components/AnnouncementsInbox";

export default function StudentAnnouncementsPage() {
  return (
    <RoleLayout role="student">
      <RolePageShell>
        <AnnouncementsInbox role="student" />
      </RolePageShell>
    </RoleLayout>
  );
}
