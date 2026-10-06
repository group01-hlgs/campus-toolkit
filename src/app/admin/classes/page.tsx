"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSession } from "@/lib/session";
import { useDataSaver } from "@/lib/data-saver";
import ModuleIcon from "@/components/ModuleIcon";
import RevealListCard from "@/components/RevealListCard";

type VocField = { code: string; name: string } | null;

interface ClassItem {
  code: string;
  name: string;
  group: VocField;
  department: VocField;
  studentCount: number;
}

interface GradeItem {
  grade: number;
  code: string;
  name: string;
  classes: ClassItem[];
}

interface Overview {
  period: { academicYear: number; semester: number };
  grades: GradeItem[];
  summary: {
    gradeCount: number;
    classCount: number;
    studentCount: number;
    unassignedCount: number;
  };
}

interface ClassesResponse {
  success?: boolean;
  message?: string;
  period?: Overview["period"];
  grades?: GradeItem[];
  summary?: Overview["summary"];
}

interface FlatRow extends ClassItem {
  grade: number;
  gradeName: string;
}

/** 統計小卡 */
function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-themed rounded-lg bg-card px-4 py-3">
      <p className="text-xs text-t3">{label}</p>
      <p className="text-xl font-bold text-t1">{value}</p>
      {hint && <p className="text-xs text-t3">{hint}</p>}
    </div>
  );
}

/**
 * 「班級管理」頁（班級總覽）：當期各年級班級清單＋每班學生人數（唯讀、可搜尋），
 * 外殼（標題、權限閘門、頁尾）由 classes/layout.tsx 提供。
 * 班級結構的新增／調整在「學校基本設定 → 年段班級設定」（僅超級管理員）。
 */
export default function ClassesPage() {
  const router = useRouter();
  const { ready: settingsReady, saverOn } = useDataSaver();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [isSuper, setIsSuper] = useState(false);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  // 省流開關：啟用時列表改為按鈕手動顯示（狀態僅維持本次頁面停留）
  const [listLoaded, setListLoaded] = useState(false);
  const gating = saverOn && !listLoaded;

  // 管理員屬性（session 快取，與列表無關，不受省流閘門影響）
  useEffect(() => {
    let cancelled = false;
    fetchSession().then((session) => {
      if (!cancelled) setIsSuper(session?.adminAttribute === "超級");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOverview = async () => {
    setListLoaded(true);
    setError("");
    try {
      const res = await fetch("/api/admin/classes", { cache: "no-store" });
      const data: ClassesResponse | null = res.ok
        ? await res.json().catch(() => null)
        : null;
      if (!data?.success || !data.period || !data.grades || !data.summary) {
        throw new Error(data?.message || "載入失敗");
      }
      setOverview({ period: data.period, grades: data.grades, summary: data.summary });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "載入失敗");
    }
  };

  // 列表載入：設定判定前不發請求；省流開關啟用時須先由按鈕解除（已載入則不再重複請求）
  useEffect(() => {
    if (!settingsReady || gating || listLoaded) return;
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady, gating, listLoaded]);

  /** 攤平成一列一班，並依年級、班級順位排序 */
  const rows = useMemo<FlatRow[]>(() => {
    if (!overview) return [];
    const flat: FlatRow[] = [];
    for (const grade of [...overview.grades].sort((a, b) => a.grade - b.grade)) {
      for (const item of grade.classes) {
        flat.push({ ...item, grade: grade.grade, gradeName: grade.name });
      }
    }
    return flat;
  }, [overview]);

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return rows;
    return rows.filter((row) =>
      [row.gradeName, row.code, row.name, row.group?.name ?? "", row.department?.name ?? ""]
        .some((value) => value.toLowerCase().includes(key))
    );
  }, [rows, keyword]);

  return (
    <div className="w-full max-w-4xl mb-8 space-y-6">
      {/* 區塊標題與操作 */}
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-t1">班級總覽</h3>
          <p className="text-xs text-t3">
            {overview
              ? `${overview.period.academicYear} 學年度 第 ${overview.period.semester} 學期：各年級班級與每班學生人數（唯讀）。`
              : "當期各年級班級與每班學生人數總覽（唯讀）。"}
            班級結構的新增與調整請至「學校基本設定 → 年段班級設定」。
          </p>
        </div>
        {isSuper && (
          <button
            type="button"
            onClick={() => router.push("/admin/school-settings/classes")}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
          >
            維護班級結構 →
          </button>
        )}
      </section>

      {/* 統計 */}
      {overview && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="年級數" value={String(overview.summary.gradeCount)} />
          <StatCard label="班級數" value={String(overview.summary.classCount)} />
          <StatCard
            label="學生人數"
            value={String(overview.summary.studentCount)}
            hint="當期有效名冊條目"
          />
          <StatCard
            label="未編班學生"
            value={String(overview.summary.unassignedCount)}
            hint="無對應班級代碼或不在名冊班級中"
          />
        </section>
      )}

      {/* 省流開關啟用：改為按鈕手動顯示列表 */}
      {gating && (
        <div className="border border-themed rounded-lg bg-card">
          <RevealListCard label="班級" onReveal={() => void loadOverview()} />
        </div>
      )}

      {/* 載入中 */}
      {!gating && !overview && !error && (
        <p className="border border-themed rounded-lg bg-card p-8 text-center text-t3">
          班級資料載入中...
        </p>
      )}

      {/* 讀取錯誤 */}
      {error && (
        <div className="alert-danger p-4 text-sm">
          <span className="font-bold text-danger">載入失敗：</span>
          {error}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer mt-3"
          >
            重新整理
          </button>
        </div>
      )}

      {/* 班級清單 */}
      {!error && overview && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-xs text-t3">共 {rows.length} 個班級</p>
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜尋年級、班級代碼／名稱、群別科別"
              aria-label="搜尋班級"
              className="input-theme rounded px-3 py-1.5 text-sm w-full sm:w-72"
            />
          </div>
          <div className="border border-themed rounded-lg bg-card overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="border-b border-themed">
                <tr className="text-t2">
                  <th className="px-3 py-2 font-medium whitespace-nowrap">年級</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">班級代碼</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">班級名稱</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">群別</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">科別</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap text-right">學生人數</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-t3">
                      尚未建立年級與班級，請至「學校基本設定 → 年段班級設定」設定。
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-t3">
                      沒有符合的班級
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.code} className="border-b border-themed last:border-0 text-t1">
                      <td className="px-3 py-2 whitespace-nowrap">{row.gradeName}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.code}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-medium text-t1">{row.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            router.push(`/admin/classes/${encodeURIComponent(row.code)}`)
                          }
                          aria-label={`查看「${row.name}」學生名單`}
                          title={`查看「${row.name}」學生名單`}
                          className="group icon-link inline-flex items-center align-middle ml-1.5 cursor-pointer"
                        >
                          <ModuleIcon
                            value="roster"
                            className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                          />
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-t3">{row.group?.name || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-t3">
                        {row.department?.name || "—"}
                      </td>
                      <td
                        className={`px-3 py-2 whitespace-nowrap text-right ${
                          row.studentCount > 0 ? "text-t1" : "text-t3"
                        }`}
                      >
                        {row.studentCount}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
