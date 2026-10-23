"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Toast, { type ToastMessage } from "@/components/Toast";
import DisclosureArrow from "@/components/DisclosureArrow";
import {
  DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS,
  WEEKDAY_LABELS,
  openStateOf,
  type FlexibleSlot,
  type PeriodOption,
  type ReviewerEntry,
  type SelfDirectedLearningSettings,
  type SpaceOption,
  type StaffCandidate,
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
    const entry: ReviewerEntry = { uid: candidate.uid, name: candidate.name || candidate.uid };
    patch({ reviewers: [...settings.reviewers, entry] });
    setSelectedStaffUid("");
  };

  const removeReviewer = (uid: string) => {
    patch({ reviewers: settings.reviewers.filter((reviewer) => reviewer.uid !== uid) });
  };

  const setInstructions = (value: string) => {
    patch({ instructions: value });
  };

  const save = async () => {
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
          {settings.reviewers.length === 0 ? (
            <p className="text-t3 text-sm">尚未指定審核人員（管理員恆可審核）。</p>
          ) : (
            <ul className="space-y-2">
              {settings.reviewers.map((reviewer) => (
                <li
                  key={reviewer.uid}
                  className="border-themed bg-surface flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2"
                >
                  <span className="text-t1 text-sm">
                    {reviewer.name}
                    <span className="text-t3 ml-2 text-xs">{reviewer.uid}</span>
                  </span>
                  <button
                    type="button"
                    className="btn-danger btn-theme h-8 px-3 text-sm"
                    onClick={() => removeReviewer(reviewer.uid)}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
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
