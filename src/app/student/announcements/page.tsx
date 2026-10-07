import RoleLayout from "@/components/RoleLayout";
import AnnouncementsInbox from "@/components/AnnouncementsInbox";

export default function StudentAnnouncementsPage() {
  return (
    <RoleLayout role="student">
      <AnnouncementsInbox role="student" />
    </RoleLayout>
  );
}
