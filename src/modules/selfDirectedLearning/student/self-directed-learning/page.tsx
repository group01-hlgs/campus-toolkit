"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AdSense from "@/components/AdSense";
import Copyright from "@/components/Copyright";
import Toast, { type ToastMessage } from "@/components/Toast";
import DisclosureArrow from "@/components/DisclosureArrow";
import { RichTextContent, RichTextEditor } from "../../components/rich-text-editor";
import { fetchSettings } from "@/lib/settings-client";
import { logout } from "@/lib/session";
import { Settings, defaultSettings } from "@/types/settings";
import {
  DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS,
  MAINTENANCE_HINT,
  MAINTENANCE_TITLE,
  MAX_PLAN_WEEKS,
  PLAN_STATUS_LABELS,
  PLAN_TIMING_LABELS,
  PRINT_PREVIEW_DATA,
  PRINT_PREVIEW_READY,
  WEEKDAY_LABELS,
  openStateOf,
  type PlanStatus,
  type PlanTiming,
  type PlanWeek,
  type PlanReview,
  type PrintPreviewPayload,
  type SelfDirectedLearningPlan,
  type SelfDirectedLearningSettings,
  type WeekSchedule,
} from "../../types/self-directed-learning";

interface StudentInfo {
  name: string;
  className: string;
}

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

function formatDateTime(epoch: number | null): string {
  if (!epoch) return "—";
  const d = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 逐週表格的短日期（`YYYY-MM-DD` → `M/D`） */
function monthDayText(date: string): string {
  const [, month, day] = date.split("-");
  if (!month || !day) return date;
  return `${Number(month)}/${Number(day)}`;
}

/** 學期識別（如 115-1）轉為易讀文字 */
function periodText(period: string): string {
  const [year, semester] = period.split("-");
  if (!year || !semester) return period || "—";
  return `${year} 學年度第 ${semester} 學期`;
}

function statusClass(status: PlanStatus): string {
  if (status === "approved") return "text-success";
  if (status === "returned") return "text-danger";
  if (status === "submitted") return "text-warning";
  return "text-t3";
}

/**
 * 依設定補齊草稿週數：
 * 全學期形式＝補到程式判斷的學期總週數；彈性形式＝夾在下限與總週數上限之間。
 */
function fitWeeks(
  weeks: PlanWeek[],
  settings: SelfDirectedLearningSettings,
  fullWeeks: number | null
): PlanWeek[] {
  const target =
    settings.weekMode === "full" && fullWeeks !== null
      ? fullWeeks
      : fullWeeks !== null
        ? Math.min(Math.max(weeks.length, settings.minWeeks), fullWeeks)
        : Math.max(weeks.length, settings.minWeeks);
  const next = weeks.slice(0, target);
  while (next.length < target) {
    next.push({ week: next.length + 1, content: "", venue: "", timing: "flexible" });
  }
  return next.map((week, index) => ({ ...week, week: index + 1 }));
}

export default function StudentSelfDirectedLearningPage() {
  const router = useRouter();
  const [systemSettings, setSystemSettings] = useState<Settings>(defaultSettings);
  const [settings, setSettings] = useState<SelfDirectedLearningSettings>(
    DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS
  );
  /** 目前為止的所有計畫（正式＝approved；其餘皆歸草稿） */
  const [plans, setPlans] = useState<SelfDirectedLearningPlan[]>([]);
  /** 各計畫的最新審查意見（key＝plan id） */
  const [reviews, setReviews] = useState<Record<string, PlanReview>>({});
  const [currentPeriod, setCurrentPeriod] = useState("");
  const [withinWindow, setWithinWindow] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"save" | "submit" | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  /** 總開關關閉：只顯示維護說明 */
  const [maintenance, setMaintenance] = useState(false);
  /** 全學期形式的須填週數（由學期起訖自動判斷；null＝學校尚未設定起訖） */
  const [fullWeeks, setFullWeeks] = useState<number | null>(null);
  /** 逐週彈性學習時間（日期／節次）與學校活動衝堂 */
  const [weekSchedule, setWeekSchedule] = useState<WeekSchedule[]>([]);
  /** 學生姓名／班級（列印預覽表頭用） */
  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(null);
  /** 撰寫計畫區塊是否展開（預設隱藏；發起新計畫或編輯草稿才顯示） */
  const [formOpen, setFormOpen] = useState(false);
  /** 正在編輯的草稿 id；null＝新計畫 */
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const formSectionRef = useRef<HTMLElement | null>(null);

  const editingPlan = editingPlanId
    ? plans.find((plan) => plan.id === editingPlanId) ?? null
    : null;
  const locked = editingPlan?.status === "submitted" || editingPlan?.status === "approved";
  /** 場地是否開放學生輸入（舊資料沒有此欄位時視為開放，避免誤鎖） */
  const venueEditable = settings.venueEditable !== false;
  const formalPlans = plans.filter((plan) => plan.status === "approved");
  const draftPlans = plans.filter((plan) => plan.status !== "approved");
  const currentApproved = plans.some(
    (plan) => plan.status === "approved" && plan.period === currentPeriod
  );
  /** 週次 → 該週彈性學習時間與衝堂資訊 */
  const weekScheduleByNo = useMemo(
    () => new Map(weekSchedule.map((row) => [row.week, row])),
    [weekSchedule]
  );
  /** 列印預覽分頁與最近一次送出的預覽內容 */
  const previewWindowRef = useRef<Window | null>(null);
  const printPayloadRef = useRef<PrintPreviewPayload | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/student/self-directed-learning", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "讀取資料失敗" });
        return;
      }
      const nextSettings = data.settings as SelfDirectedLearningSettings;
      const nextFullWeeks = typeof data.fullWeeks === "number" ? data.fullWeeks : null;
      setSettings(nextSettings);
      setFullWeeks(nextFullWeeks);
      setWeekSchedule(Array.isArray(data.weekSchedule) ? (data.weekSchedule as WeekSchedule[]) : []);
      setStudentInfo(
        data.student && typeof data.student === "object"
          ? {
              name:
                typeof (data.student as StudentInfo).name === "string"
                  ? (data.student as StudentInfo).name
                  : "",
              className:
                typeof (data.student as StudentInfo).className === "string"
                  ? (data.student as StudentInfo).className
                  : "",
            }
          : null
      );
      setMaintenance(Boolean(data.maintenance));
      setWithinWindow(Boolean(data.withinWindow));
      setCurrentPeriod(typeof data.currentPeriod === "string" ? data.currentPeriod : "");
      setPlans(Array.isArray(data.plans) ? (data.plans as SelfDirectedLearningPlan[]) : []);
      setReviews(
        data.reviews && typeof data.reviews === "object"
          ? (data.reviews as Record<string, PlanReview>)
          : {}
      );
    } catch {
      setToast({ kind: "error", text: "讀取資料失敗" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 列印預覽分頁載入後會送出 ready，這裡回傳目前編輯中的草稿（含未儲存變更）
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const target = previewWindowRef.current;
      if (!target || event.source !== target) return;
      if (!event.data || event.data.type !== PRINT_PREVIEW_READY) return;
      const payload = printPayloadRef.current;
      if (!payload) return;
      try {
        target.postMessage({ type: PRINT_PREVIEW_DATA, payload }, window.location.origin);
      } catch {
        // 分頁已關閉或瀏覽器限制時忽略
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

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

  const revealForm = () => {
    requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const startNewPlan = () => {
    setEditingPlanId(null);
    setDraft({ ...EMPTY_DRAFT, weeks: fitWeeks(emptyWeeks(1), settings, fullWeeks) });
    setFormOpen(true);
    revealForm();
  };

  const startEditPlan = (plan: SelfDirectedLearningPlan) => {
    if (plan.status !== "draft" && plan.status !== "returned") return;
    const weeks = plan.weeks.length ? plan.weeks : emptyWeeks(1);
    setEditingPlanId(plan.id);
    setDraft({
      topic: plan.topic,
      studyGroup: plan.studyGroup,
      advisor: plan.advisor,
      weeks: fitWeeks(weeks, settings, fullWeeks),
    });
    setFormOpen(true);
    revealForm();
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingPlanId(null);
  };

  /** 開新分頁列印預覽：把目前草稿（含尚未儲存的變更）交給預覽頁 */
  const openPrintPreview = () => {
    const payload: PrintPreviewPayload = {
      period: currentPeriod,
      studentName: studentInfo?.name || editingPlan?.studentName || "",
      className: studentInfo?.className || editingPlan?.className || "",
      topic: draft.topic,
      studyGroup: draft.studyGroup,
      advisor: draft.advisor,
      generatedAt: Date.now(),
      weeks: draft.weeks.map((week) => {
        const scheduleRow = weekScheduleByNo.get(week.week);
        const slots = scheduleRow?.slots ?? [];
        return {
          week: week.week,
          content: week.content,
          venue: week.venue,
          slots: slots.map((slot) => ({
            date: slot.date,
            day: slot.day,
            periods: [...slot.periods],
            blockedBy: slot.blockedBy,
          })),
          blocked: scheduleRow?.blocked ?? false,
        };
      }),
    };
    printPayloadRef.current = payload;
    const preview = window.open("/student/self-directed-learning/print", "_blank");
    if (!preview) {
      setToast({ kind: "error", text: "瀏覽器封鎖了新分頁，請允許彈出視窗後再試" });
      return;
    }
    previewWindowRef.current = preview;
    preview.focus();
  };

  const submit = async (action: "save" | "submit") => {
    setSaving(action);
    try {
      const response = await fetch("/api/student/self-directed-learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, draft, planId: editingPlanId ?? undefined }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "儲存失敗" });
        return;
      }
      const saved = data.plan as SelfDirectedLearningPlan;
      setEditingPlanId(saved.id);
      setToast({ kind: "success", text: action === "submit" ? "已送出審核" : "草稿已儲存" });
      if (action === "submit") {
        setFormOpen(false);
        setEditingPlanId(null);
      }
      await load();
    } catch {
      setToast({ kind: "error", text: "儲存失敗" });
    } finally {
      setSaving(null);
    }
  };

  const windowState = openStateOf(settings);
  const canSubmit = withinWindow && !locked && saving === null;
  const canStartNew = withinWindow && !currentApproved && !formOpen && !loading;

  const actionButtons = (
    <>
      <button
        type="button"
        onClick={() => router.push("/student")}
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

  /** 頁面外殼：與「升學考試與模擬考校內報名」學生頁一致（內容顯示區由 inner 帶入） */
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

      <div className="content-width mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">自主學習計畫</h2>
      </div>

      <div className="content-width flex justify-end gap-2 mb-4">{actionButtons}</div>
      <hr className="content-width border-themed mb-4" />

      <main className="content-width mb-6 space-y-4">{inner}</main>

      <hr className="content-width border-themed mb-4" />
      <div className="content-width flex justify-start gap-2 mb-4">{actionButtons}</div>

      {systemSettings.sponsorAdEnabled && (
        <div className="content-width mt-8">
          <AdSense />
        </div>
      )}

      <div className="content-width mt-auto">
        <Copyright mode={systemSettings.copyrightNotice ? "啟用" : "關閉"} />
      </div>
    </div>
  );

  const renderPlanCard = (plan: SelfDirectedLearningPlan, editable: boolean) => {
    const review = reviews[plan.id];
    return (
      <div key={plan.id} className="border-themed bg-surface space-y-2 rounded-md p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-t1 font-medium">{plan.topic || "（未命名草稿）"}</p>
            <p className="text-t3 mt-1 text-xs">
              {periodText(plan.period)}・{plan.studyGroup || "未填學群"}・指導老師：
              {plan.advisor || "未指定"}
            </p>
            <p className="text-t3 text-xs">更新：{formatDateTime(plan.updatedAt)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`text-xs ${statusClass(plan.status)}`}>
              {PLAN_STATUS_LABELS[plan.status]}
            </span>
            {editable && !formOpen && (plan.status === "draft" || plan.status === "returned") && (
              <button
                type="button"
                className="btn-theme rounded px-3 py-1.5 text-xs"
                onClick={() => startEditPlan(plan)}
              >
                編輯
              </button>
            )}
          </div>
        </div>

        {review && (
          <p className="text-t2 border-themed border-t pt-2 text-xs whitespace-pre-wrap">
            審查意見（{review.reviewerName || "審核人員"}）：
            {review.note || "（無文字意見）"}
          </p>
        )}

        <details>
          <summary className="text-t2 flex cursor-pointer items-center gap-1 text-xs">
            <DisclosureArrow />
            查看內容（{plan.weeks.length} 週）
          </summary>
          <ul className="mt-2 space-y-2">
            {plan.weeks.map((week) => (
              <li key={week.week} className="border-themed bg-card rounded-md p-2">
                <div className="text-t3 mb-1 flex flex-wrap gap-2 text-xs">
                  <span>第 {week.week} 週</span>
                  <span>{PLAN_TIMING_LABELS[week.timing]}</span>
                  <span>{week.venue || "—"}</span>
                </div>
                <RichTextContent html={week.content} className="text-t2 text-xs" />
              </li>
            ))}
          </ul>
        </details>
      </div>
    );
  };

  // 總開關關閉：只見維護說明（資料不呈現、表單不開放）
  if (!loading && maintenance) {
    return renderShell(
      <div className="border-themed bg-card space-y-2 rounded-lg p-6 text-center">
        <p className="text-t1 text-lg font-medium">{MAINTENANCE_TITLE}</p>
        <p className="text-t2 text-sm">{MAINTENANCE_HINT}</p>
      </div>
    );
  }

  return renderShell(
    <>
      {settings.instructions.trim() && (
        <details className="border-themed bg-card rounded-lg">
          <summary className="text-t1 flex cursor-pointer items-center gap-2 p-4 font-medium">
            <DisclosureArrow />
            自主學習實施說明
          </summary>
          <p className="text-t2 px-4 pb-4 whitespace-pre-wrap text-sm">{settings.instructions}</p>
        </details>
      )}

      <section className="border-themed bg-card space-y-4 rounded-lg p-4" aria-label="我的計畫">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-t1 font-medium">我的計畫</h2>
          {canStartNew && (
            <button
              type="button"
              className="btn-primary btn-theme px-4 py-2 text-sm"
              onClick={startNewPlan}
            >
              發起新計畫
            </button>
          )}
        </div>
        <p className="text-xs">
          <span className={windowState === "open" ? "text-success" : "text-t3"}>
            {WINDOW_LABEL[windowState]}
          </span>
          {currentApproved && <span className="text-t3">・本學期已有正式計畫</span>}
        </p>

        <div className="space-y-2">
          <h3 className="text-t2 text-sm font-medium">
            正式計畫{formalPlans.length > 0 ? `（${formalPlans.length}）` : ""}
          </h3>
          {formalPlans.length === 0 ? (
            <p className="text-t3 text-sm">尚無正式計畫</p>
          ) : (
            formalPlans.map((plan) => renderPlanCard(plan, false))
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-t2 text-sm font-medium">
            草稿計畫{draftPlans.length > 0 ? `（${draftPlans.length}）` : ""}
          </h3>
          {draftPlans.length === 0 ? (
            <p className="text-t3 text-sm">尚無草稿計畫</p>
          ) : (
            draftPlans.map((plan) => renderPlanCard(plan, true))
          )}
        </div>
      </section>

      {formOpen && (
        <section
          ref={formSectionRef}
          className="border-themed bg-card space-y-4 rounded-lg p-4"
          aria-label="撰寫計畫"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-t1 font-medium">撰寫計畫</h2>
              <p className="text-t3 mt-1 text-xs">
                {editingPlanId ? "編輯草稿" : "新計畫"}
                {editingPlan ? `・${periodText(editingPlan.period)}` : ""}
              </p>
            </div>
            <button type="button" className="btn-theme rounded-lg px-4 py-2 text-sm" onClick={closeForm}>
              取消
            </button>
          </div>

          {settings.writingInstructions.trim() && (
            <div className="border-themed bg-surface space-y-1 rounded-md p-3">
              <p className="text-t1 text-sm font-medium">自主學習計畫撰寫說明</p>
              <p className="text-t2 whitespace-pre-wrap text-sm">
                {settings.writingInstructions}
              </p>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-t1 text-sm font-medium">計畫內容</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-t2 block space-y-1 text-sm">
                <span>主題 *</span>
                <input
                  type="text"
                  className="input-theme w-full rounded px-3 py-2 text-sm"
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
                  className="input-theme w-full rounded px-3 py-2 text-sm"
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
                className="input-theme w-full rounded px-3 py-2 text-sm sm:max-w-md"
                value={draft.advisor}
                maxLength={100}
                disabled={locked}
                onChange={(event) => patchDraft({ advisor: event.target.value })}
                placeholder="如：王老師（校內）／校外相關領域人士"
              />
            </label>
          </div>

          <div className="border-themed space-y-4 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-t1 text-sm font-medium">逐週課程安排</h3>
              {settings.weekMode === "flexible" ? (
                <label className="text-t2 flex flex-wrap items-center gap-2 text-sm">
                  方案週數（至少 {settings.minWeeks} 週
                  {fullWeeks !== null ? `，至多 ${fullWeeks} 週` : ""}）
                  <input
                    type="number"
                    min={settings.minWeeks}
                    max={fullWeeks ?? MAX_PLAN_WEEKS}
                    className="input-theme w-24 rounded px-3 py-2 text-sm"
                    value={draft.weeks.length}
                    disabled={locked}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      if (Number.isInteger(parsed)) {
                        setWeekCount(
                          Math.min(
                            Math.max(parsed, settings.minWeeks),
                            fullWeeks ?? MAX_PLAN_WEEKS
                          )
                        );
                      }
                    }}
                  />
                </label>
              ) : (
                <p className="text-t2 text-sm">
                  {fullWeeks !== null
                    ? `全學期 ${fullWeeks} 週（空白週數都須填寫；學校活動衝堂週次不列入）`
                    : "全學期形式：學校尚未設定上課日／學期起訖，暫無法判斷週數"}
                </p>
              )}
            </div>

            <datalist id="sdl-venues">
              {settings.venues.map((venue) => (
                <option key={venue} value={venue} />
              ))}
            </datalist>

            <ol className="text-t3 list-decimal space-y-1 pl-5 text-xs">
              <li>週次日期依學校學期起訖與彈性學習節次推算。</li>
              <li>與學校活動衝堂的週次會標示活動名稱，不提供撰寫，也不列入必填。</li>
              <li>
                課餘時間另行處理；場地
                {venueEditable
                  ? "可自行輸入，或從學校開放的場域清單選擇。"
                  : settings.venues.length > 0
                    ? "請從學校開放的場域清單選擇。"
                    : "尚未設定開放場域，請聯繫管理人員。"}
              </li>
            </ol>

            <div className="overflow-x-auto">
              <table
                className="w-full text-left text-sm"
                style={{ minWidth: "40rem" }}
              >
                <thead className="text-t2">
                  <tr className="border-themed border-b">
                    <th scope="col" className="align-top px-2 py-2 font-medium whitespace-nowrap">
                      週次／日期／節次
                    </th>
                    <th scope="col" className="align-top px-2 py-2 font-medium">學習安排</th>
                    <th scope="col" className="align-top px-2 py-2 font-medium whitespace-nowrap">場地</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.weeks.map((week) => {
                    const scheduleRow = weekScheduleByNo.get(week.week);
                    const slots = scheduleRow?.slots ?? [];
                    const blocked = scheduleRow?.blocked ?? false;
                    const conflictNames = [
                      ...new Set(
                        slots
                          .map((slot) => slot.blockedBy)
                          .filter((name): name is string => Boolean(name))
                      ),
                    ];
                    return (
                      <tr key={week.week} className="border-themed border-b last:border-0 align-top">
                        <td className="align-top px-2 py-3 whitespace-nowrap">
                          <div className="text-t1 font-medium">第 {week.week} 週</div>
                          {slots.length === 0 ? (
                            <div className="text-t3 mt-1 text-xs">—</div>
                          ) : (
                            slots.map((slot) => (
                              <div
                                key={`${slot.date}-${slot.day}`}
                                className="text-t2 mt-1 text-xs"
                              >
                                <div>
                                  {monthDayText(slot.date)} {WEEKDAY_LABELS[slot.day - 1]}
                                </div>
                                <div className={slot.blockedBy ? "text-danger" : ""}>
                                  {slot.periods.length > 0 ? slot.periods.join("、") : "—"}
                                  {slot.blockedBy && (
                                    <span className="text-danger block">{slot.blockedBy}</span>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </td>
                        {blocked ? (
                          <td colSpan={2} className="align-top px-2 py-3">
                            <p className="text-danger text-sm font-medium">
                              {conflictNames.join("、") || "學校活動"}
                            </p>
                            <p className="text-t3 mt-1 text-xs">
                              本週彈性學習時間為學校活動，不提供撰寫（不列入必填）。
                            </p>
                            {week.content && (
                              <div className="text-t3 mt-1 text-xs">
                                <p>原內容：</p>
                                <RichTextContent html={week.content} className="text-t3 text-xs" />
                              </div>
                            )}
                          </td>
                        ) : (
                          <>
                            <td className="align-top px-2 py-3" style={{ minWidth: "20rem" }}>
                              <RichTextEditor
                                value={week.content}
                                onChange={(content) => patchWeek(week.week, { content })}
                                disabled={locked}
                                maxLength={600}
                                placeholder="本週預計學習的內容、進度與方式"
                                ariaLabel={`第 ${week.week} 週學習安排`}
                              />
                            </td>
                            <td className="align-top px-2 py-3" style={{ minWidth: "9rem" }}>
                              {venueEditable ? (
                                <input
                                  type="text"
                                  className="input-theme w-full rounded px-3 py-2 text-sm"
                                  value={week.venue}
                                  list="sdl-venues"
                                  maxLength={120}
                                  disabled={locked}
                                  onChange={(event) =>
                                    patchWeek(week.week, { venue: event.target.value })
                                  }
                                  placeholder="圖書館自習室"
                                  aria-label={`第 ${week.week} 週場地`}
                                />
                              ) : (
                                <select
                                  className="input-theme w-full rounded px-3 py-2 text-sm"
                                  value={week.venue}
                                  disabled={locked}
                                  onChange={(event) =>
                                    patchWeek(week.week, { venue: event.target.value })
                                  }
                                  aria-label={`第 ${week.week} 週場地（限學校開放場域）`}
                                >
                                  <option value="">請選擇場地</option>
                                  {settings.venues.map((venue) => (
                                    <option key={venue} value={venue}>
                                      {venue}
                                    </option>
                                  ))}
                                  {week.venue && !settings.venues.includes(week.venue) && (
                                    <option value={week.venue}>
                                      {week.venue}（不在開放清單，請重新選擇）
                                    </option>
                                  )}
                                </select>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
        </section>
      )}

      {formOpen && (
        <button
          type="button"
          onClick={openPrintPreview}
          title="列印預覽（新分頁）"
          aria-label="在新分頁預覽列印"
          className="border-themed bg-surface text-t1 hover:bg-card flex items-center justify-center border px-2 py-3 shadow-md"
          style={{
            position: "fixed",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 40,
            borderLeftWidth: 0,
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9V3h12v6" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" rx="1" />
            <path d="M18 12h.01" />
          </svg>
        </button>
      )}
    </>
  );
}
