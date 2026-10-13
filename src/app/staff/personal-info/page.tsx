import PersonalBasicInfo from "@/components/PersonalBasicInfo";
import RoleLayout from "@/components/RoleLayout";

export default function StaffPersonalInfoPage() {
  return (
    <RoleLayout role="staff">
      <PersonalBasicInfo role="staff" />
    </RoleLayout>
  );
}
