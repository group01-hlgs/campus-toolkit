import RoleLayout from "@/components/RoleLayout";
import RolePageShell from "@/components/RolePageShell";
import CalendarView from "@/components/CalendarView";

export default function StaffCalendarPage() {
  return (
    <RoleLayout role="staff">
      <RolePageShell>
        <CalendarView role="staff" canCreate />
      </RolePageShell>
    </RoleLayout>
  );
}
