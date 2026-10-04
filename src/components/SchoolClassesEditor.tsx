"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CLASSES_CODE_MAX,
  CLASSES_MAX_CLASSES,
  CLASSES_MAX_CLASSES_PER_GRADE,
  CLASSES_MAX_GRADE,
  CLASSES_MAX_SEGMENTS,
  CLASSES_NAME_MAX,
  CLASSES_SEGMENT_NAME_MAX,
  ClassRow,
  GradeRow,
  SchoolClassesSetting,
  Segment,
  newClassId,
  newSegmentId,
  readSchoolClasses,
  totalClassCount,
  usedGrades,
  validateSchoolClasses,
} from "@/types/school-classes";
import { EDUCATION_STAGES } from "@/types/school-profile";

type Modal = { type: "success" | "error"; text: string } | null;

/** 儲存結果過場視窗的停留時間 */
const MODAL_DURATION_MS = 2000;
type ClassesResponse = { success?: boolean; message?: string; setting?: unknown };

/**
 * 年段班級設定編輯器（學校基本設定的子功能）。
 * 自行讀取與儲存 `GET/PUT /api/admin/school/classes`；
 * 沿用校務基本資料的 saved／draft 模式：還原與儲存共用同一份未儲存狀態。
 */
export default function SchoolClassesEditor() {
  const [saved, setSaved] = useState<SchoolClassesSetting | null>(null);
  const [draft, setDraft] = useState<SchoolClassesSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  /** 過場視窗的自動關閉計時器（重新彈出前先清掉舊的） */
  const modalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 各年段「新增年級」下拉的暫存選擇（年段 id → 年級字串） */
  const [gradePicks, setGradePicks] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/school/classes", { cache: "no-store" });
      const data: ClassesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.setting) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      const setting = readSchoolClasses(data.setting);
      setSaved(setting);
      setDraft(setting);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validation = useMemo(
    () => (draft ? validateSchoolClasses(draft) : null),
    [draft]
  );
  const dirty = useMemo(() => {
    if (!saved || !draft) return false;
    return JSON.stringify(saved) !== JSON.stringify(draft);
  }, [saved, draft]);

  /** 彈出儲存結果過場視窗，MODAL_DURATION_MS 後自動關閉 */
  function showModal(type: "success" | "error", text: string) {
    if (modalTimer.current) clearTimeout(modalTimer.current);
    setModal({ type, text });
    modalTimer.current = setTimeout(() => {
      setModal(null);
      modalTimer.current = null;
    }, MODAL_DURATION_MS);
  }

  /** 立即關閉過場視窗（含計時器） */
  function closeModal() {
    if (modalTimer.current) {
      clearTimeout(modalTimer.current);
      modalTimer.current = null;
    }
    setModal(null);
  }

  // 卸載時清掉計時器，避免對已卸載元件 setState
  useEffect(() => {
    return () => {
      if (modalTimer.current) clearTimeout(modalTimer.current);
    };
  }, []);

  function commit(segments: Segment[]) {
    if (!draft) return;
    setModal(null);
    setDraft({ ...draft, segments });
  }

  /** 修改單一年段（依 id 定位） */
  function changeSegment(id: string, updater: (segment: Segment) => Segment) {
    if (!draft) return;
    commit(draft.segments.map((segment) => (segment.id === id ? updater(segment) : segment)));
  }

  /** 修改年段內單一年級（依年級定位） */
  function changeGrade(
    segmentId: string,
    grade: number,
    updater: (row: GradeRow) => GradeRow
  ) {
    changeSegment(segmentId, (segment) => ({
      ...segment,
      grades: segment.grades.map((row) => (row.grade === grade ? updater(row) : row)),
    }));
  }

  /** 尚未被任何年段占用的年級 */
  function unusedGradesOf(setting: SchoolClassesSetting): number[] {
    const used = usedGrades(setting);
    return Array.from({ length: CLASSES_MAX_GRADE }, (_, index) => index + 1).filter(
      (grade) => !used.has(grade)
    );
  }

  function addSegment() {
    if (!draft || draft.segments.length >= CLASSES_MAX_SEGMENTS) return;
    const free = unusedGradesOf(draft);
    if (free.length === 0) return;
    commit([
      ...draft.segments,
      {
        id: newSegmentId(),
        name: `年段 ${draft.segments.length + 1}`,
        stage: null,
        grades: [{ grade: free[0], classes: [] }],
      },
    ]);
  }

  function moveSegment(id: string, direction: -1 | 1) {
    if (!draft) return;
    const index = draft.segments.findIndex((segment) => segment.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.segments.length) return;
    const segments = [...draft.segments];
    [segments[index], segments[target]] = [segments[target], segments[index]];
    commit(segments);
  }

  function removeSegment(id: string) {
    if (!draft) return;
    const segment = draft.segments.find((item) => item.id === id);
    if (!segment) return;
    if (
      totalClassCount({ segments: [segment] }) > 0 &&
      !window.confirm(`確定刪除年段「${segment.name || "（未命名）"}」及其所有班級？`)
    ) {
      return;
    }
    setGradePicks((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    commit(draft.segments.filter((item) => item.id !== id));
  }

  function addGrade(segmentId: string) {
    if (!draft) return;
    const picked = Number(gradePicks[segmentId]);
    const segment = draft.segments.find((item) => item.id === segmentId);
    if (!segment || !Number.isInteger(picked)) return;
    if (segment.grades.some((row) => row.grade === picked)) return;
    changeSegment(segmentId, (item) => ({
      ...item,
      grades: [...item.grades, { grade: picked, classes: [] }].sort((a, b) => a.grade - b.grade),
    }));
    setGradePicks((prev) => {
      const next = { ...prev };
      delete next[segmentId];
      return next;
    });
  }

  function removeGrade(segmentId: string, grade: number) {
    if (!draft) return;
    const segment = draft.segments.find((item) => item.id === segmentId);
    const row = segment?.grades.find((item) => item.grade === grade);
    if (!segment || !row) return;
    if (
      row.classes.length > 0 &&
      !window.confirm(`確定刪除 ${grade} 年級及其 ${row.classes.length} 個班級？`)
    ) {
      return;
    }
    changeSegment(segmentId, (item) => ({
      ...item,
      grades: item.grades.filter((entry) => entry.grade !== grade),
    }));
  }

  function addClass(segmentId: string, grade: number) {
    if (!draft) return;
    const segment = draft.segments.find((item) => item.id === segmentId);
    const row = segment?.grades.find((item) => item.grade === grade);
    if (!row || row.classes.length >= CLASSES_MAX_CLASSES_PER_GRADE) return;
    changeGrade(segmentId, grade, (item) => ({
      ...item,
      classes: [...item.classes, { id: newClassId(), code: "", name: "" }],
    }));
  }

  function changeClass(
    segmentId: string,
    grade: number,
    classId: string,
    field: "code" | "name",
    value: string
  ) {
    changeGrade(segmentId, grade, (item) => ({
      ...item,
      classes: item.classes.map((row: ClassRow) =>
        row.id === classId ? { ...row, [field]: value } : row
      ),
    }));
  }

  function removeClass(segmentId: string, grade: number, classId: string) {
    changeGrade(segmentId, grade, (item) => ({
      ...item,
      classes: item.classes.filter((row) => row.id !== classId),
    }));
  }

  function reset() {
    if (!saved) return;
    setGradePicks({});
    setDraft(saved);
    setModal(null);
  }

  async function save() {
    if (!draft || !validation?.ok || saving) return;
    setSaving(true);
    setModal(null);
    try {
      const res = await fetch("/api/admin/school/classes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setting: draft }),
      });
      const data: ClassesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `儲存失敗（HTTP ${res.status}）`);
      }
      const setting = readSchoolClasses(data.setting ?? draft);
      setSaved(setting);
      setDraft(setting);
      setGradePicks({});
      showModal("success", data.message || "年段班級設定已儲存");
    } catch (error) {
      showModal("error", error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-t3 py-4">年段班級設定載入中...</p>;
  }

  if (loadError) {
    return (
      <div className="alert-danger p-4 text-sm">
        <span className="font-bold text-danger">讀取失敗：</span>
        {loadError}
        <button
          type="button"
          onClick={() => void load()}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer mt-3 block"
        >
          重新讀取
        </button>
      </div>
    );
  }

  if (!draft || !validation) return null;

  const classTotal = totalClassCount(draft);
  const unused = unusedGradesOf(draft);

  return (
    <div className="mt-4">
      {/* 新增年段／還原／儲存 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          type="button"
          onClick={addSegment}
          disabled={
            draft.segments.length >= CLASSES_MAX_SEGMENTS || unused.length === 0
          }
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          新增年段
        </button>
        <span className="text-xs text-t3">
          年段 {draft.segments.length} / {CLASSES_MAX_SEGMENTS}，班級 {classTotal} /{" "}
          {CLASSES_MAX_CLASSES}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={!dirty || saving}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            還原
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || !validation.ok || saving}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "儲存中..." : "儲存變更"}
          </button>
        </div>
      </div>

      {!validation.ok && (
        <p className="text-danger text-sm mb-2" role="alert">
          {validation.message}
        </p>
      )}
      <p className="text-xs text-t3 mb-3">
        {dirty ? "有尚未儲存的變更，記得按「儲存變更」。" : "已與伺服器同步。"}
      </p>

      {/* 年段清單 */}
      <section className="border border-themed rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h4 className="font-bold text-t1">年段與班級</h4>
          <span className="text-xs text-t3 ml-auto">年級 1～{CLASSES_MAX_GRADE}</span>
        </div>
        <p className="text-sm text-t3 mt-1 mb-3">
          新增年段後指定涵蓋的年級，再於各年級下建立班級。班級代碼全校不可重複、
          班級名稱同一年級內不可重複。
        </p>

        {draft.segments.length === 0 ? (
          <p className="text-sm text-t3">
            尚未建立年段，請按上方「新增年段」開始設定（如：低年段、中年段、高年段）。
          </p>
        ) : (
          <div className="grid gap-3">
            {draft.segments.map((segment, index) => {
              const segmentUnused = unused;
              const pick =
                gradePicks[segment.id] ??
                (segmentUnused[0] ? String(segmentUnused[0]) : "");
              return (
                <div key={segment.id} className="border border-themed rounded-lg p-3">
                  {/* 年段標題列 */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="text-sm font-bold text-t2">年段 {index + 1}</span>
                    <input
                      type="text"
                      maxLength={CLASSES_SEGMENT_NAME_MAX}
                      value={segment.name}
                      onChange={(event) =>
                        changeSegment(segment.id, (item) => ({
                          ...item,
                          name: event.target.value,
                        }))
                      }
                      placeholder="年段名稱，如：低年段"
                      aria-label={`年段 ${index + 1} 名稱`}
                      className="input-theme rounded px-3 py-1 text-sm w-44"
                    />
                    <label className="flex items-center gap-1 text-sm">
                      <span className="text-t3">學制</span>
                      <select
                        value={segment.stage ?? ""}
                        onChange={(event) =>
                          changeSegment(segment.id, (item) => ({
                            ...item,
                            stage: (event.target.value || null) as Segment["stage"],
                          }))
                        }
                        aria-label={`年段 ${index + 1} 綁定學制`}
                        className="input-theme rounded px-2 py-1 text-sm"
                      >
                        <option value="">不綁定</option>
                        {EDUCATION_STAGES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveSegment(segment.id, -1)}
                        disabled={index === 0}
                        className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSegment(segment.id, 1)}
                        disabled={index === draft.segments.length - 1}
                        className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        下移
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSegment(segment.id)}
                        className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer"
                      >
                        刪除年段
                      </button>
                    </div>
                  </div>

                  {/* 各年級 */}
                  {segment.grades.map((row) => (
                    <div
                      key={row.grade}
                      className="border-t border-themed pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="text-sm font-bold text-t2">{row.grade} 年級</span>
                        <span className="text-xs text-t3">{row.classes.length} 班</span>
                        <div className="ml-auto flex gap-1">
                          <button
                            type="button"
                            onClick={() => addClass(segment.id, row.grade)}
                            disabled={row.classes.length >= CLASSES_MAX_CLASSES_PER_GRADE}
                            className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            新增班級
                          </button>
                          <button
                            type="button"
                            onClick={() => removeGrade(segment.id, row.grade)}
                            className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer"
                          >
                            刪除年級
                          </button>
                        </div>
                      </div>

                      {row.classes.length === 0 ? (
                        <p className="text-xs text-t3 mb-2">尚未建立班級。</p>
                      ) : (
                        <div className="grid gap-2 mb-2">
                          {row.classes.map((item) => (
                            <div key={item.id} className="flex items-center gap-2">
                              <input
                                type="text"
                                maxLength={CLASSES_CODE_MAX}
                                value={item.code}
                                onChange={(event) =>
                                  changeClass(
                                    segment.id,
                                    row.grade,
                                    item.id,
                                    "code",
                                    event.target.value
                                  )
                                }
                                placeholder="班級代碼"
                                aria-label={`${row.grade} 年級班級代碼`}
                                className="input-theme rounded px-3 py-1 text-sm w-32"
                              />
                              <input
                                type="text"
                                maxLength={CLASSES_NAME_MAX}
                                value={item.name}
                                onChange={(event) =>
                                  changeClass(
                                    segment.id,
                                    row.grade,
                                    item.id,
                                    "name",
                                    event.target.value
                                  )
                                }
                                placeholder="班級名稱，如：1 年 1 班"
                                aria-label={`${row.grade} 年級班級名稱`}
                                className="input-theme rounded px-3 py-1 text-sm w-full"
                              />
                              <button
                                type="button"
                                onClick={() => removeClass(segment.id, row.grade, item.id)}
                                className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer"
                              >
                                移除
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* 新增年級 */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-themed pt-2 mt-2">
                    <select
                      value={pick}
                      onChange={(event) =>
                        setGradePicks((prev) => ({ ...prev, [segment.id]: event.target.value }))
                      }
                      disabled={segmentUnused.length === 0}
                      aria-label={`年段 ${index + 1} 待新增的年級`}
                      className="input-theme rounded px-2 py-1 text-sm disabled:opacity-50"
                    >
                      {segmentUnused.length === 0 ? (
                        <option value="">年級已用完</option>
                      ) : (
                        segmentUnused.map((grade) => (
                          <option key={grade} value={grade}>
                            {grade} 年級
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={() => addGrade(segment.id)}
                      disabled={segmentUnused.length === 0}
                      className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      新增年級
                    </button>
                    <span className="text-xs text-t3">
                      涵蓋 {segment.grades.length} 個年級
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 儲存遮罩：儲存期間覆蓋畫面、阻擋重複操作 */}
      {saving && <BlockingMask text="儲存中，請稍候…" />}

      {/* 儲存結果過場視窗：彈出後停留 2 秒自動關閉 */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
          role="presentation"
          onClick={closeModal}
        >
          <div
            className="bg-card rounded-2xl p-8 text-center space-y-4 shadow-lg animate-fade-in"
            role={modal.type === "error" ? "alertdialog" : "dialog"}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-center">
              {modal.type === "error" ? (
                <svg
                  className="w-12 h-12 text-danger"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-12 h-12 text-success"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
            </div>
            <p
              className={`text-lg font-semibold ${modal.type === "error" ? "text-danger" : "text-t1"}`}
            >
              {modal.text}
            </p>
            <p className="text-xs text-t3">視窗將於 2 秒後自動關閉</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** 全螢幕遮罩（儲存中）：淡入過場並擋住下方所有操作 */
function BlockingMask({ text }: { text: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
      role="status"
      aria-live="polite"
    >
      <svg
        className="w-10 h-10 animate-spin text-t2"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" d="M21 12a9 9 0 11-6.22-8.56" />
      </svg>
      <p className="text-sm text-t2">{text}</p>
    </div>
  );
}
