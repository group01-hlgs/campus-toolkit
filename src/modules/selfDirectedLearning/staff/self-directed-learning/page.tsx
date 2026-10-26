"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AdSense from "@/components/AdSense";
import Copyright from "@/components/Copyright";
import Toast, { type ToastMessage } from "@/components/Toast";
import DisclosureArrow from "@/components/DisclosureArrow";
import { RichTextContent } from "../../components/rich-text-editor";
import { fetchSettings } from "@/lib/settings-client";
import { logout } from "@/lib/session";
import { Settings, defaultSettings } from "@/types/settings";
import {
  MAINTENANCE_HINT,
  MAINTENANCE_TITLE,
  PLAN_STATUS_LABELS,
  PLAN_TIMING_LABELS,
  type SelfDirectedLearningPlan,
} from "../../types/self-directed-learning";
import SelfDirectedLearningManagerPanel from "../../components/manager-panel";

interface StaffRoles {
  isReviewer: boolean;
  isTutor: boolean;
  classCode: string;
  permissions: string[];
}

type Tab = "review" | "class";

interface PendingReview {
  planId: string;
  action: "approve" | "return";
  topic: string;
}

function formatDateTime(epoch: number | null): string {
  if (!epoch) return "—";
  const d = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_CLASS: Record<string, string> = {
  approved: "text-success",
  returned: "text-danger",
};

export default function StaffSelfDirectedLearningPage() {
  const router = useRouter();
  const [systemSettings, setSystemSettings] = useState<Settings>(defaultSettings);
  const [roles, setRoles] = useState<StaffRoles | null>(null);
  const [plans, setPlans] = useState<SelfDirectedLearningPlan[]>([]);
  const [tab, setTab] = useState<Tab>("review");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingReview | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  /** 總開關關閉：只顯示維護說明 */
  const [maintenance, setMaintenance] = useState(false);

  const load = useCallback(async (mode: Tab) => {
    try {
      const response = await fetch(
        `/api/staff/self-directed-learning?mode=${mode}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "讀取資料失敗" });
        setPlans([]);
        return;
      }
      setRoles((data.roles as StaffRoles) ?? null);
      setMaintenance(Boolean(data.maintenance));
      setPlans((data.plans as SelfDirectedLearningPlan[]) || []);
    } catch {
      setToast({ kind: "error", text: "讀取資料失敗" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchSettings();
        if (!cancelled && data?.success && data.settings) {
          setSystemSettings({ ...defaultSettings, ...data.settings });
        }
      } catch {
        // 設定讀取失敗時沿用預設值顯示
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const switchTab = (next: Tab) => {
    setTab(next);
    setLoading(true);
    void load(next);
  };

  const confirmReview = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const response = await fetch("/api/staff/self-directed-learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: pending.planId,
          action: pending.action,
          note: notes[pending.planId] || "",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "審核處理失敗" });
        return;
      }
      setToast({
        kind: "success",
        text: pending.action === "approve" ? "已通過審核" : "已退回並送出意見",
      });
      setPending(null);
      await load(tab);
    } catch {
      setToast({ kind: "error", text: "審核處理失敗" });
    } finally {
      setBusy(false);
    }
  };

  const hasAnyRole = Boolean(
    roles?.isReviewer || roles?.isTutor || (roles?.permissions?.length ?? 0) > 0
  );

  const roleSummary = [
    roles?.isReviewer ? "你具有審核資格。" : "",
    roles?.isTutor ? `兼導師班級：${roles.classCode}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const actionButtons = (
    <>
      <button
        type="button"
        onClick={() => router.push("/staff")}
        className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
      >
        返回功能首頁
      </button>
      <button
        type="button"
        onClick={() => {
          void logout();
          router.push("/");
        }}
        className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
      >
        登出
      </button>
    </>
  );

  /** 頁面外殼：與「升學考試與模擬考校內報名」教職員頁一致（內容顯示區由 inner 帶入） */
  const renderShell = (inner: ReactNode) => (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      <Toast message={toast} onClose={() => setToast(null)} />

      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">
          {systemSettings.systemName || "數位校園工具箱"}
        </h1>
        <p className="text-xl text-t2">{systemSettings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">
          {systemSettings.academicYear} 學年度 第{systemSettings.semester}學期
        </p>
      </div>

      <div className="content-width mt-4 mb-6 text-center">
        <h2 className="text-2xl font-bold text-t1">自主學習計畫－審核與檢視</h2>
        {roleSummary && <p className="text-sm text-t2 mt-2">{roleSummary}</p>}
      </div>

      <div className="content-width flex justify-end gap-3 mb-4">{actionButtons}</div>
      <hr className="content-width border-themed mb-4" />

      {/* 被指派管理者：同一頁內提供被授權的管理功能（未被指派者不顯示） */}
      <SelfDirectedLearningManagerPanel />

      <div className="content-width space-y-4 mb-8">{inner}</div>

      <hr className="content-width border-themed mb-4" />
      <div className="content-width flex justify-start gap-3 mb-8">{actionButtons}</div>

      {systemSettings.sponsorAdEnabled && (
        <div className="content-width">
          <AdSense />
        </div>
      )}

      <div className="content-width mt-auto">
        <Copyright mode={systemSettings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );

  // 總開關關閉：只見維護說明（計畫清單不呈現、審核不開放）
  if (!loading && maintenance) {
    return renderShell(
      <div className="border-themed bg-card space-y-2 rounded-lg p-6 text-center">
        <p className="text-t1 text-lg font-medium">{MAINTENANCE_TITLE}</p>
        <p className="text-t2 text-sm">{MAINTENANCE_HINT}</p>
      </div>
    );
  }

  if (!loading && !hasAnyRole) {
    return renderShell(
      <div className="border-themed bg-card text-t2 rounded-lg p-4 text-sm">
        你的帳號不在本模組的審核人員名單內，也未具兼導師身分。
        若需審核權限，請洽管理員在「管理規則」中加入審核人員名單。
      </div>
    );
  }

  return renderShell(
    <>
      {roles?.isReviewer && roles?.isTutor && (
        <div className="border-themed bg-card flex gap-2 rounded-lg p-2" role="tablist" aria-label="檢視模式">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "review"}
            className={`h-9 flex-1 rounded-md px-3 text-sm font-medium ${
              tab === "review" ? "bg-primary-soft text-primary" : "text-t2"
            }`}
            onClick={() => switchTab("review")}
          >
            審核佇列
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "class"}
            className={`h-9 flex-1 rounded-md px-3 text-sm font-medium ${
              tab === "class" ? "bg-primary-soft text-primary" : "text-t2"
            }`}
            onClick={() => switchTab("class")}
          >
            我的班級
          </button>
        </div>
      )}

      {loading ? (
        <div className="border-themed bg-card text-t2 rounded-lg p-4 text-sm">載入中…</div>
      ) : plans.length === 0 ? (
        <div className="border-themed bg-card text-t2 rounded-lg p-4 text-sm">
          {tab === "review" ? "目前沒有待審核的計畫。" : "本班目前沒有自主學習計畫資料。"}
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => (
            <article key={plan.id} className="border-themed bg-card rounded-lg p-4">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-t1 font-medium">
                    {plan.studentName}
                    <span className="text-t3 ml-2 text-xs">
                      {plan.grade}
                      {plan.className || plan.classCode}
                    </span>
                  </h2>
                  <p className="text-t2 mt-1 text-sm">
                    {plan.topic} ｜ {plan.studyGroup}
                    {plan.advisor ? ` ｜ 指導老師：${plan.advisor}` : ""}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <span className={STATUS_CLASS[plan.status] || "text-t2"}>
                    {PLAN_STATUS_LABELS[plan.status]}
                  </span>
                  <div className="text-t3">送出：{formatDateTime(plan.submittedAt)}</div>
                </div>
              </div>

              <details className="border-themed bg-surface mt-2 rounded-md">
                <summary className="text-t1 flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                  <DisclosureArrow />
                  檢視逐週安排（{plan.weeks.length} 週）
                </summary>
                <ul className="space-y-2 px-3 pb-3">
                  {plan.weeks.map((week) => (
                    <li key={week.week} className="text-t2 border-themed rounded-md p-2 text-sm">
                      <div className="text-t1 mb-1 flex flex-wrap gap-3 text-xs font-medium">
                        <span>第 {week.week} 週</span>
                        <span>{PLAN_TIMING_LABELS[week.timing]}</span>
                        <span className="text-t3">{week.venue}</span>
                      </div>
                      <RichTextContent html={week.content} />
                    </li>
                  ))}
                </ul>
              </details>

              {roles?.isReviewer && plan.status === "submitted" && (
                <div className="mt-3 space-y-2">
                  <label className="text-t2 block space-y-1 text-sm">
                    <span>審查意見（退回時必填）</span>
                    <textarea
                      className="input-theme min-h-16 w-full rounded px-3 py-2 text-sm"
                      maxLength={1000}
                      value={notes[plan.id] || ""}
                      onChange={(event) =>
                        setNotes((prev) => ({ ...prev, [plan.id]: event.target.value }))
                      }
                      placeholder="給學生的審查意見…"
                    />
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className="btn-danger btn-theme h-9 px-4 text-sm"
                      onClick={() =>
                        setPending({ planId: plan.id, action: "return", topic: plan.topic })
                      }
                    >
                      退回修改
                    </button>
                    <button
                      type="button"
                      className="btn-primary btn-theme h-9 px-4 text-sm"
                      onClick={() =>
                        setPending({ planId: plan.id, action: "approve", topic: plan.topic })
                      }
                    >
                      通過審核
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.4)] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sdl-review-confirm-title"
        >
          <div className="border-themed bg-card w-full max-w-md rounded-xl p-5 shadow-lg">
            <h2 id="sdl-review-confirm-title" className="text-t1 mb-2 font-semibold">
              {pending.action === "approve" ? "確認通過審核？" : "確認退回這份計畫？"}
            </h2>
            <p className="text-t2 mb-4 text-sm">
              《{pending.topic}》
              {pending.action === "return" && !(notes[pending.planId] || "").trim()
                ? "　退回必填審查意見，請先於卡片填寫。"
                : ""}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-theme h-9 px-4 text-sm"
                onClick={() => setPending(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={`btn-theme h-9 px-4 text-sm ${
                  pending.action === "approve" ? "btn-primary" : "btn-danger"
                }`}
                disabled={
                  busy ||
                  (pending.action === "return" && !(notes[pending.planId] || "").trim())
                }
                onClick={() => void confirmReview()}
              >
                {busy ? "處理中…" : "確定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
