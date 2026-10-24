"use client";

import { useState, FormEvent } from "react";

/**
 * 主題投稿／發佈共用表單（M2.5 管理員發佈、§21 使用者投稿）。
 * 只收 token JSON（契約 §11.1）——colors 由色票產生，不開放自由 CSS。
 */

const COLOR_FIELDS: Array<{ key: string; label: string }> = [
  { key: "--bg", label: "頁面背景" },
  { key: "--bg2", label: "次層背景" },
  { key: "--card", label: "卡片背景" },
  { key: "--t1", label: "主要文字" },
  { key: "--t2", label: "次要文字" },
  { key: "--t3", label: "輔助文字" },
  { key: "--bd", label: "邊框" },
  { key: "--primary", label: "主要色" },
  { key: "--primary-hover", label: "主要色（hover）" },
  { key: "--link", label: "連結" },
  { key: "--success", label: "成功" },
  { key: "--warning", label: "警告" },
  { key: "--danger", label: "危險" },
];

const DEFAULT_COLORS: Record<string, string> = {
  "--bg": "#ffffff",
  "--bg2": "#f5f5f5",
  "--card": "#ffffff",
  "--t1": "#000000",
  "--t2": "#262626",
  "--t3": "#666666",
  "--bd": "#e0e0e0",
  "--primary": "#333333",
  "--primary-hover": "#111111",
  "--link": "#333333",
  "--success": "#28a745",
  "--warning": "#e67e22",
  "--danger": "#dc3545",
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

interface SubmitResponse {
  success: boolean;
  message?: string;
  prUrl?: string;
  branch?: string;
}

export interface ThemeSubmissionInitialValues {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  colors?: Record<string, string>;
}

export default function ThemeSubmissionForm({
  endpoint,
  submitLabel,
  initialValues,
}: {
  endpoint: string;
  submitLabel: string;
  initialValues?: ThemeSubmissionInitialValues;
}) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [id, setId] = useState(initialValues?.id ?? "");
  const [idTouched, setIdTouched] = useState(!!initialValues?.id);
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [author, setAuthor] = useState("");
  const [tagsText, setTagsText] = useState((initialValues?.tags ?? []).join(", "));
  const [colors, setColors] = useState<Record<string, string>>({
    ...DEFAULT_COLORS,
    ...(initialValues?.colors ?? {}),
  });
  const [radius, setRadius] = useState(initialValues?.colors?.["--radius"] ?? "8px");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string; prUrl?: string } | null>(null);

  function handleName(value: string) {
    setName(value);
    if (!idTouched) setId(slugify(value));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const payload = {
        id: (id || slugify(name)).trim(),
        name: name.trim(),
        description: description.trim(),
        author: author.trim() || undefined,
        tags: tagsText
          .split(/[,，\s]+/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        colors: { ...colors, "--radius": radius.trim() || "8px" },
      };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as SubmitResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.message || "送出失敗");
      }
      setResult({ kind: "success", message: data.message || "已送出", prUrl: data.prUrl });
    } catch (error) {
      setResult({
        kind: "error",
        message: error instanceof Error ? error.message : "送出失敗",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="text-t2">主題名稱 *</span>
          <input
            value={name}
            onChange={(event) => handleName(event.target.value)}
            required
            maxLength={60}
            className="w-full rounded border border-themed bg-card px-3 py-2 text-t1"
            placeholder="例如：Ocean Breeze"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-t2">主題 id（kebab-case，將成為 market:{id || "…"}）*</span>
          <input
            value={id}
            onChange={(event) => {
              setIdTouched(true);
              setId(event.target.value.toLowerCase());
            }}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            className="w-full rounded border border-themed bg-card px-3 py-2 text-t1"
            placeholder="ocean-breeze"
          />
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-t2">說明</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={300}
          rows={2}
          className="w-full rounded border border-themed bg-card px-3 py-2 text-t1"
          placeholder="這個主題適合什麼情境？"
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="text-t2">作者（留空則使用您的顯示名稱）</span>
          <input
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            maxLength={80}
            className="w-full rounded border border-themed bg-card px-3 py-2 text-t1"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-t2">標籤（逗號或空白分隔）</span>
          <input
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            className="w-full rounded border border-themed bg-card px-3 py-2 text-t1"
            placeholder="blue, fresh"
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-t2">色彩（token 白名單，其餘沿用系統預設）</span>
          <button
            type="button"
            onClick={() => setColors({ ...DEFAULT_COLORS })}
            className="text-xs text-t3 underline cursor-pointer"
          >
            還原預設色
          </button>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
          {COLOR_FIELDS.map((field) => (
            <label key={field.key} className="flex items-center gap-2 text-sm">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(colors[field.key] ?? "") ? colors[field.key] : "#888888"}
                onChange={(event) =>
                  setColors((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
                className="h-8 w-10 cursor-pointer rounded border border-themed bg-card p-0"
              />
              <span className="flex-1">
                <span className="block text-t2">{field.label}</span>
                <span className="block text-xs text-t3">{field.key}</span>
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              value={radius}
              onChange={(event) => setRadius(event.target.value)}
              maxLength={20}
              className="w-20 rounded border border-themed bg-card px-2 py-1 text-t1"
            />
            <span className="flex-1">
              <span className="block text-t2">圓角</span>
              <span className="block text-xs text-t3">--radius</span>
            </span>
          </label>
        </div>
      </div>

      <div
        className="rounded-lg border border-themed p-4 text-sm"
        style={{ background: colors["--bg"], color: colors["--t1"] }}
      >
        <div className="mb-2 text-xs" style={{ color: colors["--t3"] }}>
          即時預覽
        </div>
        <div
          className="rounded border p-3"
          style={{ background: colors["--card"], borderColor: colors["--bd"] }}
        >
          <div className="font-bold">卡片標題</div>
          <div className="mt-1 text-xs" style={{ color: colors["--t2"] }}>
            次要文字範例
          </div>
          <button
            type="button"
            className="mt-3 rounded px-3 py-1.5 text-xs"
            style={{ background: colors["--primary"], color: "#ffffff" }}
          >
            主要按鈕
          </button>
        </div>
      </div>

      {result && (
        <div
          className={`border rounded-lg p-3 text-sm ${
            result.kind === "success"
              ? "border-success/60 bg-success/10 text-success"
              : "border-danger/60 bg-danger/10 text-danger"
          }`}
        >
          <p>{result.message}</p>
          {result.prUrl && (
            <a href={result.prUrl} target="_blank" rel="noreferrer" className="underline">
              開啟 PR 頁面
            </a>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className={`rounded px-4 py-2 text-sm ${busy ? "border border-themed bg-muted text-t3 cursor-wait" : "btn-theme cursor-pointer"}`}
      >
        {busy ? "送出中..." : submitLabel}
      </button>
    </form>
  );
}
