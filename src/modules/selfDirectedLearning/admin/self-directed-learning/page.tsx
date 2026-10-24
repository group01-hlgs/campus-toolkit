"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Toast, { type ToastMessage } from "@/components/Toast";
import DisclosureArrow from "@/components/DisclosureArrow";
import {
  DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS,
  WEEKDAY_LABELS,
  openStateOf,
  type ClassOption,
  type FlexibleSlot,
  type PeriodOption,
  type ReviewerEntry,
  type ReviewerStudentRef,
  type SelfDirectedLearningSettings,
  type SpaceOption,
  type StaffCandidate,
  type StudentOption,
} from "../../types/self-directed-learning";

function toDateTimeLocal(epoch: number | null): string {
  if (!epoch) return "";
  const shifted = new Date(epoch - new Date().getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function formatDateTime(epoch: number | null): string {
  if (!epoch) return "未設定";
  const d = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATE_LABEL: Record<string, string> = {
  unset: "尚未設定開放時間",
  closed: "尚未開放",
  open: "開放撰寫中",
  ended: "已截止",
};

/** 範例說明（插入後可再修改；空行不標號，其餘行自動 1. 2. 3. …） */
const INSTRUCTIONS_TEMPLATE = [
  "請於開放期間內完成填報並送出審核。",
  "逐週學習安排與場地皆須填寫完整。",
  "送出後請等待審核；退回時可依意見修改後再送。",
].join("\n");

/** 依行自動標號：先去掉行首既有數字標號再重編；空行保留不編號 */
function renumberInstructions(raw: string): string {
  let index = 0;
  const lines = raw.split(/\r?\n/).map((line) => {
    if (!line.trim()) return "";
    index += 1;
    const body = line.replace(/^\s*\d{1,3}[.、]\s*/, "").trim();
    return `${index}. ${body}`;
  });
  return lines.join("\n");
}

export default function SelfDirectedLearningSettingsPage({
  fill = false,
}: {
  /** 嵌入教職員頁管理面板時為 true：縮小外框、不出頁首返回列 */
  fill?: boolean;
}) {
  const [settings, setSettings] = useState<SelfDirectedLearningSettings>(DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS);
  /** 全學期形式的須填週數（由學期起訖自動判斷；null＝學校尚未設定起訖） */
  const [fullWeeks, setFullWeeks] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [venueInput, setVenueInput] = useState("");
  /** 選擇中的教職員候選 uid（審核人員） */
  const [selectedStaffUid, setSelectedStaffUid] = useState("");
  /** 當期教職員名冊候選人 */
  const [staffCandidates, setStaffCandidates] = useState<StaffCandidate[]>([]);
  /** 屬性過濾（""＝全部）與姓名搜尋 */
  const [staffAttribute, setStaffAttribute] = useState("");
  const [staffNameQuery, setStaffNameQuery] = useState("");
  /** 節次候選（主程式課表作息） */
  const [periodOptions, setPeriodOptions] = useState<PeriodOption[]>([]);
  /** 上課日星期（主程式課表作息；1=週一…7=週日） */
  const [schoolDays, setSchoolDays] = useState<number[]>([1, 2, 3, 4, 5]);
  /** 場域候選（主程式樓層空間設定的葉子空間） */
  const [spaceOptions, setSpaceOptions] = useState<SpaceOption[]>([]);
  /** 下限週數輸入框的暫存字串：允許清空後重打，失焦時回復現值 */
  const [minWeeksInput, setMinWeeksInput] = useState<string | null>(null);

  /** 班級候選（主程式年段班級設定） */
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  /** 正在設定審查對象的審核人員 uid（一次只展開一位） */
  const [scopeEditorUid, setScopeEditorUid] = useState<string | null>(null);
  /** 個人模式目前選取載入的班級 */
  const [targetClassCode, setTargetClassCode] = useState("");
  /** 已載入的班級學生（按班級快取，避免重複讀取） */
  const [classStudents, setClassStudents] = useState<Record<string, StudentOption[]>>({});
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/self-directed-learning", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "讀取設定失敗" });
        return;
      }
      setSettings(data.settings as SelfDirectedLearningSettings);
      setFullWeeks(typeof data.fullWeeks === "number" ? data.fullWeeks : null);
      setPeriodOptions(Array.isArray(data.periodOptions) ? (data.periodOptions as PeriodOption[]) : []);
      setSchoolDays(
        Array.isArray(data.schoolDays) && data.schoolDays.length
          ? (data.schoolDays as number[]).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
          : [1, 2, 3, 4, 5]
      );
      setSpaceOptions(Array.isArray(data.spaceOptions) ? (data.spaceOptions as SpaceOption[]) : []);
      setClassOptions(Array.isArray(data.classOptions) ? (data.classOptions as ClassOption[]) : []);
      setStaffCandidates(
        Array.isArray(data.staffCandidates) ? (data.staffCandidates as StaffCandidate[]) : []
      );
    } catch {
      setToast({ kind: "error", text: "讀取設定失敗" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (partial: Partial<SelfDirectedLearningSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  /** 屬性選項（名冊中出現過的，去重保序） */
  const staffAttributeOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const candidate of staffCandidates) {
      if (!candidate.attribute || seen.has(candidate.attribute)) continue;
      seen.add(candidate.attribute);
      options.push(candidate.attribute);
    }
    return options;
  }, [staffCandidates]);

  /** 依屬性與姓名過濾後的候選（已加入者除外） */
  const filteredStaffCandidates = useMemo(() => {
    const query = staffNameQuery.trim().toLowerCase();
    return staffCandidates.filter((candidate) => {
      if (settings.reviewers.some((reviewer) => reviewer.uid === candidate.uid)) return false;
      if (staffAttribute && candidate.attribute !== staffAttribute) return false;
      if (query && !candidate.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [staffCandidates, settings.reviewers, staffAttribute, staffNameQuery]);

  /** 班級依年級分組（維持主程式年段順序）；避免每個班級都重複顯示年級名稱 */
  const classGroups = useMemo(() => {
    const groups = new Map<string, ClassOption[]>();
    for (const option of classOptions) {
      const key = option.grade || "其他";
      const list = groups.get(key) ?? [];
      list.push(option);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([grade, classes]) => ({ grade, classes }));
  }, [classOptions]);

  /** 格狀表格勾選：day=星期代碼、periodName=節次名稱，即時寫入 slots */
  const toggleScheduleCell = (day: number, periodName: string, checked: boolean) => {
    const existing = settings.slots.find((slot) => slot.day === day);
    const current = existing ? existing.periods : [];
    const merged = checked
      ? [...current, periodName]
      : current.filter((name) => name !== periodName);
    // 依作息表順序排列該日節次
    const ordered = periodOptions
      .filter((option) => merged.includes(option.name))
      .map((option) => option.name);
    const rest = settings.slots.filter((slot) => slot.day !== day);
    const next: FlexibleSlot[] = ordered.length
      ? [...rest, { day, periods: ordered }].sort((a, b) => a.day - b.day)
      : rest;
    patch({ slots: next });
  };

  const removeSlot = (day: number) => {
    patch({ slots: settings.slots.filter((slot) => slot.day !== day) });
  };

  const addVenue = () => {
    const venue = venueInput.trim();
    if (!venue) return;
    if (settings.venues.includes(venue)) {
      setToast({ kind: "error", text: "該場域已存在" });
      return;
    }
    patch({ venues: [...settings.venues, venue] });
    setVenueInput("");
  };

  const removeVenue = (venue: string) => {
    patch({ venues: settings.venues.filter((item) => item !== venue) });
  };

  const addReviewer = () => {
    const candidate = staffCandidates.find((item) => item.uid === selectedStaffUid);
    if (!candidate) {
      setToast({ kind: "error", text: "請先選擇教職員" });
      return;
    }
    if (settings.reviewers.some((reviewer) => reviewer.uid === candidate.uid)) {
      setToast({ kind: "error", text: "此人已在名單中" });
      return;
    }
    const entry: ReviewerEntry = {
      uid: candidate.uid,
      name: candidate.name || candidate.uid,
      classScoped: false,
      classCodes: [],
      studentScoped: false,
      students: [],
    };
    patch({ reviewers: [...settings.reviewers, entry] });
    setSelectedStaffUid("");
  };

  const removeReviewer = (uid: string) => {
    patch({ reviewers: settings.reviewers.filter((reviewer) => reviewer.uid !== uid) });
    if (scopeEditorUid === uid) setScopeEditorUid(null);
  };

  const patchReviewer = (uid: string, partial: Partial<ReviewerEntry>) => {
    patch({
      reviewers: settings.reviewers.map((reviewer) =>
        reviewer.uid === uid ? { ...reviewer, ...partial } : reviewer
      ),
    });
  };

  /** 展開／收合某位審核人員的對象設定（一次只展開一位，避免多筆誤按） */
  const toggleScopeEditor = (uid: string) => {
    setScopeEditorUid((current) => (current === uid ? null : uid));
    setTargetClassCode("");
    setStudentError("");
  };

  const toggleReviewerClassScope = (reviewer: ReviewerEntry) => {
    patchReviewer(reviewer.uid, { classScoped: !reviewer.classScoped });
  };

  const toggleReviewerStudentScope = (reviewer: ReviewerEntry) => {
    patchReviewer(reviewer.uid, { studentScoped: !reviewer.studentScoped });
    setStudentError("");
  };

  const toggleReviewerClass = (reviewer: ReviewerEntry, classCode: string) => {
    const current = reviewer.classCodes ?? [];
    patchReviewer(reviewer.uid, {
      classCodes: current.includes(classCode)
        ? current.filter((code) => code !== classCode)
        : [...current, classCode].slice(0, 30),
    });
  };

  /** 整年級全選／取消（受 30 班上限限制） */
  const toggleReviewerGrade = (reviewer: ReviewerEntry, classes: ClassOption[]) => {
    const current = new Set(reviewer.classCodes ?? []);
    const allSelected = classes.every((option) => current.has(option.code));
    if (allSelected) {
      for (const option of classes) current.delete(option.code);
    } else {
      for (const option of classes) current.add(option.code);
    }
    patchReviewer(reviewer.uid, { classCodes: [...current].slice(0, 30) });
  };

  const toggleReviewerStudent = (reviewer: ReviewerEntry, student: StudentOption) => {
    const current = reviewer.students ?? [];
    const exists = current.some((item) => item.uid === student.uid);
    patchReviewer(reviewer.uid, {
      students: exists
        ? current.filter((item) => item.uid !== student.uid)
        : [
            ...current,
            {
              uid: student.uid,
              name: student.name || student.uid,
              classCode: student.classCode,
            } satisfies ReviewerStudentRef,
          ].slice(0, 100),
    });
  };

  const removeReviewerStudent = (reviewer: ReviewerEntry, uid: string) => {
    patchReviewer(reviewer.uid, {
      students: (reviewer.students ?? []).filter((student) => student.uid !== uid),
    });
  };

  /** 個人模式：只在選班級時載入該班學生（同一班只讀一次，存在記憶體） */
  const loadClassStudents = async (classCode: string) => {
    setTargetClassCode(classCode);
    setStudentError("");
    if (!classCode || classStudents[classCode]) return;
    setStudentLoading(true);
    try {
      const response = await fetch(
        `/api/admin/self-directed-learning/students?classCode=${encodeURIComponent(classCode)}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        setStudentError(data.message || "讀取學生名單失敗");
        return;
      }
      setClassStudents((prev) => ({
        ...prev,
        [classCode]: Array.isArray(data.students) ? (data.students as StudentOption[]) : [],
      }));
    } catch {
      setStudentError("讀取學生名單失敗");
    } finally {
      setStudentLoading(false);
    }
  };

  const reviewerScopeLabel = (reviewer: ReviewerEntry): string => {
    const parts: string[] = [];
    if (reviewer.classScoped) {
      const codes = reviewer.classCodes ?? [];
      if (codes.length === 0) {
        parts.push("班級（尚未選擇）");
      } else {
        const grouped = new Map<string, string[]>();
        for (const code of codes) {
          const option = classOptions.find((item) => item.code === code);
          const grade = option?.grade || "其他";
          const names = grouped.get(grade) ?? [];
          names.push(option ? option.name || option.code : code);
          grouped.set(grade, names);
        }
        parts.push(
          `班級：${[...grouped.entries()]
            .map(([grade, names]) => `${grade}：${names.join("、")}`)
            .join("；")}`
        );
      }
    }
    if (reviewer.studentScoped) {
      const students = reviewer.students ?? [];
      parts.push(
        students.length
          ? `個人：${students.map((student) => student.name || student.uid).join("、")}`
          : "個人（尚未選擇）"
      );
    }
    return parts.length ? parts.join("；") : "全校";
  };

  const setInstructions = (value: string) => {
    patch({ instructions: value });
  };

  const save = async () => {
    const emptyScopeReviewer = settings.reviewers.find(
      (reviewer) =>
        (reviewer.classScoped && (reviewer.classCodes ?? []).length === 0) ||
        (reviewer.studentScoped && (reviewer.students ?? []).length === 0)
    );
    if (emptyScopeReviewer) {
      setToast({
        kind: "error",
        text: `${emptyScopeReviewer.name} 已選擇指定對象，但尚未勾選任何班級或學生`,
      });
      return;
    }
    const openAt = fromDateTimeLocal(toDateTimeLocal(settings.openAt));
    const closeAt = fromDateTimeLocal(toDateTimeLocal(settings.closeAt));
    const payload = {
      ...settings,
      openAt,
      closeAt,
      instructions: renumberInstructions(settings.instructions),
    };
    if (payload.openAt !== null && payload.closeAt !== null && payload.closeAt <= payload.openAt) {
      setToast({ kind: "error", text: "截止時間必須晚於開始時間" });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/self-directed-learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setToast({ kind: "error", text: data.message || "儲存失敗" });
        return;
      }
      setSettings(data.settings as SelfDirectedLearningSettings);
      if (data.hookWarning) {
        setToast({ kind: "error", text: String(data.hookWarning) });
      } else {
        setToast({ kind: "success", text: "已儲存" });
      }
    } catch {
      setToast({ kind: "error", text: "儲存失敗" });
    } finally {
      setSaving(false);
    }
  };

  const state = openStateOf(settings);

  /** 重新讀取／儲存設定：標題列（上）與頁尾（下）共用同一組按鈕 */
  const actionButtons = (
    <div className="flex flex-wrap justify-end gap-3">
      <button
        type="button"
        className="btn-theme h-10 px-6 text-sm cursor-pointer disabled:opacity-50"
        onClick={() => void load()}
        disabled={loading || saving}
      >
        重新讀取
      </button>
      <button
        type="button"
        className="btn-primary btn-theme h-10 px-6 text-sm cursor-pointer disabled:opacity-50"
        onClick={() => void save()}
        disabled={loading || saving}
      >
        {saving ? "儲存中…" : "儲存設定"}
      </button>
    </div>
  );

  return (
    <section className={fill ? "space-y-4" : "mx-auto content-width space-y-4 p-4 sm:p-6"}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl text-t1">管理規則</h1>
          <p className="text-t2 text-sm">
            狀態：
            <span
              className={
                !settings.enabled
                  ? "text-danger"
                  : state === "open"
                    ? "text-success"
                    : "text-t2"
              }
            >
              {!settings.enabled ? "功能已關閉（維護中）" : STATE_LABEL[state]}
            </span>
            {settings.updatedAt > 0 ? ` ｜ 最後更新 ${formatDateTime(settings.updatedAt)}` : ""}
          </p>
        </div>
        {actionButtons}
      </header>

      <details className="border-themed bg-card rounded-lg" open>
        <summary className="text-t1 flex cursor-pointer items-center gap-2 p-4 font-medium">
          <DisclosureArrow />
          開放撰寫時間
        </summary>
        <div className="space-y-4 px-4 pb-4">
          {/* 功能總開關：關閉即全站維護中（管理端不受影響） */}
          <label className="border-themed bg-surface flex flex-wrap items-start gap-3 rounded-md p-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 cursor-pointer"
              checked={settings.enabled}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            <span className="min-w-56 flex-1">
              <span className="text-t1 block text-sm font-medium">
                功能總開關（{settings.enabled ? "開啟中" : "關閉維護中"}）
              </span>
              <span className="text-t3 block text-xs">
                關閉後，學生／教職員／家長頁面一律只顯示「目前此功能關閉維護中」，
                並暫停填報與審核；管理端不受影響，可隨時改回開啟。
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-t2 block space-y-1 text-sm">
              <span>開始時間</span>
              <input
                type="datetime-local"
                className="input-theme w-full rounded px-3 py-2 text-sm"
                value={toDateTimeLocal(settings.openAt)}
                onChange={(event) => patch({ openAt: fromDateTimeLocal(event.target.value) })}
              />
            </label>
            <label className="text-t2 block space-y-1 text-sm">
              <span>截止時間</span>
              <input
                type="datetime-local"
                className="input-theme w-full rounded px-3 py-2 text-sm"
                value={toDateTimeLocal(settings.closeAt)}
                onChange={(event) => patch({ closeAt: fromDateTimeLocal(event.target.value) })}
              />
            </label>
          </div>
          <p className="text-t3 text-sm">
            目前設定：{formatDateTime(settings.openAt)} ～ {formatDateTime(settings.closeAt)}
          </p>

          {/* 週數填寫形式：全學期全填（週數自動判斷）vs 彈性下限 */}
          <div className="space-y-2">
            <span className="text-t1 block text-sm font-medium">週數填寫形式</span>
            <label className="text-t2 flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="weekMode"
                className="mt-1 h-4 w-4 cursor-pointer"
                checked={settings.weekMode === "full"}
                onChange={() => patch({ weekMode: "full" })}
              />
              <span>
                全學期空白週數都須填寫
                <span className="text-t3 block text-xs">
                  {fullWeeks !== null
                    ? `根據學期設定，由程式自動判斷，本學期共 ${fullWeeks} 週。`
                    : "根據學期設定，由程式自動判斷（學校尚未設定上課日／學期起訖）。"}
                  扣除國定假日與學校重要行程後，依實際週數為總週數。
                </span>
              </span>
            </label>
            <label className="text-t2 flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="weekMode"
                className="mt-1 h-4 w-4 cursor-pointer"
                checked={settings.weekMode === "flexible"}
                onChange={() => patch({ weekMode: "flexible" })}
              />
              <span>
                全學期採彈性週數填寫
                <span className="text-t3 block text-xs">
                  學生只要填寫學校規定的下限週數即可
                  {fullWeeks !== null ? `，上限為程式判斷的總週數（${fullWeeks} 週）` : "，上限由程式判斷"}
                  。扣除國定假日與學校重要行程後，依實際週數為總週數。
                </span>
              </span>
            </label>
            {settings.weekMode === "flexible" && (
              <label className="text-t2 block space-y-1 text-sm">
                <span>下限週數（學生至少須填寫；建議至少 6 週）</span>
                <input
                  type="number"
                  min={1}
                  className="input-theme w-32 rounded px-3 py-2 text-sm"
                  value={minWeeksInput ?? String(settings.minWeeks)}
                  onChange={(event) => {
                    const text = event.target.value;
                    setMinWeeksInput(text);
                    const parsed = Number(text);
                    if (text.trim() !== "" && Number.isInteger(parsed)) {
                      patch({ minWeeks: parsed });
                    }
                  }}
                  onBlur={() => setMinWeeksInput(null)}
                />
              </label>
            )}
          </div>
        </div>
      </details>

      <details className="border-themed bg-card rounded-lg" open>
        <summary className="text-t1 flex cursor-pointer items-center gap-2 p-4 font-medium">
          <DisclosureArrow />
          公告與行事曆
        </summary>
        <div className="space-y-3 px-4 pb-4">
          <label className="border-themed bg-surface flex flex-wrap items-start gap-3 rounded-md p-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 cursor-pointer"
              checked={settings.publishAnnouncement}
              onChange={(event) => patch({ publishAnnouncement: event.target.checked })}
            />
            <span className="min-w-56 flex-1">
              <span className="text-t1 block text-sm font-medium">
                儲存設定時同步發布系統公告（{settings.publishAnnouncement ? "開啟" : "關閉"}）
              </span>
              <span className="text-t3 block text-xs">
                勾選後，儲存設定時會建立或更新系統公告（對象：學生、家長、教職員），
                同一筆公告不會重複發送；未勾選時不會自動發送，也不會更動既有公告。
              </span>
            </span>
          </label>
          <label className="border-themed bg-surface flex flex-wrap items-start gap-3 rounded-md p-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 cursor-pointer"
              checked={settings.publishCalendar}
              onChange={(event) => patch({ publishCalendar: event.target.checked })}
            />
            <span className="min-w-56 flex-1">
              <span className="text-t1 block text-sm font-medium">
                儲存設定時同步發布行事曆行程（{settings.publishCalendar ? "開啟" : "關閉"}）
              </span>
              <span className="text-t3 block text-xs">
                勾選後，儲存設定時會建立或更新行事曆行程（對象：學生、家長、教職員），
                同一筆行程會覆寫更新；未勾選時不會自動發送，也不會更動既有行程。
              </span>
            </span>
          </label>
          <p className="text-t3 text-sm">
            公告標題「自主學習計畫開放撰寫」，時間為上方設定的開始～截止時間；
            若時間清空，有勾選的項目會撤回公告或取消行程。
          </p>
        </div>
      </details>

      <details className="border-themed bg-card rounded-lg" open>
        <summary className="text-t1 flex cursor-pointer items-center gap-2 p-4 font-medium">
          <DisclosureArrow />
          校內彈性學習節次行程
        </summary>
        <div className="space-y-4 px-4 pb-4">
          {periodOptions.length === 0 ? (
            <p className="text-t3 text-sm">
              尚無作息資料，請先至「學校基本設定 → 課表作息時間」建立節次。
            </p>
          ) : (
            <>
              <p className="text-t3 text-sm">勾選，表示該日該節為校內彈性學習時間。</p>
              <div className="border-themed bg-surface overflow-x-auto rounded-md">
                <table className="w-full text-sm text-left">
                  <thead className="border-b border-themed">
                    <tr>
                      <th className="px-3 py-2 font-medium whitespace-nowrap text-t2">節次 ＼ 星期</th>
                      {schoolDays.map((day) => (
                        <th key={day} className="px-3 py-2 font-medium whitespace-nowrap text-t1 text-center">
                          {WEEKDAY_LABELS[day - 1]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {periodOptions.map((period) => (
                      <tr key={period.code} className="border-b border-themed last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap text-t1">{period.name}</td>
                        {schoolDays.map((day) => {
                          const slot = settings.slots.find((item) => item.day === day);
                          const checked = slot ? slot.periods.includes(period.name) : false;
                          return (
                            <td key={day} className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 cursor-pointer"
                                checked={checked}
                                aria-label={`${WEEKDAY_LABELS[day - 1]} ${period.name}`}
                                onChange={(event) =>
                                  toggleScheduleCell(day, period.name, event.target.checked)
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {settings.slots.length > 0 && (
            <ul className="space-y-2">
              {settings.slots.map((slot) => (
                <li
                  key={slot.day}
                  className="border-themed bg-surface flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2"
                >
                  <span className="text-t1 text-sm">
                    {WEEKDAY_LABELS[slot.day - 1]}：{slot.periods.join("、")}
                  </span>
                  <button
                    type="button"
                    className="btn-danger btn-theme h-8 px-3 text-sm"
                    onClick={() => removeSlot(slot.day)}
                  >
                    清除該日
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <details className="border-themed bg-card rounded-lg" open>
        <summary className="text-t1 flex cursor-pointer items-center gap-2 p-4 font-medium">
          <DisclosureArrow />
          開放場域
        </summary>
        <div className="space-y-4 px-4 pb-4">
          {settings.venues.length === 0 ? (
            <p className="text-t3 text-sm">尚未設定開放場域。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {settings.venues.map((venue) => (
                <span
                  key={venue}
                  className="border-themed bg-surface text-t1 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm"
                >
                  {venue}
                  <button
                    type="button"
                    aria-label={`移除 ${venue}`}
                    className="text-t3 hover:text-danger"
                    onClick={() => removeVenue(venue)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-t2 block min-w-48 flex-1 space-y-1 text-sm">
              <span>新增場域（可點選樓層空間建議，或自行輸入名稱）</span>
              <input
                type="text"
                className="input-theme w-full rounded px-3 py-2 text-sm"
                value={venueInput}
                list="sdl-admin-space-options"
                onChange={(event) => setVenueInput(event.target.value)}
                placeholder="如：圖書館自習室、電腦教室"
              />
              <datalist id="sdl-admin-space-options">
                {spaceOptions.map((option) => (
                  <option
                    key={`${option.name}-${option.floor}`}
                    value={option.name}
                  >
                    {option.floor ? `${option.name}（${option.floor}）` : option.name}
                  </option>
                ))}
              </datalist>
            </label>
            <button type="button" className="btn-theme h-10 px-4 text-sm" onClick={addVenue}>
              加入
            </button>
          </div>
        </div>
      </details>

      <details className="border-themed bg-card rounded-lg" open>
        <summary className="text-t1 flex cursor-pointer items-center gap-2 p-4 font-medium">
          <DisclosureArrow />
          審核人員
        </summary>
        <div className="space-y-4 px-4 pb-4">
          {/* 搜尋與加入（置於名單上方） */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-t2 block space-y-1 text-sm">
              <span>屬性</span>
              <select
                className="input-theme w-40 rounded px-3 py-2 text-sm"
                value={staffAttribute}
                onChange={(event) => {
                  setStaffAttribute(event.target.value);
                  setSelectedStaffUid("");
                }}
              >
                <option value="">全部</option>
                {staffAttributeOptions.map((attribute) => (
                  <option key={attribute} value={attribute}>
                    {attribute}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-t2 block space-y-1 text-sm">
              <span>搜尋姓名</span>
              <input
                type="search"
                className="input-theme w-40 rounded px-3 py-2 text-sm"
                value={staffNameQuery}
                onChange={(event) => {
                  setStaffNameQuery(event.target.value);
                  setSelectedStaffUid("");
                }}
                placeholder="姓名關鍵字"
              />
            </label>
            <label className="text-t2 block space-y-1 text-sm">
              <span>選擇教職員</span>
              <select
                className="input-theme w-64 rounded px-3 py-2 text-sm"
                value={selectedStaffUid}
                onChange={(event) => setSelectedStaffUid(event.target.value)}
              >
                <option value="">
                  {filteredStaffCandidates.length ? "請選擇…" : "（無符合的教職員）"}
                </option>
                {filteredStaffCandidates.map((candidate) => (
                  <option key={candidate.uid} value={candidate.uid}>
                    {candidate.name || candidate.uid}
                    {candidate.attribute ? `（${candidate.attribute}）` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-theme h-10 px-4 text-sm" onClick={addReviewer}>
              加入
            </button>
          </div>

          <p className="text-t3 text-xs">
            加入後可於下方設定審查對象（班級或個人）；未設定者為全校。個人模式僅在選擇班級後載入該班學生，避免一次讀取全校名冊。
          </p>

          {settings.reviewers.length === 0 ? (
            <p className="text-t3 text-sm">尚未指定審核人員（管理員恆可審核）。</p>
          ) : (
            <ul className="space-y-2">
              {settings.reviewers.map((reviewer) => (
                <li key={reviewer.uid} className="border-themed bg-surface space-y-2 rounded-md px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-t1 text-sm">
                        {reviewer.name}
                        <span className="text-t3 ml-2 text-xs">{reviewer.uid}</span>
                      </span>
                      <p className="text-t3 mt-0.5 text-xs">
                        審查對象：{reviewerScopeLabel(reviewer)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn-theme h-8 px-3 text-sm"
                        onClick={() => toggleScopeEditor(reviewer.uid)}
                      >
                        {scopeEditorUid === reviewer.uid ? "收合對象" : "設定對象"}
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-theme h-8 px-3 text-sm"
                        onClick={() => removeReviewer(reviewer.uid)}
                      >
                        移除
                      </button>
                    </div>
                  </div>

                  {scopeEditorUid === reviewer.uid && (
                    <div className="border border-themed space-y-3 rounded-md p-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-4">
                          <label className="text-t2 flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer"
                              checked={reviewer.classScoped === true}
                              onChange={() => toggleReviewerClassScope(reviewer)}
                            />
                            指定審查班級
                          </label>
                          <label className="text-t2 flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer"
                              checked={reviewer.studentScoped === true}
                              onChange={() => toggleReviewerStudentScope(reviewer)}
                            />
                            另指定個別學生（例外需求）
                          </label>
                        </div>
                        <p className="text-t3 text-xs">
                          未勾選以上項目＝全校。原則上以班級指派；個別學生僅供特殊需求使用。
                        </p>
                      </div>

                      {reviewer.classScoped && (
                        <div className="space-y-2">
                          {classOptions.length === 0 ? (
                            <p className="text-t3 text-sm">
                              尚無班級資料，請先至「學校基本設定 → 年段班級設定」建立班級。
                            </p>
                          ) : (
                            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                              {classGroups.map(({ grade, classes }) => {
                                const selectedCount = classes.filter((option) =>
                                  (reviewer.classCodes ?? []).includes(option.code)
                                ).length;
                                const allSelected = selectedCount === classes.length;
                                return (
                                  <div key={grade} className="border border-themed rounded-md p-3">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-t1 text-sm font-medium">
                                        {grade}
                                        <span className="text-t3 ml-1 text-xs">
                                          （{classes.length} 班，已選 {selectedCount}）
                                        </span>
                                      </span>
                                      <label className="text-t2 flex cursor-pointer items-center gap-2 text-xs">
                                        <input
                                          type="checkbox"
                                          className="h-4 w-4 cursor-pointer"
                                          checked={allSelected}
                                          onChange={() => toggleReviewerGrade(reviewer, classes)}
                                        />
                                        全選
                                      </label>
                                    </div>
                                    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                                      {classes.map((option) => (
                                        <label
                                          key={option.code}
                                          className="text-t2 flex items-center gap-2 text-sm"
                                        >
                                          <input
                                            type="checkbox"
                                            className="h-4 w-4 cursor-pointer"
                                            checked={(reviewer.classCodes ?? []).includes(option.code)}
                                            onChange={() => toggleReviewerClass(reviewer, option.code)}
                                          />
                                          <span className="min-w-0 truncate">
                                            {option.name || option.code}
                                            <span className="text-t3 text-xs">（{option.code}）</span>
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <p className="text-t3 text-xs">
                            已選 {(reviewer.classCodes ?? []).length} 班（最多 30 班）。
                          </p>
                        </div>
                      )}

                      {reviewer.studentScoped && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="text-t2 block space-y-1 text-sm">
                              <span>載入班級</span>
                              <select
                                className="input-theme w-56 rounded px-3 py-2 text-sm"
                                value={targetClassCode}
                                onChange={(event) => void loadClassStudents(event.target.value)}
                              >
                                <option value="">請選擇班級…</option>
                                {classGroups.map(({ grade, classes }) => (
                                  <optgroup key={grade} label={grade}>
                                    {classes.map((option) => (
                                      <option key={option.code} value={option.code}>
                                        {option.name || option.code}（{option.code}）
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </label>
                            {studentLoading && <p className="text-t3 text-sm">學生載入中…</p>}
                            {studentError && <p className="text-danger text-sm">{studentError}</p>}
                          </div>

                          {(reviewer.students ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {(reviewer.students ?? []).map((student) => (
                                <span
                                  key={student.uid}
                                  className="border border-themed text-t2 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
                                >
                                  {student.name || student.uid}
                                  <button
                                    type="button"
                                    onClick={() => removeReviewerStudent(reviewer, student.uid)}
                                    aria-label={`移除 ${student.name || student.uid}`}
                                    className="text-t3 hover:text-danger cursor-pointer"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}

                          {targetClassCode && classStudents[targetClassCode] && (
                            <div className="border border-themed grid max-h-56 gap-1 overflow-y-auto rounded-md p-2 sm:grid-cols-2 lg:grid-cols-3">
                              {classStudents[targetClassCode].map((student) => (
                                <label
                                  key={student.uid}
                                  className="text-t2 flex items-center gap-2 text-sm"
                                >
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 cursor-pointer"
                                    checked={(reviewer.students ?? []).some(
                                      (item) => item.uid === student.uid
                                    )}
                                    onChange={() => toggleReviewerStudent(reviewer, student)}
                                  />
                                  <span className="min-w-0 truncate">
                                    {student.name || student.uid}
                                    {student.className ? `（${student.className}）` : ""}
                                  </span>
                                </label>
                              ))}
                              {classStudents[targetClassCode].length === 0 && (
                                <p className="text-t3 text-sm">此班目前沒有有效學生。</p>
                              )}
                            </div>
                          )}
                          <p className="text-t3 text-xs">
                            已選 {(reviewer.students ?? []).length} 人（最多 100 人）。切換班級才會載入該班學生，不會一次讀取全校。
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <details className="border-themed bg-card rounded-lg" open>
        <summary className="text-t1 flex cursor-pointer items-center gap-2 p-4 font-medium">
          <DisclosureArrow />
          給學生的說明
        </summary>
        <div className="space-y-2 px-4 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-t3 text-xs">按 Enter 分段，將自動標號 1. 2. 3. …</p>
            <button
              type="button"
              className="btn-theme h-8 px-3 text-sm"
              onClick={() => setInstructions(renumberInstructions(INSTRUCTIONS_TEMPLATE))}
            >
              插入範本
            </button>
          </div>
          <textarea
            className="input-theme min-h-32 w-full rounded px-3 py-2 text-sm"
            value={settings.instructions}
            onChange={(event) => patch({ instructions: event.target.value })}
            onBlur={() => setInstructions(renumberInstructions(settings.instructions))}
            placeholder="按 Enter 分段，儲存時自動標號…"
          />
        </div>
      </details>

      {actionButtons}

      <Toast message={toast} onClose={() => setToast(null)} />
    </section>
  );
}
