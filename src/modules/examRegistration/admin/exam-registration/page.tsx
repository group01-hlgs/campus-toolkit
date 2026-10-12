"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RevealListCard from "@/components/RevealListCard";
import { useDataSaver } from "@/lib/data-saver";
import { ConfirmModal, FlashModal } from "../../components/exam-feedback";
import type { Flash } from "../../components/exam-feedback";
import {
  EXAM_CATEGORY_LABELS,
  EXAM_EVENT_LIMITS,
  EXAM_EVENT_STATUS_LABELS,
  EXAM_REGISTRATION_MODE_LABELS,
  effectiveExamStatus,
  formatExamDateRange,
  makeSubjectKey,
  parseExamAdvancedOptions,
  parseExamLocationOptions,
} from "../../types/exam-registration";
import type {
  ExamAdvancedOption,
  ExamCategory,
  ExamEvent,
  ExamEventRoster,
  ExamEventType,
  ExamLocationOption,
  ExamMode,
  ExamRegistrationMode,
} from "../../types/exam-registration";

interface AdminListResponse {
  success?: boolean;
  message?: string;
  events?: ExamEvent[];
  epoch?: number;
  total?: number;
  roster?: ExamEventRoster;
}

interface FormSubject {
  key: string;
  label: string;
  enableAdvancedOption: boolean;
  advancedOptionsText: string;
  advancedOptionCodeText: string;
  advancedOptionLabelText: string;
  advancedOptions: ExamAdvancedOption[];
  capacityText: string;
  feeStandardText: string;
  feeReducedText: string;
}

interface FormState {
  id?: string;
  title: string;
  examType: ExamCategory;
  examDate: string;
  /** 考試結束日；""＝單日 */
  examEndDate: string;
  deadlineText: string;
  /** 報名開放時間（datetime-local 字串；必填） */
  registrationOpenAtText: string;
  location: string;
  /** 考試地區批次輸入（每行：代碼,考區名稱；僅 entrance） */
  locationOptionsText: string;
  /** 考試地區單筆輸入：代碼（僅 entrance） */
  locationOptionCodeText: string;
  /** 考試地區單筆輸入：名稱（僅 entrance） */
  locationOptionLabelText: string;
  /** 地點選項（僅 entrance；由單筆／批次新增維護） */
  locationOptions: ExamLocationOption[];
  note: string;
  basicFeeStandardText: string;
  basicFeeReducedText: string;
  grades: string[];
  classes: string[];
  subjects: FormSubject[];
  examMode: ExamMode;
  registrationMode: ExamRegistrationMode;
  status: ExamEventType;
}

interface ClassOption {
  code: string;
  name: string;
}

interface ClassesResponse {
  success?: boolean;
  setting?: { grades?: { code: string; name: string; classes?: ClassOption[] }[] };
}

function emptyForm(): FormState {
  return {
    title: "",
    examType: "mock",
    examDate: "",
    examEndDate: "",
    deadlineText: toDatetimeLocal(defaultDeadline()),
    registrationOpenAtText: "",
    location: "",
    locationOptionsText: "",
    locationOptionCodeText: "",
    locationOptionLabelText: "",
    locationOptions: [],
    note: "",
    basicFeeStandardText: "0",
    basicFeeReducedText: "0",
    grades: [],
    classes: [],
    subjects: [
      {
        key: makeSubjectKey(new Set()),
        label: "",
        enableAdvancedOption: false,
        advancedOptionsText: "",
        advancedOptionCodeText: "",
        advancedOptionLabelText: "",
        advancedOptions: [],
        capacityText: "",
        feeStandardText: "",
        feeReducedText: "",
      },
    ],
    examMode: "review",
    registrationMode: "optional",
    status: "draft",
  };
}

function defaultDeadline(): number {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

function toDatetimeLocal(ms: number): string {
  if (!ms || ms <= 0) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDatetimeLocal(value: string): number {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function sanitizeNonNegativeIntegerInput(value: string): string {
  if (value === "") return "";
  return value.replace(/[^\d]/g, "");
}

function splitCodes(value: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of value.split(/[,、;；\s]+/)) {
    const code = part.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    list.push(code);
  }
  return list;
}

function joinCodes(value: string[]): string {
  return value.join(", ");
}

function normalizeLocationOptions(options: ExamLocationOption[]): ExamLocationOption[] {
  if (!options.length) return [];
  const defaultIndex = Math.max(
    0,
    options.findIndex((option) => option.isDefault === true)
  );
  return options.map((option, index) => ({
    code: option.code,
    label: option.label,
    ...(index === defaultIndex ? { isDefault: true } : {}),
  }));
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}

function parseLocationBatchText(value: string): { ok: true; value: ExamLocationOption[] } | { ok: false; message: string } {
  const lines = value.split(/\r?\n/);
  const list: ExamLocationOption[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) continue;
    const [rawCode = "", ...labelParts] = line.split(",");
    const code = rawCode.trim();
    const label = labelParts.join(",").trim();
    if (!code || !label) {
      return { ok: false, message: `第 ${index + 1} 行格式需為「代碼,考區名稱」` };
    }
    list.push({ code, label });
  }
  return { ok: true, value: list };
}

function parseAdvancedOptionBatchText(value: string): { ok: true; value: ExamAdvancedOption[] } | { ok: false; message: string } {
  const lines = value.split(/\r?\n/);
  const list: ExamAdvancedOption[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) continue;
    const [rawCode = "", ...labelParts] = line.split(",");
    const code = rawCode.trim();
    const label = labelParts.join(",").trim();
    if (!code || !label) {
      return { ok: false, message: `第 ${index + 1} 行格式需為「代碼,進階選項」` };
    }
    list.push({ code, label });
  }
  return { ok: true, value: list };
}

function formatLocationOptionError(message: string): string {
  return message.startsWith("地點") ? `考試${message}` : message;
}

function formatNumberedNote(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+\.\s*/, ""));
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
}

function formatListDateTime(value: number): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 清單上建議的下一個狀態（與狀態機一致） */
function nextStatusOf(status: ExamEventType): ExamEventType | null {
  if (status === "draft") return "open";
  if (status === "open") return "closed";
  if (status === "closed") return "archived";
  return null;
}

/**
 * 升學考試與模擬考校內報名（僅被指派 examRegistration 的管理員）。
 * 版面：建立／編輯場次（預設收合）→ 場次清單（狀態篩選、狀態轉換、名單）→ 名單與統計。
 * 場次清單依系統「省流開關」：啟用時進頁不載入，按鈕才載入（同公告／行事曆）。
 */
export default function AdminExamRegistrationPage() {
  const { ready: settingsReady, saverOn } = useDataSaver();
  const [items, setItems] = useState<ExamEvent[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const gating = saverOn && !listLoaded;
  const [loadingList, setLoadingList] = useState(false);
  const [listCount, setListCount] = useState<number | null>(null);
  const [loadingListCount, setLoadingListCount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [classOptions, setClassOptions] = useState<Record<string, ClassOption[]> | null>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ExamEventType>("all");
  // 清單分頁（純前端切片，不增加任何 Firestore 讀取；同帳號／名冊清單）
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [roster, setRoster] = useState<ExamEventRoster | null>(null);
  const [loadingRoster, setLoadingRoster] = useState(false);
  /** 主題化確認框（取代 window.confirm）：text 顯示、danger 決定確定鈕樣式、onConfirm 確定時執行 */
  const [confirm, setConfirm] = useState<{
    text: string;
    danger: boolean;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(timer);
  }, [flash]);

  // 年級／班級選項：需「學校基本設定」權限，讀不到就退回手動輸入代碼
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/school/classes", { cache: "no-store" });
        const data: ClassesResponse | null = await res.json().catch(() => null);
        if (cancelled || !res.ok || !data?.success) return;
        const map: Record<string, ClassOption[]> = {};
        for (const grade of data.setting?.grades ?? []) {
          map[grade.code] = grade.classes ?? [];
        }
        setClassOptions(map);
      } catch {
        // 無權限或讀取失敗：改用手動輸入年級／班級代碼
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/admin/exam-registration", { cache: "no-store" });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (data?.success) {
        setItems(data.events ?? []);
        setListCount(data.total ?? data.events?.length ?? 0);
        setListLoaded(true);
      } else {
        setFlash({ type: "error", text: data?.message || "載入場次失敗" });
      }
    } catch {
      setFlash({ type: "error", text: "載入場次失敗" });
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadListCount = useCallback(async () => {
    setLoadingListCount(true);
    try {
      const res = await fetch("/api/admin/exam-registration?summary=count", { cache: "no-store" });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (data?.success && typeof data.total === "number") {
        setListCount(data.total);
      }
    } finally {
      setLoadingListCount(false);
    }
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    if (gating || listLoaded) return;
    void loadList();
  }, [settingsReady, gating, listLoaded, loadList]);

  useEffect(() => {
    if (!settingsReady || !gating) return;
    void loadListCount();
  }, [settingsReady, gating, loadListCount]);

  function applyList(data: AdminListResponse) {
    if (!data.events) return;
    setListCount(data.events.length);
    if (listLoaded) setItems(data.events);
  }

  function addLocationOption() {
    const code = form.locationOptionCodeText.trim();
    const label = form.locationOptionLabelText.trim();
    if (!code || !label) {
      setFlash({ type: "error", text: "請輸入考試地區代碼與名稱" });
      return;
    }
    const parsed = parseExamLocationOptions([...form.locationOptions, { code, label }]);
    if (!parsed.ok) {
      setFlash({ type: "error", text: formatLocationOptionError(parsed.message) });
      return;
    }
    setForm((prev) => ({
      ...prev,
      locationOptions: normalizeLocationOptions(parsed.value),
      locationOptionCodeText: "",
      locationOptionLabelText: "",
    }));
  }

  function applyLocationBatch() {
    const batch = parseLocationBatchText(form.locationOptionsText);
    if (!batch.ok) {
      setFlash({ type: "error", text: batch.message });
      return;
    }
    if (!batch.value.length) {
      setFlash({ type: "error", text: "請先輸入批次內容" });
      return;
    }
    const parsed = parseExamLocationOptions([...form.locationOptions, ...batch.value]);
    if (!parsed.ok) {
      setFlash({ type: "error", text: formatLocationOptionError(parsed.message) });
      return;
    }
    setForm((prev) => ({
      ...prev,
      locationOptions: normalizeLocationOptions(parsed.value),
      locationOptionsText: "",
    }));
  }

  function removeLocationOption(index: number) {
    setForm((prev) => ({
      ...prev,
      locationOptions: normalizeLocationOptions(prev.locationOptions.filter((_, i) => i !== index)),
    }));
  }

  function moveLocationOption(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    setForm((prev) => ({
      ...prev,
      locationOptions: normalizeLocationOptions(moveItem(prev.locationOptions, index, target)),
    }));
  }

  function setLocationOptionDefault(index: number) {
    const selected = form.locationOptions[index];
    if (!selected) return;
    setForm((prev) => ({
      ...prev,
      locationOptions: normalizeLocationOptions(
        prev.locationOptions.map((option, i) => ({ ...option, isDefault: i === index }))
      ),
    }));
    setFlash({ type: "success", text: `已將「${selected.label}」設為預設考區` });
  }

  function addAdvancedOption(subjectIndex: number) {
    const subject = form.subjects[subjectIndex];
    if (!subject) return;
    const code = subject.advancedOptionCodeText.trim();
    const label = subject.advancedOptionLabelText.trim();
    if (!code || !label) {
      setFlash({ type: "error", text: "請輸入進階選項代碼與名稱" });
      return;
    }
    const parsed = parseExamAdvancedOptions([...subject.advancedOptions, { code, label }]);
    if (!parsed.ok) {
      setFlash({ type: "error", text: parsed.message });
      return;
    }
    setForm((prev) => ({
      ...prev,
      subjects: prev.subjects.map((item, index) =>
        index === subjectIndex
          ? {
              ...item,
              advancedOptions: parsed.value,
              advancedOptionCodeText: "",
              advancedOptionLabelText: "",
            }
          : item
      ),
    }));
  }

  function applyAdvancedOptionBatch(subjectIndex: number) {
    const subject = form.subjects[subjectIndex];
    if (!subject) return;
    const batch = parseAdvancedOptionBatchText(subject.advancedOptionsText);
    if (!batch.ok) {
      setFlash({ type: "error", text: batch.message });
      return;
    }
    if (!batch.value.length) {
      setFlash({ type: "error", text: "請先輸入批次內容" });
      return;
    }
    const parsed = parseExamAdvancedOptions([...subject.advancedOptions, ...batch.value]);
    if (!parsed.ok) {
      setFlash({ type: "error", text: parsed.message });
      return;
    }
    setForm((prev) => ({
      ...prev,
      subjects: prev.subjects.map((item, index) =>
        index === subjectIndex
          ? {
              ...item,
              advancedOptions: parsed.value,
              advancedOptionsText: "",
            }
          : item
      ),
    }));
  }

  function removeAdvancedOption(subjectIndex: number, optionIndex: number) {
    setForm((prev) => ({
      ...prev,
      subjects: prev.subjects.map((item, index) =>
        index === subjectIndex
          ? { ...item, advancedOptions: item.advancedOptions.filter((_, i) => i !== optionIndex) }
          : item
      ),
    }));
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const subjects: ExamEvent["subjects"] = [];
    for (const subject of form.subjects) {
      const label = subject.label.trim();
      if (!label) continue;
      const capacity = Number(subject.capacityText);
      const feeStandard = Number(subject.feeStandardText);
      const feeReduced = Number(subject.feeReducedText);
      const entry: ExamEvent["subjects"][number] = {
        key: subject.key,
        label,
      };
      const parsedAdvancedOptions = parseExamAdvancedOptions(subject.advancedOptions);
      if (!parsedAdvancedOptions.ok) {
        setFlash({ type: "error", text: `科目「${label}」的進階選項${parsedAdvancedOptions.message}` });
        return;
      }
      if (subject.enableAdvancedOption) {
        if (!parsedAdvancedOptions.value.length) {
          setFlash({ type: "error", text: `科目「${label}」啟用進階選項時，請至少新增一個進階選項` });
          return;
        }
        entry.enableAdvancedOption = true;
        entry.advancedOptions = parsedAdvancedOptions.value;
      }
      if (subject.capacityText.trim() !== "" && Number.isInteger(capacity) && capacity > 0) {
        entry.capacity = capacity;
      }
      if (subject.feeStandardText.trim() !== "" && Number.isInteger(feeStandard) && feeStandard > 0) {
        entry.feeStandard = feeStandard;
      }
      if (subject.feeReducedText.trim() !== "" && Number.isInteger(feeReduced) && feeReduced > 0) {
        entry.feeReduced = feeReduced;
      }
      subjects.push(entry);
    }
    for (const subject of subjects) {
      if (subject.capacity !== undefined && subject.capacity > EXAM_EVENT_LIMITS.subjectCapacityMax) {
        setFlash({
          type: "error",
          text: `科目「${subject.label}」名額上限過大（最多 ${EXAM_EVENT_LIMITS.subjectCapacityMax}）`,
        });
        return;
      }
    }
    if (subjects.length < EXAM_EVENT_LIMITS.subjectsMin) {
      setFlash({ type: "error", text: "請至少輸入一個科目名稱" });
      return;
    }
    if (subjects.length > EXAM_EVENT_LIMITS.subjectsMax) {
      setFlash({
        type: "error",
        text: `科目最多 ${EXAM_EVENT_LIMITS.subjectsMax} 項（目前 ${subjects.length} 項）`,
      });
      return;
    }
    if (!form.grades.length) {
      setFlash({ type: "error", text: "請至少指定一個年級" });
      return;
    }
    const deadline = parseDatetimeLocal(form.deadlineText);
    if (!deadline) {
      setFlash({ type: "error", text: "請設定報名截止時間" });
      return;
    }
    if (form.status === "open" && deadline <= Date.now()) {
      setFlash({ type: "error", text: "開放報名狀態的截止時間必須晚於現在" });
      return;
    }
    // 考試結束日須 >= 起日（空＝單日）
    if (form.examEndDate && form.examDate && form.examEndDate < form.examDate) {
      setFlash({ type: "error", text: "考試結束日不可早於開始日" });
      return;
    }
    const registrationOpenAt = parseDatetimeLocal(form.registrationOpenAtText);
    if (!registrationOpenAt) {
      setFlash({ type: "error", text: "請設定報名開放時間" });
      return;
    }
    if (registrationOpenAt >= deadline) {
      setFlash({ type: "error", text: "報名開放時間須早於報名截止時間" });
      return;
    }
    // 考試地區（僅升學考試）
    let locationOptions: ExamLocationOption[] = [];
    let location = form.location;
    if (form.examType === "entrance") {
      const parsedLocationOptions = parseExamLocationOptions(form.locationOptions);
      if (!parsedLocationOptions.ok) {
        setFlash({ type: "error", text: formatLocationOptionError(parsedLocationOptions.message) });
        return;
      }
      locationOptions = normalizeLocationOptions(parsedLocationOptions.value);
      location = "";
    } else {
      location = "";
      locationOptions = [];
    }
    const basicFeeStandard = Number(form.basicFeeStandardText);
    const basicFeeReduced = Number(form.basicFeeReducedText);
    if (!Number.isInteger(basicFeeStandard) || basicFeeStandard < 0 || !Number.isInteger(basicFeeReduced) || basicFeeReduced < 0) {
      setFlash({ type: "error", text: "基本費用數值無效（需 0 以上整數）" });
      return;
    }

    const normalizedNote = formatNumberedNote(form.note);

    setSaving(true);
    setFlash(null);
    try {
      const payload = {
        id: form.id,
        title: form.title,
        examType: form.examType,
        examDate: form.examDate,
        examEndDate: form.examEndDate,
        location,
        locationOptions,
        note: normalizedNote,
        deadline,
        registrationOpenAt,
        subjects,
        target: { grades: form.grades, classes: form.classes },
        basicFee: { standard: basicFeeStandard, reduced: basicFeeReduced },
        examMode: "review",
        registrationMode: form.registrationMode,
        status: form.status,
      };
      const res = await fetch("/api/admin/exam-registration", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "儲存失敗");
      applyList(data);
      setForm(emptyForm());
      setFormOpen(false);
      setRoster(null);
      setFlash({ type: "success", text: data.message || "已儲存" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "儲存失敗" });
    } finally {
      setSaving(false);
    }
  }

  async function patchStatus(item: ExamEvent, status: ExamEventType) {
    if (saving) return;
    const label = EXAM_EVENT_STATUS_LABELS[status];
    const confirmText =
      status === "open"
        ? `確定要「${label}」？\n開放時會同步發佈系統公告並寫入學生行事曆。`
        : status === "archived"
          ? "確定要封存？\n封存後不可再變更狀態。"
          : `確定要將場次改為「${label}」？`;
    setConfirm({
      text: confirmText,
      danger: status === "archived",
      confirmLabel: label,
      onConfirm: () => void runPatchStatus(item, status),
    });
  }

  async function runPatchStatus(item: ExamEvent, status: ExamEventType) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/exam-registration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, status }),
      });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "操作失敗");
      applyList(data);
      setRoster((prev) => (prev && prev.eventId === item.id ? null : prev));
      setFlash({ type: "success", text: data.message || "已更新" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "操作失敗" });
    } finally {
      setSaving(false);
    }
  }

  /** 硬刪除場次（僅無登錄可刪；伺服端 409 會擋有登錄的場次） */
  function deleteEvent(item: ExamEvent) {
    if (saving) return;
    setConfirm({
      text:
        `確定要刪除「${item.title}」？\n\n` +
        "⚠️ 刪除不可恢復——將連同該場次全部學生登錄名單一併刪除。\n" +
        "若此場次曾「開放報名」，系統公告與學生行事曆不會自動撤回，請到公告管理與行事曆管理另行封存/取消。",
      danger: true,
      confirmLabel: "刪除",
      onConfirm: () => void runDeleteEvent(item),
    });
  }

  async function runDeleteEvent(item: ExamEvent) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/exam-registration?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "刪除失敗");
      applyList(data);
      setRoster((prev) => (prev && prev.eventId === item.id ? null : prev));
      setForm((prev) => (prev.id === item.id ? emptyForm() : prev));
      if (form.id === item.id) setFormOpen(false);
      setFlash({ type: "success", text: data.message || "已刪除" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "刪除失敗" });
    } finally {
      setSaving(false);
    }
  }

  function edit(item: ExamEvent) {
    const isEntrance = item.examType === "entrance";
    setForm({
      id: item.id,
      title: item.title,
      examType: item.examType,
      examDate: item.examDate,
      examEndDate: item.examEndDate ?? "",
      deadlineText: toDatetimeLocal(item.deadline),
      registrationOpenAtText: item.registrationOpenAt ? toDatetimeLocal(item.registrationOpenAt) : "",
      location: isEntrance ? item.location : "",
      locationOptionsText: "",
      locationOptionCodeText: "",
      locationOptionLabelText: "",
      locationOptions: isEntrance ? normalizeLocationOptions(item.locationOptions ?? []) : [],
      note: item.note,
      basicFeeStandardText: String(item.basicFee.standard),
      basicFeeReducedText: String(item.basicFee.reduced),
      grades: [...item.target.grades],
      classes: [...item.target.classes],
      subjects: item.subjects.map((subject) => ({
        key: subject.key,
        label: subject.label,
        enableAdvancedOption: subject.enableAdvancedOption === true,
        advancedOptionsText: "",
        advancedOptionCodeText: "",
        advancedOptionLabelText: "",
        advancedOptions: subject.advancedOptions ?? [],
        capacityText: subject.capacity ? String(subject.capacity) : "",
        feeStandardText: subject.feeStandard ? String(subject.feeStandard) : "",
        feeReducedText: subject.feeReduced ? String(subject.feeReduced) : "",
      })),
      examMode: "review",
      registrationMode: item.registrationMode,
      status: item.status,
    });
    setFormOpen(true);
    setRoster(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setForm(emptyForm());
    setFormOpen(false);
  }

  async function loadRoster(eventId: string) {
    if (loadingRoster) return;
    setLoadingRoster(true);
    try {
      const res = await fetch(
        `/api/admin/exam-registration?eventId=${encodeURIComponent(eventId)}`,
        { cache: "no-store" }
      );
      const data: AdminListResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.roster) {
        throw new Error(data?.message || "載入名單失敗");
      }
      setRoster(data.roster);
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "載入名單失敗" });
    } finally {
      setLoadingRoster(false);
    }
  }

  function toggleCode(list: string[], code: string): string[] {
    return list.includes(code) ? list.filter((item) => item !== code) : [...list, code];
  }

  function subjectEditor(index: number, label: string) {
    setForm((prev) => ({
      ...prev,
      subjects: prev.subjects.map((item, i) => (i === index ? { ...item, label } : item)),
    }));
  }

  function capacityEditor(index: number, capacityText: string) {
    setForm((prev) => ({
      ...prev,
      subjects: prev.subjects.map((item, i) => (i === index ? { ...item, capacityText } : item)),
    }));
  }

  function subjectFeeEditor(index: number, field: "feeStandardText" | "feeReducedText", value: string) {
    const sanitized = sanitizeNonNegativeIntegerInput(value);
    setForm((prev) => ({
      ...prev,
      subjects: prev.subjects.map((item, i) => (i === index ? { ...item, [field]: sanitized } : item)),
    }));
  }

  const searchKeyword = keyword.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!searchKeyword) return true;
      const haystack =
        `${item.title}\n${item.location}\n${(item.locationOptions ?? []).map((o) => `${o.code} ${o.label}`).join("\n")}\n${item.subjects.map((s) => s.label).join("\n")}\n${item.createdBy.name}`.toLowerCase();
      return haystack.includes(searchKeyword);
    });
  }, [items, statusFilter, searchKeyword]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedItems = useMemo(
    () => filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredItems, currentPage, pageSize]
  );

  // 篩選條件變動時回到第一頁
  useEffect(() => {
    setPage(1);
  }, [keyword, statusFilter]);

  const targetText = (item: ExamEvent) =>
    `${item.target.grades.join("、") || "—"} 年級${
      item.target.classes.length ? `（${item.target.classes.join("、")}）` : "（全年級）"
    }`;

  return (
    <div className="w-full max-w-4xl mb-8 space-y-6">
      <FlashModal flash={flash} onDismiss={() => setFlash(null)} />
      {confirm && (
        <ConfirmModal
          text={confirm.text}
          danger={confirm.danger}
          confirmLabel={confirm.confirmLabel}
          onConfirm={() => {
            const action = confirm.onConfirm;
            setConfirm(null);
            action();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* 1. 建立／編輯場次（預設收合） */}
      <section className="border border-themed rounded-lg bg-card">
        <button
          type="button"
          onClick={() => (formOpen ? cancelEdit() : setFormOpen(true))}
          aria-expanded={formOpen}
          className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer"
        >
          <h3 className="text-lg font-bold text-t1">{form.id ? "編輯場次" : "建立場次"}</h3>
          <span className="text-t3 text-sm shrink-0">
            {formOpen ? "收合" : "展開"} {formOpen ? "▲" : "▼"}
          </span>
        </button>
        {formOpen && (
          <div className="px-5 pt-2.5 pb-5">
            <form onSubmit={submitForm} className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="exam-title">
                  場次名稱
                </label>
                <input
                  id="exam-title"
                  className="flex-1 input-theme rounded px-3 py-2"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  maxLength={EXAM_EVENT_LIMITS.title}
                  placeholder="例如：115 學年度模擬考（第一次）"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="exam-type">
                  考試類型
                </label>
                <select
                  id="exam-type"
                  className="flex-1 input-theme rounded px-3 py-2"
                  value={form.examType}
                  onChange={(e) => {
                    const examType = e.target.value as ExamCategory;
                    setForm({
                      ...form,
                      examType,
                      ...(examType !== "entrance"
                        ? {
                            location: "",
                            locationOptions: [],
                            locationOptionsText: "",
                            locationOptionCodeText: "",
                            locationOptionLabelText: "",
                          }
                        : {}),
                    });
                  }}
                >
                  {(Object.keys(EXAM_CATEGORY_LABELS) as ExamCategory[]).map((key) => (
                    <option key={key} value={key}>
                      {EXAM_CATEGORY_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="exam-date">
                  考試日期
                </label>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    id="exam-date"
                    type="date"
                    className="input-theme rounded px-3 py-2"
                    value={form.examDate}
                    onChange={(e) => setForm({ ...form, examDate: e.target.value })}
                    required
                  />
                  <span className="text-t3 text-sm shrink-0">～</span>
                  <input
                    type="date"
                    className="input-theme rounded px-3 py-2"
                    value={form.examEndDate}
                    min={form.examDate || undefined}
                    onChange={(e) => setForm({ ...form, examEndDate: e.target.value })}
                    aria-label="考試結束日（留空＝單日）"
                    placeholder="結束日"
                  />
                  <span className="text-xs text-t3 shrink-0">訖（留空＝單日）</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="exam-open-at">
                  報名期間
                </label>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    id="exam-open-at"
                    type="datetime-local"
                    className="input-theme rounded px-3 py-2"
                    value={form.registrationOpenAtText}
                    onChange={(e) => setForm({ ...form, registrationOpenAtText: e.target.value })}
                    required
                  />
                  <span className="text-t3 text-sm shrink-0">～</span>
                  <input
                    id="exam-deadline"
                    type="datetime-local"
                    className="input-theme rounded px-3 py-2"
                    value={form.deadlineText}
                    onChange={(e) => setForm({ ...form, deadlineText: e.target.value })}
                    required
                  />
                  <span className="text-xs text-t3 shrink-0">開放與截止皆為必填</span>
                </div>
              </div>

              {form.examType === "entrance" && (
                <>
                <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                  <label className="text-t2 sm:w-40 shrink-0" htmlFor="exam-location-option-code">
                    考試地區
                  </label>
                  <div className="flex-1 space-y-2">
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-t2">單筆新增</div>
                      <div className="flex flex-col lg:flex-row gap-2">
                        <input
                          id="exam-location-option-code"
                          className="input-theme rounded px-3 py-2 lg:w-40"
                          value={form.locationOptionCodeText}
                          onChange={(e) => setForm({ ...form, locationOptionCodeText: e.target.value })}
                          placeholder="代碼（例：100）"
                          maxLength={EXAM_EVENT_LIMITS.locationCode}
                        />
                        <input
                          className="input-theme rounded px-3 py-2 flex-1"
                          value={form.locationOptionLabelText}
                          onChange={(e) => setForm({ ...form, locationOptionLabelText: e.target.value })}
                          placeholder="考區名稱（例：台北）"
                          maxLength={EXAM_EVENT_LIMITS.locationLabel}
                        />
                        <button
                          type="button"
                          className="btn-theme px-3 py-2 rounded text-sm shrink-0"
                          onClick={addLocationOption}
                        >
                          + 新增考區
                        </button>
                      </div>
                      {form.locationOptions.length > 0 ? (
                        <div className="space-y-1">
                          {form.locationOptions.map((option, index) => (
                            <div key={option.code} className="flex items-center gap-2 text-sm">
                              <span className="text-t3 w-5 text-right">{index + 1}</span>
                              <input
                                className="input-theme rounded px-2 py-1 w-24"
                                value={option.code}
                                readOnly
                                aria-label={`考試地區代碼 ${option.code}`}
                              />
                              <input
                                className="input-theme rounded px-2 py-1 flex-1"
                                value={option.label}
                                readOnly
                                aria-label={`考試地區名稱 ${option.label}`}
                              />
                              <button
                                type="button"
                                className={`px-2 py-1 rounded shrink-0 ${
                                  option.isDefault ? "btn-theme" : "btn-soft"
                                }`}
                                onClick={() => setLocationOptionDefault(index)}
                                aria-label={option.isDefault ? `預設考區：${option.label}` : `將 ${option.label} 設為預設`}
                                title={option.isDefault ? "目前預設" : "設為預設"}
                              >
                                {option.isDefault ? (
                                  <svg viewBox="0 0 20 20" className="w-4 h-4" aria-hidden="true">
                                    <path
                                      d="M10 2.4L12.35 7.16L17.6 7.92L13.8 11.63L14.7 16.86L10 14.39L5.3 16.86L6.2 11.63L2.4 7.92L7.65 7.16L10 2.4Z"
                                      fill="currentColor"
                                    />
                                  </svg>
                                ) : (
                                  <svg viewBox="0 0 20 20" className="w-4 h-4" aria-hidden="true">
                                    <path
                                      d="M10 2.4L12.35 7.16L17.6 7.92L13.8 11.63L14.7 16.86L10 14.39L5.3 16.86L6.2 11.63L2.4 7.92L7.65 7.16L10 2.4Z"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.6"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                )}
                              </button>
                              <button
                                type="button"
                                className="text-t3 hover:text-t1 shrink-0"
                                onClick={() => moveLocationOption(index, "up")}
                                disabled={index === 0}
                                aria-label={`上移 ${option.label}`}
                                title="上移"
                              >
                                <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                  <path d="M10 4L4 10H8V16H12V10H16L10 4Z" fill="currentColor" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="text-t3 hover:text-t1 shrink-0"
                                onClick={() => moveLocationOption(index, "down")}
                                disabled={index === form.locationOptions.length - 1}
                                aria-label={`下移 ${option.label}`}
                                title="下移"
                              >
                                <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                  <path d="M10 16L16 10H12V4H8V10H4L10 16Z" fill="currentColor" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="text-danger/80 hover:text-danger shrink-0"
                                onClick={() => removeLocationOption(index)}
                                aria-label={`刪除 ${option.label}`}
                                title="刪除"
                              >
                                <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                  <path
                                    d="M7 3.5H13L14 5H17V7H3V5H6L7 3.5ZM5 8H15L14.2 16.2C14.15 16.75 13.69 17.17 13.14 17.17H6.86C6.31 17.17 5.85 16.75 5.8 16.2L5 8ZM8 10V15H9.5V10H8ZM10.5 10V15H12V10H10.5Z"
                                    fill="currentColor"
                                  />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-t3">尚未新增考區（可留空，表示試場由主辦單位分配）</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-t2">批次新增</div>
                    <textarea
                      id="exam-location-options-text"
                      className="w-full input-theme rounded px-3 py-2 min-h-24"
                      value={form.locationOptionsText}
                      onChange={(e) => setForm({ ...form, locationOptionsText: e.target.value })}
                      placeholder={"110,臺北\n250,板橋、土城"}
                    />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="btn-theme px-3 py-1.5 rounded text-xs"
                          onClick={applyLocationBatch}
                        >
                          套用為單筆新增
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-t3">
                      單筆新增與批次新增會合併，不可重複；每行一筆格式「代碼,考區名稱」
                    </p>
                  </div>
                </div>
                </>
              )}

              <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="exam-note">
                  備註（選填）
                </label>
                <textarea
                  id="exam-note"
                  className="flex-1 input-theme rounded px-3 py-2 min-h-20"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  maxLength={EXAM_EVENT_LIMITS.note}
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-start gap-2 -mt-1">
                <span className="text-t2 sm:w-40 shrink-0" />
                <p className="text-xs text-t3 flex-1">
                  說明：按 Enter 斷行後，系統會自動依序編號為 1.、2.、3.…
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-t2 sm:w-40 shrink-0">基本費用</span>
                <div className="flex-1 flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-sm text-t1">
                    一般生
                    <input
                      type="number"
                      min={0}
                      max={EXAM_EVENT_LIMITS.fee}
                      step={1}
                      inputMode="numeric"
                      className="input-theme rounded px-2 py-1 w-24"
                      value={form.basicFeeStandardText}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          basicFeeStandardText: sanitizeNonNegativeIntegerInput(e.target.value),
                        })
                      }
                      aria-label="基本費用（一般生）"
                    />
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-sm text-t1">
                    中低收入戶
                    <input
                      type="number"
                      min={0}
                      max={EXAM_EVENT_LIMITS.fee}
                      step={1}
                      inputMode="numeric"
                      className="input-theme rounded px-2 py-1 w-24"
                      value={form.basicFeeReducedText}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          basicFeeReducedText: sanitizeNonNegativeIntegerInput(e.target.value),
                        })
                      }
                      aria-label="基本費用（中低收入戶）"
                    />
                  </label>
                  <span className="text-xs text-t3">低收入戶免繳</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-start gap-2 -mt-1">
                <span className="text-t2 sm:w-40 shrink-0" />
                <p className="text-xs text-t3 flex-1">
                  僅能填寫 0 或正整數，不收基本費時填0
                </p>
              </div>

              {/* 適用對象：年級（必填）＋班級（選填＝全年級） */}
              <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                <span className="text-t2 sm:w-40 shrink-0">適用對象</span>
                <div className="flex-1 space-y-3">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-t2">年級</div>
                    {classOptions ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {Object.entries(classOptions).map(([code, classes]) => (
                          <label
                            key={code}
                            className="inline-flex items-center gap-1.5 text-sm text-t1"
                            title={`班級：${classes.map((item) => item.name).join("、") || "尚未設定"}`}
                          >
                            <input
                              type="checkbox"
                              checked={form.grades.includes(code)}
                              onChange={() =>
                                setForm({ ...form, grades: toggleCode(form.grades, code) })
                              }
                            />
                            {code}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <input
                        className="w-full input-theme rounded px-3 py-2"
                        value={joinCodes(form.grades)}
                        onChange={(e) => setForm({ ...form, grades: splitCodes(e.target.value) })}
                        placeholder="年級代碼，例：1, 2, 3"
                      />
                    )}
                    <p className="text-xs text-t3">
                      年級代碼須與名冊「年級」欄一致；未取得班級清單時可直接輸入代碼（逗號分隔）
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-t2">班級</div>
                    {classOptions && Object.keys(classOptions).length ? (
                      <div className="space-y-2">
                        {form.grades.map((gradeCode) => (
                          <div key={gradeCode} className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-t2 w-8 shrink-0">{gradeCode}</span>
                            {(classOptions[gradeCode] ?? []).map((item) => (
                              <label
                                key={item.code}
                                className="inline-flex items-center gap-1 text-xs text-t1"
                              >
                                <input
                                  type="checkbox"
                                  checked={form.classes.includes(item.code)}
                                  onChange={() =>
                                    setForm({ ...form, classes: toggleCode(form.classes, item.code) })
                                  }
                                />
                                {item.name}
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <input
                        className="w-full input-theme rounded px-3 py-2"
                        value={joinCodes(form.classes)}
                        onChange={(e) => setForm({ ...form, classes: splitCodes(e.target.value) })}
                        placeholder="班級代碼，例：101, 102（留空＝該年級全體）"
                      />
                    )}
                    <p className="text-xs text-t3">未勾選＝該年級全體；勾選＝僅這些班可見</p>
                  </div>
                </div>
              </div>

              {/* 科目（1～15 項） */}
              <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                <span className="text-t2 sm:w-40 shrink-0">選考科目</span>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-t2">
                    <span className="w-5 shrink-0" />
                    <span className="w-[150px] shrink-0">科目名稱</span>
                    <span className="w-[72px] shrink-0 text-center">進階選項</span>
                    <span className="w-[75px] shrink-0">一般生</span>
                    <span className="w-[75px] shrink-0">中低收入戶</span>
                    <span className="w-10 shrink-0" />
                  </div>
                  {form.subjects.map((subject, index) => (
                    <div key={subject.key} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-t3 w-5 shrink-0 text-center">{index + 1}</span>
                        <input
                          className="h-8 w-[150px] min-w-0 input-theme rounded px-2 py-1"
                          value={subject.label}
                          onChange={(e) => subjectEditor(index, e.target.value)}
                          maxLength={EXAM_EVENT_LIMITS.subjectLabel}
                          placeholder="例：國文"
                          aria-label={`第 ${index + 1} 科科目名稱`}
                        />
                        <label className="w-[72px] shrink-0 inline-flex justify-center">
                          <input
                            type="checkbox"
                            checked={subject.enableAdvancedOption}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                subjects: prev.subjects.map((item, i) =>
                                  i === index ? { ...item, enableAdvancedOption: e.target.checked } : item
                                ),
                              }))
                            }
                            aria-label={`第 ${index + 1} 科啟用進階選項`}
                          />
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={EXAM_EVENT_LIMITS.fee}
                          className="h-8 input-theme rounded px-2 py-1 w-[75px] text-xs"
                          value={subject.feeStandardText || "0"}
                          onChange={(e) => subjectFeeEditor(index, "feeStandardText", e.target.value)}
                          aria-label={`第 ${index + 1} 科一般生費用`}
                        />
                        <input
                          type="number"
                          min={0}
                          max={EXAM_EVENT_LIMITS.fee}
                          className="h-8 input-theme rounded px-2 py-1 w-[75px] text-xs"
                          value={subject.feeReducedText || "0"}
                          onChange={(e) => subjectFeeEditor(index, "feeReducedText", e.target.value)}
                          aria-label={`第 ${index + 1} 科中低收入戶費用`}
                        />
                        <button
                          type="button"
                          className="text-xs text-t3 hover:text-danger cursor-pointer px-1 w-10 shrink-0"
                          disabled={form.subjects.length <= 1}
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              subjects: prev.subjects.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          刪除
                        </button>
                      </div>
                      {subject.enableAdvancedOption && (
                        <div className="ml-7 rounded border border-themed p-2 space-y-2">
                          <div className="text-xs font-medium text-t2">第 {index + 1} 科進階選項</div>
                          <div className="flex flex-col lg:flex-row gap-2">
                            <input
                              className="h-8 input-theme rounded px-2 py-1 lg:w-40 text-xs"
                              value={subject.advancedOptionCodeText}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  subjects: prev.subjects.map((item, i) =>
                                    i === index ? { ...item, advancedOptionCodeText: e.target.value } : item
                                  ),
                                }))
                              }
                              placeholder="代碼（例：0101）"
                              maxLength={EXAM_EVENT_LIMITS.advancedOptionCode}
                            />
                            <input
                              className="h-8 input-theme rounded px-2 py-1 flex-1 text-xs"
                              value={subject.advancedOptionLabelText}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  subjects: prev.subjects.map((item, i) =>
                                    i === index ? { ...item, advancedOptionLabelText: e.target.value } : item
                                  ),
                                }))
                              }
                              placeholder="進階選項（例：鋼琴）"
                              maxLength={EXAM_EVENT_LIMITS.advancedOptionLabel}
                            />
                            <button
                              type="button"
                              className="btn-theme h-8 px-3 py-1 rounded text-xs shrink-0"
                              onClick={() => addAdvancedOption(index)}
                            >
                              + 新增進階選項
                            </button>
                          </div>
                          {subject.advancedOptions.length > 0 ? (
                            <div className="space-y-1">
                              {subject.advancedOptions.map((option, optionIndex) => (
                                <div key={option.code} className="flex items-center gap-2 text-xs">
                                  <span className="text-t3 w-5 text-right">{optionIndex + 1}</span>
                                  <input
                                    className="h-8 input-theme rounded px-2 py-1 w-24"
                                    value={option.code}
                                    readOnly
                                    aria-label={`第 ${index + 1} 科進階選項代碼 ${option.code}`}
                                  />
                                  <input
                                    className="h-8 input-theme rounded px-2 py-1 flex-1"
                                    value={option.label}
                                    readOnly
                                    aria-label={`第 ${index + 1} 科進階選項名稱 ${option.label}`}
                                  />
                                  <button
                                    type="button"
                                    className="text-danger/80 hover:text-danger shrink-0"
                                    onClick={() => removeAdvancedOption(index, optionIndex)}
                                    aria-label={`刪除第 ${index + 1} 科進階選項 ${option.label}`}
                                    title="刪除"
                                  >
                                    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                                      <path
                                        d="M7 3.5H13L14 5H17V7H3V5H6L7 3.5ZM5 8H15L14.2 16.2C14.15 16.75 13.69 17.17 13.14 17.17H6.86C6.31 17.17 5.85 16.75 5.8 16.2L5 8ZM8 10V15H9.5V10H8ZM10.5 10V15H12V10H10.5Z"
                                        fill="currentColor"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-t3">尚未新增進階選項</p>
                          )}
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-t2">批次新增</div>
                            <textarea
                              className="w-full input-theme rounded px-2 py-1 min-h-20 text-xs"
                              value={subject.advancedOptionsText}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  subjects: prev.subjects.map((item, i) =>
                                    i === index ? { ...item, advancedOptionsText: e.target.value } : item
                                  ),
                                }))
                              }
                              placeholder={"0101,鋼琴\n0301,聲樂"}
                            />
                            <div className="flex justify-end">
                              <button
                                type="button"
                                className="btn-theme h-8 px-3 py-1 rounded text-xs"
                                onClick={() => applyAdvancedOptionBatch(index)}
                              >
                                套用為單筆新增
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-t3">
                            第 {index + 1} 科：單筆新增與批次新增會合併，不可重複；每行一筆格式「代碼,進階選項」
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="btn-soft rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
                      disabled={form.subjects.length >= EXAM_EVENT_LIMITS.subjectsMax}
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          subjects: [
                            ...prev.subjects,
                            {
                              key: makeSubjectKey(new Set(prev.subjects.map((s) => s.key))),
                              label: "",
                              enableAdvancedOption: false,
                              advancedOptionsText: "",
                              advancedOptionCodeText: "",
                              advancedOptionLabelText: "",
                              advancedOptions: [],
                              capacityText: "",
                              feeStandardText: "",
                              feeReducedText: "",
                            },
                          ],
                        }))
                      }
                    >
                      ＋ 新增科目
                    </button>
                    <span className="text-xs text-t3">
                      {form.subjects.length} / {EXAM_EVENT_LIMITS.subjectsMax}
                    </span>
                  </div>
                  <p className="text-xs text-t3">僅能填寫 0 或正整數</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="exam-reg-mode">
                  報名方式
                </label>
                <div className="flex-1">
                  <select
                    id="exam-reg-mode"
                    className="w-full input-theme rounded px-3 py-2 sm:max-w-56"
                    value={form.registrationMode}
                    onChange={(e) =>
                      setForm({ ...form, registrationMode: e.target.value as ExamRegistrationMode })
                    }
                  >
                    {(Object.keys(EXAM_REGISTRATION_MODE_LABELS) as ExamRegistrationMode[]).map((key) => (
                      <option key={key} value={key}>
                        {EXAM_REGISTRATION_MODE_LABELS[key]}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-t3 mt-1">
                    必須報名時，堅決不報名的學生須至報名頁面點選"不報名並說明理由"
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0" htmlFor="exam-status">
                  狀態
                </label>
                <select
                  id="exam-status"
                  className="flex-1 input-theme rounded px-3 py-2 sm:max-w-56"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ExamEventType })}
                >
                  {(Object.keys(EXAM_EVENT_STATUS_LABELS) as ExamEventType[]).map((key) => (
                    <option key={key} value={key}>
                      {EXAM_EVENT_STATUS_LABELS[key]}
                    </option>
                  ))}
                </select>
                {form.id && (
                  <p className="text-xs text-t3 sm:ml-2">
                    狀態轉換受狀態機限制（草稿 → 開放 ⇄ 截止 → 封存）
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                >
                  {saving ? "儲存中..." : form.id ? "儲存變更" : "建立場次"}
                </button>
                {form.id && (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="btn-soft rounded-lg px-4 py-2 text-sm cursor-pointer"
                  >
                    取消編輯
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </section>

      {/* 2. 場次清單 */}
      <section className="border border-themed rounded-lg bg-card">
        <div className="px-5 py-4 border-b border-themed flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-bold text-t1">場次清單</h3>
          <input
            className="input-theme rounded px-2 py-1 text-sm flex-1 min-w-40"
            value={keyword}
            onChange={(e) => {
              const value = e.target.value;
              setKeyword(value);
              // 省流閘門外搜尋：輸入即載入清單，載入後再本機過濾（與公告／行事曆一致）
              if (value && gating) void loadList();
            }}
            placeholder="搜尋名稱、地點、科目、建立者"
          />
          <select
            className="input-theme rounded px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | ExamEventType)}
            aria-label="狀態篩選"
          >
            <option value="all">全部狀態</option>
            {(Object.keys(EXAM_EVENT_STATUS_LABELS) as ExamEventType[]).map((key) => (
              <option key={key} value={key}>
                {EXAM_EVENT_STATUS_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        <div className="border-t border-themed overflow-x-auto">
          {gating ? (
            <RevealListCard
              label="場次"
              onReveal={() => void loadList()}
              summary={loadingListCount ? "目前顯示中（全部狀態）讀取中…" : `目前顯示中（全部狀態）${listCount ?? 0} 筆`}
            />
          ) : loadingList && !listLoaded ? (
            <p className="p-6 text-center text-t3">場次清單載入中...</p>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="border-b border-themed">
                <tr className="text-t2">
                  <th className="px-3 py-2 font-medium">場次</th>
                  <th className="px-3 py-2 font-medium">重要日期</th>
                  <th className="px-3 py-2 font-medium">對象</th>
                  <th className="px-3 py-2 font-medium">科目</th>
                  <th className="px-3 py-2 font-medium">狀態</th>
                  <th className="px-3 py-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-t3">
                      尚無符合條件的場次
                    </td>
                  </tr>
                ) : (
                  pagedItems.map((item) => {
                    const nextStatus = nextStatusOf(item.status);
                    const pastDeadline =
                      item.status === "open" && effectiveExamStatus(item) === "closed";
                    return (
                      <tr key={item.id} className="border-b border-themed last:border-0 text-t1">
                        <td className="px-3 py-2">
                          <span className="font-medium">{item.title}</span>
                        </td>
                        <td className="px-3 py-2 text-t2 whitespace-nowrap">
                          <div className="space-y-1">
                            <div>
                              <span className="text-xs text-t3 mr-1">考試日期：</span>
                              {item.examEndDate && item.examEndDate !== item.examDate ? (
                                <span className="inline-flex flex-col align-top">
                                  <span>{item.examDate}</span>
                                  <span>{item.examEndDate}</span>
                                </span>
                              ) : (
                                <span>{item.examDate}</span>
                              )}
                            </div>
                          </div>
                          <div className="mt-1.5 space-y-1">
                            <div>
                              <span className="text-xs text-t3 mr-1">報名日期：</span>
                              {item.registrationOpenAt > 0 ? (
                                <span className="inline-flex flex-col align-top">
                                  <span>{formatListDateTime(item.registrationOpenAt)}</span>
                                  <span>{formatListDateTime(item.deadline)}</span>
                                </span>
                              ) : (
                                <span>{formatListDateTime(item.deadline)}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-t2">{targetText(item)}</td>
                        <td className="px-3 py-2 text-t2">{item.subjects.length}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-xs ${
                              item.status === "open"
                                ? pastDeadline
                                  ? "text-t3"
                                  : "text-success"
                                : item.status === "archived"
                                  ? "text-t3"
                                  : "text-t2"
                            }`}
                          >
                            {EXAM_EVENT_STATUS_LABELS[item.status]}
                            {pastDeadline && "（已逾截止）"}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex justify-end">
                            <div className="grid grid-cols-2 gap-1 min-w-[170px]">
                              <button
                                type="button"
                                onClick={() => edit(item)}
                                className="btn-theme rounded px-2.5 py-1 text-[10px] cursor-pointer"
                                aria-label={`編輯 ${item.title}`}
                                title="編輯"
                              >
                                編輯
                              </button>
                              <button
                                type="button"
                                onClick={() => void loadRoster(item.id)}
                                disabled={loadingRoster}
                                className="btn-soft rounded px-2.5 py-1 text-[10px] cursor-pointer disabled:opacity-50"
                                aria-label={`${item.title} 報名統計`}
                                title="報名統計"
                              >
                                {roster?.eventId === item.id ? "統計 ✓" : "統計"}
                              </button>
                              {nextStatus ? (
                                <button
                                  type="button"
                                  onClick={() => void patchStatus(item, nextStatus)}
                                  disabled={saving}
                                  className="btn-soft rounded px-2.5 py-1 text-[10px] cursor-pointer disabled:opacity-50"
                                  aria-label={`切換為${EXAM_EVENT_STATUS_LABELS[nextStatus]}`}
                                  title={EXAM_EVENT_STATUS_LABELS[nextStatus]}
                                >
                                  {EXAM_EVENT_STATUS_LABELS[nextStatus]}
                                </button>
                              ) : (
                                <span />
                              )}
                              <button
                                type="button"
                                onClick={() => void deleteEvent(item)}
                                disabled={saving}
                                className="rounded px-2.5 py-1 text-[10px] cursor-pointer disabled:opacity-50 border border-themed text-t3 hover:text-danger hover:border-danger"
                                aria-label={`刪除 ${item.title}`}
                                title="刪除場次（連同全部登錄名單一併刪除）"
                              >
                                刪除
                              </button>
                              <a
                                href={`/admin/exam-registration/roster?eventId=${encodeURIComponent(item.id)}`}
                                className="btn-soft rounded px-2.5 py-1 text-[10px] cursor-pointer text-center"
                                aria-label={`查看 ${item.title} 名單`}
                                title="查看名單"
                              >
                                查看名單
                              </a>
                              <span />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
        {/* 分頁列：每頁筆數選擇與頁次切換（同帳號清單） */}
        {!gating && listLoaded && filteredItems.length > 0 && (
          <div className="border-t border-themed px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-t2">
            <div className="flex items-center gap-2">
              <label htmlFor="exam-events-page-size">每頁</label>
              <select
                id="exam-events-page-size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="input-theme rounded px-2 py-1 cursor-pointer"
              >
                {[10, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <span>
                筆，共 {filteredItems.length} 筆
                {filteredItems.length !== items.length && `（全部 ${items.length} 筆）`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={currentPage <= 1}
                className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
              >
                第一頁
              </button>
              <button
                type="button"
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
              >
                上一頁
              </button>
              <span>
                第 {currentPage} / {totalPages} 頁
              </span>
              <button
                type="button"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
              >
                下一頁
              </button>
              <button
                type="button"
                onClick={() => setPage(totalPages)}
                disabled={currentPage >= totalPages}
                className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
              >
                最後一頁
              </button>
            </div>
          </div>
        )}
        {!gating && listLoaded && (
          <p className="text-xs text-t3 mt-2 px-5 pb-4">
            狀態轉換受狀態機限制（草稿 → 開放 ⇄ 截止 → 封存，封存不可逆）；單頁最多 200 場次。
          </p>
        )}
      </section>

      {/* 3. 名單與統計 */}
      {roster && (
        <section className="border border-themed rounded-lg bg-card px-5 py-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-t1">名單｜{roster.event.title}</h3>
              <p className="text-xs text-t3">
                應報名 {roster.summary.applicableCount} 人／完成報名 {roster.summary.registeredCount} 人；
                {formatExamDateRange(roster.event)}・
                {EXAM_REGISTRATION_MODE_LABELS[roster.event.registrationMode]}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`/admin/exam-registration/roster?eventId=${encodeURIComponent(roster.eventId)}`}
                className="btn-soft rounded px-3 py-1 text-xs cursor-pointer"
              >
                查看名單
              </a>
              <button
                type="button"
                onClick={() => setRoster(null)}
                className="btn-soft rounded px-3 py-1 text-xs cursor-pointer"
              >
                關閉
              </button>
            </div>
          </div>

          {/* 各科統計數字（表格格線） */}
          <div className="overflow-x-auto border border-themed rounded">
            <table className="w-full text-sm text-left">
              <thead className="border-b border-themed bg-themed">
                <tr className="text-t2">
                  <th className="px-3 py-2 font-medium border-r border-themed">選考科目</th>
                  <th className="px-3 py-2 font-medium text-right">已報名</th>
                </tr>
              </thead>
              <tbody>
                {roster.event.subjects.map((subject) => {
                  const entry = roster.summary.bySubject[subject.key];
                  const count = entry?.count ?? 0;
                  return (
                    <tr key={subject.key} className="border-b border-themed last:border-b-0">
                      <td className="px-3 py-2 text-t2 border-r border-themed">{subject.label}</td>
                      <td className="px-3 py-2 text-t1 text-right">{count} 人</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
