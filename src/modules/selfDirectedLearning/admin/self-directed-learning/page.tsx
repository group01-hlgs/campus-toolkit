"use client";

import { useCallback, useEffect, useState } from "react";
import Toast, { type ToastMessage } from "@/components/Toast";
import DisclosureArrow from "@/components/DisclosureArrow";
import {
  DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS,
  WEEKDAY_LABELS,
  openStateOf,
  type FlexibleSlot,
  type ReviewerEntry,
  type SelfDirectedLearningSettings,
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

export default function SelfDirectedLearningSettingsPage() {
  const [settings, setSettings] = useState<SelfDirectedLearningSettings>(DEFAULT_SELF_DIRECTED_LEARNING_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [slotDay, setSlotDay] = useState(1);
  const [slotPeriods, setSlotPeriods] = useState("");
  const [venueInput, setVenueInput] = useState("");
  const [reviewerUid, setReviewerUid] = useState("");
  const [reviewerName, setReviewerName] = useState("");
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

  const addSlot = () => {
    const periods = slotPeriods
      .split(/[、,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!periods.length) {
      setToast({ kind: "error", text: "請輸入節次（如：第 5 節）" });
      return;
    }
    if (settings.slots.some((slot) => slot.day === slotDay)) {
      setToast({ kind: "error", text: "該星期已有節次行程，請先移除再新增" });
      return;
    }
    const next: FlexibleSlot = { day: slotDay, periods };
    patch({ slots: [...settings.slots, next].sort((a, b) => a.day - b.day) });
    setSlotPeriods("");
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
    const uid = reviewerUid.trim();
    const name = reviewerName.trim();
    if (!uid || !name) {
      setToast({ kind: "error", text: "審核人員需填 uid 與名稱" });
      return;
    }
    if (settings.reviewers.some((reviewer) => reviewer.uid === uid)) {
      setToast({ kind: "error", text: "此 uid 已在名單中" });
      return;
    }
    const entry: ReviewerEntry = { uid, name };
    patch({ reviewers: [...settings.reviewers, entry] });
    setReviewerUid("");
    setReviewerName("");
  };

  const removeReviewer = (uid: string) => {
    patch({ reviewers: settings.reviewers.filter((reviewer) => reviewer.uid !== uid) });
  };

  const save = async () => {
    const openAt = fromDateTimeLocal(toDateTimeLocal(settings.openAt));
    const closeAt = fromDateTimeLocal(toDateTimeLocal(settings.closeAt));
    const payload = { ...settings, openAt, closeAt };
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

  return (
    <section className="mx-auto content-width space-y-4 p-4 sm:p-6">
      <header className="space-y-1">
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

          {/* 週數填寫形式：全學期全填 vs 彈性下限 */}
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
                  學校彈性時間未安排活動的週，學生也必須填寫；週數＝下方「全學期週數」。
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
                  學生只要填寫學校規定的下限週數即可（上限仍為全學期週數）。
                </span>
              </span>
            </label>
            {settings.weekMode === "flexible" && (
              <label className="text-t2 block space-y-1 text-sm">
                <span>下限週數（學生至少須填寫；建議至少 6 週）</span>
                <input
                  type="number"
                  min={1}
                  max={settings.maxWeeks}
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

          <label className="text-t2 block space-y-1 text-sm">
            <span>全學期週數（課綱為 21 或 22 週）</span>
            <input
              type="number"
              min={1}
              max={52}
              className="input-theme w-32 rounded px-3 py-2 text-sm"
              value={settings.maxWeeks}
              onChange={(event) => patch({ maxWeeks: Number(event.target.value) })}
            />
            <span className="text-t3 block text-xs">
              全學期形式＝學生須全數填寫的週數；彈性形式＝可填寫的上限。
            </span>
          </label>
        </div>
      </details>

      <details className="border-themed bg-card rounded-lg" open>
        <summary className="text-t1 flex cursor-pointer items-center gap-2 p-4 font-medium">
          <DisclosureArrow />
          校內彈性學習節次行程
        </summary>
        <div className="space-y-4 px-4 pb-4">
          {settings.slots.length === 0 ? (
            <p className="text-t3 text-sm">尚未設定節次行程。</p>
          ) : (
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
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-t2 block space-y-1 text-sm">
              <span>星期</span>
              <select
                className="input-theme rounded px-3 py-2 text-sm"
                value={slotDay}
                onChange={(event) => setSlotDay(Number(event.target.value))}
              >
                {WEEKDAY_LABELS.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-t2 block min-w-40 flex-1 space-y-1 text-sm">
              <span>節次（可用頓號或逗號分隔，如：第 5 節、第 6 節）</span>
              <input
                type="text"
                className="input-theme w-full rounded px-3 py-2 text-sm"
                value={slotPeriods}
                onChange={(event) => setSlotPeriods(event.target.value)}
                placeholder="第 5 節、第 6 節"
              />
            </label>
            <button type="button" className="btn-theme h-10 px-4 text-sm" onClick={addSlot}>
              加入
            </button>
          </div>
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
              <span>新增場域（如：圖書館自習室、電腦教室）</span>
              <input
                type="text"
                className="input-theme w-full rounded px-3 py-2 text-sm"
                value={venueInput}
                onChange={(event) => setVenueInput(event.target.value)}
              />
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
              <span>帳號 uid</span>
              <input
                type="text"
                className="input-theme w-56 rounded px-3 py-2 text-sm"
                value={reviewerUid}
                onChange={(event) => setReviewerUid(event.target.value)}
                placeholder="uid"
              />
            </label>
            <label className="text-t2 block space-y-1 text-sm">
              <span>顯示名稱</span>
              <input
                type="text"
                className="input-theme w-40 rounded px-3 py-2 text-sm"
                value={reviewerName}
                onChange={(event) => setReviewerName(event.target.value)}
                placeholder="王老師"
              />
            </label>
            <button type="button" className="btn-theme h-10 px-4 text-sm" onClick={addReviewer}>
              加入
            </button>
          </div>
          <p className="text-t3 text-xs">v1 以手動輸入 uid＋名稱建立名單；帳號選擇器列後續版本。</p>
        </div>
      </details>

      <details className="border-themed bg-card rounded-lg" open>
        <summary className="text-t1 flex cursor-pointer items-center gap-2 p-4 font-medium">
          <DisclosureArrow />
          給學生的說明
        </summary>
        <div className="px-4 pb-4">
          <textarea
            className="input-theme min-h-32 w-full rounded px-3 py-2 text-sm"
            value={settings.instructions}
            onChange={(event) => patch({ instructions: event.target.value })}
            placeholder="說明撰寫原則、送審流程與注意事項…"
          />
        </div>
      </details>

      <div className="flex justify-end gap-3">
        <button type="button" className="btn-theme px-6" onClick={() => void load()} disabled={loading || saving}>
          重新讀取
        </button>
        <button
          type="button"
          className="btn-primary btn-theme px-6"
          onClick={() => void save()}
          disabled={loading || saving}
        >
          {saving ? "儲存中…" : "儲存設定"}
        </button>
      </div>

      <Toast message={toast} onClose={() => setToast(null)} />
    </section>
  );
}
