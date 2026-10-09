"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CALENDAR_FALLBACK_CATEGORY_ID,
  CALENDAR_FALLBACK_CATEGORY_NAME,
  DEFAULT_CALENDAR_SETTINGS,
  type AdminCalendarEventRow,
  type CalendarCategory,
  type CalendarEventStatus,
  type CalendarSettings,
} from "@/types/calendar";
import { normalizeCategoryId } from "@/types/category";
import { ROLE_LABELS, ALL_ROLES, type UserRole } from "@/types/users";
import { useDataSaver } from "@/lib/data-saver";
import RevealListCard from "@/components/RevealListCard";

type Flash = { type: "success" | "error"; text: string } | null;

interface AdminListResponse {
  success?: boolean;
  message?: string;
  events?: AdminCalendarEventRow[];
  settings?: CalendarSettings;
}

interface FormState {
  id?: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  allDayDate: string;
  startAtText: string;
  endAtText: string;
  important: boolean;
  categoryId: string;
  publishUnit: string;
  roles: UserRole[];
  classCodesText: string;
}

const emptyForm: FormState = {
  title: "",
  description: "",
  location: "",
  allDay: false,
  allDayDate: "",
  startAtText: "",
  endAtText: "",
  important: false,
  categoryId: DEFAULT_CALENDAR_SETTINGS.categories[0].id,
  publishUnit: "",
  roles: ["student", "parent", "staff", "admin"],
  classCodesText: "",
};

function toDatetimeLocal(ms?: number): string {
  if (!ms || ms <= 0) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDatetimeLocal(value: string): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key: string, dir: -1 | 1): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + dir, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatRange(item: {
  startAt: number;
  endAt?: number;
  allDayDate?: string;
}): string {
  if (item.allDayDate) {
    const label = new Date(item.startAt).toLocaleDateString("zh-TW");
    return `全天（${label}）`;
  }
  const start = new Date(item.startAt).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (!item.endAt || item.endAt === item.startAt) return start;
  const end = new Date(item.endAt).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${start} ~ ${end}`;
}

/**
 * 行事曆（僅超級／被指派「行事曆」的管理員）。
 * 版面順序：設定卡片（分類管理，預設收合）→ 建立／編輯行程（預設收合）
 * → 行程清單（月份切換、搜尋、狀態篩選）。
 * 清單依系統「省流開關」：啟用時進頁不載入，改按鈕或搜尋時載入（同公告／帳號清單）。
 */
export default function AdminCalendarPage() {
  const { ready: settingsReady, saverOn } = useDataSaver();
  const [settings, setSettings] = useState<CalendarSettings>(DEFAULT_CALENDAR_SETTINGS);
  const [items, setItems] = useState<AdminCalendarEventRow[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const gating = saverOn && !listLoaded;
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [categories, setCategories] = useState<CalendarCategory[]>(
    DEFAULT_CALENDAR_SETTINGS.categories
  );
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [cardOpen, setCardOpen] = useState({ settings: false, categories: false });
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CalendarEventStatus>("all");
  const [month, setMonth] = useState<string | null>(null);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(timer);
  }, [flash]);

  const applySettings = useCallback((next: CalendarSettings) => {
    setSettings(next);
    setCategories(next.categories);
    setRemindersEnabled(next.defaultRemindersEnabled !== false);
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/calendar/settings", { cache: "no-store" });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (data?.success && data.settings) applySettings(data.settings);
    } catch {
      // 設定讀失敗不擋頁面：表單分類退回預設
    }
  }, [applySettings]);

  useEffect(() => {
    if (!settingsReady) return;
    void loadSettings();
  }, [settingsReady, loadSettings]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/admin/calendar", { cache: "no-store" });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (data?.success) {
        setItems(data.events ?? []);
        if (data.settings) applySettings(data.settings);
        setListLoaded(true);
      } else {
        setFlash({ type: "error", text: data?.message || "載入行程失敗" });
      }
    } catch {
      setFlash({ type: "error", text: "載入行程失敗" });
    } finally {
      setLoadingList(false);
    }
  }, [applySettings]);

  useEffect(() => {
    if (!settingsReady) return;
    if (gating) return;
    if (listLoaded) return;
    void loadList();
  }, [settingsReady, gating, listLoaded, loadList]);

  function applyListFromResponse(data: AdminListResponse) {
    if (listLoaded && data.events) setItems(data.events);
    if (data.settings) applySettings(data.settings);
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFlash(null);
    try {
      const classCodes = form.classCodesText
        .split(/[,、;；\s]+/)
        .map((c) => c.trim())
        .filter(Boolean);
      const startAt = parseDatetimeLocal(form.startAtText);
      if (!form.allDay && !startAt) {
        throw new Error("請填寫開始時間");
      }
      const payload = {
        title: form.title,
        description: form.description,
        location: form.location,
        allDay: form.allDay,
        allDayDate: form.allDay ? form.allDayDate : undefined,
        startAt: form.allDay ? undefined : startAt,
        endAt: form.allDay ? null : (parseDatetimeLocal(form.endAtText) ?? null),
        important: form.important,
        categoryId: formCategoryId,
        publishUnit: form.publishUnit,
        audience: { roles: form.roles, classCodes },
      };
      const res = await fetch(form.id ? `/api/admin/calendar/${form.id}` : "/api/admin/calendar", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "儲存失敗");
      applyListFromResponse(data);
      setForm(emptyForm);
      setFormOpen(false);
      setFlash({ type: "success", text: data.message || "已儲存" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "儲存失敗" });
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: CalendarEventStatus) {
    if (saving) return;
    const confirmText =
      status === "cancelled"
        ? "確定要取消此行程？（文件會保留，但不再顯示給任何身分）"
        : "確定要恢復此行程？";
    if (!window.confirm(confirmText)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/calendar/${id}`, {
        method: status === "cancelled" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: status === "cancelled" ? undefined : JSON.stringify({ status: "active" }),
      });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "操作失敗");
      applyListFromResponse(data);
      setFlash({ type: "success", text: data.message || "已更新" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "操作失敗" });
    } finally {
      setSaving(false);
    }
  }

  function edit(item: AdminCalendarEventRow) {
    setForm({
      id: item.id,
      title: item.title,
      description: item.description ?? "",
      location: item.location ?? "",
      allDay: Boolean(item.allDayDate),
      allDayDate: item.allDayDate ?? "",
      startAtText: toDatetimeLocal(item.startAt),
      endAtText: toDatetimeLocal(item.endAt),
      important: item.important === true,
      categoryId: item.categoryId,
      publishUnit: item.publishUnit ?? "",
      roles: item.audience.roles.filter((role) => (ALL_ROLES as string[]).includes(role)),
      classCodesText: item.audience.classCodes.filter((c) => c !== "*").join(", "),
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setForm(emptyForm);
    setFormOpen(false);
  }

  async function saveSettings() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/calendar/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories, defaultRemindersEnabled: remindersEnabled }),
      });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "設定儲存失敗");
      if (data.settings) applySettings(data.settings);
      setFlash({ type: "success", text: data.message || "設定已儲存" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "設定儲存失敗" });
    } finally {
      setSaving(false);
    }
  }

  function moveCategory(index: number, dir: -1 | 1) {
    setCategories((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next.map((cat, i) => ({ ...cat, sortOrder: i }));
    });
  }

  function toggleRole(role: UserRole) {
    setForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }));
  }

  // 表單目前生效的類型：id 已被刪除（或停用）時自動歸到後備類型「其他」
  const enabledCategories = categories.filter((c) => c.enabled);
  const formCategoryId = normalizeCategoryId(
    enabledCategories,
    CALENDAR_FALLBACK_CATEGORY_ID,
    form.categoryId
  );

  const searchKeyword = keyword.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (month && monthKey(item.startAt) !== month) return false;
    if (!searchKeyword) return true;
    const haystack =
      `${item.title}\n${item.description ?? ""}\n${item.location ?? ""}\n${item.categoryName}\n${item.publishUnit ?? ""}\n${item.createdBy.name}`.toLowerCase();
    return haystack.includes(searchKeyword);
  });

  const monthLabel = month
    ? `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`
    : "不限月份";

  return (
    <div className="w-full max-w-4xl mb-8 space-y-6">
      {flash && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white"
          style={{ background: `var(${flash.type === "success" ? "--success" : "--danger"})` }}
          role="status"
        >
          {flash.text}
        </div>
      )}

      {/* 1. 設定管理（預設收合）：收納行事曆設定 */}
      <SettingsCard
        title="設定管理"
        open={cardOpen.settings}
        onToggle={() => setCardOpen((prev) => ({ ...prev, settings: !prev.settings }))}
      >
          {/* 1-1. 設定卡片（行程類型管理，預設收合） */}
          <SettingsCard
            title="行程類型"
            open={cardOpen.categories}
            onToggle={() => setCardOpen((prev) => ({ ...prev, categories: !prev.categories }))}
          >
            <div>
              <div className="space-y-4">
                <div>
                  <span className="block text-t2 mb-1">行事曆類型名稱、啟用與排序</span>
                  <div className="space-y-2">
                    {categories.map((cat, index) => {
                      const isFallback = cat.id === CALENDAR_FALLBACK_CATEGORY_ID;
                      return (
                        <div key={cat.id || index} className="flex items-center gap-2">
                          <span className="text-xs text-t3 w-4 text-center">{index + 1}</span>
                          <input
                            className="w-28 input-theme rounded px-2 py-1"
                            value={cat.name}
                            onChange={(e) => {
                              const next = [...categories];
                              next[index] = { ...cat, name: e.target.value };
                              setCategories(next);
                            }}
                            placeholder="名稱"
                          />
                          <label className="inline-flex items-center gap-1 text-xs text-t2">
                            <input
                              type="checkbox"
                              checked={cat.enabled}
                              disabled={isFallback}
                              title={isFallback ? "後備類型必須啟用" : undefined}
                              onChange={(e) => {
                                const next = [...categories];
                                next[index] = { ...cat, enabled: e.target.checked };
                                setCategories(next);
                              }}
                            />
                            啟用
                          </label>
                          <button
                            type="button"
                            className="text-xs text-t3 hover:text-t1 cursor-pointer px-1"
                            disabled={index === 0}
                            onClick={() => moveCategory(index, -1)}
                            title="上移"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="text-xs text-t3 hover:text-t1 cursor-pointer px-1"
                            disabled={index === categories.length - 1}
                            onClick={() => moveCategory(index, 1)}
                            title="下移"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className={`text-xs px-1 ${
                              isFallback
                                ? "text-t3 cursor-not-allowed"
                                : "text-t3 hover:text-danger cursor-pointer"
                            }`}
                            disabled={isFallback}
                            title={
                              isFallback
                                ? `後備類型「${CALENDAR_FALLBACK_CATEGORY_NAME}」不可刪除`
                                : undefined
                            }
                            onClick={() => setCategories(categories.filter((_, i) => i !== index))}
                          >
                            刪除
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-t3 mt-2">
                    「{CALENDAR_FALLBACK_CATEGORY_NAME}」為後備類型（不可刪除／停用）：其他類型被刪除後，
                    已發佈的行程會在顯示時自動歸入「{CALENDAR_FALLBACK_CATEGORY_NAME}」，不需批次搬移資料。
                  </p>
                  <button
                    type="button"
                    className="mt-2 btn-soft rounded px-3 py-1 text-xs cursor-pointer"
                    onClick={() =>
                      setCategories([
                        ...categories,
                        {
                          id: `custom_${Date.now()}`,
                          name: "",
                          sortOrder: categories.length,
                          enabled: true,
                        },
                      ])
                    }
                  >
                    ＋ 新增行事曆類型
                  </button>
                </div>

                <label className="inline-flex items-center gap-1.5 text-sm text-t1">
                  <input
                    type="checkbox"
                    checked={remindersEnabled}
                    onChange={(e) => setRemindersEnabled(e.target.checked)}
                  />
                  啟用個人提醒（行程清單的「提醒我」按鈕；非推播，開啟頁面才更新）
                </label>
              </div>

              {/* 儲存設定與上方元件固定 10px 間距 */}
              <div className="mt-2.5">
                <button
                  type="button"
                  onClick={saveSettings}
                  disabled={saving}
                  className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                >
                  {saving ? "處理中..." : "儲存設定"}
                </button>
              </div>
              <p className="mt-4 text-xs text-t3">
                跨模組發佈行程請呼叫 <code>publishScheduleFromModule()</code>（src/lib/calendar.ts）。
              </p>
            </div>
          </SettingsCard>
      </SettingsCard>

      {/* 2. 建立／編輯行程（預設收合） */}
      <section className="border border-themed rounded-lg bg-card">
        <button
          type="button"
          onClick={() => (formOpen ? cancelEdit() : setFormOpen(true))}
          aria-expanded={formOpen}
          className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer"
        >
          <h3 className="text-lg font-bold text-t1">{form.id ? "編輯行程" : "建立行程"}</h3>
          <span className="text-t3 text-sm shrink-0">
            {formOpen ? "收合" : "展開"} {formOpen ? "▲" : "▼"}
          </span>
        </button>
        {formOpen && (
          <div className="px-5 pt-2.5 pb-5">
            <form onSubmit={submitForm} className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="cal-title">
                  標題
                </label>
                <input
                  id="cal-title"
                  className="flex-1 input-theme rounded px-3 py-2"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  maxLength={120}
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="cal-desc">
                  說明（選填）
                </label>
                <textarea
                  id="cal-desc"
                  className="flex-1 input-theme rounded px-3 py-2 min-h-24"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  maxLength={2000}
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="cal-location">
                  地點（選填）
                </label>
                <input
                  id="cal-location"
                  className="flex-1 input-theme rounded px-3 py-2"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  maxLength={120}
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="cal-publish-unit">
                  發佈單位（選填）
                </label>
                <input
                  id="cal-publish-unit"
                  className="flex-1 input-theme rounded px-3 py-2"
                  value={form.publishUnit}
                  onChange={(e) => setForm({ ...form, publishUnit: e.target.value })}
                  placeholder="例如：教務處"
                  maxLength={64}
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                <span className="text-t2 sm:w-40 shrink-0">時間</span>
                <div className="flex-1 space-y-2">
                  <label className="inline-flex items-center gap-1.5 text-sm text-t1">
                    <input
                      type="checkbox"
                      checked={form.allDay}
                      onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
                    />
                    全天行程
                  </label>
                  {form.allDay ? (
                    <div>
                      <label className="block text-xs text-t2 mb-1" htmlFor="cal-date">
                        日期
                      </label>
                      <input
                        id="cal-date"
                        type="date"
                        className="w-full sm:w-56 input-theme rounded px-3 py-2"
                        value={form.allDayDate}
                        onChange={(e) => setForm({ ...form, allDayDate: e.target.value })}
                        required
                      />
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs text-t2 mb-1" htmlFor="cal-start">
                          開始時間
                        </label>
                        <input
                          id="cal-start"
                          type="datetime-local"
                          className="w-full input-theme rounded px-3 py-2"
                          value={form.startAtText}
                          onChange={(e) => setForm({ ...form, startAtText: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-t2 mb-1" htmlFor="cal-end">
                          結束時間（選填，留空＝單點）
                        </label>
                        <input
                          id="cal-end"
                          type="datetime-local"
                          className="w-full input-theme rounded px-3 py-2"
                          value={form.endAtText}
                          onChange={(e) => setForm({ ...form, endAtText: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="cal-cat">
                  行事曆類型
                </label>
                  <select
                    id="cal-cat"
                    className="flex-1 input-theme rounded px-3 py-2"
                    value={formCategoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  >
                    {enabledCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {form.id && formCategoryId !== form.categoryId && (
                    <p className="text-xs text-t3 mt-1">
                      原類型已刪除，已自動歸入「{CALENDAR_FALLBACK_CATEGORY_NAME}」
                    </p>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-t2 sm:w-40 shrink-0">重要行程</span>
                  <label className="inline-flex items-center gap-1.5 text-sm text-t1">
                    <input
                      type="checkbox"
                      checked={form.important}
                      onChange={(e) => setForm({ ...form, important: e.target.checked })}
                    />
                    以星號標記
                  </label>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                <span className="text-t2 sm:w-40 shrink-0">可見身分</span>
                <div className="flex-1">
                  <div className="flex flex-wrap gap-3">
                    {ALL_ROLES.map((role) => (
                      <label
                        key={role}
                        className="inline-flex items-center gap-1.5 text-sm text-t1"
                      >
                        <input
                          type="checkbox"
                          checked={form.roles.includes(role)}
                          onChange={() => toggleRole(role)}
                        />
                        {ROLE_LABELS[role]}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-t3 mt-1">至少勾選一個身分。</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="cal-classes">
                  班級代碼（選填，逗號分隔；留空＝全校）
                </label>
                <input
                  id="cal-classes"
                  className="flex-1 input-theme rounded px-3 py-2"
                  value={form.classCodesText}
                  onChange={(e) => setForm({ ...form, classCodesText: e.target.value })}
                  placeholder="例如：101, 102"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                >
                  {saving ? "處理中..." : form.id ? "儲存變更" : "建立行程"}
                </button>
                {form.id && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={cancelEdit}
                    className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                  >
                    取消編輯
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </section>

      {/* 3. 行程清單（月份切換、搜尋、狀態篩選；省流啟用時預設不載入） */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-t1">行程清單</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={keyword}
              onChange={(e) => {
                const value = e.target.value;
                setKeyword(value);
                if (value && gating) void loadList();
              }}
              placeholder="搜尋標題／說明／地點／建立者"
              aria-label="搜尋行程"
              className="input-theme rounded px-2 py-1 text-sm w-44"
            />
            {!gating && listLoaded && (
              <>
                <div className="flex items-center gap-1 text-sm">
                  <button
                    type="button"
                    onClick={() => setMonth(null)}
                    aria-pressed={month === null}
                    className={`px-2 py-1 rounded border cursor-pointer ${
                      month === null
                        ? "border-primary text-primary"
                        : "border-themed text-t3 hover:text-t1"
                    }`}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    aria-label="上一個月"
                    onClick={() => setMonth(shiftMonth(month ?? monthKey(Date.now()), -1))}
                    className="px-2 py-1 rounded border border-themed text-t3 hover:text-t1 cursor-pointer"
                  >
                    ‹
                  </button>
                  <span className="px-1 text-t2 whitespace-nowrap">{monthLabel}</span>
                  <button
                    type="button"
                    aria-label="下一個月"
                    onClick={() => setMonth(shiftMonth(month ?? monthKey(Date.now()), 1))}
                    className="px-2 py-1 rounded border border-themed text-t3 hover:text-t1 cursor-pointer"
                  >
                    ›
                  </button>
                </div>
                <label className="flex items-center gap-1 text-sm text-t2" htmlFor="cal-status">
                  篩選
                </label>
                <select
                  id="cal-status"
                  className="input-theme rounded px-2 py-1"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as "all" | CalendarEventStatus)
                  }
                >
                  <option value="all">全部</option>
                  <option value="active">顯示中</option>
                  <option value="cancelled">已取消</option>
                </select>
              </>
            )}
          </div>
        </div>
        <div className="border border-themed rounded-lg bg-card overflow-x-auto">
          {gating ? (
            <RevealListCard label="行程" onReveal={() => void loadList()} />
          ) : loadingList && !listLoaded ? (
            <p className="p-6 text-center text-t3">行程清單載入中...</p>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="border-b border-themed">
                <tr className="text-t2">
                  <th className="px-3 py-2 font-medium">標題</th>
                  <th className="px-3 py-2 font-medium">時間</th>
                  <th className="px-3 py-2 font-medium">地點</th>
                  <th className="px-3 py-2 font-medium">可見範圍</th>
                  <th className="px-3 py-2 font-medium">發佈單位</th>
                  <th className="px-3 py-2 font-medium">發佈者</th>
                  <th className="px-3 py-2 font-medium">狀態</th>
                  <th className="px-3 py-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-t3">
                      尚無符合條件的行程
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="border-b border-themed last:border-0 text-t1">
                      <td className="px-3 py-2">
                        <span className="font-medium">{item.title}</span>
                        {item.important && (
                          <span className="ml-1.5 text-xs text-primary">★ 重要</span>
                        )}
                        <span className="ml-1.5 text-xs text-t3">
                          行事曆類型：{item.categoryName}
                        </span>
                        {item.sourceModule !== "calendar" && (
                          <span className="ml-1.5 text-xs text-t3">[{item.sourceModule}]</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-t2 whitespace-nowrap">
                        {formatRange(item)}
                      </td>
                      <td className="px-3 py-2 text-t2">{item.location || "—"}</td>
                      <td className="px-3 py-2 text-t2">
                        {item.audience.roles.map((r) => ROLE_LABELS[r]).join("、") || "—"}
                        {item.audience.classCodes[0] !== "*" &&
                        item.audience.classCodes.length > 0
                          ? `（${item.audience.classCodes.join("、")}）`
                          : "（全校）"}
                      </td>
                      <td className="px-3 py-2 text-t2">{item.publishUnit || "—"}</td>
                      <td className="px-3 py-2 text-t2">{item.createdBy.name || "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`text-xs ${
                            item.status === "active" ? "text-success" : "text-t3"
                          }`}
                        >
                          {item.status === "active" ? "顯示中" : "已取消"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => edit(item)}
                          className="btn-theme rounded px-2.5 py-1 text-xs cursor-pointer mr-2"
                        >
                          編輯
                        </button>
                        {item.status === "active" ? (
                          <button
                            type="button"
                            onClick={() => setStatus(item.id, "cancelled")}
                            disabled={saving}
                            className="btn-danger rounded px-2.5 py-1 text-xs cursor-pointer disabled:opacity-50"
                          >
                            取消
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setStatus(item.id, "active")}
                            disabled={saving}
                            className="btn-soft rounded px-2.5 py-1 text-xs cursor-pointer disabled:opacity-50"
                          >
                            恢復
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
        {!gating && listLoaded && (
          <p className="text-xs text-t3 mt-2">
            已取消的行程保留文件但不會回給任何身分；單頁最多載入最近 200 筆行程。
          </p>
        )}
      </section>
    </div>
  );
}

/** 設定卡片：標題列可收合（收合時不渲染內容） */
function SettingsCard({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-themed rounded-lg bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left cursor-pointer"
      >
        <h3 className="text-base font-bold text-t1">{title}</h3>
        <span className="text-t3 text-xs shrink-0">
          {open ? "收合" : "展開"} {open ? "▲" : "▼"}
        </span>
      </button>
      {open && <div className="px-5 pt-2.5 pb-5">{children}</div>}
    </section>
  );
}
