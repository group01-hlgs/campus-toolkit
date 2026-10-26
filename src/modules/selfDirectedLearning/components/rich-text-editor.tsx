"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import { sanitizeRichHtml, stripHtmlToText } from "../types/self-directed-learning";

/** 富文本區塊的共用顯示樣式（清單符號會被 Tailwind reset 清掉，改用行內樣式補回） */
const DISPLAY_STYLES: Record<string, string> = {
  ul: "list-style-type:disc;padding-left:1.5rem;margin:0.25rem 0",
  ol: "list-style-type:decimal;padding-left:1.5rem;margin:0.25rem 0",
  li: "margin:0.125rem 0",
  blockquote: "border-left:3px solid var(--bd2);padding-left:0.75rem;margin:0.25rem 0;color:var(--t2)",
  p: "margin:0.25rem 0",
};

const RICH_TAG_TEST =
  /<\/?(?:b|strong|i|em|u|s|strike|del|span|font|p|div|br|ul|ol|li|blockquote)(?:\s|\/?>)/i;

const FONT_FAMILIES = [
  { value: "sans-serif", label: "Sans Serif" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Monospace" },
  { value: '"Microsoft JhengHei", "微軟正黑體", sans-serif', label: "微軟正黑體" },
  { value: '"PMingLiU", "新細明體", serif', label: "新細明體" },
  { value: '"DFKai-SB", "標楷體", serif', label: "標楷體" },
  { value: '"Noto Sans TC", "思源黑體", sans-serif', label: "思源黑體" },
  { value: '"PingFang TC", "蘋方-繁", sans-serif', label: "蘋方-繁" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: '"Times New Roman", Times, serif', label: "Times New Roman" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: '"Courier New", monospace', label: "Courier New" },
] as const;

const FONT_SIZES = [
  { value: "2", label: "小" },
  { value: "3", label: "標準" },
  { value: "5", label: "大" },
  { value: "7", label: "特大" },
] as const;

const ALIGNMENTS = [
  { value: "left", label: "靠左對齊", command: "justifyLeft" },
  { value: "center", label: "置中對齊", command: "justifyCenter" },
  { value: "right", label: "靠右對齊", command: "justifyRight" },
] as const;

/** 文字顏色選色盤（內容色，非主題色） */
const TEXT_COLORS = [
  { value: "#111827", label: "黑色" },
  { value: "#dc2626", label: "紅色" },
  { value: "#ea580c", label: "橘色" },
  { value: "#ca8a04", label: "黃色" },
  { value: "#16a34a", label: "綠色" },
  { value: "#2563eb", label: "藍色" },
  { value: "#7c3aed", label: "紫色" },
  { value: "#6b7280", label: "灰色" },
] as const;

function hasRichHtmlTag(value: string): boolean {
  return RICH_TAG_TEST.test(value);
}

/** 純文字內容（舊資料）載入編輯器時，把換行轉成 <br>，避免內容擠成一行 */
function editorHtmlOf(value: string): string {
  const safe = sanitizeRichHtml(value);
  return hasRichHtmlTag(safe) ? safe : safe.replace(/\r?\n/g, "<br>");
}

/** 在既有 style 屬性後追加顯示樣式（僅供檢視與編輯畫面，不會寫回儲存內容） */
function mergeDisplayStyle(style: string | null, extra: string): string {
  return style ? `${style};${extra}` : extra;
}

/** 把清單、引用等結構補上顯示樣式，確保 Tailwind reset 下仍看得到符號／縮排 */
function decorateRichHtml(html: string): string {
  return html.replace(/<(ul|ol|li|blockquote|p)((?:\s[^>]*)?)>/gi, (match, tag: string, attrs: string) => {
    const extra = DISPLAY_STYLES[tag.toLowerCase()];
    if (!extra) return match;
    const styleMatch = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i);
    if (styleMatch) {
      const merged = mergeDisplayStyle(styleMatch[1], extra);
      return `<${tag}${attrs.replace(styleMatch[0], ` style="${merged}"`)}>`;
    }
    return `<${tag}${attrs} style="${extra}">`;
  });
}

/** 編輯區 DOM 的顯示樣式：直接改 inline style，不動內容與游標位置 */
function applyEditorDisplayStyles(root: HTMLElement) {
  for (const tag of ["ul", "ol", "li", "blockquote", "p"] as const) {
    for (const element of Array.from(root.querySelectorAll(tag))) {
      const node = element as HTMLElement;
      if (tag === "ul" || tag === "ol") {
        node.style.listStyleType = tag === "ul" ? "disc" : "decimal";
        node.style.paddingLeft = "1.5rem";
        node.style.margin = "0.25rem 0";
      } else if (tag === "li") {
        node.style.margin = "0.125rem 0";
      } else if (tag === "blockquote") {
        node.style.borderLeft = "3px solid var(--bd2)";
        node.style.paddingLeft = "0.75rem";
        node.style.margin = "0.25rem 0";
        node.style.color = "var(--t2)";
      } else {
        node.style.margin = "0.25rem 0";
      }
    }
  }
}

function ToolButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      className="text-t1 hover:bg-card px-2 py-1 text-xs leading-none disabled:cursor-not-allowed disabled:opacity-50"
      style={{ borderRadius: 0 }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="border-themed mx-1 h-4 border-r" />;
}

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  ariaLabel?: string;
}

/**
 * 零依賴所見即所得編輯器：以 contentEditable＋document.execCommand 實作，
 * 變更一律先經 `sanitizeRichHtml` 白名單淨化再回傳。
 */
export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  placeholder = "本週預計學習的內容、進度與方式",
  maxLength = 600,
  ariaLabel,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [fontFamily, setFontFamily] = useState("sans-serif");
  const [fontSize, setFontSize] = useState("3");
  const [alignment, setAlignment] = useState("left");

  const plainText = useMemo(() => stripHtmlToText(value).trim(), [value]);
  const empty = plainText.length === 0;
  const count = plainText.length;

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (typeof document !== "undefined" && document.activeElement === editor) return;
    const next = editorHtmlOf(value);
    if (editor.innerHTML !== next) {
      editor.innerHTML = next;
      applyEditorDisplayStyles(editor);
    }
  }, [value]);

  useEffect(() => {
    // 讓 execCommand 以標籤（b／font…）輸出，避免產生白名單外的 style
    try {
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      // 舊瀏覽器不支援時忽略
    }
  }, []);

  const saveSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const anchor = selection.anchorNode;
    if (anchor && editor.contains(anchor)) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const range = savedRangeRef.current;
    if (!range) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const sync = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(sanitizeRichHtml(editor.innerHTML));
  }, [onChange]);

  const exec = useCallback(
    (command: string, commandValue?: string) => {
      if (disabled) return;
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      restoreSelection();
      try {
        document.execCommand("styleWithCSS", false, "false");
        document.execCommand(command, false, commandValue);
      } catch {
        // 瀏覽器不支援時忽略，避免中斷輸入
      }
      applyEditorDisplayStyles(editor);
      sync();
    },
    [disabled, restoreSelection, sync]
  );

  const handleInput = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    applyEditorDisplayStyles(editor);
    sync();
    saveSelection();
  }, [saveSelection, sync]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      event.preventDefault();
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");
      let insert = "";
      if (html) {
        insert = sanitizeRichHtml(html);
      } else if (text) {
        insert = sanitizeRichHtml(text).replace(/\r?\n/g, "<br>");
      }
      if (!insert) return;
      const editor = editorRef.current;
      editor?.focus();
      restoreSelection();
      try {
        document.execCommand("insertHTML", false, insert);
      } catch {
        // 忽略不支援 insertHTML 的環境
      }
      if (editor) applyEditorDisplayStyles(editor);
      sync();
      saveSelection();
    },
    [disabled, restoreSelection, saveSelection, sync]
  );

  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <span className={`text-xs ${count > maxLength ? "text-danger" : "text-t3"}`}>
          {count} / {maxLength} 字
        </span>
      </div>

      <div style={{ position: "relative" }}>
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          contentEditable={!disabled}
          suppressContentEditableWarning
          className={`input-theme min-h-24 w-full px-3 py-2 text-sm ${disabled ? "opacity-60" : ""}`}
          style={{
            minHeight: "6rem",
            resize: disabled ? "none" : "both",
            overflow: "auto",
            borderRadius: 0,
          }}
          onInput={handleInput}
          onPaste={handlePaste}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onBlur={saveSelection}
        />
        {empty && (
          <span
            className="text-t3 pointer-events-none select-none text-sm"
            style={{ position: "absolute", top: "0.5rem", left: "0.75rem" }}
          >
            {placeholder}
          </span>
        )}
      </div>

      <div
        role="toolbar"
        aria-label="文字格式工具列"
        className="border border-themed bg-surface px-3 py-1 flex flex-wrap items-center gap-1"
        style={{ borderRadius: 0 }}
        onMouseDown={saveSelection}
      >
        <ToolButton title="復原" disabled={disabled} onClick={() => exec("undo")}>
          ↶
        </ToolButton>
        <ToolButton title="重做" disabled={disabled} onClick={() => exec("redo")}>
          ↷
        </ToolButton>

        <Divider />

        <select
          aria-label="字型"
          title="字型"
          className="text-t1 bg-transparent px-1 py-1 text-xs"
          style={{ borderRadius: 0 }}
          value={fontFamily}
          disabled={disabled}
          onChange={(event) => {
            setFontFamily(event.target.value);
            exec("fontName", event.target.value);
          }}
        >
          {FONT_FAMILIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <span className="text-t2 text-xs" aria-hidden="true">
          TT
        </span>
        <select
          aria-label="字級"
          title="字級"
          className="text-t1 bg-transparent px-1 py-1 text-xs"
          style={{ borderRadius: 0 }}
          value={fontSize}
          disabled={disabled}
          onChange={(event) => {
            setFontSize(event.target.value);
            exec("fontSize", event.target.value);
          }}
        >
          {FONT_SIZES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <Divider />

        <ToolButton title="粗體" disabled={disabled} onClick={() => exec("bold")}>
          <span style={{ fontWeight: 700 }}>B</span>
        </ToolButton>
        <ToolButton title="斜體" disabled={disabled} onClick={() => exec("italic")}>
          <span style={{ fontStyle: "italic" }}>I</span>
        </ToolButton>
        <ToolButton title="底線" disabled={disabled} onClick={() => exec("underline")}>
          <span style={{ textDecoration: "underline" }}>U</span>
        </ToolButton>

        <div className="relative">
          <button
            type="button"
            title="文字顏色"
            aria-label="文字顏色"
            aria-expanded={colorOpen}
            disabled={disabled}
            className="text-t1 hover:bg-card px-2 py-1 text-xs leading-none disabled:cursor-not-allowed disabled:opacity-50"
      style={{ borderRadius: 0 }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setColorOpen((open) => !open)}
          >
            <span style={{ textDecoration: "underline" }}>A</span> ▾
          </button>
          {colorOpen && !disabled && (
            <div
              className="border-themed bg-card absolute bottom-full right-0 z-20 mb-1 flex flex-wrap gap-1 border p-2 shadow-lg"
              style={{ width: "8.5rem", borderRadius: 0 }}
            >
              {TEXT_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  title={color.label}
                  aria-label={color.label}
                  className="border-themed h-5 w-5 border"
                  style={{ backgroundColor: color.value, borderRadius: 0 }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    exec("foreColor", color.value);
                    setColorOpen(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <Divider />

        <span className="text-t2 text-xs" aria-hidden="true">
          ≡
        </span>
        <select
          aria-label="對齊方式"
          title="對齊方式"
          className="text-t1 bg-transparent px-1 py-1 text-xs"
          style={{ borderRadius: 0 }}
          value={alignment}
          disabled={disabled}
          onChange={(event) => {
            const option = ALIGNMENTS.find((item) => item.value === event.target.value);
            setAlignment(event.target.value);
            if (option) exec(option.command);
          }}
        >
          {ALIGNMENTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <ToolButton title="編號清單" disabled={disabled} onClick={() => exec("insertOrderedList")}>
          1.
        </ToolButton>
        <ToolButton title="項目符號清單" disabled={disabled} onClick={() => exec("insertUnorderedList")}>
          •
        </ToolButton>
        <ToolButton title="減少縮排" disabled={disabled} onClick={() => exec("outdent")}>
          ⇤
        </ToolButton>
        <ToolButton title="增加縮排" disabled={disabled} onClick={() => exec("indent")}>
          ⇥
        </ToolButton>
        <ToolButton
          title="引用區塊"
          disabled={disabled}
          onClick={() => exec("formatBlock", "blockquote")}
        >
          ”
        </ToolButton>

        <Divider />

        <ToolButton title="刪除線" disabled={disabled} onClick={() => exec("strikeThrough")}>
          <span style={{ textDecoration: "line-through" }}>S</span>
        </ToolButton>

        <Divider />

        <ToolButton title="清除格式" disabled={disabled} onClick={() => exec("removeFormat")}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21" />
            <path d="M22 21H7" />
            <path d="m5 12 5.6 5.6" />
          </svg>
        </ToolButton>
      </div>
    </div>
  );
}

export interface RichTextContentProps {
  html: string;
  className?: string;
  emptyText?: string;
}

/**
 * 唯讀富文本：先淨化再渲染；舊版純文字若不含 HTML 標籤則保留換行顯示。
 * 清單／引用以行內樣式補回 Tailwind reset 清掉的符號、縮排與左邊框。
 */
export function RichTextContent({
  html,
  className = "text-t2 text-sm",
  emptyText = "—",
}: RichTextContentProps) {
  const safe = sanitizeRichHtml(html ?? "");
  const plain = stripHtmlToText(safe).trim();
  if (!plain) return <p className={className}>{emptyText}</p>;
  if (!hasRichHtmlTag(safe)) {
    return <p className={`${className} whitespace-pre-wrap`}>{plain}</p>;
  }
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: decorateRichHtml(safe) }}
    />
  );
}
