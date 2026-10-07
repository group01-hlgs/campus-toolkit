import RoleLayout from "@/components/RoleLayout";
import AnnouncementsInbox from "@/components/AnnouncementsInbox";

export default function StaffAnnouncementsPage() {
  return (
    <RoleLayout role="staff">
      <AnnouncementsInbox role="staff" canPublish />
    </RoleLayout>
  );
}
