"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CLASSES_CODE_MAX,
  CLASSES_GRADE_CODE_MAX,
  CLASSES_GRADE_NAME_MAX,
  CLASSES_MAX_CLASSES,
  CLASSES_MAX_CLASSES_PER_GRADE,
  CLASSES_NAME_MAX,
  CLASSES_SEGMENT_NAME_MAX,
  CLASSES_VOC_CODE_MAX,
  CLASSES_VOC_NAME_MAX,
  ClassRow,
  GradeNameStyle,
  GradeRow,
  SchoolClassesContext,
  SchoolClassesSetting,
  SENIOR_HIGH_STAGE,
  Segment,
  VocField,
  contextYearsSum,
  defaultGradeCode,
  defaultGradeName,
  emptyContext,
  freeGradeNumbers,
  gradeRangeOf,
  newClassId,
  newGradeId,
  newSegmentId,
  readSchoolClasses,
  stageName,
  totalClassCount,
  totalGradeCount,
  validateSchoolClasses,
} from "@/types/school-classes";
import { EDUCATION_STAGES, StageValue } from "@/types/school-profile";

type Modal = { type: "success" | "error"; text: string } | null;

/** 儲存結果過場視窗的停留時間 */
const MODAL_DURATION_MS = 2000;
type ClassesResponse = {
  success?: boolean;
  message?: string;
  setting?: unknown;
  stages?: SchoolClassesContext["stages"];
};

/**
 * 年段班級設定編輯器（學校基本設定的子功能）。
 * 自行讀取與儲存 `GET/PUT /api/admin/school/classes`；
 * 沿用校務基本資料的 saved／draft 模式：還原與儲存共用同一份未儲存狀態。
 * 學制與年制（上限）由 GET 一併回傳，取自校務基本資料。
 */
export default function SchoolClassesEditor() {
  const router = useRouter();
  const [saved, setSaved] = useState<SchoolClassesSetting | null>(null);
  const [draft, setDraft] = useState<SchoolClassesSetting | null>(null);
  const [context, setContext] = useState<SchoolClassesContext>(emptyContext);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  /** 過場視窗的自動關閉計時器（重新彈出前先清掉舊的） */
  const modalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 「新增年段」待用的學制選擇 */
  const [stagePick, setStagePick] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/school/classes", { cache: "no-store" });
      const data: ClassesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.setting) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      const next: SchoolClassesContext = { stages: Array.isArray(data.stages) ? data.stages : [] };
      const setting = readSchoolClasses(data.setting, next);
      setContext(next);
      setSaved(setting);
      setDraft(setting);
      setStagePick("");
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
    () => (draft ? validateSchoolClasses(draft, context) : null),
    [draft, context]
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

  /** 修改年段內單一年級（依年級編號定位） */
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

  /** 年級編號尚未被占用的學制（供「新增年段」挑選） */
  const availableStages = draft
    ? context.stages.filter((item) => freeGradeNumbers(draft, context, item.stage).length > 0)
    : [];
  const pickStage =
    availableStages.find((item) => item.stage === stagePick)?.stage ??
    availableStages[0]?.stage ??
    null;

  function addSegment() {
    if (!draft || !pickStage) return;
    const free = freeGradeNumbers(draft, context, pickStage);
    if (free.length === 0) return;
    // 每次只帶入 1 個年級（該學制第一個未占用編號），
    // 同段其餘年級按「新增年級」、分段就再按「新增年段」，
    // 否則一次吃光所有編號會讓高級中等學校只能建立 1 個年段。
    const value = free[0];
    const range = gradeRangeOf(context, pickStage);
    const gradeName = defaultGradeName(value, range, draft.nameStyle);
    commit([
      ...draft.segments,
      {
        id: newSegmentId(),
        name: `${stageName(pickStage)}部 ${gradeName}`,
        stage: pickStage,
        grades: [
          {
            id: newGradeId(),
            grade: value,
            code: defaultGradeCode(value),
            name: gradeName,
            classes: [],
          },
        ],
      },
    ]);
    // 刻意不重置 stagePick：連續按可依同一學制往下建年段（高一→高二→高三）
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
      !window.confirm(`確定刪除年段「${segment.name || "（未命名）"}」及其所有年級與班級？`)
    ) {
      return;
    }
    commit(draft.segments.filter((item) => item.id !== id));
  }

  /** 修正學制（僅在現有學制未於校務基本資料勾選時開放），非高中職學制會一併清空群別與科別 */
  function fixSegmentStage(segmentId: string, rawStage: string) {
    if (!draft) return;
    const stage = (rawStage || null) as StageValue | null;
    changeSegment(segmentId, (item) => ({
      ...item,
      stage,
      grades:
        stage === SENIOR_HIGH_STAGE
          ? item.grades
          : item.grades.map((row) => ({
              ...row,
              classes: row.classes.map((cls) => ({ ...cls, group: null, department: null })),
            })),
    }));
  }

  function addGrade(segmentId: string) {
    if (!draft) return;
    const segment = draft.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    const free = freeGradeNumbers(draft, context, segment.stage);
    if (free.length === 0) return;
    const value = free[0];
    const range = gradeRangeOf(context, segment.stage);
    changeSegment(segmentId, (item) => ({
      ...item,
      grades: [
        ...item.grades,
        {
          id: newGradeId(),
          grade: value,
          code: defaultGradeCode(value),
          name: defaultGradeName(value, range, draft.nameStyle),
          classes: [],
        },
      ].sort((a, b) => a.grade - b.grade),
    }));
  }

  function removeGrade(segmentId: string, grade: number) {
    if (!draft) return;
    const segment = draft.segments.find((item) => item.id === segmentId);
    const row = segment?.grades.find((item) => item.grade === grade);
    if (!segment || !row) return;
    if (
      row.classes.length > 0 &&
      !window.confirm(`確定刪除「${row.name}」及其 ${row.classes.length} 個班級？`)
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
      classes: [
        ...item.classes,
        { id: newClassId(), code: "", name: "", group: null, department: null },
      ],
    }));
  }

  function changeClass(segmentId: string, grade: number, classId: string, patch: Partial<ClassRow>) {
    changeGrade(segmentId, grade, (item) => ({
      ...item,
      classes: item.classes.map((row) => (row.id === classId ? { ...row, ...patch } : row)),
    }));
  }

  function changeVoc(
    segmentId: string,
    grade: number,
    classId: string,
    key: "group" | "department",
    field: "code" | "name",
    value: string
  ) {
    changeGrade(segmentId, grade, (item) => ({
      ...item,
      classes: item.classes.map((row) => {
        if (row.id !== classId) return row;
        const current: VocField = row[key] ?? { code: "", name: "" };
        const next: VocField = { ...current, [field]: value };
        const merged: VocField | null =
          next.code.trim() || next.name.trim() ? { code: next.code, name: next.name } : null;
        return { ...row, [key]: merged };
      }),
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
    setStagePick("");
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
      const next: SchoolClassesContext = { stages: Array.isArray(data.stages) ? data.stages : context.stages };
      const setting = readSchoolClasses(data.setting ?? draft, next);
      setContext(next);
      setSaved(setting);
      setDraft(setting);
      setStagePick("");
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
  const gradeTotal = totalGradeCount(draft);
  const yearsSum = contextYearsSum(context);

  return (
    <div className="mt-4">
      {/* 新增年段／還原／儲存 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={pickStage ?? ""}
          onChange={(event) => setStagePick(event.target.value)}
          disabled={availableStages.length === 0}
          aria-label="新增年段的學制"
          className="input-theme rounded px-2 py-2 text-sm disabled:opacity-50"
        >
          {availableStages.length === 0 ? (
            <option value="">
              {context.stages.length === 0 ? "尚無學制" : "各學制年級已用完"}
            </option>
          ) : (
            availableStages.map((item) => (
              <option key={item.stage} value={item.stage}>
                {stageName(item.stage)}（剩餘 {freeGradeNumbers(draft, context, item.stage).length}{" "}
                年）
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          onClick={addSegment}
          disabled={!pickStage}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          新增年段
        </button>
        <label className="flex items-center gap-1 text-sm" title="只影響之後新增年級的預設名稱，既有名稱不會被改寫">
          <span className="text-t3">年級名稱預設</span>
          <select
            value={draft.nameStyle}
            onChange={(event) =>
              setDraft({ ...draft, nameStyle: event.target.value as GradeNameStyle })
            }
            aria-label="年級名稱預設慣例"
            className="input-theme rounded px-2 py-2 text-sm"
          >
            <option value="local">學制內序號（1 年級）</option>
            <option value="global">全域編號（10 年級）</option>
          </select>
        </label>
        <span className="text-xs text-t3">
          年段 {draft.segments.length} / {yearsSum}，年級 {gradeTotal} / {yearsSum}，班級{" "}
          {classTotal} / {CLASSES_MAX_CLASSES}
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
          <span className="text-xs text-t3 ml-auto">年級編號總和 {yearsSum}</span>
        </div>
        <p className="text-sm text-t3 mt-1 mb-3">
          年段須綁定校務基本資料中的學制，每段可含 1 個或多個年級（高中職常見 3 個年段各 1 個年級，
          國小常見低／中／高年段各 2 個年級），可建立的年段與年級數受年制總和限制。
          年級代碼與名稱可自行修改；高級中等學校學制的班級另可填寫群別與科別。
        </p>

        {context.stages.length === 0 && (
          <div className="alert-danger p-4 text-sm mb-3">
            <p className="mb-2">
              尚未於「校務基本資料」勾選教育階段與學校年制，無法建立年段。
            </p>
            <button
              type="button"
              onClick={() => router.push("/admin/school-settings/profile")}
              className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
            >
              前往校務基本資料
            </button>
          </div>
        )}

        {draft.segments.length === 0 ? (
          <p className="text-sm text-t3">
            尚未建立年段。請在上方選擇學制後按「新增年段」，一次建立 1 個年段並帶入 1 個年級；
            同一段要再加年級按「新增年級」，要分段就再按一次「新增年段」。
          </p>
        ) : (
          <div className="grid gap-3">
            {draft.segments.map((segment, index) => {
              const range = gradeRangeOf(context, segment.stage);
              const free = freeGradeNumbers(draft, context, segment.stage);
              const stageValid =
                segment.stage !== null &&
                context.stages.some((item) => item.stage === segment.stage);
              const isSenior = segment.stage === SENIOR_HIGH_STAGE;
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
                    {stageValid ? (
                      <span className="text-sm text-t2">
                        學制：{stageName(segment.stage)}
                        <span className="text-xs text-t3 ml-1">
                          （{range ? `${range.start}～${range.end} 年級編號` : "年制未勾選"}）
                        </span>
                      </span>
                    ) : (
                      <label className="flex items-center gap-1 text-sm">
                        <span className="text-t3">學制</span>
                        <select
                          value={segment.stage ?? ""}
                          onChange={(event) => fixSegmentStage(segment.id, event.target.value)}
                          aria-label={`年段 ${index + 1} 學制`}
                          className="input-theme rounded px-2 py-1 text-sm"
                        >
                          <option value="">請選擇學制</option>
                          {segment.stage &&
                            !context.stages.some((item) => item.stage === segment.stage) && (
                              <option value={segment.stage}>
                                {stageName(segment.stage)}（未在校務基本資料勾選）
                              </option>
                            )}
                          {EDUCATION_STAGES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
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

                  {isSenior && (
                    <p className="text-xs text-t3 mb-2">
                      高級中等學校學制：每班的「群別」「科別」為選填，代碼與名稱需同時填寫。
                    </p>
                  )}

                  {/* 各年級 */}
                  {segment.grades.map((row) => (
                    <div
                      key={row.id}
                      className="border-t border-themed pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <label className="flex items-center gap-1 text-sm">
                          <span className="text-t3">年級代碼</span>
                          <input
                            type="text"
                            maxLength={CLASSES_GRADE_CODE_MAX}
                            value={row.code}
                            onChange={(event) =>
                              changeGrade(segment.id, row.grade, (item) => ({
                                ...item,
                                code: event.target.value,
                              }))
                            }
                            aria-label={`${row.name}年級代碼`}
                            className="input-theme rounded px-2 py-1 text-sm w-24"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-sm">
                          <span className="text-t3">年級名稱</span>
                          <input
                            type="text"
                            maxLength={CLASSES_GRADE_NAME_MAX}
                            value={row.name}
                            onChange={(event) =>
                              changeGrade(segment.id, row.grade, (item) => ({
                                ...item,
                                name: event.target.value,
                              }))
                            }
                            aria-label={`${row.name}年級名稱`}
                            className="input-theme rounded px-2 py-1 text-sm w-32"
                          />
                        </label>
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
                            <div key={item.id} className="border border-themed rounded p-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  maxLength={CLASSES_CODE_MAX}
                                  value={item.code}
                                  onChange={(event) =>
                                    changeClass(segment.id, row.grade, item.id, {
                                      code: event.target.value,
                                    })
                                  }
                                  placeholder="班級代碼"
                                  aria-label={`${row.name}班級代碼`}
                                  className="input-theme rounded px-3 py-1 text-sm w-32"
                                />
                                <input
                                  type="text"
                                  maxLength={CLASSES_NAME_MAX}
                                  value={item.name}
                                  onChange={(event) =>
                                    changeClass(segment.id, row.grade, item.id, {
                                      name: event.target.value,
                                    })
                                  }
                                  placeholder="班級名稱，如：1 年 1 班"
                                  aria-label={`${row.name}班級名稱`}
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

                              {isSenior && (
                                <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-themed">
                                  <span className="text-xs font-bold text-t2">群別</span>
                                  <input
                                    type="text"
                                    maxLength={CLASSES_VOC_CODE_MAX}
                                    value={item.group?.code ?? ""}
                                    onChange={(event) =>
                                      changeVoc(
                                        segment.id,
                                        row.grade,
                                        item.id,
                                        "group",
                                        "code",
                                        event.target.value
                                      )
                                    }
                                    placeholder="群別代碼"
                                    aria-label={`${row.name}班級群別代碼`}
                                    className="input-theme rounded px-3 py-1 text-sm w-28"
                                  />
                                  <input
                                    type="text"
                                    maxLength={CLASSES_VOC_NAME_MAX}
                                    value={item.group?.name ?? ""}
                                    onChange={(event) =>
                                      changeVoc(
                                        segment.id,
                                        row.grade,
                                        item.id,
                                        "group",
                                        "name",
                                        event.target.value
                                      )
                                    }
                                    placeholder="群別名稱，如：機械群"
                                    aria-label={`${row.name}班級群別名稱`}
                                    className="input-theme rounded px-3 py-1 text-sm w-40"
                                  />
                                  <span className="text-xs font-bold text-t2">科別</span>
                                  <input
                                    type="text"
                                    maxLength={CLASSES_VOC_CODE_MAX}
                                    value={item.department?.code ?? ""}
                                    onChange={(event) =>
                                      changeVoc(
                                        segment.id,
                                        row.grade,
                                        item.id,
                                        "department",
                                        "code",
                                        event.target.value
                                      )
                                    }
                                    placeholder="科別代碼"
                                    aria-label={`${row.name}班級科別代碼`}
                                    className="input-theme rounded px-3 py-1 text-sm w-28"
                                  />
                                  <input
                                    type="text"
                                    maxLength={CLASSES_VOC_NAME_MAX}
                                    value={item.department?.name ?? ""}
                                    onChange={(event) =>
                                      changeVoc(
                                        segment.id,
                                        row.grade,
                                        item.id,
                                        "department",
                                        "name",
                                        event.target.value
                                      )
                                    }
                                    placeholder="科別名稱，如：機械科"
                                    aria-label={`${row.name}班級科別名稱`}
                                    className="input-theme rounded px-3 py-1 text-sm w-40"
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* 補回年級 */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-themed pt-2 mt-2">
                    <button
                      type="button"
                      onClick={() => addGrade(segment.id)}
                      disabled={free.length === 0 || !stageValid}
                      title={
                        free.length === 0
                          ? "該學制的年級編號已全部建立"
                          : "補回已刪除的年級"
                      }
                      className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      新增年級
                    </button>
                    <span className="text-xs text-t3">
                      {stageValid && range
                        ? `學制「${stageName(segment.stage)}」年級編號 ${range.start}～${range.end}，本段已建立 ${segment.grades.length} 個年級`
                        : "學制未在校務基本資料勾選，請先修正學制"}
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
