"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ANNOUNCEMENT_DISPLAY_METHOD_LABELS,
  type AnnouncementCategory,
  type AnnouncementDisplayMethod,
  type AnnouncementRecord,
  type AnnouncementSettings,
  DEFAULT_ANNOUNCEMENT_SETTINGS,
} from "@/types/announcements";
import { ALL_ROLES, ROLE_LABELS, type UserRole } from "@/types/users";

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
  roles: UserRole[];
  classCodesText: string;
  pinned: boolean;
  expireAtText: string;
}

const emptyForm: FormState = {
  title: "",
  body: "",
  categoryId: "general",
  roles: ["student", "parent", "staff", "admin"],
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

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState<AnnouncementRecord[]>([]);
  const [settings, setSettings] = useState<AnnouncementSettings>(DEFAULT_ANNOUNCEMENT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [displayMethod, setDisplayMethod] = useState<AnnouncementDisplayMethod>("list");
  const [categories, setCategories] = useState<AnnouncementCategory[]>(
    DEFAULT_ANNOUNCEMENT_SETTINGS.categories
  );

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(timer);
  }, [flash]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/announcements", { cache: "no-store" });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (data?.success) {
        setItems(data.announcements ?? []);
        if (data.settings) {
          setSettings(data.settings);
          setDisplayMethod(data.settings.displayMethod);
          setCategories(data.settings.categories);
        }
      }
    } catch {
      setFlash({ type: "error", text: "載入公告失敗" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        audience: { roles: form.roles, classCodes },
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
      if (data.announcements) setItems(data.announcements);
      if (data.settings) setSettings(data.settings);
      setForm(emptyForm);
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
      if (data.announcements) setItems(data.announcements);
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
      roles: item.audience.roles,
      classCodesText: item.audience.classCodes.filter((c) => c !== "*").join(", "),
      pinned: item.pinned === true,
      expireAtText: toDatetimeLocal(item.expireAt),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveSettings() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/announcements/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayMethod, categories }),
      });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "設定儲存失敗");
      if (data.settings) {
        setSettings(data.settings);
        setDisplayMethod(data.settings.displayMethod);
        setCategories(data.settings.categories);
      }
      setFlash({ type: "success", text: data.message || "設定已儲存" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "設定儲存失敗" });
    } finally {
      setSaving(false);
    }
  }

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

      {/* 建立／編輯表單 */}
      <section className="border border-themed rounded-lg bg-card p-5">
        <h3 className="text-lg font-bold text-t1 mb-3">
          {form.id ? "編輯公告" : "建立公告"}
        </h3>
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
            <span className="block text-xs text-t2 mb-1">對象身分</span>
            <div className="flex flex-wrap gap-3">
              {ALL_ROLES.map((role) => (
                <label key={role} className="inline-flex items-center gap-1.5 text-sm text-t1">
                  <input
                    type="checkbox"
                    checked={form.roles.includes(role)}
                    onChange={() => toggleRole(role)}
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-t2 mb-1" htmlFor="ann-classes">
              班級代碼（選填，逗號分隔；留空＝全校）
            </label>
            <input
              id="ann-classes"
              className="w-full border border-themed rounded px-3 py-2 text-sm bg-card text-t1"
              value={form.classCodesText}
              onChange={(e) => setForm({ ...form, classCodesText: e.target.value })}
              placeholder="例如：101, 102"
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
                onClick={() => setForm(emptyForm)}
                className="rounded px-4 py-2 text-sm cursor-pointer border border-themed text-t2"
              >
                取消編輯
              </button>
            )}
          </div>
        </form>
      </section>

      {/* 公告清單 */}
      <section>
        <h3 className="text-lg font-bold text-t1 mb-3">公告清單</h3>
        <div className="border border-themed rounded-lg bg-card overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="border-b border-themed">
              <tr className="text-t2">
                <th className="px-3 py-2 font-medium">標題</th>
                <th className="px-3 py-2 font-medium">分類</th>
                <th className="px-3 py-2 font-medium">對象</th>
                <th className="px-3 py-2 font-medium">狀態</th>
                <th className="px-3 py-2 font-medium">發布</th>
                <th className="px-3 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-t3">
                    載入中...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-t3">
                    尚無公告
                  </td>
                </tr>
              ) : (
                items.map((item) => (
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
                    <td className="px-3 py-2 text-t2">{item.categoryId}</td>
                    <td className="px-3 py-2 text-t2">
                      {item.audience.roles.map((r) => ROLE_LABELS[r]).join("、")}
                      {item.audience.classCodes[0] !== "*" && item.audience.classCodes.length > 0
                        ? `（${item.audience.classCodes.join("、")}）`
                        : "（全校）"}
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
        </div>
      </section>

      {/* 模組設定 */}
      <section className="border border-themed rounded-lg bg-card p-5">
        <h3 className="text-lg font-bold text-t1 mb-3">模組設定</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-t2 mb-1" htmlFor="ann-display">
              顯示方式
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
            <span className="block text-xs text-t2 mb-1">公告分類</span>
            <div className="space-y-2">
              {categories.map((cat, index) => (
                <div key={cat.id || index} className="flex items-center gap-2">
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
            現行顯示方式：{ANNOUNCEMENT_DISPLAY_METHOD_LABELS[settings.displayMethod]}
            ；跨模組發文請呼叫 <code>publishFromModule()</code>（src/lib/announcements.ts）。
          </p>
        </div>
      </section>
    </div>
  );
}
