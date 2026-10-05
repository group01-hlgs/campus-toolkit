"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type FirestoreDayUsage,
  type FirebaseUsage,
  type QuotaMetric,
  type StatsResponse,
  type UsageLink,
  type VercelUsage,
} from "@/types/usage";

/** 額度進度顏色：未達 80% 正常、80% 以上警示、超過額度危險 */
function barColor(ratio: number | null): string {
  if (ratio === null) return "var(--primary)";
  if (ratio >= 1) return "var(--danger)";
  if (ratio >= 0.8) return "var(--warning)";
  return "var(--primary)";
}

/** 數量依單位格式化（bytes 以 GB 顯示） */
function formatAmount(value: number, unit: QuotaMetric["unit"], rawUnit?: string): string {
  switch (unit) {
    case "bytes":
      return `${(value / 1e9).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} GB`;
    case "count":
      return Math.round(value).toLocaleString("zh-TW");
    case "hours":
      return `${value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 小時`;
    case "gbHours":
      return `${value.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} GB-hrs`;
    default:
      return `${value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}${rawUnit ? ` ${rawUnit}` : ""}`;
  }
}

/** 軸刻度用的精簡數字（1234 → 1.2k） */
function compactAmount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })}M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })}k`;
  return Math.round(value).toLocaleString("zh-TW");
}

/** 單項資源的「已用／額度」進度條 */
function QuotaBar({ metric, hint }: { metric: QuotaMetric; hint?: string }) {
  const ratio = metric.limit && metric.limit > 0 ? metric.used / metric.limit : null;
  const percent = ratio === null ? null : Math.min(100, Math.round(ratio * 1000) / 10);
  return (
    <div className="border border-themed rounded-lg bg-card px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-t1">{metric.label}</p>
        {ratio !== null && (
          <span
            className={`text-xs ${ratio >= 1 ? "font-semibold text-danger" : "text-t3"}`}
          >
            {percent}%
          </span>
        )}
      </div>
      <p className="mt-1 text-lg font-bold text-t1">
        {formatAmount(metric.used, metric.unit, metric.rawUnit)}
        <span className="ml-1 text-xs font-normal text-t3">
          / {metric.limit !== null ? formatAmount(metric.limit, metric.unit, metric.rawUnit) : "額度未知"}
        </span>
      </p>
      <div
        className="mt-2 h-2 w-full rounded-full bg-surface border border-themed overflow-hidden"
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${metric.label} 使用比例`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${percent ?? 0}%`,
            backgroundColor: barColor(ratio),
            opacity: ratio === null ? 0.35 : 1,
          }}
        />
      </div>
      {hint && <p className="mt-1.5 text-xs text-t3">{hint}</p>}
    </div>
  );
}

/** 未設定／失敗提示（附設定指引與官方用量頁連結） */
function NoticeBox({
  tone,
  message,
  hint,
  links,
}: {
  tone: "info" | "danger";
  message: string | null;
  hint: string | null;
  links?: UsageLink[];
}) {
  if (!message && !hint && !links?.length) return null;
  return (
    <div className={`p-4 text-sm whitespace-pre-wrap ${tone === "danger" ? "alert-danger" : "alert-info"} text-t2`}>
      {message}
      {hint && (
        <>
          {"\n\n"}
          {hint}
        </>
      )}
      {links && links.length > 0 && (
        <div className="mt-3 whitespace-normal">
          <p className="mb-1.5">額度與用量請到官方頁面自行查看：</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {link.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Firestore 近 7 日讀／寫趨勢（純 SVG 長條圖，不引入圖表函式庫） */
function TrendChart({ daily }: { daily: FirestoreDayUsage[] }) {
  const width = 700;
  const height = 240;
  const pad = { top: 16, right: 8, bottom: 34, left: 52 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxValue = Math.max(1, ...daily.flatMap((day) => [day.reads, day.writes]));
  const hasData = daily.some((day) => day.reads > 0 || day.writes > 0);
  const groupW = chartW / Math.max(1, daily.length);
  const barW = Math.min(20, groupW * 0.3);
  const ticks = 4;

  return (
    <div className="border border-themed rounded-lg bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-t1">近 7 日讀寫趨勢</p>
        <div className="flex items-center gap-3 text-xs text-t3">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "var(--primary)" }} />
            讀取
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "var(--success)" }} />
            寫入
          </span>
        </div>
      </div>

      {!hasData ? (
        <p className="mt-4 mb-2 text-center text-xs text-t3">近 7 日尚無讀寫資料。</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mt-2 w-full h-auto"
          role="img"
          aria-label="Firestore 近 7 日讀取與寫入次數趨勢"
        >
          {/* 水平刻度線與標籤 */}
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const ratio = i / ticks;
            const y = pad.top + chartH - ratio * chartH;
            return (
              <g key={`tick-${i}`}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y}
                  y2={y}
                  stroke="var(--bd)"
                  strokeWidth={1}
                  strokeDasharray={i === 0 ? undefined : "4 4"}
                />
                <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--t3)">
                  {compactAmount(maxValue * ratio)}
                </text>
              </g>
            );
          })}

          {/* 每日群組長條 */}
          {daily.map((day, index) => {
            const x0 = pad.left + index * groupW;
            const readsH = (day.reads / maxValue) * chartH;
            const writesH = (day.writes / maxValue) * chartH;
            const baseY = pad.top + chartH;
            return (
              <g key={day.date}>
                <rect
                  x={x0 + groupW / 2 - barW - 2}
                  y={baseY - readsH}
                  width={barW}
                  height={readsH}
                  rx={2}
                  fill="var(--primary)"
                >
                  <title>{`${day.date} 讀取 ${day.reads.toLocaleString("zh-TW")} 次`}</title>
                </rect>
                <rect
                  x={x0 + groupW / 2 + 2}
                  y={baseY - writesH}
                  width={barW}
                  height={writesH}
                  rx={2}
                  fill="var(--success)"
                >
                  <title>{`${day.date} 寫入 ${day.writes.toLocaleString("zh-TW")} 次`}</title>
                </rect>
                <text
                  x={x0 + groupW / 2}
                  y={height - 12}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--t3)"
                >
                  {day.date.slice(5).replace("-", "/")}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <p className="mt-1 text-xs text-t3">單位：次；日期為太平洋時間（免費額度於該日午夜重置），今日為累計至目前。</p>
    </div>
  );
}

/** 區塊標題列（含狀態說明與更新時間） */
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-lg font-bold text-t1">{title}</h3>
      <p className="text-xs text-t3 mt-0.5">{subtitle}</p>
    </div>
  );
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-TW", { hour12: false });
}

export default function StatsPage() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/admin/stats", { cache: "no-store" })
      .then((res) =>
        res.json().then((body: StatsResponse & { message?: string }) => {
          if (!res.ok || !body?.success) {
            throw new Error(body?.message || "載入失敗");
          }
          return body;
        })
      )
      .then((body) => setData(body))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const vercel: VercelUsage | undefined = data?.vercel;
  const firebase: FirebaseUsage | undefined = data?.firebase;

  return (
    <div className="w-full max-w-4xl mb-8 space-y-6">
      {/* 工具列：更新時間、重新整理、整頁錯誤 */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-t3">
          {vercel?.fetchedAt || firebase?.fetchedAt
            ? `資料更新時間：${formatTime(vercel?.fetchedAt || firebase?.fetchedAt)}（伺服器端每 5 分鐘快取）`
            : "外部用量資料由伺服器取得，金鑰不會出現在瀏覽器。"}
        </p>
        <button onClick={load} disabled={loading} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50">
          {loading ? "載入中..." : "重新整理"}
        </button>
      </section>
      {error && <div className="alert-danger p-4 text-sm">{error}</div>}

      {!data && !error && (
        <p className="border border-themed rounded-lg bg-card p-8 text-center text-t3">用量資料載入中...</p>
      )}

      {/* Vercel：本月用量 */}
      {vercel && (
        <section>
          <SectionHeader
            title="Vercel 用量（本月）"
            subtitle={
              vercel.period.from
                ? `方案 ${vercel.plan === "pro" ? "Pro" : "Hobby"}・區間 ${
                    vercel.period.from.slice(0, 10)
                  } ~ ${vercel.period.to.slice(0, 10)}（UTC，每月重置）`
                : `方案 ${vercel.plan === "pro" ? "Pro" : "Hobby"}・每月重置`
            }
          />
          {vercel.ok ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {vercel.metrics.map((metric) => (
                  <QuotaBar key={metric.key} metric={metric} hint={metric.limit === null ? "此項目無免費額度或按量計費" : undefined} />
                ))}
              </div>
              {vercel.note && (
                <div className="mt-3 p-3 text-xs whitespace-pre-wrap alert-info text-t2">{vercel.note}</div>
              )}
              {!!vercel.links?.length && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-t3">
                  <span>官方用量頁：</span>
                  {vercel.links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {link.label} ↗
                    </a>
                  ))}
                </div>
              )}
            </>
          ) : (
            <NoticeBox
              tone={vercel.configured ? "danger" : "info"}
              message={vercel.message}
              hint={vercel.hint}
              links={vercel.links}
            />
          )}
        </section>
      )}

      {/* Firestore：今日用量與近 7 日趨勢 */}
      {firebase && (
        <section>
          <SectionHeader
            title="Firebase / Firestore 用量（今日）"
            subtitle="免費額度：讀取 50,000、寫入 20,000、刪除 20,000（每日，太平洋時間午夜重置）"
          />
          {firebase.ok ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <QuotaBar
                metric={{
                  key: "reads",
                  label: "文件讀取（今日）",
                  used: firebase.today.reads,
                  limit: firebase.limits.reads,
                  unit: "count",
                }}
              />
              <QuotaBar
                metric={{
                  key: "writes",
                  label: "文件寫入（今日）",
                  used: firebase.today.writes,
                  limit: firebase.limits.writes,
                  unit: "count",
                }}
              />
              <QuotaBar
                metric={{
                  key: "deletes",
                  label: "文件刪除（今日）",
                  used: firebase.today.deletes,
                  limit: firebase.limits.deletes,
                  unit: "count",
                }}
              />
            </div>
          ) : (
            <NoticeBox
              tone={firebase.configured ? "danger" : "info"}
              message={firebase.message}
              hint={firebase.hint}
              links={firebase.links}
            />
          )}
        </section>
      )}

      {/* Firestore 近 7 日趨勢（有資料來源才顯示） */}
      {firebase?.ok && (
        <section>
          <TrendChart daily={firebase.daily} />
        </section>
      )}
    </div>
  );
}
