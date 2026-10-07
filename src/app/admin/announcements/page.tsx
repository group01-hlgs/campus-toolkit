"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ANNOUNCEMENT_DISPLAY_METHOD_LABELS,
  ANNOUNCEMENT_PERMISSION_ROLES,
  ANNOUNCEMENT_SURFACE_LABELS,
  ANNOUNCEMENT_SURFACES,
  ANNOUNCEMENT_SURFACE_METHOD_LABELS,
  announcementPermissionText,
  DEFAULT_ANNOUNCEMENT_SETTINGS,
  type AnnouncementCategory,
  type AnnouncementDisplayMethod,
  type AnnouncementRecord,
  type AnnouncementSettings,
  type AnnouncementSurface,
  type AnnouncementSurfaceMethod,
  type AnnouncementSurfaceSetting,
  type AnnouncementSurfaces,
} from "@/types/announcements";
import { ROLE_LABELS, type UserRole } from "@/types/users";
import { useDataSaver } from "@/lib/data-saver";
import RevealListCard from "@/components/RevealListCard";

type Flash = { type: "success" | "error"; text: string } | null;

interface AdminListResponse {
  success?: boolean;
  message?: string;
  announcements?: AnnouncementRecord[];
  settings?: AnnouncementSettings;
}

interface FormState {
  id?: string;
  title: string;
  body: string;
  categoryId: string;
  /** 閱讀權限：勾選的身分（isPublic 時為空） */
  roles: UserRole[];
  /** 閱讀權限＝「無」（公開，不需登入可見） */
  isPublic: boolean;
  classCodesText: string;
  pinned: boolean;
  expireAtText: string;
}

const emptyForm: FormState = {
  title: "",
  body: "",
  categoryId: "general",
  roles: ["student", "parent", "staff"],
  isPublic: false,
  classCodesText: "",
  pinned: false,
  expireAtText: "",
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

/**
 * 系統公告管理（僅超級／被指派「系統公告管理」的管理員）。
 * 版面順序：模組設定（含 5 處顯示位置）→ 建立／編輯公告（預設收納）→ 公告清單。
 * 清單依系統「省流開關」：啟用時進頁不載入，改按鈕手動顯示（與帳號／名冊清單一致）。
 */
export default function AdminAnnouncementsPage() {
  const { ready: settingsReady, saverOn } = useDataSaver();
  const [settings, setSettings] = useState<AnnouncementSettings>(DEFAULT_ANNOUNCEMENT_SETTINGS);
  const [items, setItems] = useState<AnnouncementRecord[]>([]);
  // 省流開關：啟用時清單預設不載入（狀態僅維持本次頁面停留）
  const [listLoaded, setListLoaded] = useState(false);
  const gating = saverOn && !listLoaded;
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  // 建立／編輯表單：預設收納；點「展開」或由清單按「編輯」時展開
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [displayMethod, setDisplayMethod] = useState<AnnouncementDisplayMethod>("list");
  const [categories, setCategories] = useState<AnnouncementCategory[]>(
    DEFAULT_ANNOUNCEMENT_SETTINGS.categories
  );
  // 5 個顯示位置的顯示與否／方式／筆數
  const [surfaces, setSurfaces] = useState<AnnouncementSurfaces>(
    DEFAULT_ANNOUNCEMENT_SETTINGS.surfaces
  );
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "archived">("all");

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(timer);
  }, [flash]);

  /** 套用設定回應（收件匣顯示方式、分類、顯示位置） */
  const applySettings = useCallback((next: AnnouncementSettings) => {
    setSettings(next);
    setDisplayMethod(next.displayMethod);
    setCategories(next.categories);
    setSurfaces(next.surfaces ?? DEFAULT_ANNOUNCEMENT_SETTINGS.surfaces);
  }, []);

  /** 僅載入模組設定（settings 文檔，不讀公告清單——省流） */
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/announcements/settings", { cache: "no-store" });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (data?.success && data.settings) {
        applySettings(data.settings);
      }
    } catch {
      // 設定讀失敗不擋頁面：表單分類退回預設
    }
  }, [applySettings]);

  useEffect(() => {
    if (!settingsReady) return;
    void loadSettings();
  }, [settingsReady, loadSettings]);

  /** 載入公告清單（省流關閉時進頁自動；開啟時僅在按「顯示公告列表」後） */
  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/admin/announcements", { cache: "no-store" });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (data?.success) {
        setItems(data.announcements ?? []);
        if (data.settings) applySettings(data.settings);
        setListLoaded(true);
      } else {
        setFlash({ type: "error", text: data?.message || "載入公告失敗" });
      }
    } catch {
      setFlash({ type: "error", text: "載入公告失敗" });
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

  /** 寫入後：清單已顯示才就地更新；閘門仍關著時不自動載入 */
  function applyListFromResponse(data: AdminListResponse) {
    if (listLoaded && data.announcements) {
      setItems(data.announcements);
    }
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
      const payload = {
        title: form.title,
        body: form.body,
        categoryId: form.categoryId,
        // 閱讀權限「無」＝公開：不帶身分與班級（伺服端一律正規化為全校、全身分）
        audience: {
          roles: form.isPublic ? [] : form.roles,
          classCodes: form.isPublic ? [] : classCodes,
        },
        isPublic: form.isPublic,
        pinned: form.pinned,
        expireAt: parseDatetimeLocal(form.expireAtText),
      };
      const res = await fetch(
        form.id ? `/api/admin/announcements/${form.id}` : "/api/admin/announcements",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "儲存失敗");
      }
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

  async function archive(id: string) {
    if (saving) return;
    if (!window.confirm("確定要封存此公告？")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, { method: "POST" });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "封存失敗");
      applyListFromResponse(data);
      setFlash({ type: "success", text: data.message || "已封存" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "封存失敗" });
    } finally {
      setSaving(false);
    }
  }

  function edit(item: AnnouncementRecord) {
    setForm({
      id: item.id,
      title: item.title,
      body: item.body,
      categoryId: item.categoryId,
      roles: item.audience.roles.filter((role) => ANNOUNCEMENT_PERMISSION_ROLES.includes(role)),
      isPublic: item.isPublic === true,
      classCodesText: item.isPublic
        ? ""
        : item.audience.classCodes.filter((c) => c !== "*").join(", "),
      pinned: item.pinned === true,
      expireAtText: toDatetimeLocal(item.expireAt),
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
      const res = await fetch("/api/admin/announcements/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayMethod, categories, surfaces }),
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

  function updateSurface(key: AnnouncementSurface, patch: Partial<AnnouncementSurfaceSetting>) {
    setSurfaces((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
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

  function categoryName(id: string) {
    return (
      categories.find((c) => c.id === id)?.name ||
      settings.categories.find((c) => c.id === id)?.name ||
      id
    );
  }

  const filteredItems = items.filter((item) =>
    statusFilter === "all" ? true : item.status === statusFilter
  );

  function toggleRole(role: UserRole) {
    setForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }));
  }

  return (
    <div className="w-full max-w-5xl mb-8 space-y-6">
      {flash && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white"
          style={{ background: `var(${flash.type === "success" ? "--success" : "--danger"})` }}
          role="status"
        >
          {flash.text}
        </div>
      )}

      {/* 1. 模組設定 */}
      <section className="border border-themed rounded-lg bg-card p-5">
        <h3 className="text-lg font-bold text-t1 mb-3">模組設定</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-t2 mb-1" htmlFor="ann-display">
              收件匣顯示方式（各身分「公告」頁）
            </label>
            <select
              id="ann-display"
              className="border border-themed rounded px-3 py-2 text-sm bg-card text-t1"
              value={displayMethod}
              onChange={(e) =>
                setDisplayMethod(e.target.value as AnnouncementDisplayMethod)
              }
            >
              {(Object.keys(ANNOUNCEMENT_DISPLAY_METHOD_LABELS) as AnnouncementDisplayMethod[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {ANNOUNCEMENT_DISPLAY_METHOD_LABELS[key]}
                  </option>
                )
              )}
            </select>
          </div>
          <div>
            <span className="block text-xs text-t2 mb-1">
              顯示位置（顯示與否／顯示方式／顯示筆數，5 處各自設定）
            </span>
            <div className="space-y-2">
              {ANNOUNCEMENT_SURFACES.map((key) => {
                const surface = surfaces[key];
                return (
                  <div key={key} className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-sm text-t1 w-60">
                      <input
                        type="checkbox"
                        checked={surface.enabled}
                        onChange={(e) => updateSurface(key, { enabled: e.target.checked })}
                      />
                      {ANNOUNCEMENT_SURFACE_LABELS[key]}
                    </label>
                    <select
                      className="border border-themed rounded px-2 py-1 text-sm bg-card text-t1 disabled:opacity-50"
                      value={surface.method}
                      disabled={!surface.enabled}
                      onChange={(e) =>
                        updateSurface(key, { method: e.target.value as AnnouncementSurfaceMethod })
                      }
                    >
                      {(
                        Object.keys(
                          ANNOUNCEMENT_SURFACE_METHOD_LABELS
                        ) as AnnouncementSurfaceMethod[]
                      ).map((method) => (
                        <option key={method} value={method}>
                          {ANNOUNCEMENT_SURFACE_METHOD_LABELS[method]}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-1 text-xs text-t2">
                      顯示筆數
                      <input
                        type="number"
                        min={1}
                        max={20}
                        className="w-16 border border-themed rounded px-2 py-1 text-sm bg-card text-t1 disabled:opacity-50"
                        value={surface.limit}
                        disabled={!surface.enabled}
                        onChange={(e) =>
                          updateSurface(key, { limit: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-t3 mt-1">
              「系統首頁」只顯示閱讀權限＝「無」的公告；各身分首頁依其身分顯示。
            </p>
          </div>
          <div>
            <span className="block text-xs text-t2 mb-1">公告分類</span>
            <div className="space-y-2">
              {categories.map((cat, index) => (
                <div key={cat.id || index} className="flex items-center gap-2">
                  <span className="text-xs text-t3 w-4 text-center">{index + 1}</span>
                  <input
                    className="border border-themed rounded px-2 py-1 text-sm bg-card text-t1 w-28"
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
                    className="text-xs text-t3 hover:text-danger cursor-pointer"
                    onClick={() => setCategories(categories.filter((_, i) => i !== index))}
                  >
                    刪除
                  </button>
                </div>
              ))}
            </div>
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
              ＋ 新增分類
            </button>
          </div>
          <button
            type="button"
            onClick={saveSettings}
            disabled={saving}
            className="btn-theme rounded px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
          >
            {saving ? "處理中..." : "儲存設定"}
          </button>
          <p className="text-xs text-t3">
            現行收件匣顯示方式：{ANNOUNCEMENT_DISPLAY_METHOD_LABELS[settings.displayMethod]}
            ；顯示位置啟用 {ANNOUNCEMENT_SURFACES.filter((key) => surfaces[key].enabled).length} / 5 處
            ；跨模組發文請呼叫 <code>publishFromModule()</code>（src/lib/announcements.ts）。
          </p>
        </div>
      </section>

      {/* 2. 建立／編輯公告（預設收納） */}
      <section className="border border-themed rounded-lg bg-card">
        <button
          type="button"
          onClick={() => {
            if (formOpen) {
              cancelEdit();
            } else {
              setFormOpen(true);
            }
          }}
          aria-expanded={formOpen}
          className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer"
        >
          <h3 className="text-lg font-bold text-t1">
            {form.id ? "編輯公告" : "建立公告"}
          </h3>
          <span className="text-t3 text-sm shrink-0">
            {formOpen ? "收合" : "展開"} {formOpen ? "▲" : "▼"}
          </span>
        </button>
        {formOpen && (
          <div className="px-5 pb-5">
            <form onSubmit={submitForm} className="space-y-3">
              <div>
                <label className="block text-xs text-t2 mb-1" htmlFor="ann-title">
                  標題
                </label>
                <input
                  id="ann-title"
                  className="w-full border border-themed rounded px-3 py-2 text-sm bg-card text-t1"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  maxLength={120}
                />
              </div>
              <div>
                <label className="block text-xs text-t2 mb-1" htmlFor="ann-body">
                  內容
                </label>
                <textarea
                  id="ann-body"
                  className="w-full border border-themed rounded px-3 py-2 text-sm bg-card text-t1 min-h-28"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  required
                  maxLength={5000}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-t2 mb-1" htmlFor="ann-cat">
                    分類
                  </label>
                  <select
                    id="ann-cat"
                    className="w-full border border-themed rounded px-3 py-2 text-sm bg-card text-t1"
                    value={form.categoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  >
                    {categories
                      .filter((c) => c.enabled)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-t2 mb-1" htmlFor="ann-expire">
                    到期時間（選填）
                  </label>
                  <input
                    id="ann-expire"
                    type="datetime-local"
                    className="w-full border border-themed rounded px-3 py-2 text-sm bg-card text-t1"
                    value={form.expireAtText}
                    onChange={(e) => setForm({ ...form, expireAtText: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <span className="block text-xs text-t2 mb-1">閱讀權限</span>
                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-1.5 text-sm text-t1">
                    <input
                      type="checkbox"
                      checked={form.isPublic}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          isPublic: e.target.checked,
                          roles: e.target.checked ? [] : prev.roles,
                        }))
                      }
                    />
                    無（公開，不需登入即可看見）
                  </label>
                  {ANNOUNCEMENT_PERMISSION_ROLES.map((role) => (
                    <label
                      key={role}
                      className={`inline-flex items-center gap-1.5 text-sm ${
                        form.isPublic ? "text-t3" : "text-t1"
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={form.isPublic}
                        checked={form.roles.includes(role)}
                        onChange={() => toggleRole(role)}
                      />
                      {ROLE_LABELS[role]}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-t3 mt-1">
                  勾選「無」＝任何人均可看見、不需先登入；勾選身分＝僅該身分可見（可多選，與「無」互斥）。
                </p>
              </div>
              <div>
                <label className="block text-xs text-t2 mb-1" htmlFor="ann-classes">
                  班級代碼（選填，逗號分隔；留空＝全校）
                </label>
                <input
                  id="ann-classes"
                  className="w-full border border-themed rounded px-3 py-2 text-sm bg-card text-t1 disabled:opacity-50"
                  value={form.classCodesText}
                  disabled={form.isPublic}
                  onChange={(e) => setForm({ ...form, classCodesText: e.target.value })}
                  placeholder={form.isPublic ? "閱讀權限「無」＝全校" : "例如：101, 102"}
                />
              </div>
              <label className="inline-flex items-center gap-1.5 text-sm text-t1">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                />
                置頂
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-theme rounded px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                >
                  {saving ? "處理中..." : form.id ? "儲存變更" : "發佈公告"}
                </button>
                {form.id && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={cancelEdit}
                    className="rounded px-4 py-2 text-sm cursor-pointer border border-themed text-t2"
                  >
                    取消編輯
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </section>

      {/* 3. 公告清單（省流：啟用時預設不載入） */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-t1">公告清單</h3>
          {!gating && listLoaded && (
            <div className="flex items-center gap-2 text-sm">
              <label className="text-t2" htmlFor="ann-status-filter">
                篩選
              </label>
              <select
                id="ann-status-filter"
                className="border border-themed rounded px-2 py-1 text-sm bg-card text-t1"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as "all" | "published" | "archived")
                }
              >
                <option value="all">全部</option>
                <option value="published">發布中</option>
                <option value="archived">已封存</option>
              </select>
            </div>
          )}
        </div>
        <div className="border border-themed rounded-lg bg-card overflow-x-auto">
          {gating ? (
            <RevealListCard label="公告" onReveal={() => void loadList()} />
          ) : loadingList && !listLoaded ? (
            <p className="p-6 text-center text-t3">公告清單載入中...</p>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="border-b border-themed">
                <tr className="text-t2">
                  <th className="px-3 py-2 font-medium">標題</th>
                  <th className="px-3 py-2 font-medium">分類</th>
                  <th className="px-3 py-2 font-medium">閱讀權限</th>
                  <th className="px-3 py-2 font-medium">狀態</th>
                  <th className="px-3 py-2 font-medium">發布／到期</th>
                  <th className="px-3 py-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-t3">
                      尚無符合條件的公告
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="border-b border-themed last:border-0 text-t1">
                      <td className="px-3 py-2">
                        <span className="font-medium">{item.title}</span>
                        {item.pinned && (
                          <span className="ml-1.5 text-xs text-success">置頂</span>
                        )}
                        {item.sourceModule !== "announcements" && (
                          <span className="ml-1.5 text-xs text-t3">[{item.sourceModule}]</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-t2">{categoryName(item.categoryId)}</td>
                      <td className="px-3 py-2 text-t2">
                        {announcementPermissionText(item.audience, item.isPublic)}
                        {!item.isPublic &&
                          (item.audience.classCodes[0] !== "*" &&
                          item.audience.classCodes.length > 0
                            ? `（${item.audience.classCodes.join("、")}）`
                            : "（全校）")}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`text-xs ${item.status === "published" ? "text-success" : "text-t3"}`}
                        >
                          {item.status === "published" ? "發布中" : "已封存"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-t3 text-xs">
                        {item.publishAt ? new Date(item.publishAt).toLocaleString("zh-TW") : "—"}
                        {item.expireAt ? (
                          <span className="block">
                            到期 {new Date(item.expireAt).toLocaleString("zh-TW")}
                          </span>
                        ) : (
                          <span className="block">不過期</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => edit(item)}
                          className="btn-theme rounded px-2.5 py-1 text-xs cursor-pointer mr-2"
                        >
                          編輯
                        </button>
                        {item.status === "published" && (
                          <button
                            type="button"
                            onClick={() => archive(item.id)}
                            disabled={saving}
                            className="btn-danger rounded px-2.5 py-1 text-xs cursor-pointer disabled:opacity-50"
                          >
                            封存
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
            到期公告不會出現在各身分收件匣（伺服端已隱藏）；管理端仍可於「已封存」或編輯中處理。
          </p>
        )}
      </section>
    </div>
  );
}
