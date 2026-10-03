"use client";

import { useRouter } from "next/navigation";

/** 學校基本設定的子功能入口卡片（新增子功能時在這裡加一張） */
const SUB_FEATURE_CARDS = [
  {
    id: "org",
    href: "/admin/school-settings/org",
    label: "單位層級設定",
    description: "設定學校層級數與各層名稱，並維護各單位（處室、組別）的層級與上級關係。",
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
          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6A2.25 2.25 0 0115.75 3.75H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
        />
      </svg>
    ),
  },
] as const;

/** 「學校基本設定」入口：列出各子功能的卡片，點選進入對應子頁面 */
export default function SchoolSettingsPage() {
  const router = useRouter();

  return (
    <div className="w-full max-w-4xl mb-8">
      <div className="grid gap-4 sm:grid-cols-2">
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
            <span className="text-sm text-t2 mt-1">進入設定 →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
