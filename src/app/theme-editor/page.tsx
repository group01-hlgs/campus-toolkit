"use client";

import { useEffect, useMemo, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchSession, UserSession } from "@/lib/session";
import { useTheme } from "@/contexts/ThemeContext";
import { builtinThemes } from "@/lib/themes";
import {
  listInstalledThemes,
  readStoredTheme,
  removeInstalledTheme,
  saveInstalledTheme,
  syncInstalledThemesToAccount,
} from "@/lib/theme-store";
import ThemeSubmissionForm from "@/components/ThemeSubmissionForm";
import DisclosureArrow from "@/components/DisclosureArrow";
import Toast, { type ToastMessage } from "@/components/Toast";
import { ThemeColors, THEME_COLOR_KEYS } from "@/types/theme";

/**
 * CSS 主題編輯器（對應舊 GAS theme_create 的核心體驗）：
 * 選基底 → 調色票（即時預覽）→ 儲存並套用（custom: 主題，僅本人可見）
 * → 滿意的話「投稿上架」送審（§21）。
 */

const COLOR_GROUPS: Array<{ title: string; keys: Array<keyof ThemeColors> }> = [
  { title: "版面", keys: ["--bg", "--bg2", "--card"] },
  { title: "文字", keys: ["--t1", "--t2", "--t3"] },
  { title: "邊框", keys: ["--bd", "--bd2"] },
  {
    title: "主要色",
    keys: ["--primary", "--primary-hover", "--primary-text", "--primary-text-hover", "--primary-block"],
  },
  { title: "狀態", keys: ["--success", "--warning", "--danger"] },
  {
    title: "按鈕",
    keys: [
      "--btn-secondary",
      "--btn-secondary-hover",
      "--btn-secondary-text",
      "--btn-secondary-text-hover",
      "--btn-danger",
      "--btn-danger-hover",
      "--btn-danger-text",
      "--btn-danger-text-hover",
      "--btn-disabled",
      "--btn-disabled-text",
    ],
  },
  { title: "連結", keys: ["--link", "--link-hover"] },
];

const STYLE_FIELDS: Array<{ key: keyof ThemeColors; label: string }> = [
  { key: "--sh", label: "陰影（完整 shadow 值）" },
  { key: "--radius", label: "圓角" },
  { key: "--font-sans", label: "正文字型" },
  { key: "--font-mono", label: "等寬字型" },
  { key: "--transition", label: "轉場" },
];

function copyColors(colors: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const key of THEME_COLOR_KEYS) {
    next[key] = colors[key] ?? "";
  }
  return next;
}

/** 各身分的功能首頁（返回功能頁按鈕用） */
function roleHome(role: string | undefined): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "staff":
      return "/staff";
    case "parent":
      return "/parent";
    case "student":
      return "/student";
    default:
      return "/";
  }
}

export default function ThemeEditorPage() {
  const router = useRouter();
  const { setTheme, refreshAvailableThemes, availableThemes, currentTheme } = useTheme();
  const [session, setSession] = useState<UserSession | null>(null);
  const [ready, setReady] = useState(false);

  const [name, setName] = useState("我的主題");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [colors, setColors] = useState<Record<string, string>>(() =>
    copyColors(builtinThemes[0]!.colors as unknown as Record<string, string>)
  );
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);

  const customThemes = useMemo(
    () => listInstalledThemes().filter((record) => record.id.startsWith("custom:")),
    // installedTick 讓安裝清單變動時重新計算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableThemes, currentId]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchSession(true).then((current) => {
      if (cancelled) return;
      if (!current) {
        window.location.href = "/";
        return;
      }
      setSession(current);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function applyColor(key: string, value: string) {
    setColors((prev) => ({ ...prev, [key]: value }));
  }

  function loadBase(themeId: string) {
    const base = builtinThemes.find((theme) => theme.id === themeId);
    if (!base) return;
    setName(base.name);
    setColors(copyColors(base.colors as unknown as Record<string, string>));
    setCurrentId(null);
    setToast(null);
    setShowSubmit(false);
  }

  function loadCustom(themeId: string) {
    const theme = readStoredTheme(themeId);
    if (!theme) return;
    setName(theme.name);
    setColors(copyColors(theme.colors as unknown as Record<string, string>));
    setCurrentId(themeId);
    setToast(null);
    setShowSubmit(false);
  }

  function handleSave(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setToast(null);
    try {
      const id = currentId ?? `custom:${crypto.randomUUID()}`;
      saveInstalledTheme(
        {
          id,
          name: name.trim() || "我的主題",
          version: "1.0.0",
          source: "custom",
          installedAt: new Date().toISOString(),
        },
        { colors: colors as unknown as ThemeColors, preview: colors["--bg"] || "#ffffff" }
      );
      setCurrentId(id);
      // 方案 C：僅在「儲存」這個明確動作時，把該主題色彩備援寫入帳號（跨裝置還原用）
      void syncInstalledThemesToAccount({ includeColorsFor: id });
      setTheme(id);
      refreshAvailableThemes();
      setToast({ kind: "success", text: `已儲存並套用「${name.trim() || "我的主題"}」（僅顯示在您的帳號）` });
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : "儲存失敗" });
    } finally {
      setBusy(false);
    }
  }

  function handleDelete(themeId: string) {
    const label = readStoredTheme(themeId)?.name ?? themeId;
    if (!window.confirm(`確定刪除自訂主題「${label}」？刪除後無法復原。`)) return;
    removeInstalledTheme(themeId);
    void syncInstalledThemesToAccount();
    if (currentTheme.id === themeId) {
      setTheme(builtinThemes[0]!.id);
    }
    if (currentId === themeId) {
      setCurrentId(null);
    }
    refreshAvailableThemes();
    setToast({ kind: "success", text: `已刪除自訂主題「${label}」` });
    setShowSubmit(false);
  }

  if (!ready || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-t3">
        檢查登入狀態中...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-t1">CSS 主題編輯器</h1>
          <p className="mt-1 text-sm text-t3">
            選一個基底開始調色，上方即時預覽；按「儲存並套用」只會保存在您的帳號（別人看不到）。
            滿意的話再按「投稿上架」，經管理員審核後全校都能安裝。
          </p>
        </div>

        <div className="space-y-6">
          {/* 我的自訂主題（管理清單，獨立於編輯表單之外） */}
          {customThemes.length > 0 && (
            <div className="border border-themed rounded-lg bg-card p-4 space-y-2">
              <div className="text-sm font-semibold text-t1">
                我的自訂主題（{customThemes.length}）
              </div>
              <div className="space-y-1">
                {customThemes.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between gap-2 border border-themed rounded px-3 py-2 text-sm"
                  >
                    <span className="text-t1 truncate">
                      {record.name}
                      {currentId === record.id && (
                        <span className="ml-2 text-xs text-success">編輯中</span>
                      )}
                    </span>
                    <span className="flex gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => loadCustom(record.id)}
                        className="btn-theme rounded px-3 py-1 text-xs cursor-pointer"
                      >
                        載入編輯
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(record.id)}
                        className="rounded px-3 py-1 text-xs border border-danger/60 text-danger cursor-pointer"
                      >
                        刪除
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 上方：即時預覽（桌面版黏在視野頂端，調色不離預覽） */}
          <div className="space-y-2 lg:sticky lg:top-4 z-10">
            <div className="text-sm font-semibold text-t1">即時預覽</div>
            <div
              className="rounded-lg border border-themed p-4 space-y-3"
              style={{ background: colors["--bg"], color: colors["--t1"], borderColor: colors["--bd"] }}
            >
              <div className="text-xs" style={{ color: colors["--t3"] }}>
                頁面背景 --bg
              </div>
              <div
                className="rounded border p-3 space-y-2"
                style={{
                  background: colors["--card"],
                  borderColor: colors["--bd"],
                  borderRadius: colors["--radius"],
                  boxShadow: colors["--sh"],
                }}
              >
                <div className="font-bold">卡片標題（--t1）</div>
                <div className="text-sm" style={{ color: colors["--t2"] }}>
                  次要文字 --t2
                </div>
                <div className="text-xs" style={{ color: colors["--t3"] }}>
                  輔助文字 --t3
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <span
                    className="px-3 py-1.5 text-xs"
                    style={{
                      background: colors["--primary"],
                      color: colors["--primary-text"],
                      borderRadius: colors["--radius"],
                    }}
                  >
                    主要按鈕
                  </span>
                  <span
                    className="px-3 py-1.5 text-xs"
                    style={{
                      background: colors["--btn-secondary"],
                      color: colors["--btn-secondary-text"],
                      borderRadius: colors["--radius"],
                    }}
                  >
                    次要按鈕
                  </span>
                  <span
                    className="px-3 py-1.5 text-xs"
                    style={{
                      background: colors["--btn-danger"],
                      color: colors["--btn-danger-text"],
                      borderRadius: colors["--radius"],
                    }}
                  >
                    危險按鈕
                  </span>
                </div>
                <div className="text-xs pt-1">
                  <span style={{ color: colors["--link"] }}>連結文字</span>
                  <span className="mx-1">·</span>
                  <span style={{ color: colors["--success"] }}>成功</span>
                  <span className="mx-1">·</span>
                  <span style={{ color: colors["--warning"] }}>警告</span>
                  <span className="mx-1">·</span>
                  <span style={{ color: colors["--danger"] }}>危險</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-t3">
              自訂主題（custom:）只存在您的帳號與瀏覽器；市集主題（market:）才是全校可見。
            </p>
            <div className="flex justify-end gap-2 flex-wrap pt-1">
              <button
                type="submit"
                form="theme-editor-form"
                disabled={busy}
                className={`rounded px-4 py-2 text-sm ${busy ? "border border-themed bg-muted text-t3 cursor-wait" : "btn-theme cursor-pointer"}`}
              >
                {busy ? "處理中..." : currentId ? "儲存並套用" : "儲存並套用（建立新主題）"}
              </button>
              <button
                type="button"
                onClick={() => router.push(roleHome(session?.role))}
                className="rounded px-4 py-2 text-sm border border-themed bg-card text-t2 cursor-pointer"
              >
                返回功能頁
              </button>
            </div>
          </div>

          {/* 下：控制項 */}
          <form id="theme-editor-form" onSubmit={handleSave} className="space-y-5 border border-themed rounded-lg bg-card p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-1 text-sm">
                  <span className="text-t2">主題名稱</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={40}
                    className="w-full rounded border border-themed bg-card px-3 py-2 text-t1"
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="text-t2">從內建主題複製開始</span>
                  <select
                    value=""
                    onChange={(event) => loadBase(event.target.value)}
                    className="w-full rounded border border-themed bg-card px-3 py-2 text-t1 cursor-pointer"
                  >
                    <option value="">選擇基底...</option>
                    {builtinThemes.map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {COLOR_GROUPS.map((group) => (
                <div key={group.title} className="space-y-2">
                  <div className="text-sm font-semibold text-t1">{group.title}</div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                    {group.keys.map((key) => {
                      const value = colors[key] ?? "";
                      return (
                        <label key={key} className="flex items-center gap-2 text-xs">
                          <input
                            type="color"
                            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#888888"}
                            onChange={(event) => applyColor(key, event.target.value)}
                            className="h-7 w-9 cursor-pointer rounded border border-themed bg-card p-0 flex-shrink-0"
                          />
                          <span className="min-w-0">
                            <span className="block text-t2 truncate">{key.replace("--", "")}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="space-y-2">
                <div className="text-sm font-semibold text-t1">其他</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {STYLE_FIELDS.map((field) => (
                    <label key={field.key} className="block space-y-1 text-xs">
                      <span className="text-t2">{field.label}</span>
                      <input
                        value={colors[field.key] ?? ""}
                        onChange={(event) => applyColor(field.key, event.target.value)}
                        className="w-full rounded border border-themed bg-card px-3 py-2 text-t1"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <Toast message={toast} onClose={() => setToast(null)} />

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-themed">
                <button
                  type="submit"
                  disabled={busy}
                  className={`rounded px-4 py-2 text-sm ${busy ? "border border-themed bg-muted text-t3 cursor-wait" : "btn-theme cursor-pointer"}`}
                >
                  {busy ? "處理中..." : currentId ? "儲存並套用" : "儲存並套用（建立新主題）"}
                </button>
                {currentId && (
                  <button
                    type="button"
                    onClick={() => currentId && handleDelete(currentId)}
                    className="rounded px-3 py-2 text-sm border border-danger/60 text-danger cursor-pointer"
                  >
                    刪除
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => router.push(roleHome(session?.role))}
                  className="rounded px-4 py-2 text-sm border border-themed bg-card text-t2 cursor-pointer"
                >
                  返回功能頁
                </button>
              </div>
            </form>

          <details
            open={showSubmit}
            onToggle={(event) => setShowSubmit(event.currentTarget.open)}
            className="border border-themed rounded-lg bg-card"
          >
            <summary className="flex list-none cursor-pointer items-center justify-between gap-3 p-5">
              <span className="font-bold text-t1">投稿上架到市集</span>
              <DisclosureArrow />
            </summary>
            {showSubmit && (
              <div className="px-5 pb-5 space-y-3">
                <div>
                  <h2 className="font-bold text-t1">投稿上架（經管理員審核後全校可安裝）</h2>
                  <p className="text-xs text-t3 mt-1">
                    會帶入目前編輯的色彩；送出後建立草稿 PR，管理員在市集倉庫審核 merge 後即上架。
                  </p>
                </div>
                <ThemeSubmissionForm
                  endpoint="/api/market/submit"
                  submitLabel="送出投稿"
                  initialValues={{
                    name: name.trim() === "我的主題" ? "" : name.trim(),
                    colors,
                  }}
                />
              </div>
            )}
          </details>
        </div>
      </div>
    </div>
  );
}
