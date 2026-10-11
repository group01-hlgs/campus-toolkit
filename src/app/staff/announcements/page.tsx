import RoleLayout from "@/components/RoleLayout";
import RolePageShell from "@/components/RolePageShell";
import AnnouncementsInbox from "@/components/AnnouncementsInbox";

export default function StaffAnnouncementsPage() {
  return (
    <RoleLayout role="staff">
      <RolePageShell>
        <AnnouncementsInbox role="staff" canPublish />
      </RolePageShell>
    </RoleLayout>
  );
}
