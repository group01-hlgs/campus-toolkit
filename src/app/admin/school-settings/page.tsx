"use client";

import { useRouter } from "next/navigation";

/** 學校基本設定的子功能入口卡片（新增子功能時在這裡加一張） */
const SUB_FEATURE_CARDS = [
  {
    id: "profile",
    href: "/admin/school-settings/profile",
    label: "校務基本資料",
    description: "設定教育階段與學校年制、現任校長與副校長、各校區地址與電話、學校官網。",
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
          d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"
        />
      </svg>
    ),
  },
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
          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6A2.25 2.25 0 0115.75 3.75H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z"
        />
      </svg>
    ),
  },
  {
    id: "classes",
    href: "/admin/school-settings/classes",
    label: "年段班級設定",
    description: "設定年段劃分與各年段涵蓋的年級，並維護每年級的班級代碼與名稱。",
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

/** 「學校基本設定」入口：列出各子功能的卡片，點選進入對應子頁面 */
export default function SchoolSettingsPage() {
  const router = useRouter();

  return (
    <div className="w-full max-w-4xl mb-8">
      <div className="grid gap-4 sm:grid-cols-3">
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
