"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CLASSES_CODE_MAX,
  CLASSES_GRADE_CODE_MAX,
  CLASSES_GRADE_NAME_MAX,
  CLASSES_MAX_CLASSES_PER_GRADE,
  CLASSES_NAME_MAX,
  CLASSES_VOC_CODE_MAX,
  CLASSES_VOC_NAME_MAX,
  ClassRow,
  GradeRow,
  SchoolClassesContext,
  SchoolClassesSetting,
  SENIOR_HIGH_STAGE,
  VocField,
  contextYearsSum,
  defaultGradeCode,
  defaultGradeName,
  emptyContext,
  freeGradeNumbers,
  gradeRangeOf,
  newClassId,
  newGradeId,
  readSchoolClasses,
  stageName,
  validateSchoolClasses,
} from "@/types/school-classes";
import { StageValue } from "@/types/school-profile";
import {
  SchoolCodesSetting,
  defaultSchoolCodes,
  readSchoolCodes,
} from "@/types/school-codes";

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
  /** 各式代碼表（代碼下拉與名稱帶入的來源；讀取失敗時退回內建官方清單） */
  const [codes, setCodes] = useState<SchoolCodesSetting>(defaultSchoolCodes);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  /** 過場視窗的自動關閉計時器（重新彈出前先清掉舊的） */
  const modalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [res, codesRes] = await Promise.all([
        fetch("/api/admin/school/classes", { cache: "no-store" }),
        fetch("/api/admin/school/codes", { cache: "no-store" }).catch(() => null),
      ]);
      const data: ClassesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.setting) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      const next: SchoolClassesContext = { stages: Array.isArray(data.stages) ? data.stages : [] };
      const setting = readSchoolClasses(data.setting, next);
      setContext(next);
      setSaved(setting);
      setDraft(setting);
      // 代碼表讀不到不擋編輯：退回內建官方清單（只是少了下拉建議）
      if (codesRes && codesRes.ok) {
        const codesData = (await codesRes.json().catch(() => null)) as
          | { success?: boolean; setting?: unknown }
          | null;
        if (codesData?.success && codesData.setting) {
          setCodes(readSchoolCodes(codesData.setting));
        } else {
          setCodes(defaultSchoolCodes());
        }
      } else {
        setCodes(defaultSchoolCodes());
      }
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

  function commit(grades: GradeRow[]) {
    if (!draft) return;
    setModal(null);
    setDraft({ ...draft, grades: [...grades].sort((a, b) => a.grade - b.grade) });
  }

  /** 修改單一年段（＝單一年級，依年級編號定位） */
  function changeGrade(grade: number, updater: (row: GradeRow) => GradeRow) {
    if (!draft) return;
    commit(draft.grades.map((row) => (row.grade === grade ? updater(row) : row)));
  }

  /** 在指定學制建立一個年段：帶入該學制第一個尚未占用的年級編號 */
  function addGradeForStage(stage: StageValue) {
    if (!draft) return;
    const free = freeGradeNumbers(draft, context, stage);
    if (free.length === 0) return;
    const value = free[0];
    const range = gradeRangeOf(context, stage);
    commit([
      ...draft.grades,
      {
        id: newGradeId(),
        grade: value,
        code: defaultGradeCode(value),
        name: defaultGradeName(value, range, draft.nameStyle),
        classes: [],
      },
    ]);
  }

  /** 刪除年段（＝刪除該年級與其下所有班級） */
  function removeGrade(grade: number) {
    if (!draft) return;
    const row = draft.grades.find((item) => item.grade === grade);
    if (!row) return;
    if (
      row.classes.length > 0 &&
      !window.confirm(`確定刪除年段「${row.name}」及其 ${row.classes.length} 個班級？`)
    ) {
      return;
    }
    commit(draft.grades.filter((item) => item.grade !== grade));
  }

  function addClass(grade: number) {
    if (!draft) return;
    const row = draft.grades.find((item) => item.grade === grade);
    if (!row || row.classes.length >= CLASSES_MAX_CLASSES_PER_GRADE) return;
    changeGrade(grade, (item) => ({
      ...item,
      classes: [
        ...item.classes,
        { id: newClassId(), code: "", name: "", group: null, department: null },
      ],
    }));
  }

  function changeClass(grade: number, classId: string, patch: Partial<ClassRow>) {
    changeGrade(grade, (item) => ({
      ...item,
      classes: item.classes.map((row) => (row.id === classId ? { ...row, ...patch } : row)),
    }));
  }

  /**
   * 修改群別／科別的代碼或名稱。
   * 代碼完全比對到代碼表時自動帶入名稱——但僅在名稱目前是空的、
   * 或仍是表內的官方名稱時才覆寫，避免打斷自行改過的名稱。
   */
  function changeVoc(
    grade: number,
    classId: string,
    key: "group" | "department",
    field: "code" | "name",
    value: string
  ) {
    const list = key === "group" ? codes.groups : codes.departments;
    changeGrade(grade, (item) => ({
      ...item,
      classes: item.classes.map((row) => {
        if (row.id !== classId) return row;
        const current: VocField = row[key] ?? { code: "", name: "" };
        const next: VocField = { ...current, [field]: value };
        if (field === "code") {
          const keyword = value.trim();
          const hit = keyword ? list.find((option) => option.code === keyword) : undefined;
          const nameIsPristine =
            !next.name.trim() || list.some((option) => option.name === next.name.trim());
          if (hit && nameIsPristine) next.name = hit.name;
        }
        const merged: VocField | null =
          next.code.trim() || next.name.trim() ? { code: next.code, name: next.name } : null;
        return { ...row, [key]: merged };
      }),
    }));
  }

  /** 調整班級順位：同一年段內前後移動（陣列順序＝儲存的班級順位，日後顯示全年段班級以此排序） */
  function moveClass(grade: number, classId: string, direction: -1 | 1) {
    changeGrade(grade, (item) => {
      const index = item.classes.findIndex((row) => row.id === classId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= item.classes.length) return item;
      const classes = [...item.classes];
      [classes[index], classes[target]] = [classes[target], classes[index]];
      return { ...item, classes };
    });
  }

  function removeClass(grade: number, classId: string) {
    changeGrade(grade, (item) => ({
      ...item,
      classes: item.classes.filter((row) => row.id !== classId),
    }));
  }

  function reset() {
    if (!saved) return;
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

  const yearsSum = contextYearsSum(context);
  /** 年級編號未落在校務基本資料任何學制範圍內的年段（需刪除後才能儲存） */
  const orphanRows = draft.grades.filter((row) =>
    !context.stages.some((item) => {
      const range = gradeRangeOf(context, item.stage);
      return range !== null && row.grade >= range.start && row.grade <= range.end;
    })
  );

  return (
    <div className="mt-4">
      {/* 群別／科別代碼下拉（僅高級中等學校學制用得到；選項取自各式代碼表） */}
      {context.stages.some((item) => item.stage === SENIOR_HIGH_STAGE) && (
        <>
          <datalist id="voc-group-codes">
            {codes.groups.map((option) => (
              <option key={`${option.code}-${option.name}`} value={option.code}>
                {option.code} {option.name}
              </option>
            ))}
          </datalist>
          <datalist id="voc-department-codes">
            {codes.departments.map((option) => (
              <option key={`${option.code}-${option.name}`} value={option.code}>
                {option.code} {option.name}
              </option>
            ))}
          </datalist>
        </>
      )}
      {/* 還原／儲存 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
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
        <div className="sticky-alert mb-2" role="alert">
          <p className="alert-danger px-3 py-2 text-sm">
            <span className="font-bold text-danger">無法儲存：</span>
            {validation.message}
          </p>
        </div>
      )}
      <p className="text-xs text-t3 mb-3">
        {dirty ? "有尚未儲存的變更，記得按「儲存變更」。" : "已與伺服器同步。"}
      </p>

      {/* 年段清單（不加外框與說明文字，各學制分區本身已有框線） */}
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-xs text-t3 ml-auto">年級編號總和 {yearsSum}</span>
      </div>

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

        {context.stages.map((item) => {
          const range = gradeRangeOf(context, item.stage);
          if (!range) return null;
          const rows = draft.grades.filter(
            (row) => row.grade >= range.start && row.grade <= range.end
          );
          const free = freeGradeNumbers(draft, context, item.stage);
          const isSenior = item.stage === SENIOR_HIGH_STAGE;
          return (
            <div key={item.stage} className="border border-themed rounded-lg p-3">
              {/* 學制分區標題列（年段＝年級，學制由年級編號推導，不在此選擇） */}
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-sm font-bold text-t1">{stageName(item.stage)}</span>
                <span className="text-xs text-t3">
                  年級編號 {range.start}～{range.end}（年制 {item.years} 年），已建立{" "}
                  {rows.length} / {item.years} 個年段
                </span>
                <button
                  type="button"
                  onClick={() => addGradeForStage(item.stage)}
                  disabled={free.length === 0}
                  title={
                    free.length === 0 ? "該學制的年級編號已全部建立" : "建立下一個年級的年段"
                  }
                  className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
                >
                  新增年段
                </button>
              </div>

              {isSenior && (
                <p className="text-xs text-t3 mb-2">
                  高級中等學校學制：每班的「群別」「科別」為選填，代碼與名稱需同時填寫；
                  代碼可下拉選自「各式代碼表」（學校基本設定 → 各式代碼表），
                  選定後自動帶入名稱，也可自行輸入表外的代碼與名稱。
                </p>
              )}

              {rows.length === 0 ? (
                <p className="text-xs text-t3">
                  尚未建立年段。按右上「新增年段」即可建立 1 個年段（＝1 個年級），
                  {free.length > 0
                    ? `並帶入年級編號 ${free[0]} 與預設名稱。`
                    : "但該學制的年級編號已全部建立。"}
                </p>
              ) : (
                <div className="space-y-3">
                  {rows.map((row) => {
                    const totalCols = isSenior ? 5 : 3;
                    const tableMin = isSenior ? "min-w-[720px]" : "min-w-[420px]";
                    return (
                      <div key={row.id}>
                        {/* 年段（＝年級）列：獨立一行，不與班級表格同格，避免資料交疊 */}
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-t2 whitespace-nowrap">
                            年級編號 {row.grade}
                          </span>
                          <label className="flex items-center gap-1 text-xs text-t3">
                            年級代碼
                            <input
                              type="text"
                              maxLength={CLASSES_GRADE_CODE_MAX}
                              value={row.code}
                              onChange={(event) =>
                                changeGrade(row.grade, (item) => ({
                                  ...item,
                                  code: event.target.value,
                                }))
                              }
                              aria-label={`${row.name}年級代碼`}
                              className="input-theme rounded px-2 py-1 text-sm w-20"
                            />
                          </label>
                          <label className="flex items-center gap-1 text-xs text-t3">
                            年級名稱
                            <input
                              type="text"
                              maxLength={CLASSES_GRADE_NAME_MAX}
                              value={row.name}
                              onChange={(event) =>
                                changeGrade(row.grade, (item) => ({
                                  ...item,
                                  name: event.target.value,
                                }))
                              }
                              aria-label={`${row.name}年級名稱`}
                              className="input-theme rounded px-2 py-1 text-sm w-28"
                            />
                          </label>
                          <span className="text-xs text-t3">
                            {row.classes.length} 班
                          </span>
                          <div className="flex gap-1 ml-auto">
                            <button
                              type="button"
                              onClick={() => addClass(row.grade)}
                              disabled={
                                row.classes.length >= CLASSES_MAX_CLASSES_PER_GRADE
                              }
                              className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              新增班級
                            </button>
                            <button
                              type="button"
                              onClick={() => removeGrade(row.grade)}
                              className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer"
                            >
                              刪除年段
                            </button>
                          </div>
                          {row.classes.length > 1 && (
                            <span className="text-xs text-t3 basis-full">
                              班級順位＝由上到下的順序（用「前移／後移」調整），
                              日後顯示全年段班級時以此排序。
                            </span>
                          )}
                        </div>

                        {/* 班級表格：每個年段獨立一張，內縮置於年段列之下 */}
                        <div className="overflow-x-auto ml-4 sm:ml-8">
                          <table
                            className={`w-full ${tableMin} text-sm border border-themed`}
                          >
                            <thead>
                              <tr className="bg-hover">
                                <th className="px-2 py-2 text-left text-xs font-bold text-t3 whitespace-nowrap">
                                  班級代碼
                                </th>
                                <th className="px-2 py-2 text-left text-xs font-bold text-t3 whitespace-nowrap">
                                  班級名稱
                                </th>
                                {isSenior && (
                                  <>
                                    <th className="px-2 py-2 text-left text-xs font-bold text-t3 whitespace-nowrap">
                                      群別（代碼／名稱）
                                    </th>
                                    <th className="px-2 py-2 text-left text-xs font-bold text-t3 whitespace-nowrap">
                                      科別（代碼／名稱）
                                    </th>
                                  </>
                                )}
                                <th className="px-2 py-2 text-left text-xs font-bold text-t3 whitespace-nowrap">
                                  操作
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.classes.map((item, classIndex) => (
                              <tr key={item.id} className="border-t border-themed align-top">
                                <td className="px-2 py-2">
                                  <input
                                    type="text"
                                    maxLength={CLASSES_CODE_MAX}
                                    value={item.code}
                                    onChange={(event) =>
                                      changeClass(row.grade, item.id, {
                                        code: event.target.value,
                                      })
                                    }
                                    placeholder="班級代碼"
                                    aria-label={`${row.name}班級代碼`}
                                    className="input-theme rounded px-2 py-1 text-sm w-24"
                                  />
                                </td>
                                <td className="px-2 py-2">
                                  <input
                                    type="text"
                                    maxLength={CLASSES_NAME_MAX}
                                    value={item.name}
                                    onChange={(event) =>
                                      changeClass(row.grade, item.id, {
                                        name: event.target.value,
                                      })
                                    }
                                    placeholder="班級名稱，如：1 年 1 班"
                                    aria-label={`${row.name}班級名稱`}
                                    className="input-theme rounded px-2 py-1 text-sm w-44"
                                  />
                                </td>
                                {isSenior && (
                                  <td className="px-2 py-2">
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="text"
                                        maxLength={CLASSES_VOC_CODE_MAX}
                                        value={item.group?.code ?? ""}
                                        onChange={(event) =>
                                          changeVoc(
                                            row.grade,
                                            item.id,
                                            "group",
                                            "code",
                                            event.target.value
                                          )
                                        }
                                        placeholder="代碼，可下拉選"
                                        aria-label={`${row.name}班級群別代碼`}
                                        list="voc-group-codes"
                                        className="input-theme rounded px-2 py-1 text-sm w-20"
                                      />
                                      <input
                                        type="text"
                                        maxLength={CLASSES_VOC_NAME_MAX}
                                        value={item.group?.name ?? ""}
                                        onChange={(event) =>
                                          changeVoc(
                                            row.grade,
                                            item.id,
                                            "group",
                                            "name",
                                            event.target.value
                                          )
                                        }
                                        placeholder="名稱，如：機械群"
                                        aria-label={`${row.name}班級群別名稱`}
                                        className="input-theme rounded px-2 py-1 text-sm w-28"
                                      />
                                    </div>
                                  </td>
                                )}
                                {isSenior && (
                                  <td className="px-2 py-2">
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="text"
                                        maxLength={CLASSES_VOC_CODE_MAX}
                                        value={item.department?.code ?? ""}
                                        onChange={(event) =>
                                          changeVoc(
                                            row.grade,
                                            item.id,
                                            "department",
                                            "code",
                                            event.target.value
                                          )
                                        }
                                        placeholder="代碼，可下拉選"
                                        aria-label={`${row.name}班級科別代碼`}
                                        list="voc-department-codes"
                                        className="input-theme rounded px-2 py-1 text-sm w-20"
                                      />
                                      <input
                                        type="text"
                                        maxLength={CLASSES_VOC_NAME_MAX}
                                        value={item.department?.name ?? ""}
                                        onChange={(event) =>
                                          changeVoc(
                                            row.grade,
                                            item.id,
                                            "department",
                                            "name",
                                            event.target.value
                                          )
                                        }
                                        placeholder="名稱，如：機械科"
                                        aria-label={`${row.name}班級科別名稱`}
                                        className="input-theme rounded px-2 py-1 text-sm w-28"
                                      />
                                    </div>
                                  </td>
                                )}
                                <td className="px-2 py-2 whitespace-nowrap">
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => moveClass(row.grade, item.id, -1)}
                                      disabled={classIndex === 0}
                                      title="往前調整班級順位"
                                      aria-label={`${item.name || "班級"}往前移動`}
                                      className="btn-theme rounded-lg px-2 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      前移
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => moveClass(row.grade, item.id, 1)}
                                      disabled={classIndex === row.classes.length - 1}
                                      title="往後調整班級順位"
                                      aria-label={`${item.name || "班級"}往後移動`}
                                      className="btn-theme rounded-lg px-2 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      後移
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeClass(row.grade, item.id)}
                                      className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer"
                                    >
                                      移除
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}

                              {row.classes.length === 0 && (
                                <tr className="border-t border-themed">
                                  <td
                                    colSpan={totalCols}
                                    className="px-2 py-2 text-xs text-t3"
                                  >
                                    尚未建立班級。
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {orphanRows.length > 0 && (
          <div className="alert-danger p-4 text-sm mt-3">
            <p className="mb-2">
              以下年段的年級編號超出校務基本資料的學制範圍（年制或勾選的學制已變動），刪除後才能儲存：
            </p>
            <div className="flex flex-wrap gap-2">
              {orphanRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => removeGrade(row.grade)}
                  className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer"
                >
                  刪除年級編號 {row.grade}（{row.name || "未命名"}）
                </button>
              ))}
            </div>
          </div>
        )}

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
