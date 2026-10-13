import PersonalBasicInfo from "@/components/PersonalBasicInfo";
import RoleLayout from "@/components/RoleLayout";

export default function StudentPersonalInfoPage() {
  return (
    <RoleLayout role="student">
      <PersonalBasicInfo role="student" />
    </RoleLayout>
  );
}
