import RoleLayout from "@/components/RoleLayout";
import CalendarView from "@/components/CalendarView";

export default function StudentCalendarPage() {
  return (
    <RoleLayout role="student">
      <CalendarView role="student" />
    </RoleLayout>
  );
}
