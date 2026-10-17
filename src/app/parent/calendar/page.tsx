import { redirect } from "next/navigation";

/** 已併入全站統一行事曆頁 /calendar（無身分差異；行程可見性由 API 依 session 過濾） */
export default function ParentCalendarPage() {
  redirect("/calendar");
}
