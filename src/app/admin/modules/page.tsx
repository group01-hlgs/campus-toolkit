"use client";

import { useRouter } from "next/navigation";
import ModuleIcon from "@/components/ModuleIcon";
import {
  MODULE_CATEGORIES,
  type ModuleCategory,
  type ModuleMeta,
  type ModuleScope,
  type ModuleStatus,
  modulesInCategory,
} from "@/types/modules";

const SCOPE_LABELS: Record<ModuleScope, string> = {
  core: "核心・人人具備",
  assignable: "可指派",
  superOnly: "僅超級管理員",
};

const STATUS_LABELS: Record<ModuleStatus, string> = {
  built: "已上線",
  apiOnly: "API 已上線",
  planned: "規劃中",
};

const CATEGORY_NOTES: Record<ModuleCategory, string> = {
  帳號與權限: "管理登入帳號與各身分名冊，以及管理端操作的稽核。",
  校務資料: "學校本身的基本資料與組織、班級結構。",
  系統與紀錄: "系統層級的設定與功能模組總覽。",
};

/** 單一模組卡片：有入口者可進入，未建頁者標示建置中 */
function ModuleCard({ item }: { item: ModuleMeta }) {
  const router = useRouter();
  const enterable = item.href !== "" && item.status !== "planned";
  return (
    <div
      className={`border border-themed rounded-lg bg-card p-5 flex flex-col gap-2${enterable ? "" : " opacity-70"}`}
    >
      <span className="text-t3">
        <ModuleIcon value={item.value} />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold text-t1">{item.label}</span>
        <span className="text-xs text-t2 border border-themed rounded px-1.5 py-0.5">
          {SCOPE_LABELS[item.scope]}
        </span>
        <span className="text-xs text-t3 border border-themed rounded px-1.5 py-0.5">
          {STATUS_LABELS[item.status]}
        </span>
      </div>
      <p className="text-sm text-t3">{item.description}</p>
      <p className="text-xs text-t2">
        模組代碼：{item.value}
        {item.children.length > 0 ? `｜${item.children.length} 個子功能` : ""}
      </p>
      <div className="mt-auto pt-1">
        {enterable ? (
          <button
            type="button"
            onClick={() => router.push(item.href)}
            className="text-sm text-t2 cursor-pointer hover:text-t1"
          >
            前往 →
          </button>
        ) : (
          <span className="text-sm text-t3">頁面建置中</span>
        )}
      </div>
    </div>
  );
}

/** 「功能模組管理」入口：依分類分區塊列出所有功能模組（唯讀總覽） */
export default function ModulesPage() {
  return (
    <div className="w-full max-w-4xl mb-8 space-y-6">
      {MODULE_CATEGORIES.map((category) => {
        const items = modulesInCategory(category);
        if (items.length === 0) return null;
        return (
          <section key={category}>
            <div className="mb-3">
              <h3 className="text-lg font-bold text-t1">{category}</h3>
              <p className="text-xs text-t3">{CATEGORY_NOTES[category]}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <ModuleCard key={item.value} item={item} />
              ))}
            </div>
          </section>
        );
      })}

      {/* 權限範圍說明 */}
      <section className="border border-themed rounded-lg bg-card p-5">
        <h3 className="text-lg font-bold text-t1 mb-2">權限範圍說明</h3>
        <ul className="text-sm text-t2 space-y-1.5 list-disc pl-5">
          <li>
            <span className="font-bold text-t1">核心</span>
            ：不需指派、每位管理員皆具備（系統設定、功能模組管理）。
          </li>
          <li>
            <span className="font-bold text-t1">可指派</span>
            ：由超級管理員在「身分名冊管理」或「使用者帳號管理」勾選授予。
          </li>
          <li>
            <span className="font-bold text-t1">僅超級管理員</span>
            ：不開放指派，只有超級屬性可用（學校基本設定）。
          </li>
          <li>
            功能模組同時決定管理員首頁卡片是否顯示，以及對應 API 是否放行（未具備一律 403）。
          </li>
          <li>本頁為唯讀總覽；模組的指派請到名冊或帳號頁操作。</li>
        </ul>
      </section>
    </div>
  );
}
