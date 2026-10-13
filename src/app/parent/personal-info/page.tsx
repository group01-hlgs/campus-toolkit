import PersonalBasicInfo from "@/components/PersonalBasicInfo";
import RoleLayout from "@/components/RoleLayout";

export default function ParentPersonalInfoPage() {
  return (
    <RoleLayout role="parent">
      <PersonalBasicInfo role="parent" />
    </RoleLayout>
  );
}
