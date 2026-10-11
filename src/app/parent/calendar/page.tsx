import RoleLayout from "@/components/RoleLayout";
import RolePageShell from "@/components/RolePageShell";
import CalendarView from "@/components/CalendarView";

export default function ParentCalendarPage() {
  return (
    <RoleLayout role="parent">
      <RolePageShell>
        <CalendarView role="parent" />
      </RolePageShell>
    </RoleLayout>
  );
}
