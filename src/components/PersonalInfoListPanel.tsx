"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DisclosureArrow from "@/components/DisclosureArrow";
import RevealListCard from "@/components/RevealListCard";
import { useDataSaver } from "@/lib/data-saver";
import type { SchoolPeriod } from "@/types/settings";

interface ClassOption {
  code: string;
  name: string;
  gradeName: string;
}

interface ListRow {
  uid: string;
  studentId: string;
  name: string;
  classCode: string;
  status: "none" | "incomplete" | "complete";
  updatedAt: number | null;
}

interface ListResponse {
  success?: boolean;
  message?: string;
  period?: SchoolPeriod;
  classes?: ClassOption[];
  classCode?: string;
  rows?: ListRow[];
}

interface CountResponse {
  success?: boolean;
  message?: string;
  count?: number;
  period?: SchoolPeriod;
}

const STATUS_LABELS: Record<ListRow["status"], { label: string; className: string }> = {
  none: { label: "未填寫", className: "text-t3" },
  incomplete: { label: "未完成", className: "text-danger" },
  complete: { label: "已完成", className: "text-success" },
};

function formatUpdatedAt(value: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-TW");
}

export default function PersonalInfoListPanel() {
  const { ready: saverReady, saverOn } = useDataSaver();
  const [count, setCount] = useState<number | null>(null);
  const [period, setPeriod] = useState<SchoolPeriod | null>(null);
  const [countError, setCountError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classCode, setClassCode] = useState("");
  const [rows, setRows] = useState<ListRow[]>([]);
  const loadedRef = useRef(false);
  /** 省流關著＝不設閘門；省流開著＝直到使用者按下顯示列表才載入 */
  const gating = saverReady && saverOn && !revealed;

  // 統計總數：無論是否省流都先取（count 聚合僅 1 次讀取，供按鈕旁與卡片標題顯示）
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/personal-info/count", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as CountResponse | null;
        if (!response.ok || !data?.success || typeof data.count !== "number") {
          throw new Error(data?.message || "讀取個人資料總數失敗");
        }
        if (!cancelled) {
          setCount(data.count);
          setPeriod(data.period ?? null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCountError(error instanceof Error ? error.message : "讀取個人資料總數失敗");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 載入某班列表（預設第一個班級）；只在展開後呼叫，省流模式下須先解除閘門
  const loadClass = useCallback(async (code?: string) => {
    setLoading(true);
    setLoadError("");
    try {
      const query = code ? `?classCode=${encodeURIComponent(code)}` : "";
      const response = await fetch(`/api/admin/personal-info/list${query}`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as ListResponse | null;
      if (!response.ok || !data?.success || !data.period || !Array.isArray(data.classes)) {
        throw new Error(data?.message || "讀取個人資料列表失敗");
      }
      setClasses(data.classes);
      setClassCode(data.classCode ?? "");
      setRows(data.rows ?? []);
      setPeriod(data.period);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "讀取個人資料列表失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  // 展開時才載入（省流模式下須先解除閘門；非省流模式直接讀第一個班級）
  function handleToggle(next: boolean) {
    setExpanded(next);
    if (!next || loadedRef.current) return;
    loadedRef.current = true;
    if (!saverOn) void loadClass();
  }

  function handleReveal() {
    setRevealed(true);
    void loadClass();
  }

  function changeClass(code: string) {
    setClassCode(code);
    void loadClass(code);
  }

  const summaryText =
    count !== null
      ? `本期已填寫 ${count} 筆個人資料`
      : countError
        ? countError
        : "統計載入中…";

  return (
    <details
      open={expanded}
      onToggle={(event) => handleToggle(event.currentTarget.open)}
      className="border border-themed rounded-lg bg-card p-5 sm:p-6"
    >
      <summary
        aria-controls="personal-info-list-content"
        className="flex list-none cursor-pointer flex-wrap items-center justify-between gap-2"
      >
        <div>
          <h3 className="text-lg font-bold text-t1">學生個人基本資料列表</h3>
          <p className="text-xs text-t3 mt-1">{summaryText}</p>
        </div>
        <DisclosureArrow />
      </summary>

      {expanded && (
        <div id="personal-info-list-content" className="mt-4">
          {gating ? (
            <RevealListCard label="學生個人資料" onReveal={handleReveal} summary={summaryText} />
          ) : loading ? (
            <p className="text-sm text-t3" role="status">載入個人資料列表中…</p>
          ) : loadError ? (
            <div className="space-y-3">
              <p className="text-sm text-danger" role="alert">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadClass(classCode || undefined)}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                重新載入
              </button>
            </div>
          ) : (
            <>
              {classes.length > 1 && (
                <label className="mb-3 flex items-center gap-2 text-sm text-t2">
                  <span>班級</span>
                  <select
                    value={classCode}
                    onChange={(event) => changeClass(event.target.value)}
                    className="input-theme rounded px-3 py-2"
                  >
                    {classes.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.gradeName}・{option.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {rows.length === 0 ? (
                <p className="text-sm text-t3">此班級本期沒有有效學生名冊。</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm border border-themed">
                    <thead>
                      <tr className="bg-hover">
                        <th className="px-3 py-2 text-left text-xs font-bold text-t3">學號</th>
                        <th className="px-3 py-2 text-left text-xs font-bold text-t3">姓名</th>
                        <th className="px-3 py-2 text-left text-xs font-bold text-t3">填寫狀態</th>
                        <th className="px-3 py-2 text-left text-xs font-bold text-t3">最後更新</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.uid} className="border-t border-themed">
                          <td className="px-3 py-2 text-t1">{row.studentId || "—"}</td>
                          <td className="px-3 py-2 text-t1">{row.name || "—"}</td>
                          <td className={`px-3 py-2 ${STATUS_LABELS[row.status].className}`}>
                            {STATUS_LABELS[row.status].label}
                          </td>
                          <td className="px-3 py-2 text-t2">{formatUpdatedAt(row.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {period && (
                <p className="mt-3 text-xs text-t3">
                  {period.academicYear} 學年度第 {period.semester} 學期・共 {rows.length} 位有效學生
                </p>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
