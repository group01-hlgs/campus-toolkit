"use client";

import { useCallback, useEffect, useState } from "react";
import Toast, { type ToastMessage } from "@/components/Toast";
import DisclosureArrow from "@/components/DisclosureArrow";
import {
  DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS,
  PLAN_STATUS_LABELS,
  PLAN_TIMING_LABELS,
  openStateOf,
  type PlanReview,
  type PlanTiming,
  type PlanWeek,
  type SelfDirectedLearningPlan,
  type SelfDirectedLearningSettings,
} from "../../types/self-directed-learning";

interface Draft {
  topic: string;
  studyGroup: string;
  advisor: string;
  weeks: PlanWeek[];
}

const EMPTY_DRAFT: Draft = { topic: "", studyGroup: "", advisor: "", weeks: [] };

function emptyWeeks(count: number): PlanWeek[] {
  return Array.from({ length: count }, (_, index) => ({
    week: index + 1,
    content: "",
    venue: "",
    timing: "flexible" as PlanTiming,
  }));
}

const WINDOW_LABEL: Record<string, string> = {
  unset: "學校尚未設定開放撰寫時間",
  closed: "尚未開放撰寫",
  open: "開放撰寫中",
  ended: "已超過開放撰寫期限",
};

export default function StudentSelfDirectedLearningPage() {
  const [settings, setSettings] = useState<SelfDirectedLearningSettings>(
    DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS
  );
  const [plan, setPlan] = useState<SelfDirectedLearningPlan | null>(null);
  const [latestReview, setLatestReview] = useState<PlanReview | null>(null);
  const [withinWindow, setWithinWindow] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"save" | "submit" | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const locked = plan?.status === "submitted" || plan?.status === "approved";

  const applyPlan = useCallback((next: SelfDirectedLearningPlan | null) => {
    setPlan(next);
    if (next) {
      setDraft({
        topic: next.topic,
        studyGroup: next.studyGroup,
        advisor: next.advisor,
        weeks: next.weeks.length ? next.weeks : emptyWeeks(1),
      });
    } else {
      setDraft({ ...EMPTY_DRAFT, weeks: emptyWeeks(1) });
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/student/self-directed-learning", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "讀取資料失敗" });
        return;
      }
      setSettings(data.settings as SelfDirectedLearningSettings);
      setLatestReview((data.latestReview as PlanReview | null) ?? null);
      setWithinWindow(Boolean(data.withinWindow));
      applyPlan((data.plan as SelfDirectedLearningPlan | null) ?? null);
    } catch {
      setToast({ kind: "error", text: "讀取資料失敗" });
    } finally {
      setLoading(false);
    }
  }, [applyPlan]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchDraft = (partial: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...partial }));

  const setWeekCount = (count: number) => {
    setDraft((prev) => {
      const weeks = [...prev.weeks];
      if (count > weeks.length) {
        while (weeks.length < count) {
          weeks.push({ week: weeks.length + 1, content: "", venue: "", timing: "flexible" });
        }
      } else {
        weeks.length = count;
      }
      return { ...prev, weeks: weeks.map((week, index) => ({ ...week, week: index + 1 })) };
    });
  };

  const patchWeek = (weekNo: number, partial: Partial<PlanWeek>) => {
    setDraft((prev) => ({
      ...prev,
      weeks: prev.weeks.map((week) => (week.week === weekNo ? { ...week, ...partial } : week)),
    }));
  };

  const submit = async (action: "save" | "submit") => {
    setSaving(action);
    try {
      const response = await fetch("/api/student/self-directed-learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, draft }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "儲存失敗" });
        return;
      }
      setPlan(data.plan as SelfDirectedLearningPlan);
      setToast({ kind: "success", text: action === "submit" ? "已送出審核" : "草稿已儲存" });
      if (action === "submit") void load();
    } catch {
      setToast({ kind: "error", text: "儲存失敗" });
    } finally {
      setSaving(null);
    }
  };

  const windowState = openStateOf(settings);
  const canSubmit = withinWindow && !locked && saving === null;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-xl text-t1">自主學習計畫</h1>
        <p className="text-t2 flex flex-wrap items-center gap-2 text-sm">
          <span
            className={
              plan?.status === "approved"
                ? "text-success"
                : plan?.status === "returned"
                  ? "text-danger"
                  : "text-t2"
            }
          >
            {plan ? PLAN_STATUS_LABELS[plan.status] : "尚未建立計畫"}
          </span>
          <span className={windowState === "open" ? "text-success" : "text-t3"}>
            {WINDOW_LABEL[windowState]}
          </span>
        </p>
      </header>

      {latestReview && (latestReview.decision === "returned" || plan?.status !== "approved") && (
        <section className="border-themed bg-card rounded-lg p-4" aria-label="審查意見">
          <h2 className="text-t1 mb-1 text-sm font-medium">
            最新審查意見（{latestReview.reviewerName || "審核人員"}）
          </h2>
          <p className="text-t2 whitespace-pre-wrap text-sm">{latestReview.note || "（無文字意見）"}</p>
        </section>
      )}

      {settings.instructions.trim() && (
        <details className="border-themed bg-card rounded-lg">
          <summary className="text-t1 flex cursor-pointer items-center gap-2 p-4 font-medium">
            <DisclosureArrow />
            學校說明
          </summary>
          <p className="text-t2 px-4 pb-4 whitespace-pre-wrap text-sm">{settings.instructions}</p>
        </details>
      )}

      <div className="border-themed bg-card space-y-4 rounded-lg p-4">
        <h2 className="text-t1 font-medium">計畫內容</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-t2 block space-y-1 text-sm">
            <span>主題 *</span>
            <input
              type="text"
              className="input-theme w-full"
              value={draft.topic}
              maxLength={100}
              disabled={locked}
              onChange={(event) => patchDraft({ topic: event.target.value })}
              placeholder="如：城市影像的光與構圖"
            />
          </label>
          <label className="text-t2 block space-y-1 text-sm">
            <span>學群 *</span>
            <input
              type="text"
              className="input-theme w-full"
              value={draft.studyGroup}
              maxLength={100}
              disabled={locked}
              onChange={(event) => patchDraft({ studyGroup: event.target.value })}
              placeholder="如：藝術與人文"
            />
          </label>
        </div>
        <label className="text-t2 block space-y-1 text-sm">
          <span>指導老師（非必填）</span>
          <input
            type="text"
            className="input-theme w-full sm:max-w-md"
            value={draft.advisor}
            maxLength={100}
            disabled={locked}
            onChange={(event) => patchDraft({ advisor: event.target.value })}
            placeholder="如：王老師（校內）／校外相關領域人士"
          />
        </label>
      </div>

      <div className="border-themed bg-card space-y-4 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-t1 font-medium">逐週課程安排</h2>
          <label className="text-t2 flex items-center gap-2 text-sm">
            方案週數
            <select
              className="input-theme"
              value={draft.weeks.length}
              disabled={locked}
              onChange={(event) => setWeekCount(Number(event.target.value))}
            >
              {Array.from({ length: Math.max(settings.maxWeeks, 1) }, (_, index) => index + 1).map(
                (count) => (
                  <option key={count} value={count}>
                    {count} 週
                  </option>
                )
              )}
            </select>
          </label>
        </div>

        <datalist id="sdl-venues">
          {settings.venues.map((venue) => (
            <option key={venue} value={venue} />
          ))}
        </datalist>

        <div className="space-y-3">
          {draft.weeks.map((week) => (
            <div key={week.week} className="border-themed bg-surface rounded-md p-3">
              <div className="text-t1 mb-2 text-sm font-medium">第 {week.week} 週</div>
              <div className="grid gap-3">
                <label className="text-t2 block space-y-1 text-sm">
                  <span>學習安排</span>
                  <textarea
                    className="input-theme min-h-20 w-full"
                    value={week.content}
                    maxLength={600}
                    disabled={locked}
                    onChange={(event) => patchWeek(week.week, { content: event.target.value })}
                    placeholder="本週預計學習的內容、進度與方式"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-t2 block space-y-1 text-sm">
                    <span>場地</span>
                    <input
                      type="text"
                      className="input-theme w-full"
                      value={week.venue}
                      list="sdl-venues"
                      maxLength={120}
                      disabled={locked}
                      onChange={(event) => patchWeek(week.week, { venue: event.target.value })}
                      placeholder="圖書館自習室（可輸入或點選開放場域）"
                    />
                  </label>
                  <label className="text-t2 block space-y-1 text-sm">
                    <span>時段</span>
                    <select
                      className="input-theme w-full"
                      value={week.timing}
                      disabled={locked}
                      onChange={(event) =>
                        patchWeek(week.week, { timing: event.target.value as PlanTiming })
                      }
                    >
                      {(["flexible", "afterSchool"] as const).map((timing) => (
                        <option key={timing} value={timing}>
                          {PLAN_TIMING_LABELS[timing]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          className="btn-theme px-6"
          disabled={locked || saving !== null || loading}
          onClick={() => void submit("save")}
        >
          {saving === "save" ? "儲存中…" : "儲存草稿"}
        </button>
        <button
          type="button"
          className="btn-primary btn-theme px-6"
          disabled={!canSubmit || loading}
          onClick={() => void submit("submit")}
          title={withinWindow ? "" : WINDOW_LABEL[windowState]}
        >
          {saving === "submit" ? "送出中…" : "送出審核"}
        </button>
      </div>

      <Toast message={toast} onClose={() => setToast(null)} />
    </section>
  );
}
