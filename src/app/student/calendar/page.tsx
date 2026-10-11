import RoleLayout from "@/components/RoleLayout";
import RolePageShell from "@/components/RolePageShell";
import CalendarView from "@/components/CalendarView";

export default function StudentCalendarPage() {
  return (
    <RoleLayout role="student">
      <RolePageShell>
        <CalendarView role="student" />
      </RolePageShell>
    </RoleLayout>
  );
}
