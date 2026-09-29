import { redirect } from "next/navigation";

/** 改版：「身分管理」併入「身分名冊管理」（每學期啟用狀態移至該頁頂端） */
export default function RoleSettingsPage() {
  redirect("/admin/roster");
}
