import RoleLayout from "@/components/RoleLayout";
import AnnouncementsInbox from "@/components/AnnouncementsInbox";

export default function ParentAnnouncementsPage() {
  return (
    <RoleLayout role="parent">
      <AnnouncementsInbox role="parent" />
    </RoleLayout>
  );
}
