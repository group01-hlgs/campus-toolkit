import RoleLayout from "@/components/RoleLayout";
import CalendarView from "@/components/CalendarView";

export default function ParentCalendarPage() {
  return (
    <RoleLayout role="parent">
      <CalendarView role="parent" />
    </RoleLayout>
  );
}
