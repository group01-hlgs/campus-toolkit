"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ANNOUNCEMENT_PERMISSION_ROLES,
  ANNOUNCEMENT_SURFACE_LABELS,
  ANNOUNCEMENT_SURFACES,
  ANNOUNCEMENT_SURFACE_METHOD_LABELS,
  announcementPermissionText,
  ANNOUNCEMENT_FALLBACK_CATEGORY_ID,
  ANNOUNCEMENT_FALLBACK_CATEGORY_NAME,
  DEFAULT_ANNOUNCEMENT_SETTINGS,
  isAnnouncementReadable,
  type AnnouncementCategory,
  type AnnouncementPolicies,
  type AnnouncementRecord,
  type AnnouncementSettings,
  type AnnouncementSurface,
  type AnnouncementSurfaceMethod,
  type AnnouncementSurfaceSetting,
  type AnnouncementSurfaces,
} from "@/types/announcements";
import { ROLE_LABELS, type UserRole } from "@/types/users";
import { normalizeCategoryId } from "@/types/category";
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
    categoryId: ANNOUNCEMENT_FALLBACK_CATEGORY_ID,
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
 * 系統公告（僅超級／被指派「系統公告」的管理員）。
 * 版面順序：設定卡片（規則設定／公告顯示方式／顯示位置／公告分類，全部預設收合）
 * → 建立／編輯公告（預設收納）→ 公告清單（標題列有搜尋，省流閘門外）。
 * 清單依系統「省流開關」：啟用時進頁不載入，改按鈕或搜尋時載入（與帳號／名冊清單一致）。
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
  const [categories, setCategories] = useState<AnnouncementCategory[]>(
    DEFAULT_ANNOUNCEMENT_SETTINGS.categories
  );
  // 5 個顯示位置的顯示與否／方式／筆數
  const [surfaces, setSurfaces] = useState<AnnouncementSurfaces>(
    DEFAULT_ANNOUNCEMENT_SETTINGS.surfaces
  );
  // 公告原則（置頂／強制到期／真實刪除）
  const [policies, setPolicies] = useState<AnnouncementPolicies>(
    DEFAULT_ANNOUNCEMENT_SETTINGS.policies
  );
  // 個人公告提醒（首頁鈴鐺＋收件匣「提醒我」按鈕）啟用與否
  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(
    DEFAULT_ANNOUNCEMENT_SETTINGS.defaultRemindersEnabled
  );
  // 設定卡片收合：全部預設收合（外層「設定管理」與其下三張卡片都收合）
  const [cardOpen, setCardOpen] = useState({
    settings: false,
    policies: false,
    surfaces: false,
    categories: false,
  });
  // 清單關鍵字搜尋（省流閘門外：輸入即載入清單再過濾）
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "archived">("all");

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(timer);
  }, [flash]);

  /** 套用設定回應（分類、顯示位置、公告原則） */
  const applySettings = useCallback((next: AnnouncementSettings) => {
    setSettings(next);
    setCategories(next.categories);
    setSurfaces(next.surfaces ?? DEFAULT_ANNOUNCEMENT_SETTINGS.surfaces);
    setPolicies(next.policies ?? DEFAULT_ANNOUNCEMENT_SETTINGS.policies);
    setRemindersEnabled(next.defaultRemindersEnabled !== false);
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
        categoryId: formCategoryId,
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
    const confirmText = policies.hardDeleteExpired
      ? "確定要下架此公告？（已啟用「下架公告真實刪除」：將連同個人提醒一併刪除，無法恢復）"
      : "確定要封存此公告？";
    if (!window.confirm(confirmText)) return;
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
        body: JSON.stringify({ categories, surfaces, policies, defaultRemindersEnabled: remindersEnabled }),
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

  function toggleCard(key: keyof typeof cardOpen) {
    setCardOpen((prev) => ({ ...prev, [key]: !prev[key] }));
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
      // 分類已被刪除：顯示時自動歸到後備分類，不露出原始 id
      ANNOUNCEMENT_FALLBACK_CATEGORY_NAME
    );
  }

  // 表單目前生效的分類：id 已被刪除（或停用）時自動歸到後備分類「其他」
  const enabledCategories = categories.filter((c) => c.enabled);
  const formCategoryId = normalizeCategoryId(
    enabledCategories,
    ANNOUNCEMENT_FALLBACK_CATEGORY_ID,
    form.categoryId
  );

  const searchKeyword = keyword.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (!searchKeyword) return true;
    // 下架（封存／到期）公告不進入搜尋結果——僅供上方清單管理
    if (!isAnnouncementReadable(item)) return false;
    const haystack =
      `${item.title}\n${item.body}\n${categoryName(item.categoryId)}\n${item.authorName}`.toLowerCase();
    return haystack.includes(searchKeyword);
  });

  function toggleRole(role: UserRole) {
    setForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }));
  }

  // 內容寬度與外殼（AdminSectionShell）的 hr／按鈕／頁尾同為 max-w-4xl，左右才會對齊
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

      {/* 1. 設定管理（預設收合）：收納公告原則／顯示位置／公告分類三張卡片 */}
      <SettingsCard
        title="設定管理"
        open={cardOpen.settings}
        onToggle={() => toggleCard("settings")}
      >
        <div className="space-y-6">
          {/* 1-1. 規則設定（預設收合，第一順位）：公告原則＋個人提醒開關 */}
          <SettingsCard
            title="規則設定"
            open={cardOpen.policies}
            onToggle={() => toggleCard("policies")}
          >
            <div>
              <div className="space-y-3">
                <PolicyRow
                  id="pol-pinned"
                  label={
                    <>
                      啟用 <PinIcon />
                      <span className="sr-only">置頂</span>（預設啟用）
                    </>
                  }
                  checked={policies.enablePinned}
                  onChange={(checked) => setPolicies((prev) => ({ ...prev, enablePinned: checked }))}
                  hint="允許管理員將公告設為置頂；置頂公告排在各身分收件匣頂部，並以醒目方式呈現。關閉後新增與編輯皆無法再設定置頂（避免公告區被過多置頂公告佔據）。"
                />
                <PolicyRow
                  id="pol-expire"
                  label="強制到期時間下架（預設啟用）"
                  checked={policies.forceExpire}
                  onChange={(checked) => setPolicies((prev) => ({ ...prev, forceExpire: checked }))}
                  hint="到期時間留空的公告，自動以發布後一個月為到期時間；到期後自動離開收件匣（避免過舊公告長期佔據公告區）。"
                />
                <PolicyRow
                  id="pol-delete"
                  label="下架公告真實刪除（預設停用）"
                  checked={policies.hardDeleteExpired}
                  onChange={(checked) =>
                    setPolicies((prev) => ({ ...prev, hardDeleteExpired: checked }))
                  }
                  hint="開啟後，封存或到期的公告連同個人提醒一併從資料庫真實刪除（無法恢復）。關閉時僅隱藏保留：不進入收件匣，也不提供搜尋。"
                />
                <PolicyRow
                  id="pol-reminders"
                  label="啟用個人公告提醒・首頁鈴鐺（預設啟用）"
                  checked={remindersEnabled}
                  onChange={(checked) => setRemindersEnabled(checked)}
                  hint="啟用後，各身分功能首頁顯示公告提醒鈴鐺（有提醒時顯示則數徽章），公告清單也提供「提醒我」按鈕。關閉後鈴鐺與提醒按鈕一律隱藏。提醒為個人設定、非系統推播，開啟首頁時才更新。"
                />
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
            </div>
          </SettingsCard>

          {/* 1-2. 顯示位置（預設收合） */}
          <SettingsCard
            title="顯示位置"
            open={cardOpen.surfaces}
            onToggle={() => toggleCard("surfaces")}
          >
            <div>
              <span className="block text-t2 mb-1">顯示與否／顯示方式／顯示筆數，5 處各自設定</span>
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
                          className="input-theme rounded px-2 py-1 disabled:opacity-50"
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
                            className="w-16 input-theme rounded px-2 py-1 disabled:opacity-50"
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
                  顯示方式：清單＝單行（日期｜分類｜標題 20 字內）；
                  「清單，置頂公告橫幅」＝置頂公告三行卡片、其餘單行；
                  橫幅＝全部三行卡片（標題 20 字內／內容摘要 40 字內／公告資訊）。
                </p>
                <p className="text-xs text-t3 mt-1">
                  「系統首頁」只顯示閱讀權限＝「無」的公告；各身分首頁依其身分顯示。
                </p>
                <p className="text-xs text-t3 mt-1">
                  顯示位置啟用 {ANNOUNCEMENT_SURFACES.filter((key) => surfaces[key].enabled).length} / 5 處
                  ；跨模組發文請呼叫 <code>publishFromModule()</code>（src/lib/announcements.ts）。
                </p>
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
          </SettingsCard>

          {/* 1-3. 公告分類（預設收合） */}
          <SettingsCard
            title="公告分類"
            open={cardOpen.categories}
            onToggle={() => toggleCard("categories")}
          >
            <div>
              <span className="block text-t2 mb-1">分類名稱、啟用與排序</span>
                <div className="space-y-2">
                  {categories.map((cat, index) => {
                    const isFallback = cat.id === ANNOUNCEMENT_FALLBACK_CATEGORY_ID;
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
                            title={isFallback ? "後備分類必須啟用" : undefined}
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
                              ? `後備分類「${ANNOUNCEMENT_FALLBACK_CATEGORY_NAME}」不可刪除`
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
                  「{ANNOUNCEMENT_FALLBACK_CATEGORY_NAME}」為後備分類（不可刪除／停用）：其他分類被刪除後，
                  已發佈的公告會在顯示時自動歸入「{ANNOUNCEMENT_FALLBACK_CATEGORY_NAME}」，不需批次搬移資料。
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
                  ＋ 新增分類
                </button>
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
          </SettingsCard>
        </div>
      </SettingsCard>

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
          <div className="px-5 pt-2.5 pb-5">
            <form onSubmit={submitForm} className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="ann-title">
                  標題
                </label>
                <input
                  id="ann-title"
                  className="flex-1 input-theme rounded px-3 py-2"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  maxLength={120}
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="ann-body">
                  內容
                </label>
                <textarea
                  id="ann-body"
                  className="flex-1 input-theme rounded px-3 py-2 min-h-28"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  required
                  maxLength={5000}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-t2 mb-1" htmlFor="ann-cat">
                    分類
                  </label>
                  <select
                    id="ann-cat"
                    className="w-full input-theme rounded px-3 py-2"
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
                      原分類已刪除，已自動歸入「{ANNOUNCEMENT_FALLBACK_CATEGORY_NAME}」
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-t2 mb-1" htmlFor="ann-expire">
                    到期時間（選填）
                  </label>
                  <input
                    id="ann-expire"
                    type="datetime-local"
                    className="w-full input-theme rounded px-3 py-2"
                    value={form.expireAtText}
                    onChange={(e) => setForm({ ...form, expireAtText: e.target.value })}
                  />
                  {policies.forceExpire && (
                    <p className="text-xs text-t3 mt-1">
                      留空＝發布後一個月自動到期（「強制到期時間下架」已啟用）
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                <span className="text-t2 sm:w-40 shrink-0">閱讀權限</span>
                <div className="flex-1">
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
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="ann-classes">
                  班級代碼（選填，逗號分隔；留空＝全校）
                </label>
                <input
                  id="ann-classes"
                  className="flex-1 input-theme rounded px-3 py-2 disabled:opacity-50"
                  value={form.classCodesText}
                  disabled={form.isPublic}
                  onChange={(e) => setForm({ ...form, classCodesText: e.target.value })}
                  placeholder={form.isPublic ? "閱讀權限「無」＝全校" : "例如：101, 102"}
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-t2 sm:w-40 shrink-0">置頂</span>
                <label
                  className={`inline-flex items-center gap-1.5 text-sm ${
                    policies.enablePinned ? "text-t1" : "text-t3"
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={!policies.enablePinned}
                    checked={policies.enablePinned && form.pinned}
                    onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                  />
                  {policies.enablePinned
                    ? "公告排序在各身分收件匣頂部（「清單，置頂公告橫幅／橫幅」方式另有醒目呈現）"
                    : "已在「規則設定」關閉置頂功能，儲存時將不設定置頂"}
                </label>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                >
                  {saving ? "處理中..." : form.id ? "儲存變更" : "發佈公告"}
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

      {/* 3. 公告清單（省流：啟用時預設不載入） */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-t1">公告清單</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={keyword}
              onChange={(e) => {
                const value = e.target.value;
                setKeyword(value);
                // 省流閘門外搜尋：輸入即載入清單，載入後再本機過濾（與名冊一致）
                if (value && gating) void loadList();
              }}
              placeholder="搜尋標題／內容／分類／作者"
              aria-label="搜尋公告"
              className="input-theme rounded px-2 py-1 text-sm w-44"
            />
            {!gating && listLoaded && (
              <div className="flex items-center gap-2 text-sm">
                <label className="text-t2" htmlFor="ann-status-filter">
                  篩選
                </label>
                <select
                  id="ann-status-filter"
                  className="input-theme rounded px-2 py-1"
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
                          <span className="ml-1.5 text-xs text-primary">置頂</span>
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
                            {policies.hardDeleteExpired ? "下架" : "封存"}
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
            到期與封存（下架）公告不會出現在各身分收件匣，也不進入上方搜尋結果；
            管理端仍可於本清單編輯或處理。
          </p>
        )}
      </section>
    </div>
  );
}

/** 設定卡片：標題列可收合（收合時不渲染內容，省去重複計算） */
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

/** 置頂圖示（替代標籤裡突兀的「置頂」兩字；寬高 16、隨文字主色） */
function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block align-[-3px]"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

/** 公告原則列：核取框＋「？」說明（點選才顯示） */
function PolicyRow({
  id,
  label,
  checked,
  onChange,
  hint,
}: {
  id: string;
  label: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint: string;
}) {
  const [showHint, setShowHint] = useState(false);
  return (
    <div>
      <label
        htmlFor={id}
        className="inline-flex items-center gap-1.5 text-sm text-t1 cursor-pointer"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      <button
        type="button"
        aria-expanded={showHint}
        onClick={() => setShowHint((prev) => !prev)}
        className="ml-1.5 inline-flex w-4 h-4 leading-4 items-center justify-center border border-themed rounded-full text-t2 text-xs cursor-pointer hover:bg-themed"
        title="顯示說明"
      >
        ?
      </button>
      {showHint && (
        <p className="text-xs text-t3 mt-0.5 pl-6">{hint}</p>
      )}
    </div>
  );
}
