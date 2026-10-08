import RoleLayout from "@/components/RoleLayout";
import CalendarView from "@/components/CalendarView";

export default function StaffCalendarPage() {
  return (
    <RoleLayout role="staff">
      <CalendarView role="staff" canCreate />
    </RoleLayout>
  );
}
