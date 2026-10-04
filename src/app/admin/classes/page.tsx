"use client";

import { useRouter } from "next/navigation";

/** 班級管理的子功能入口卡片（新增子功能時在這裡加一張） */
const SUB_FEATURE_CARDS = [
  {
    id: "overview",
    href: "/admin/classes/overview",
    label: "班級總覽",
    description: "檢視當期各年級的班級清單與每班學生人數（唯讀、可搜尋）。",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 5.25h16.5v13.5H3.75V5.25zM8.25 5.25v13.5M3.75 9.75h16.5M3.75 14.25h16.5"
        />
      </svg>
    ),
  },
] as const;

/** 「班級管理」入口：列出各子功能的卡片，點選進入對應子頁面 */
export default function ClassesPage() {
  const router = useRouter();

  return (
    <div className="w-full max-w-4xl mb-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SUB_FEATURE_CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => router.push(card.href)}
            className="border border-themed rounded-lg bg-card p-5 text-left flex flex-col gap-2 transition cursor-pointer hover:bg-hover"
          >
            <span className="text-t3">{card.icon}</span>
            <span className="text-lg font-bold text-t1">{card.label}</span>
            <span className="text-sm text-t3">{card.description}</span>
            <span className="text-sm text-t2 mt-1">進入 →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
