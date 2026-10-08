"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSession } from "@/lib/session";
import { fetchSettings } from "@/lib/settings-client";
import { calendarEventEnd, type CalendarEventItem } from "@/types/calendar";
import { ROLE_LABELS, type UserRole } from "@/types/users";

type Flash = { type: "success" | "error"; text: string } | null;
type FontSize = "small" | "medium" | "large";
type ViewMode = "month" | "list";

const FONT_SIZE_LABELS: Record<FontSize, string> = { small: "小", medium: "中", large: "大" };

/** 字級對照：原尺寸為基準，小=+15%、中=+40%、大=+90%（同公告） */
const FONT_SIZE_CLASSES: Record<
  FontSize,
  { heading: string; title: string; body: string; meta: string }
> = {
  small: { heading: "text-base", title: "text-base", body: "text-sm", meta: "text-sm" },
  medium: { heading: "text-lg", title: "text-lg", body: "text-base", meta: "text-base" },
  large: { heading: "text-xl", title: "text-2xl", body: "text-xl", meta: "text-xl" },
};

const STORAGE_KEY = "calendar-font-size";
const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function readStoredFontSize(): FontSize {
  if (typeof window === "undefined") return "small";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "medium" || raw === "large" ? raw : "small";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 本地時區的 "YYYY-MM-DD" */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDatetimeLocal(value: string): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function eventDayRange(item: CalendarEventItem): [string, string] {
  if (item.allDayDate) return [item.allDayDate, item.allDayDate];
  const start = dayKey(item.startAt);
  const end = dayKey(calendarEventEnd(item));
  if (end <= start || start > end) return [start, start];
  return [start, end];
}

function inRange(range: [string, string], key: string): boolean {
  return key >= range[0] && key <= range[1];
}

function formatRange(item: CalendarEventItem): string {
  const s = new Date(item.startAt);
  if (item.allDayDate) return `全天（${s.getMonth() + 1}/${s.getDate()}）`;
  const base = `${s.getMonth() + 1}/${s.getDate()} ${pad2(s.getHours())}:${pad2(s.getMinutes())}`;
  if (typeof item.endAt !== "number" || item.endAt <= item.startAt) return base;
  const e = new Date(item.endAt);
  const sameDay =
    e.getFullYear() === s.getFullYear() &&
    e.getMonth() === s.getMonth() &&
    e.getDate() === s.getDate();
  return sameDay
    ? `${base} ~ ${pad2(e.getHours())}:${pad2(e.getMinutes())}`
    : `${base} ~ ${e.getMonth() + 1}/${e.getDate()} ${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
}

interface CalendarResponse {
  success?: boolean;
  message?: string;
  items?: CalendarEventItem[];
  classCode?: string | null;
  displayName?: string;
  categories?: { id: string; name: string }[];
  remindersEnabled?: boolean;
  /** 發佈單位預設值（教職員名冊「單位」） */
  publishUnit?: string;
}

/**
 * 各身分行事曆（學生／家長／教職員共用；教職員另可建立行程）。
 * 功能：月曆檢視（月曆格＋當日行程列表）、列表檢視、重要性標記、
 * 個人提醒切換、字級切換（localStorage）、教職員建立行程。
 */
export default function CalendarView({
  role,
  canCreate,
}: {
  role: UserRole;
  canCreate?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<CalendarEventItem[]>([]);
  const [classCode, setClassCode] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [unitDefault, setUnitDefault] = useState("");
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<Flash>(null);
  const [fontSize, setFontSize] = useState<FontSize>("small");
  const [view, setView] = useState<ViewMode>("month");
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => dayKey(Date.now()));
  const [keyword, setKeyword] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [togglingReminder, setTogglingReminder] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    location: "",
    allDay: false,
    allDayDate: dayKey(Date.now()),
    startAtText: "",
    endAtText: "",
    important: false,
    classScoped: false,
    publishUnit: "",
    roles: ["student", "parent", "staff"] as UserRole[],
  });

  useEffect(() => setFontSize(readStoredFontSize()), []);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const [session, settingsData] = await Promise.all([fetchSession(true), fetchSettings()]);
      if (cancelled) return;
      if (!session || session.role !== role) {
        router.push("/");
        return;
      }
      setDisplayName(session.displayName);
      const visible = settingsData?.visibleModules;
      if (Array.isArray(visible) && !visible.includes("calendar")) {
        setFlash({ type: "error", text: "行事曆功能目前對此身分關閉顯示" });
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [role, router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar", { cache: "no-store" });
      const data: CalendarResponse | null = await res.json().catch(() => null);
      if (data?.success) {
        setItems(data.items ?? []);
        setClassCode(data.classCode ?? null);
        if (data.categories) setCategories(data.categories);
        if (typeof data.remindersEnabled === "boolean") {
          setRemindersEnabled(data.remindersEnabled);
        }
        if (typeof data.publishUnit === "string") {
          setUnitDefault(data.publishUnit);
          setForm((prev) =>
            prev.publishUnit === "" ? { ...prev, publishUnit: data.publishUnit ?? "" } : prev
          );
        }
      } else if (data?.message) {
        setFlash({ type: "error", text: data.message });
      }
    } catch {
      setFlash({ type: "error", text: "載入行事曆失敗" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryName = useCallback(
    (categoryId: string) => categories.find((c) => c.id === categoryId)?.name || "其他",
    [categories]
  );

  const visibleItems = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const sorted = [...items].sort((a, b) => a.startAt - b.startAt);
    if (!kw) return sorted;
    return sorted.filter((item) =>
      `${item.title}\n${item.description ?? ""}\n${item.location ?? ""}\n${categoryName(
        item.categoryId
      )}`
        .toLowerCase()
        .includes(kw)
    );
  }, [items, keyword, categoryName]);

  /** 月曆格：日期 key → 該日行程（含跨日行程的每一天） */
  const dayEvents = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const item of visibleItems) {
      const range = eventDayRange(item);
      const keys: string[] = [];
      if (range[0] === range[1]) {
        keys.push(range[0]);
      } else {
        const start = new Date(`${range[0]}T00:00:00`);
        for (let i = 0; i <= 31; i++) {
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
          const key = dayKey(d.getTime());
          if (key > range[1]) break;
          keys.push(key);
        }
      }
      for (const key of keys) {
        const list = map.get(key);
        if (list) list.push(item);
        else map.set(key, [item]);
      }
    }
    return map;
  }, [visibleItems]);

  const monthCells = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const offset = new Date(y, m, 1).getDay();
    const base = new Date(y, m, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      return { key: dayKey(d.getTime()), date: d, inMonth: d.getMonth() === m };
    });
  }, [cursor]);

  const selectedItems = dayEvents.get(selectedDay) ?? [];
  const todayKey = dayKey(Date.now());

  function changeFontSize(size: FontSize) {
    setFontSize(size);
    try {
      window.localStorage.setItem(STORAGE_KEY, size);
    } catch {
      // localStorage 不可用時僅本次生效
    }
  }

  function shiftCursor(dir: -1 | 1) {
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  }

  function goToday() {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDay(dayKey(now.getTime()));
  }

  async function toggleReminder(eventId: string) {
    if (togglingReminder) return;
    setTogglingReminder(eventId);
    try {
      const res = await fetch("/api/calendar/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
        reminded?: boolean;
      } | null;
      if (!res.ok || !data?.success) throw new Error(data?.message || "提醒設定失敗");
      const reminded = data.reminded === true;
      setItems((prev) =>
        prev.map((item) => (item.id === eventId ? { ...item, reminded } : item))
      );
      setFlash({
        type: "success",
        text: data.message || (reminded ? "已加入提醒" : "已取消提醒"),
      });
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "提醒設定失敗",
      });
    } finally {
      setTogglingReminder(null);
    }
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (posting) return;
    setPosting(true);
    setFlash(null);
    try {
      const startAt = parseDatetimeLocal(form.startAtText);
      if (!form.allDay && !startAt) throw new Error("請填寫開始時間");
      const classCodes = form.classScoped && classCode ? [classCode] : [];
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          location: form.location,
          allDay: form.allDay,
          allDayDate: form.allDay ? form.allDayDate : undefined,
          startAt: form.allDay ? undefined : startAt,
          endAt: form.allDay ? null : (parseDatetimeLocal(form.endAtText) ?? null),
          important: form.important,
          publishUnit: form.publishUnit || unitDefault,
          audience: { roles: form.roles, classCodes },
        }),
      });
      const data: CalendarResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "建立失敗");
      setForm({
        ...form,
        title: "",
        description: "",
        location: "",
        startAtText: "",
        endAtText: "",
        important: false,
      });
      setFormOpen(false);
      if (data.items) setItems(data.items);
      else await load();
      setFlash({ type: "success", text: data.message || "行程已建立" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "建立失敗" });
    } finally {
      setPosting(false);
    }
  }

  const sizes = FONT_SIZE_CLASSES[fontSize];

  return (
    <div className="w-full max-w-3xl mb-8 space-y-6">
      {flash && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white"
          style={{ background: `var(${flash.type === "success" ? "--success" : "--danger"})` }}
          role="status"
        >
          {flash.text}
        </div>
      )}

      <div className="content-width text-center">
        <h2 className="text-2xl font-bold text-t1">行事曆</h2>
        {displayName && <p className="text-t2 mt-1">{displayName}，您好</p>}
        {classCode && <p className="text-xs text-t3 mt-0.5">班級：{classCode}</p>}
        <button
          type="button"
          onClick={() => router.push(`/${role}`)}
          className="mt-2 btn-soft rounded px-3 py-1 text-xs cursor-pointer"
        >
          ← 返回功能首頁
        </button>
      </div>

      {canCreate && (
        <section className="border border-themed rounded-lg bg-card p-5">
          <button
            type="button"
            aria-expanded={formOpen}
            onClick={() => setFormOpen((prev) => !prev)}
            className="w-full flex items-center justify-between text-left cursor-pointer"
          >
            <h3 className="text-lg font-bold text-t1">建立行程</h3>
            <span className="text-t3 text-sm">{formOpen ? "收合 ▲" : "展開 ▼"}</span>
          </button>
          {formOpen && (
            <form onSubmit={submitCreate} className="mt-3 space-y-3">
              <div>
                <label className="block text-xs text-t2 mb-1" htmlFor="cv-title">
                  標題
                </label>
                <input
                  id="cv-title"
                  className="w-full input-theme rounded px-3 py-2 text-sm"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  maxLength={120}
                />
              </div>
              <div>
                <label className="block text-xs text-t2 mb-1" htmlFor="cv-desc">
                  說明（選填）
                </label>
                <textarea
                  id="cv-desc"
                  className="w-full input-theme rounded px-3 py-2 text-sm min-h-20"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  maxLength={2000}
                />
              </div>
              <div>
                <label className="block text-xs text-t2 mb-1" htmlFor="cv-unit">
                  發佈單位（選填）
                </label>
                <input
                  id="cv-unit"
                  className="w-full input-theme rounded px-3 py-2 text-sm"
                  value={form.publishUnit}
                  onChange={(e) => setForm({ ...form, publishUnit: e.target.value })}
                  placeholder={unitDefault || "例如：教務處"}
                  maxLength={64}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-t2 mb-1" htmlFor="cv-location">
                    地點（選填）
                  </label>
                  <input
                    id="cv-location"
                    className="w-full input-theme rounded px-3 py-2 text-sm"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    maxLength={120}
                  />
                </div>
                <div>
                  <span className="block text-xs text-t2 mb-1">時間</span>
                  <label className="inline-flex items-center gap-1.5 text-sm text-t1 mr-3">
                    <input
                      type="checkbox"
                      checked={form.allDay}
                      onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
                    />
                    全天
                  </label>
                  {form.allDay ? (
                    <input
                      type="date"
                      aria-label="全天日期"
                      className="input-theme rounded px-2 py-1 text-sm"
                      value={form.allDayDate}
                      onChange={(e) => setForm({ ...form, allDayDate: e.target.value })}
                      required
                    />
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
                      <input
                        type="datetime-local"
                        aria-label="開始時間"
                        className="input-theme rounded px-2 py-1 text-sm"
                        value={form.startAtText}
                        onChange={(e) => setForm({ ...form, startAtText: e.target.value })}
                        required
                      />
                      <input
                        type="datetime-local"
                        aria-label="結束時間（選填）"
                        className="input-theme rounded px-2 py-1 text-sm"
                        value={form.endAtText}
                        onChange={(e) => setForm({ ...form, endAtText: e.target.value })}
                      />
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-t1">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={form.important}
                    onChange={(e) => setForm({ ...form, important: e.target.checked })}
                  />
                  重要行程
                </label>
                {(["student", "parent", "staff"] as UserRole[]).map((r) => (
                  <label key={r} className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={form.roles.includes(r)}
                      onChange={() =>
                        setForm((prev) => ({
                          ...prev,
                          roles: prev.roles.includes(r)
                            ? prev.roles.filter((x) => x !== r)
                            : [...prev.roles, r],
                        }))
                      }
                    />
                    {ROLE_LABELS[r]}
                  </label>
                ))}
                {classCode && (
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={form.classScoped}
                      onChange={(e) => setForm({ ...form, classScoped: e.target.checked })}
                    />
                    僅限我的導師班（{classCode}）
                  </label>
                )}
              </div>
              <button
                type="submit"
                disabled={posting}
                className="btn-theme rounded px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
              >
                {posting ? "處理中..." : "建立行程"}
              </button>
            </form>
          )}
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex items-center gap-1" role="group" aria-label="檢視方式">
            <button
              type="button"
              onClick={() => setView("month")}
              aria-pressed={view === "month"}
              className={`px-3 py-1 text-sm rounded border cursor-pointer ${
                view === "month"
                  ? "border-primary text-primary font-medium"
                  : "border-themed text-t3 hover:text-t1"
              }`}
            >
              月曆
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              className={`px-3 py-1 text-sm rounded border cursor-pointer ${
                view === "list"
                  ? "border-primary text-primary font-medium"
                  : "border-themed text-t3 hover:text-t1"
              }`}
            >
              列表
            </button>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="行事曆字級">
            {(Object.keys(FONT_SIZE_LABELS) as FontSize[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => changeFontSize(key)}
                aria-pressed={fontSize === key}
                className={`px-2 py-0.5 text-sm rounded border cursor-pointer transition-colors ${
                  fontSize === key
                    ? "border-primary text-primary font-medium"
                    : "border-themed text-t3 hover:text-t1"
                }`}
              >
                {FONT_SIZE_LABELS[key]}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋行程"
            aria-label="搜尋行程"
            className="input-theme rounded px-2 py-1 text-sm w-40 ml-auto"
          />
        </div>

        {loading ? (
          <p className="text-t3 text-sm">載入中...</p>
        ) : view === "month" ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="上個月"
                  onClick={() => shiftCursor(-1)}
                  className="px-2 py-1 rounded border border-themed text-t3 hover:text-t1 cursor-pointer"
                >
                  ‹
                </button>
                <span className={`${sizes.heading} font-bold text-t1`}>
                  {cursor.getFullYear()} 年 {cursor.getMonth() + 1} 月
                </span>
                <button
                  type="button"
                  aria-label="下個月"
                  onClick={() => shiftCursor(1)}
                  className="px-2 py-1 rounded border border-themed text-t3 hover:text-t1 cursor-pointer"
                >
                  ›
                </button>
              </div>
              <button
                type="button"
                onClick={goToday}
                className="btn-soft rounded px-2.5 py-1 text-xs cursor-pointer"
              >
                今天
              </button>
            </div>

            <div className="border border-themed rounded-lg bg-card overflow-hidden">
              <div className="grid grid-cols-7 border-b border-themed text-center text-t2 text-xs">
                {WEEK_LABELS.map((label) => (
                  <div key={label} className="py-1.5">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {monthCells.map((cell) => {
                  const list = dayEvents.get(cell.key) ?? [];
                  const isToday = cell.key === todayKey;
                  const isSelected = cell.key === selectedDay;
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      onClick={() => setSelectedDay(cell.key)}
                      aria-pressed={isSelected}
                      className={`min-h-16 sm:min-h-20 p-1 text-left border-r border-b border-themed last:border-r-0 cursor-pointer ${
                        isSelected ? "bg-card border-primary/40" : "hover:bg-card/60"
                      } ${cell.inMonth ? "" : "opacity-45"}`}
                    >
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 text-xs rounded-full ${
                          isToday
                            ? "bg-primary text-white font-medium"
                            : isSelected
                              ? "text-primary font-medium"
                              : "text-t2"
                        }`}
                      >
                        {cell.date.getDate()}
                      </span>
                      {list.slice(0, 2).map((item) => (
                        <span
                          key={item.id}
                          className="mt-0.5 block truncate text-[11px] leading-tight text-t1"
                        >
                          {item.important && <span className="text-primary">★</span>}
                          {item.title}
                        </span>
                      ))}
                      {list.length > 2 && (
                        <span className="block text-[11px] text-t3">＋{list.length - 2}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3">
              <h4 className={`${sizes.title} font-bold text-t1 mb-2`}>
                {selectedDay.replace(/-/g, "/")} 的行程
              </h4>
              {selectedItems.length === 0 ? (
                <p className={`${sizes.body} text-t3 text-sm`}>這天沒有行程</p>
              ) : (
                <ul className="space-y-2">
                  {selectedItems.map((item) => (
                    <EventCard
                      key={item.id}
                      item={item}
                      categoryName={categoryName(item.categoryId)}
                      sizes={sizes}
                      expanded={expandedId === item.id}
                      onToggleExpand={() =>
                        setExpandedId((prev) => (prev === item.id ? null : item.id))
                      }
                      remindersEnabled={remindersEnabled}
                      toggling={togglingReminder === item.id}
                      onToggleReminder={toggleReminder}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <ul className="space-y-2">
            {visibleItems.length === 0 ? (
              <li className={`${sizes.body} text-t3 text-sm`}>目前沒有行程</li>
            ) : (
              visibleItems.map((item) => (
                <EventCard
                  key={item.id}
                  item={item}
                  categoryName={categoryName(item.categoryId)}
                  sizes={sizes}
                  expanded={expandedId === item.id}
                  onToggleExpand={() =>
                    setExpandedId((prev) => (prev === item.id ? null : item.id))
                  }
                  remindersEnabled={remindersEnabled}
                  toggling={togglingReminder === item.id}
                  onToggleReminder={toggleReminder}
                />
              ))
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

function EventCard({
  item,
  categoryName,
  sizes,
  expanded,
  onToggleExpand,
  remindersEnabled,
  toggling,
  onToggleReminder,
}: {
  item: CalendarEventItem;
  categoryName: string;
  sizes: { title: string; body: string; meta: string };
  expanded: boolean;
  onToggleExpand: () => void;
  remindersEnabled: boolean;
  toggling: boolean;
  onToggleReminder: (id: string) => void;
}) {
  return (
    <li className="border border-themed rounded-lg bg-card">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggleExpand}
        className="w-full flex items-start justify-between gap-2 px-4 py-3 text-left cursor-pointer"
      >
        <span className="min-w-0">
          <span className={`${sizes.title} font-bold text-t1`}>
            {item.important && <span className="text-primary mr-1">★</span>}
            {item.title}
          </span>
          <span className={`${sizes.meta} block text-t3 mt-0.5`}>
            {formatRange(item)}
            {item.location ? `｜${item.location}` : ""}
            {`｜行事曆類型：${categoryName}`}
            {item.classScoped ? "｜班級" : ""}
          </span>
        </span>
        <span className={`${sizes.meta} text-t3 shrink-0`}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="border-t border-themed px-4 py-3">
          <p className={`${sizes.meta} text-t3`}>
            行事曆類型：{categoryName}｜{item.createdByName}
            {item.classScoped ? `｜${item.classCodes.join("、")}` : "｜全校"}
            {item.sourceModule !== "calendar" ? `｜來源：${item.sourceModule}` : ""}
          </p>
          <p className={`${sizes.meta} text-t3 mt-0.5`}>{formatRange(item)}</p>
          {item.description && (
            <p className={`${sizes.body} text-t2 mt-2 whitespace-pre-wrap`}>{item.description}</p>
          )}
          {remindersEnabled && (
            <div className="mt-3">
              <button
                type="button"
                disabled={toggling}
                onClick={() => onToggleReminder(item.id)}
                className={
                  item.reminded
                    ? "btn-danger rounded px-2.5 py-1 text-sm cursor-pointer disabled:opacity-50"
                    : "btn-soft rounded px-2.5 py-1 text-sm cursor-pointer disabled:opacity-50"
                }
                title="個人提醒：於本頁提醒區顯示（非系統推播）"
              >
                {toggling ? "處理中..." : item.reminded ? "已設定提醒" : "提醒我"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
