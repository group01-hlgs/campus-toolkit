"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type VocField = { code: string; name: string } | null;

interface ClassInfo {
  code: string;
  name: string;
  grade: number;
  gradeName: string;
  group: VocField;
  department: VocField;
  studentCount: number;
}

interface ClassStudent {
  uid: string;
  name: string;
  studentId: string;
  seatNo: string;
  rollNo: string;
  email: string;
  account: string;
}

interface ClassResponse {
  success?: boolean;
  message?: string;
  period?: { academicYear: number; semester: number };
  classInfo?: ClassInfo;
  students?: ClassStudent[];
}

/**
 * 「班級管理 → 班級學生名單」子頁（唯讀）：由班級總覽的班級名稱進入，
 * 列出該班當期有效學生名冊條目（座號、學號、姓名、班號、信箱、帳號），可搜尋。
 * 外殼（標題、權限閘門、頁尾）由 classes/layout.tsx 提供；
 * 資料由 `GET /api/admin/classes?classCode=…` 取得（同一 classes 權限）。
 */
export default function ClassStudentsPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = typeof params.code === "string" ? params.code : "";

  const [info, setInfo] = useState<ClassInfo | null>(null);
  const [period, setPeriod] = useState<{ academicYear: number; semester: number } | null>(null);
  const [students, setStudents] = useState<ClassStudent[]>([]);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    fetch(`/api/admin/classes?classCode=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then(async (res) => {
        const data: ClassResponse | null = await res.json().catch(() => null);
        if (!res.ok || !data?.success || !data.classInfo || !data.period || !data.students) {
          throw new Error(data?.message || "載入失敗");
        }
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setInfo(data.classInfo ?? null);
        setPeriod(data.period ?? null);
        setStudents(data.students ?? []);
        setError("");
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "載入失敗");
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return students;
    return students.filter((student) =>
      [
        student.name,
        student.studentId,
        student.seatNo,
        student.rollNo,
        student.email,
        student.account,
      ].some((value) => value.toLowerCase().includes(key))
    );
  }, [students, keyword]);

  /** 群別／科別（僅高級中等學校學制的班級有值） */
  const vocNote = info
    ? [
        info.group?.name ? `群別：${info.group.name}` : "",
        info.department?.name ? `科別：${info.department.name}` : "",
      ]
        .filter(Boolean)
        .join("、")
    : "";

  return (
    <div className="w-full max-w-4xl mb-8 space-y-6">
      {/* 區塊標題與操作 */}
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-t1">班級學生名單</h3>
          <p className="text-xs text-t3">
            {info && period
              ? `${info.gradeName}・${info.name}（班級代碼 ${info.code}）：${period.academicYear} 學年度 第 ${period.semester} 學期，共 ${info.studentCount} 位學生（唯讀，僅列當期有效名冊條目）。`
              : "該班當期有效學生名單（唯讀）。"}
            {vocNote && ` ${vocNote}。`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/admin/classes")}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          ← 返回班級總覽
        </button>
      </section>

      {/* 載入中 */}
      {!info && !error && (
        <p className="border border-themed rounded-lg bg-card p-8 text-center text-t3">
          班級名單載入中...
        </p>
      )}

      {/* 讀取錯誤（含查無此班級） */}
      {error && (
        <div className="alert-danger p-4 text-sm">
          <span className="font-bold text-danger">載入失敗：</span>
          {error}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
            >
              重新整理
            </button>
            <button
              type="button"
              onClick={() => router.push("/admin/classes")}
              className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
            >
              返回班級總覽
            </button>
          </div>
        </div>
      )}

      {/* 學生名單 */}
      {!error && info && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-xs text-t3">共 {students.length} 位學生</p>
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜尋姓名、學號、座號、帳號或信箱"
              aria-label="搜尋學生"
              className="input-theme rounded px-3 py-1.5 text-sm w-full sm:w-72"
            />
          </div>
          <div className="border border-themed rounded-lg bg-card overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="border-b border-themed">
                <tr className="text-t2">
                  <th className="px-3 py-2 font-medium whitespace-nowrap">座號</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">學號</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">姓名</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">班號</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">電子郵件地址</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">帳號</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-t3">
                      此班級目前沒有學生（當期無有效名冊條目）。
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-t3">
                      沒有符合的學生
                    </td>
                  </tr>
                ) : (
                  filtered.map((student) => (
                    <tr key={student.uid} className="border-b border-themed last:border-0 text-t1">
                      <td className="px-3 py-2 whitespace-nowrap">{student.seatNo || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{student.studentId || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{student.name}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-t3">
                        {student.rollNo || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-t3">
                        {student.email || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-t3">
                        {student.account || "—"}
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
