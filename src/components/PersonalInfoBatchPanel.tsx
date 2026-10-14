"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DisclosureArrow from "@/components/DisclosureArrow";
import type { SchoolPeriod } from "@/types/settings";

type BatchMode = "create" | "update" | "delete";
type BatchRowAction = BatchMode | "skip";

interface BatchRowSummary {
  row: number;
  action: BatchRowAction;
  reason?: string;
}

interface BatchSummary {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  total: number;
  rows: BatchRowSummary[];
}

interface BatchResponse {
  success?: boolean;
  message?: string;
  period?: SchoolPeriod;
  preview?: BatchSummary;
  result?: Omit<BatchSummary, "rows" | "total"> & { skippedRows: BatchRowSummary[] };
  progress?: { processed: number; total: number; done: boolean };
}

const MODE_OPTIONS: { value: BatchMode; label: string }[] = [
  { value: "create", label: "匯入（新增本期資料）" },
  { value: "update", label: "修改本期資料" },
  { value: "delete", label: "刪除本期資料" },
];

const MODE_ACTION_LABELS: Record<BatchRowAction, string> = {
  create: "新增",
  update: "修改",
  delete: "刪除",
  skip: "略過",
};

export default function PersonalInfoBatchPanel() {
  const [period, setPeriod] = useState<SchoolPeriod | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [mode, setMode] = useState<BatchMode>("create");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "execute" | "">("");
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [preview, setPreview] = useState<BatchSummary | null>(null);
  const [result, setResult] = useState<BatchResponse["result"] | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/personal-info/batch", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as BatchResponse | null;
        if (!response.ok || !data?.success || !data.period) {
          throw new Error(data?.message || "讀取目前學年度學期失敗");
        }
        if (active) setPeriod(data.period);
      })
      .catch((error) => {
        if (active) {
          setFeedback({
            kind: "error",
            message: error instanceof Error ? error.message : "讀取目前學年度學期失敗",
          });
        }
      })
      .finally(() => {
        if (active) setPeriodLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const academicYears = useMemo(() => {
    const latest = period?.academicYear ?? 1;
    return Array.from({ length: latest + 1 }, (_, index) => latest + 1 - index).filter((year) => year > 0);
  }, [period?.academicYear]);

  function clearBatchState() {
    setPreview(null);
    setResult(null);
    setFeedback(null);
  }

  function changeMode(value: BatchMode) {
    setMode(value);
    clearBatchState();
  }

  function changePeriod(key: "academicYear" | "semester", value: number) {
    setPeriod((current) => (current ? { ...current, [key]: value } : current));
    clearBatchState();
  }

  function selectFile(selected: File | null) {
    setFile(selected);
    clearBatchState();
  }

  async function sendBatch(dryRun: boolean, offset = 0): Promise<BatchResponse> {
    if (!period || !file) throw new Error("請先選擇學年度學期與試算表檔案");
    const body = new FormData();
    body.append("mode", mode);
    body.append("academicYear", String(period.academicYear));
    body.append("semester", String(period.semester));
    body.append("dryRun", dryRun ? "true" : "false");
    body.append("offset", String(offset));
    body.append("file", file);
    const response = await fetch("/api/admin/personal-info/batch", { method: "POST", body });
    const data = (await response.json().catch(() => null)) as BatchResponse | null;
    if (!response.ok || !data?.success) throw new Error(data?.message || "批次資料管理失敗");
    return data;
  }

  async function makePreview() {
    if (!file || busy) return;
    setBusy("preview");
    setFeedback(null);
    setResult(null);
    setPreview(null);
    try {
      const data = await sendBatch(true);
      setPreview(data.preview ?? null);
      if (!data.preview) throw new Error("伺服器未回傳預覽結果");
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "批次資料預覽失敗" });
    } finally {
      setBusy("");
    }
  }

  async function executeBatch() {
    if (!file || !preview || busy) return;
    setConfirmOpen(false);
    setBusy("execute");
    setFeedback(null);
    setProgress({ processed: 0, total: preview.total });
    const aggregate: NonNullable<BatchResponse["result"]> = {
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      skippedRows: [],
    };
    try {
      let offset = 0;
      for (;;) {
        const data = await sendBatch(false, offset);
        if (!data.result || !data.progress) throw new Error(data.message || "批次執行未回傳結果");
        aggregate.created += data.result.created;
        aggregate.updated += data.result.updated;
        aggregate.deleted += data.result.deleted;
        aggregate.skipped += data.result.skipped;
        aggregate.skippedRows.push(...data.result.skippedRows);
        offset = data.progress.processed;
        setProgress({ processed: offset, total: data.progress.total });
        if (data.progress.done) break;
      }
      setPreview(null);
      setResult(aggregate);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setFeedback({
        kind: "success",
        message: `批次作業完成：新增 ${aggregate.created} 筆、修改 ${aggregate.updated} 筆、刪除 ${aggregate.deleted} 筆、略過 ${aggregate.skipped} 筆。`,
      });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "批次資料管理失敗" });
    } finally {
      setBusy("");
      setProgress(null);
    }
  }

  const actionCount = preview
    ? preview.created + preview.updated + preview.deleted
    : 0;

  return (
    <>
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        className="border border-themed rounded-lg bg-card p-5 sm:p-6"
      >
        <summary
          aria-controls="personal-info-batch-content"
          className="flex list-none cursor-pointer flex-wrap items-center justify-between gap-2"
        >
          <div>
            <h3 className="text-lg font-bold text-t1">資料管理</h3>
            <p className="text-xs text-t3 mt-1">
              依 Excel 標題中的學號或證件號碼自動辨識學生，對指定學年度學期批次匯入、修改或刪除個人資料。
            </p>
          </div>
          <DisclosureArrow />
        </summary>

        <div id="personal-info-batch-content" className="mt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm text-t2">
            <span className="block">學年度</span>
            <select
              value={period?.academicYear ?? ""}
              onChange={(event) => changePeriod("academicYear", Number(event.target.value))}
              disabled={!period || periodLoading || busy !== ""}
              className="w-full input-theme rounded px-3 py-2"
            >
              {academicYears.map((year) => (
                <option key={year} value={year}>{year} 學年度</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-t2">
            <span className="block">學期</span>
            <select
              value={period?.semester ?? ""}
              onChange={(event) => changePeriod("semester", Number(event.target.value))}
              disabled={!period || periodLoading || busy !== ""}
              className="w-full input-theme rounded px-3 py-2"
            >
              <option value={1}>第 1 學期</option>
              <option value={2}>第 2 學期</option>
            </select>
          </label>
          <label className="space-y-1 text-sm text-t2">
            <span className="block">批次作業</span>
            <select
              value={mode}
              onChange={(event) => changeMode(event.target.value as BatchMode)}
              disabled={busy !== ""}
              className="w-full input-theme rounded px-3 py-2"
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
            disabled={busy !== ""}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== ""}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
          >
            選擇檔案
          </button>
          <span className="text-sm text-t2">{file?.name ?? "尚未選擇檔案"}</span>
          <button
            type="button"
            onClick={() => void makePreview()}
            disabled={!file || !period || busy !== ""}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
          >
            {busy === "preview" ? "預覽中…" : "上傳預覽"}
          </button>
          {preview && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={actionCount === 0 || busy !== ""}
              className={`${mode === "delete" ? "btn-danger" : "btn-theme"} rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50`}
            >
              確認執行
            </button>
          )}
          <a
            href="/api/admin/personal-info/batch?template=1"
            className="text-sm text-t1 underline underline-offset-2"
            download
          >
            下載 Excel 範本
          </a>
        </div>

        {periodLoading && <p className="mt-2 text-xs text-t3" role="status">讀取目前學年度學期中…</p>}

        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-t3">
          <li>支援 Excel（.xlsx、.xls）與 CSV，單檔上限 5 MB、最多 900 列；執行前會先列出預覽。</li>
          <li>每列優先使用「學號」辨識；學號空白時改用「證件號碼」。姓名僅供核對，不會修改帳號姓名。</li>
          <li>Excel 範本含「匯入資料」與「範例資料」工作表；請把實際資料放在「匯入資料」，保留標題列與欄位名稱。</li>
          <li>「範例資料」僅供格式參考，請以真實學生資料取代；證件號碼會依證件類型驗證格式與檢查碼。</li>
          <li>修改時空白欄位保留原值；輸入「[清空]」可清除該欄。生日接受民國年月日（例：0990101）。</li>
          <li>刪除只移除所選學年度學期的個人資料與該期證件照；性別、生日、證件資訊等跨學期身分資料會保留。</li>
        </ul>

        {preview && (
          <div className="mt-4 rounded-lg border border-themed p-3 text-sm">
            <p className="font-bold text-t1">
              預覽：新增 {preview.created} 筆、修改 {preview.updated} 筆、刪除 {preview.deleted} 筆、略過 {preview.skipped} 筆（共 {preview.total} 列）
            </p>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-t2">
              {preview.rows.map((row) => (
                <li key={row.row}>
                  第 {row.row} 列：{MODE_ACTION_LABELS[row.action]}{row.reason ? ` — ${row.reason}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result && (
          <div className="mt-4 rounded-lg border border-themed p-3 text-sm">
            <p className="font-bold text-t1">
              執行結果：新增 {result.created} 筆、修改 {result.updated} 筆、刪除 {result.deleted} 筆、略過 {result.skipped} 筆。
            </p>
            {result.skippedRows.length > 0 && (
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-t2">
                {result.skippedRows.map((row) => (
                  <li key={row.row}>第 {row.row} 列：{row.reason || "略過"}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {progress && (
          <p className="mt-3 text-sm text-t2" role="status">
            批次執行中：{progress.processed}/{progress.total} 列
          </p>
        )}
        </div>
      </details>

      {confirmOpen && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role={mode === "delete" ? "alertdialog" : "dialog"}
            aria-modal="true"
            aria-labelledby="personal-info-batch-confirm-title"
            aria-describedby="personal-info-batch-confirm-description"
            className="w-full max-w-lg rounded-xl border border-themed bg-card p-6 shadow-xl"
          >
            <h3 id="personal-info-batch-confirm-title" className="text-lg font-bold text-t1">
              {mode === "delete" ? "確認刪除學生個人資料" : "確認執行批次資料管理"}
            </h3>
            <p id="personal-info-batch-confirm-description" className="mt-3 whitespace-pre-wrap text-sm text-t2">
              {mode === "delete"
                ? `將刪除 ${preview.deleted} 筆 ${period?.academicYear} 學年度第 ${period?.semester} 學期個人資料及其證件照；跨學期身分資料保留。此操作無法復原。`
                : `將對 ${preview.created + preview.updated} 筆 ${period?.academicYear} 學年度第 ${period?.semester} 學期資料執行${mode === "create" ? "新增" : "修改"}，另略過 ${preview.skipped} 列。`}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="border border-themed rounded-lg px-4 py-2 text-sm text-t2 hover:text-t1"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void executeBatch()}
                className={`${mode === "delete" ? "btn-danger" : "btn-theme"} rounded-lg px-4 py-2 text-sm`}
                autoFocus
              >
                確認執行
              </button>
            </div>
          </div>
        </div>
      )}

      {feedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="personal-info-batch-feedback-title"
            className="w-full max-w-lg rounded-xl border border-themed bg-card p-6 shadow-xl"
          >
            <h3
              id="personal-info-batch-feedback-title"
              className={`text-lg font-bold ${feedback.kind === "error" ? "text-danger" : "text-t1"}`}
            >
              {feedback.kind === "error" ? "批次作業失敗" : "批次作業完成"}
            </h3>
            <p className="mt-3 whitespace-pre-wrap text-sm text-t2">{feedback.message}</p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="btn-theme rounded-lg px-4 py-2 text-sm"
                autoFocus
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
