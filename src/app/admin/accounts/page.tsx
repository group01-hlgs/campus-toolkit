"use client";

import { useEffect, useMemo, useRef, useState, FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ACCOUNT_BATCH_MODES,
  ACCOUNT_BATCH_MODE_LABELS,
  AccountBatchMode,
  AccountBatchPreview,
  AccountBatchProgress,
  AccountBatchResult,
  AccountBatchRow,
  AccountStatus,
  AccountSummary,
  ADMIN_MODULES,
  ALL_ROLES,
  BASE_ADMIN_MODULES,
  RosterDeleteScope,
  ROSTER_DELETE_SCOPE_LABELS,
  ROLE_LABELS,
  STAFF_ATTRIBUTES,
  statusLabel,
  SUPER_ONLY_ADMIN_MODULES,
  twoFactorShortLabel,
  UserRole,
} from "@/types/users";
import { RosterFieldDef, rosterEntryFieldDefs } from "@/types/roster";
import {
  ACCOUNT_FORMAT_MESSAGE,
  ACCOUNT_IDENTIFIER_REQUIRED_MESSAGE,
  EMAIL_FORMAT_MESSAGE,
  isStrongPassword,
  isValidAccount,
  isValidEmail,
  PASSWORD_REQUIREMENT_MESSAGE,
} from "@/lib/validation";
import { getCachedSession, logout } from "@/lib/session";
import { readJsonResponse } from "@/lib/fetch-json";
import { useDataSaver } from "@/lib/data-saver";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import PasswordToggleButton from "@/components/PasswordToggleButton";
import RevealListCard from "@/components/RevealListCard";

type Flash = { type: "success" | "error"; text: string } | null;

/** 狀態標籤配色：有效＝綠、停用＝黃 */
const STATUS_STYLE: Record<AccountStatus, string> = {
  有效: "text-success",
  無效: "text-warning",
};

function formatDateTime(value?: number): string {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function roleDisplayLines(roles: UserRole[]): string[] {
  const labels = roles.map((role) => ROLE_LABELS[role]);
  if (labels.length < 3) return [labels.join("、")];
  const cut = Math.ceil(labels.length / 2);
  return [labels.slice(0, cut).join("、"), labels.slice(cut).join("、")];
}

interface AccountForm {
  email: string;
  account: string;
  name: string;
  password: string;
}

const EMPTY_FORM: AccountForm = { email: "", account: "", name: "", password: "" };

/** 管理員代為設定的預設密碼提示（不設強度規則；首次登入會要求本人修改） */
const DEFAULT_PASSWORD_PLACEHOLDER = "預設密碼；首次登入會要求本人修改";

/** 「同時建立身分」的名冊專屬欄位（只存目前所選身分的欄位，換身分即清空） */
type RosterForm = Record<string, string>;

/** 批次管理三種模式的說明（分點敘述） */
const BATCH_HINTS: Record<AccountBatchMode, string[]> = {
  create: [
    "辨識欄位：電子郵件地址或帳號（至少填一個，兩者都填須指向同一帳號）",
    "必填欄位：姓名、密碼（預設密碼，批次不檢查命名規則，該使用者首次登入須先修改）",
    "可選欄位：慣用身分（學生／家長／教職員／管理員）",
    "「身分」欄填了即同時建立本學期該身分，需一併填該身分的名冊欄位（如學生的學號）；不填＝只建帳號，事後至「身分名冊管理」指定",
    "單批最多 900 列",
  ],
  update: [
    "辨識欄位：電子郵件地址或帳號（兩者都填須指向同一帳號）",
    "可更新：姓名、帳號、慣用身分、狀態，空白欄位＝不修改",
    "不支援批次修改電子郵件地址與密碼",
  ],
  delete: [
    "辨識欄位：電子郵件地址或帳號（兩者都填須指向同一帳號）",
    "刪除帳號；其名冊條目可選擇一併刪除所有學期、只刪本學期，或完全保留（於確認視窗選擇）",
    "刪除後無法復原",
  ],
};

/** 未被指派「身分名冊管理」權限時的新增模式說明（無法同時建立身分） */
const BATCH_HINT_CREATE_NO_ROSTER: string[] = [
  "辨識欄位：電子郵件地址或帳號（至少填一個，兩者都填須指向同一帳號）",
  "必填欄位：姓名、密碼（預設密碼，批次不檢查命名規則，該使用者首次登入須先修改）",
  "可選欄位：慣用身分（學生／家長／教職員／管理員）",
  "未被指派「身分名冊管理」權限，無法同時建立身分",
  "單批最多 900 列",
];

/** 刪除確認視窗的名冊條目處理選項（單筆與批次共用；說明文字代入目前學年度學期） */
const ROSTER_SCOPE_OPTIONS: RosterDeleteScope[] = ["all", "current", "none"];

/** 批次 API 回應（預覽／單批執行；執行另帶分批進度 progress） */
interface BatchResponse {
  success: boolean;
  message?: string;
  preview?: AccountBatchPreview;
  result?: AccountBatchResult;
  progress?: AccountBatchProgress;
}

/** 單筆新增／編輯 API 回應（partial＝帳號已建立但同建立的名冊條目失敗） */
interface SaveResponse {
  success?: boolean;
  message?: string;
  uid?: string;
  partial?: boolean;
}

/** 彙總多批執行結果的完成訊息（格式同伺服器單批訊息，但為整檔累計） */
function composeBatchMessage(
  mode: AccountBatchMode,
  result: AccountBatchResult,
  rosterScope: RosterDeleteScope
): string {
  const rosterNote = (result.rostered ?? 0) > 0 ? `、同時建立身分 ${result.rostered} 筆` : "";
  const linkNote = (result.linked ?? 0) > 0 ? `、銜接名冊 ${result.linked} 筆` : "";
  const deleteNote =
    mode === "delete" && result.deleted > 0
      ? `（${ROSTER_DELETE_SCOPE_LABELS[rosterScope]}）`
      : "";
  return `批次作業完成：新增 ${result.created} 筆${rosterNote}${linkNote}、更新 ${result.updated} 筆、刪除 ${result.deleted} 筆${deleteNote}、略過 ${result.skipped.length} 筆`;
}

/** 批次作業範例檔（存於 docs/，由 /api/admin/downloads 提供下載；粗體＝目前所選模式） */
const BATCH_SAMPLE_FILES: { key: AccountBatchMode; href: string; label: string }[] = [
  {
    key: "create",
    href: "/api/admin/downloads/範例_使用者帳號管理_批次新增.xlsx",
    label: "批次新增",
  },
  {
    key: "create",
    href: "/api/admin/downloads/範例_使用者帳號管理_批次新增含身分.xlsx",
    label: "批次新增（含身分）",
  },
  {
    key: "update",
    href: "/api/admin/downloads/範例_使用者帳號管理_批次修改姓名.xlsx",
    label: "批次修改姓名",
  },
  {
    key: "delete",
    href: "/api/admin/downloads/範例_使用者帳號管理_批次刪除.xlsx",
    label: "批次刪除",
  },
];

const BATCH_ACTION_LABELS: Record<AccountBatchRow["action"], string> = {
  create: "新增",
  update: "修改",
  delete: "刪除",
  skip: "略過",
};

function describeBatchRow(item: AccountBatchRow): string {
  if (item.action === "skip") {
    return `第 ${item.row} 列 · 略過「${item.key}」：${item.reason}`;
  }
  const changes = (item.changes ?? [])
    .map((change) => `${change.label} ${change.from || "（空）"} → ${change.to || "（空）"}`)
    .join("、");
  return `第 ${item.row} 列 · ${BATCH_ACTION_LABELS[item.action]}「${item.key}」${
    changes ? `：${changes}` : ""
  }${item.note ? `（${item.note}）` : ""}`;
}

/** 全螢幕遮罩（儲存／刪除中）：淡入過場並擋住下方所有操作 */
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

export default function AccountsPage() {
  const router = useRouter();
  const { settings, ready: settingsReady, saverOn } = useDataSaver();
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  // 省流開關：啟用時列表改為按鈕手動顯示（狀態僅維持本次頁面停留）
  const [listLoaded, setListLoaded] = useState(false);
  const gating = saverOn && !listLoaded;
  const [flash, setFlash] = useState<Flash>(null);

  // 目前帳號的功能模組（同時建立身分需「身分名冊管理」；讀不到＝不提供，fail-closed）
  const [adminModules, setAdminModules] = useState<string[] | null>(null);
  const canCreateRoster = adminModules !== null && adminModules.includes("roster");
  // 目前操作者的管理員屬性（超級／一般）：決定能否指派「超級」屬性
  const [adminAttribute, setAdminAttribute] = useState(
    () => getCachedSession()?.adminAttribute ?? ""
  );

  // 新增／編輯表單
  const [formOpen, setFormOpen] = useState(false);
  const [editingUid, setEditingUid] = useState("");
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [formPreferredRole, setFormPreferredRole] = useState<UserRole | "">("");
  // 同時建立身分（僅新增時）：選擇的身分＋該身分的名冊專屬欄位
  const [formRosterRole, setFormRosterRole] = useState<UserRole | "">("");
  const [formRoster, setFormRoster] = useState<RosterForm>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // 重設密碼 modal
  const [resetTarget, setResetTarget] = useState<AccountSummary | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetting, setResetting] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  // 批次管理：上傳試算表 → 預覽 → 確認執行（卡片預設收合）
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchMode, setBatchMode] = useState<AccountBatchMode>("create");
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchBusy, setBatchBusy] = useState<"" | "preview" | "execute">("");
  const [batchPreview, setBatchPreview] = useState<AccountBatchPreview | null>(null);
  const [batchResult, setBatchResult] = useState<AccountBatchResult | null>(null);
  const [batchError, setBatchError] = useState("");
  // 分批執行進度（已完成列數／總列數），供遮罩即時顯示
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const batchFileRef = useRef<HTMLInputElement>(null);

  // 操作欄下拉選單：記錄開啟的列與定位（top／bottom 二選一，避開視窗下緣）
  const [menu, setMenu] = useState<{
    uid: string;
    right: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  // 儲存成功提示 modal：完成時跳出，1 秒後自動消失
  const [successModal, setSuccessModal] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 部分完成提示 modal：帳號已建立但名冊條目失敗，須手動按「知道了」才關閉
  const [partialModal, setPartialModal] = useState<string | null>(null);

  // 確認對話 modal：取代原生 confirm，樣式跟隨主題
  const [confirmRequest, setConfirmRequest] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  function askConfirm(message: string, onConfirm: () => void) {
    setConfirmRequest({ message, onConfirm });
  }

  // 刪除確認 modal：單筆與批次共用，可選擇名冊條目的處理範圍（預設＝所有學期）
  const [deleteRequest, setDeleteRequest] = useState<
    { kind: "single"; target: AccountSummary } | { kind: "batch"; count: number } | null
  >(null);
  const [deleteScope, setDeleteScope] = useState<RosterDeleteScope>("all");

  /** 開啟刪除確認（每次都回到預設範圍） */
  function openDeleteConfirm(request: NonNullable<typeof deleteRequest>) {
    setDeleteScope("all");
    setDeleteRequest(request);
  }

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // 選單開啟時：點外部、按 Esc、捲動頁面都收合
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-account-menu]")) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  // 確認 modal：Esc 取消
  useEffect(() => {
    if (!confirmRequest) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmRequest(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmRequest]);

  // 刪除確認 modal：Esc 取消
  useEffect(() => {
    if (!deleteRequest) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDeleteRequest(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteRequest]);

  const loadAccounts = async () => {
    setListLoaded(true);
    setLoading(true);
    setListError("");
    try {
      const res = await fetch("/api/admin/accounts", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || "帳號清單載入失敗");
      }
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (error) {
      setAccounts([]);
      setListError(error instanceof Error ? error.message : "帳號清單載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const modules = data?.user?.adminModules;
        setAdminModules(Array.isArray(modules) ? modules.filter((m) => typeof m === "string") : []);
        const attribute = data?.user?.adminAttribute;
        if (typeof attribute === "string") setAdminAttribute(attribute);
      })
      .catch(() => {
        // 模組清單讀不到＝不提供（fail-closed）；屬性沿用快取值，權限由伺服器端判定
        if (!cancelled) setAdminModules([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 列表載入：設定判定前不發請求；省流開關啟用時須先由按鈕解除（已載入則不再重複請求）
  useEffect(() => {
    if (!settingsReady || gating || listLoaded) return;
    void loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady, gating, listLoaded]);

  /** 儲存成功訊息：跳出 modal，3 秒後自動消失（重複呼叫會重置計時） */
  function showSuccessModal(text: string) {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSuccessModal(text);
    successTimerRef.current = setTimeout(() => {
      setSuccessModal(null);
      successTimerRef.current = null;
    }, 3000);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingUid("");
    setForm(EMPTY_FORM);
    setFormPreferredRole("");
    setFormRosterRole("");
    setFormRoster({});
    setFormError("");
    setShowPassword(false);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormPreferredRole("");
    setFormRosterRole("");
    setFormRoster({});
    setEditingUid("");
    setFormError("");
    setShowPassword(false);
    setFormOpen(true);
  }

  function openEdit(target: AccountSummary) {
    setForm({
      email: target.email,
      account: target.account,
      name: target.name,
      password: "",
    });
    setFormPreferredRole(target.preferredRole || "");
    setFormRosterRole("");
    setFormRoster({});
    setEditingUid(target.uid);
    setFormError("");
    setShowPassword(false);
    setFormOpen(true);
  }

  /** 重設密碼視窗：清空欄位後開啟 */
  function openReset(target: AccountSummary) {
    setResetTarget(target);
    setResetPassword("");
    setResetConfirm("");
    setResetError("");
  }

  /** 依按鈕位置開啟操作選單；同一列再按一次即收合 */
  function toggleMenu(event: ReactMouseEvent<HTMLButtonElement>, uid: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu((prev) => {
      if (prev?.uid === uid) return null;
      const openUp = rect.bottom + 230 > window.innerHeight;
      return {
        uid,
        right: Math.max(8, window.innerWidth - rect.right),
        ...(openUp
          ? { bottom: Math.max(8, window.innerHeight - rect.top + 4) }
          : { top: rect.bottom + 4 }),
      };
    });
  }

  /** 選單項目共用：先收合選單再執行動作 */
  function runMenuAction(action: () => void) {
    setMenu(null);
    action();
  }

  function handleField(key: keyof AccountForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleRosterField(key: string, value: string) {
    setFormRoster((prev) => ({ ...prev, [key]: value }));
  }

  /** 換身分即清空名冊欄位：各身分的專屬欄位不通用 */
  function changeRosterRole(value: UserRole | "") {
    setFormRosterRole(value);
    setFormRoster({});
  }

  /** 指定功能模組（一般管理員）：以逗號字串儲存，與名冊表單一致 */
  function toggleRosterModule(value: string) {
    setFormRoster((prev) => {
      const list = (prev.modules || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      return { ...prev, modules: next.join(",") };
    });
  }

  /** 與伺服器 /api/admin/accounts 的規則一致 */
  function validateForm(): string | null {
    if (!form.name.trim()) return "請填寫姓名";
    const hasEmail = Boolean(form.email.trim());
    const hasAccount = Boolean(form.account.trim());
    if (!hasEmail && !hasAccount) return ACCOUNT_IDENTIFIER_REQUIRED_MESSAGE;
    if (hasEmail && !isValidEmail(form.email.trim())) return EMAIL_FORMAT_MESSAGE;
    if (hasAccount && !isValidAccount(form.account.trim())) {
      return ACCOUNT_FORMAT_MESSAGE;
    }
    // 單筆建立／編輯不套用密碼強度規則（僅驗證非空白），與伺服器 skipPasswordRule 一致
    if (!form.password && !editingUid) {
      return "請填寫密碼";
    }
    // 同時建立身分的必填欄位（與伺服器 validateRosterInput 一致）
    if (!editingUid && formRosterRole) {
      if (formRosterRole === "student" && !formRoster.studentId?.trim()) return "請填寫學號";
      if (
        formRosterRole === "admin" &&
        formRoster.attribute !== "一般" &&
        formRoster.attribute !== "超級"
      ) {
        return "請選擇管理員屬性（一般／超級）";
      }
      // 屬性層級守門（與伺服器一致）：非超級管理員不得建立超級管理員
      if (formRosterRole === "admin" && adminAttribute !== "超級" && formRoster.attribute === "超級") {
        return "僅超級管理員可以指定「超級」管理員";
      }
    }
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const message = validateForm();
    if (message) {
      setFormError(message);
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const isEdit = Boolean(editingUid);
      const res = await fetch("/api/admin/accounts", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { uid: editingUid } : {}),
          input: { ...form },
          preferredRole: formPreferredRole,
          // 同時建立身分（僅新增）：寫入帳號後一併建立本學期名冊條目
          ...(!isEdit && formRosterRole ? { roster: { role: formRosterRole, input: formRoster } } : {}),
        }),
      });
      const data = await readJsonResponse<SaveResponse>(res);
      if (!res.ok || !data.success) {
        setFormError(data?.message || "儲存失敗");
        return;
      }
      closeForm();
      await loadAccounts();
      if (data.partial) {
        const text = data.message || "帳號已建立，但身分名冊條目未建立，請至「身分名冊管理」補建";
        setFlash({ type: "error", text });
        setPartialModal(text);
        return;
      }
      setFlash({ type: "success", text: data.message || "已儲存" });
      showSuccessModal(data.message || "已儲存");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  /** 重設密碼：以既有帳號欄位＋新密碼送出（PUT 會一併讓舊 session 失效） */
  async function handleResetSubmit(event: FormEvent) {
    event.preventDefault();
    if (resetting || !resetTarget) return;
    if (!isStrongPassword(resetPassword)) {
      setResetError(PASSWORD_REQUIREMENT_MESSAGE);
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError("兩次輸入的密碼不一致");
      return;
    }

    setResetting(true);
    setResetError("");
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: resetTarget.uid,
          input: {
            email: resetTarget.email,
            account: resetTarget.account,
            name: resetTarget.name,
            password: resetPassword,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setResetError(data?.message || "重設失敗");
        return;
      }
      setFlash({ type: "success", text: `已重設 ${resetTarget.name} 的密碼` });
      showSuccessModal("密碼已重設");
      setResetTarget(null);
      setResetPassword("");
      setResetConfirm("");
      await loadAccounts();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "重設失敗");
    } finally {
      setResetting(false);
    }
  }

  /** 帳號狀態（擋整個帳戶能否登入） */
  function handleSetStatus(target: AccountSummary, status: AccountStatus) {
    if (toggling) return;
    if (status === target.status) return;
    const label = `${target.name}（${target.account || target.email}）`;
    const question =
      status === "有效"
        ? `確定恢復 ${label} 的帳號狀態為「有效」？`
        : `確定停用 ${label} 的帳號？停用後無法登入（含所有身分）。`;
    askConfirm(question, () => void applySetStatus(target, status));
  }

  async function applySetStatus(target: AccountSummary, status: AccountStatus) {
    setToggling(true);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: target.uid, status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFlash({ type: "error", text: data?.message || "狀態更新失敗" });
        return;
      }
      setFlash({ type: "success", text: data.message || "狀態已更新" });
      showSuccessModal(data.message || "狀態已更新");
      if (editingUid === target.uid) closeForm();
      await loadAccounts();
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "狀態更新失敗",
      });
    } finally {
      setToggling(false);
    }
  }

  function handleDelete(target: AccountSummary) {
    if (deleting) return;
    openDeleteConfirm({ kind: "single", target });
  }

  async function applyDelete(target: AccountSummary, rosterScope: RosterDeleteScope) {
    setDeleting(true);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: target.uid, rosterScope }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFlash({ type: "error", text: data?.message || "刪除失敗" });
        return;
      }
      setFlash({ type: "success", text: data.message || "已刪除" });
      showSuccessModal(data.message || "已刪除");
      if (editingUid === target.uid) closeForm();
      await loadAccounts();
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "刪除失敗" });
    } finally {
      setDeleting(false);
    }
  }

  /** 刪除確認視窗的名冊處理選項文字（「本學期」代入目前學年度學期） */
  function rosterScopeCopy(scope: RosterDeleteScope): { label: string; hint: string } {
    const periodLabel = `${settings.academicYear} 學年度第 ${settings.semester} 學期`;
    switch (scope) {
      case "current":
        return {
          label: "只刪除本學期的名冊條目",
          hint: `僅移除 ${periodLabel} 的身分名冊資料，其他學期保留`,
        };
      case "none":
        return {
          label: "不刪除任何名冊條目",
          hint: "只刪除帳號，所有學期的身分名冊資料完整保留",
        };
      default:
        return {
          label: "一併刪除所有學期的名冊條目",
          hint: "該帳號各學年度學期的身分名冊資料全部刪除",
        };
    }
  }

  function handleBack() {
    router.push("/admin");
  }

  function clearBatchSelection() {
    setBatchFile(null);
    setBatchPreview(null);
    setBatchResult(null);
    setBatchError("");
    setBatchProgress(null);
    if (batchFileRef.current) batchFileRef.current.value = "";
  }

  function selectBatchMode(mode: AccountBatchMode) {
    setBatchMode(mode);
    clearBatchSelection();
  }

  function runBatch(dryRun: boolean) {
    if (!batchFile || batchBusy) return;
    if (dryRun) {
      void executeBatch(true);
      return;
    }
    if (batchMode === "delete") {
      openDeleteConfirm({ kind: "batch", count: batchPreview?.deleted ?? 0 });
      return;
    }
    askConfirm(
      `確定執行批次「${ACCOUNT_BATCH_MODE_LABELS[batchMode]}」？共 ${
        batchPreview?.total ?? 0
      } 列。`,
      () => void executeBatch(false)
    );
  }

  async function executeBatch(dryRun: boolean, rosterScope: RosterDeleteScope = "all") {
    if (!batchFile || batchBusy) return;
    const file = batchFile;
    const mode = batchMode;
    setBatchBusy(dryRun ? "preview" : "execute");
    setBatchError("");
    setBatchProgress(null);
    let doneRows = 0;
    let totalRows = 0;
    try {
      const send = async (offset: number): Promise<BatchResponse> => {
        const body = new FormData();
        body.append("mode", mode);
        body.append("dryRun", dryRun ? "true" : "false");
        if (mode === "delete") body.append("rosterScope", rosterScope);
        if (!dryRun) body.append("offset", String(offset));
        body.append("file", file);
        const res = await fetch("/api/admin/accounts/batch", { method: "POST", body });
        const data = await readJsonResponse<BatchResponse>(res);
        if (!res.ok || !data.success) {
          throw new Error(data?.message || "批次作業失敗");
        }
        return data;
      };

      if (dryRun) {
        const data = await send(0);
        setBatchResult(null);
        setBatchPreview(data.preview ?? null);
        return;
      }

      // 執行：伺服器每批只處理 offset 起的一段，依 progress 迴圈送下一批並逐批累加結果
      const aggregated: AccountBatchResult = {
        created: 0,
        updated: 0,
        deleted: 0,
        rostered: 0,
        linked: 0,
        skipped: [],
      };
      let offset = 0;
      for (;;) {
        const data = await send(offset);
        if (!data.result) throw new Error(data.message || "批次作業失敗");
        const result = data.result;
        aggregated.created += result.created;
        aggregated.updated += result.updated;
        aggregated.deleted += result.deleted;
        aggregated.rostered = (aggregated.rostered ?? 0) + (result.rostered ?? 0);
        aggregated.linked = (aggregated.linked ?? 0) + (result.linked ?? 0);
        aggregated.skipped.push(...result.skipped);
        const progress = data.progress;
        const processed =
          progress?.processed ??
          result.created + result.updated + result.deleted + result.skipped.length;
        offset += processed;
        totalRows = progress?.total ?? offset;
        doneRows = Math.min(offset, totalRows);
        setBatchProgress({ done: doneRows, total: totalRows });
        if (!progress || progress.done) break;
      }

      setBatchPreview(null);
      setBatchResult(aggregated);
      setBatchFile(null);
      setBatchProgress(null);
      if (batchFileRef.current) batchFileRef.current.value = "";
      await loadAccounts();
      showSuccessModal(composeBatchMessage(mode, aggregated, rosterScope));
    } catch (error) {
      const base = error instanceof Error ? error.message : "批次作業失敗";
      // 中斷時明確告知已完成範圍：已建立的資料保留，重跑已完成的列會自然略過（可原檔續傳）
      const note =
        !dryRun && doneRows > 0
          ? `；已完成 ${doneRows}/${totalRows} 列，已建立的資料已保留，再次執行時已完成的列會自動略過`
          : "";
      setBatchError(base + note);
    } finally {
      setBatchBusy("");
      setBatchProgress(null);
    }
  }

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return accounts;
    return accounts.filter((item) => {
      const parts = [
        item.name,
        item.email,
        item.account,
        item.status,
        statusLabel(item.status),
        item.preferredRole ? ROLE_LABELS[item.preferredRole] : "",
        twoFactorShortLabel(item.twoFactor),
        item.roles.map((role) => ROLE_LABELS[role]).join(" "),
      ];
      return parts.some((value) => value.toLowerCase().includes(key));
    });
  }, [accounts, keyword]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  );

  // 目前開啟選單的帳號（清單重載後找不到就自動不顯示）
  const menuTarget = menu ? accounts.find((item) => item.uid === menu.uid) : null;

  /** 同時建立身分：屬性（下拉）與指定功能模組（勾選）為特殊控制項 */
  function renderRosterAttribute(field: RosterFieldDef) {
    const isAdmin = formRosterRole === "admin";
    const options = isAdmin
      ? [
          { value: "", label: "請選擇屬性" },
          { value: "一般", label: "一般（指定功能模組）" },
          // 「超級」只有超級管理員可以指派
          ...(adminAttribute === "超級" ? [{ value: "超級", label: "超級（全開）" }] : []),
        ]
      : [
          { value: "", label: "請選擇屬性（選填）" },
          ...STAFF_ATTRIBUTES.map((value) => ({ value, label: value })),
        ];
    return (
      <div key={field.key} className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="text-t2 sm:w-40 shrink-0 flex items-center gap-1">
          {field.label}
          {isAdmin && <span className="text-t1">*</span>}
        </label>
        <select
          value={formRoster.attribute ?? ""}
          onChange={(e) => handleRosterField("attribute", e.target.value)}
          className="flex-1 input-theme rounded px-3 py-2"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {!isAdmin && (
          <span className="text-xs text-t3 sm:max-w-64">
            教師＝純教學；兼導師＝任導師；兼行政＝組長／主任等行政職或職員編制；職員＝專任行政人員。
          </span>
        )}
      </div>
    );
  }

  /** 指定功能模組（一般管理員勾選）：超級管理員全開、不需勾選 */
  function renderRosterModules(field: RosterFieldDef) {
    const isSuper = formRoster.attribute === "超級";
    const selected = (formRoster.modules || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    // 基本模組（系統設定）與超級專屬模組（學校基本設定、功能模組管理）都不列入指派
    const assignable = ADMIN_MODULES.filter(
      (module) =>
        !(BASE_ADMIN_MODULES as readonly string[]).includes(module.value) &&
        !(SUPER_ONLY_ADMIN_MODULES as readonly string[]).includes(module.value)
    );
    return (
      <div key={field.key} className="flex flex-col sm:flex-row sm:items-start gap-2">
        <label className="text-t2 sm:w-40 shrink-0">{field.label}</label>
        <div className="flex-1 flex flex-wrap gap-x-4 gap-y-2">
          {assignable.map((module) => (
            <label key={module.value} className="flex items-center gap-1.5 text-sm text-t1">
              <input
                type="checkbox"
                checked={isSuper || selected.includes(module.value)}
                disabled={isSuper}
                onChange={() => toggleRosterModule(module.value)}
                className="accent-current"
              />
              {module.label}
            </label>
          ))}
          <span className="w-full text-xs text-t3">
            可選欄位：只記錄實際勾選的內容；超級管理員＝全開，由屬性判定、不看此欄位。
          </span>
        </div>
      </div>
    );
  }

  /** 同時建立身分的單一欄位 */
  function renderRosterField(field: RosterFieldDef) {
    if (field.key === "attribute") return renderRosterAttribute(field);
    if (field.key === "modules") return renderRosterModules(field);
    return (
      <div key={field.key} className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="text-t2 sm:w-40 shrink-0 flex items-center gap-1">
          {field.label}
          {field.required && <span className="text-t1">*</span>}
        </label>
        <input
          type={field.key === "studentEmail" ? "email" : "text"}
          value={formRoster[field.key] ?? ""}
          onChange={(e) => handleRosterField(field.key, e.target.value)}
          autoComplete="off"
          className="flex-1 input-theme rounded px-3 py-2"
        />
      </div>
    );
  }

  const actionButtons = (
    <>
      <button onClick={handleBack} className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer">
        返回功能首頁
      </button>
      <button
        onClick={() => void logout()}
        className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
      >
        登出
      </button>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      {/* 標題區域 */}
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      {/* 功能標題 */}
      <div className="w-full max-w-6xl mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">使用者帳號管理</h2>
      </div>

      {/* 操作按鈕 */}
      <div className="w-full max-w-6xl flex justify-end gap-3 mb-4">{actionButtons}</div>

      <hr className="w-full max-w-6xl border-themed mb-4" />

      {/* 批次管理：上傳試算表 → 預覽 → 確認執行（預設收合） */}
      <div className="w-full max-w-6xl border border-themed rounded-lg bg-card p-4 mb-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-t1">批次管理</h3>
          <button
            type="button"
            onClick={() => setBatchOpen((prev) => !prev)}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
            aria-expanded={batchOpen}
          >
            {batchOpen ? "收合" : "展開"}
          </button>
        </div>

        {batchOpen && (
          <div className="mt-3">
            <p className="text-xs text-t3 mb-3">
              Excel／CSV（.xlsx、.xls、.csv），上傳後先預覽再執行
            </p>

            <div className="flex flex-wrap gap-2 mb-3">
              {ACCOUNT_BATCH_MODES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => selectBatchMode(item.value)}
                  className={`rounded-lg px-4 py-1.5 text-sm cursor-pointer border ${
                    batchMode === item.value
                      ? "btn-theme"
                      : "border-themed text-t2 bg-card hover:text-t1"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={batchFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  setBatchFile(e.target.files?.[0] ?? null);
                  setBatchPreview(null);
                  setBatchResult(null);
                  setBatchError("");
                }}
              />
              <button
                type="button"
                onClick={() => batchFileRef.current?.click()}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                選擇檔案
              </button>
              <span className="text-sm text-t2">{batchFile ? batchFile.name : "尚未選擇檔案"}</span>
              <button
                type="button"
                onClick={() => void runBatch(true)}
                disabled={!batchFile}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
              >
                上傳預覽
              </button>
              {batchPreview && (
                <>
                  <button
                    type="button"
                    onClick={() => void runBatch(false)}
                    className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
                  >
                    確認執行
                  </button>
                  <button
                    type="button"
                    onClick={clearBatchSelection}
                    className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
                  >
                    取消
                  </button>
                </>
              )}
            </div>

            <ul className="text-xs text-t3 mt-2 list-disc pl-5 space-y-1">
              {(batchMode === "create" && !canCreateRoster
                ? BATCH_HINT_CREATE_NO_ROSTER
                : BATCH_HINTS[batchMode]
              ).map((item) => (
                <li key={item}>{item}</li>
              ))}
              {BATCH_SAMPLE_FILES.filter((item) => item.key === batchMode).map((item) => (
                <li key={item.href}>
                  範例檔下載：
                  <a
                    href={encodeURI(item.href)}
                    download
                    className="text-t1 font-medium"
                  >
                    {item.label}
                  </a>
                  ，可另存修改後再上傳。
                </li>
              ))}
            </ul>

            {batchError && (
              <p className="text-sm text-danger mt-2" role="alert">
                {batchError}
              </p>
            )}

            {batchPreview && (
              <div className="mt-3 border border-themed rounded-lg p-3 text-sm">
                <p className="font-bold text-t1 mb-2">
                  預覽：新增 {batchPreview.created} 筆
                  {(batchPreview.rostered ?? 0) > 0 && `（含同時建立身分 ${batchPreview.rostered} 筆）`}
                  、更新 {batchPreview.updated} 筆、刪除{" "}
                  {batchPreview.deleted} 筆、略過 {batchPreview.skipped} 筆（共{" "}
                  {batchPreview.total} 列）
                </p>
                <ul className="max-h-64 overflow-y-auto space-y-1 text-t2">
                  {batchPreview.rows.map((item) => (
                    <li key={item.row}>{describeBatchRow(item)}</li>
                  ))}
                </ul>
              </div>
            )}

            {batchResult && (
              <div className="mt-3 border border-themed rounded-lg p-3 text-sm">
                <p className="font-bold text-t1 mb-2">
                  批次作業完成：新增 {batchResult.created} 筆
                  {(batchResult.rostered ?? 0) > 0 && `（含同時建立身分 ${batchResult.rostered} 筆）`}
                  、更新 {batchResult.updated} 筆、刪除{" "}
                  {batchResult.deleted} 筆、略過 {batchResult.skipped.length} 筆
                </p>
                {batchResult.skipped.length > 0 && (
                  <ul className="max-h-64 overflow-y-auto space-y-1 text-t2">
                    {batchResult.skipped.map((item) => (
                      <li key={item.row}>第 {item.row} 列：{item.reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 工具列：搜尋、新增 */}
      <div className="w-full max-w-6xl flex flex-wrap items-center gap-3 mb-4">
        {!gating && (
          <input
            type="search"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            placeholder="搜尋姓名、帳號、信箱、身分或狀態"
            className="flex-1 min-w-[200px] input-theme rounded px-3 py-2"
          />
        )}
        <button
          onClick={openCreate}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer ml-auto"
        >
          新增帳號
        </button>
      </div>

      {/* 提示訊息 */}
      {flash && (
        <div
          className={`w-full max-w-6xl mb-4 px-4 py-3 text-sm ${
            flash.type === "error"
              ? "alert-danger"
              : "rounded-lg border border-themed text-t1 bg-card"
          }`}
          role={flash.type === "error" ? "alert" : "status"}
        >
          {flash.text}
        </div>
      )}

      {/* 新增／編輯表單 */}
      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-6xl border border-themed rounded-lg p-6 mb-4 bg-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-t1">
              {editingUid ? "編輯帳號" : "新增帳號"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="btn-theme rounded-lg px-3 py-1.5 text-sm cursor-pointer"
            >
              取消
            </button>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-t2 sm:w-40 shrink-0 flex items-center gap-1">
                姓名<span className="text-t1">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => handleField("name", e.target.value)}
                autoComplete="off"
                className="flex-1 input-theme rounded px-3 py-2"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-t2 sm:w-40 shrink-0">電子郵件地址</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleField("email", e.target.value)}
                autoComplete="off"
                className="flex-1 input-theme rounded px-3 py-2"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-t2 sm:w-40 shrink-0">帳號</label>
              <input
                type="text"
                value={form.account}
                onChange={(e) => handleField("account", e.target.value)}
                autoComplete="off"
                className="flex-1 input-theme rounded px-3 py-2"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-t2 sm:w-40 shrink-0 flex items-center gap-1">
                密碼{!editingUid && <span className="text-t1">*</span>}
              </label>
              <div className="relative flex-1">
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => handleField("password", e.target.value)}
                  autoComplete="new-password"
                  placeholder={editingUid ? "留空表示不變更密碼" : DEFAULT_PASSWORD_PLACEHOLDER}
                  className="w-full input-theme rounded px-3 py-2 pr-10"
                />
                <PasswordToggleButton
                  visible={showPassword}
                  onToggle={() => setShowPassword((prev) => !prev)}
                  label="顯示密碼"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="text-t2 sm:w-40 shrink-0">慣用身分</label>
              <select
                value={formPreferredRole}
                onChange={(e) => setFormPreferredRole(e.target.value as UserRole | "")}
                className="flex-1 input-theme rounded px-3 py-2"
              >
                <option value="">未設定（登入時詢問）</option>
                {ALL_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>

            {/* 同時建立身分（僅新增）：選擇身分後帶出該身分的名冊專屬欄位 */}
            {!editingUid && canCreateRoster && (
              <div className="border-t border-themed pt-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <label className="text-t2 sm:w-40 shrink-0">同時建立身分</label>
                  <select
                    value={formRosterRole}
                    onChange={(e) => changeRosterRole(e.target.value as UserRole | "")}
                    className="flex-1 input-theme rounded px-3 py-2"
                  >
                    <option value="">不建立（事後至「身分名冊管理」指定）</option>
                    {ALL_ROLES.map((option) => (
                      <option key={option} value={option}>
                        {ROLE_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </div>
                {formRosterRole && (
                  <div className="mt-3 space-y-4">
                    <p className="text-xs text-t3">
                      一併建立 {settings.academicYear} 學年度第{settings.semester}學期的
                      {ROLE_LABELS[formRosterRole]}身分（名冊欄位）；建立後仍可在「身分名冊管理」維護。
                    </p>
                    {rosterEntryFieldDefs(formRosterRole).map(renderRosterField)}
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-t3">
              電子郵件地址與帳號至少填寫一個（登入識別用，另一欄可留空）；同一組帳號具備多個身分時，
              登入依慣用身分決定預設身分。此處設定的密碼為預設密碼，該使用者首次登入時會被要求先修改。
              {canCreateRoster
                ? "未選擇「同時建立身分」時，建立帳號後請至「身分名冊管理」指定身分。"
                : "建立帳號後，請至「身分名冊管理」指定身分。"}
            </p>
          </div>

          {formError && (
            <p className="text-sm text-t1 mt-3 border border-themed rounded px-3 py-2" role="alert">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button
              type="submit"
              disabled={saving}
              className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
            >
              {saving ? "儲存中..." : "儲存"}
            </button>
          </div>
        </form>
      )}

      {/* 帳號工作表（依每頁筆數分頁顯示）；省流開關啟用時改為按鈕手動顯示 */}
      <div className="w-full max-w-6xl border border-themed rounded-lg bg-card mb-4 overflow-x-auto">
        {gating ? (
          <RevealListCard label="帳號" onReveal={() => void loadAccounts()} />
        ) : loading ? (
          <p className="p-6 text-center text-t3">帳號清單載入中...</p>
        ) : listError ? (
          <p className="p-6 text-center text-t1">{listError}</p>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="border-b border-themed">
              <tr className="text-t2">
                <th className="px-3 py-2 font-medium whitespace-nowrap">狀態</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">姓名</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">電子郵件地址／帳號</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">慣用身分</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">兩階段驗證</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">登入記錄</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">具備身分</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-t3">
                    {accounts.length === 0 ? "目前沒有帳號" : "沒有符合的資料"}
                  </td>
                </tr>
              )}
              {paged.map((item) => (
                <tr key={item.uid} className="border-b border-themed last:border-0 text-t1">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`inline-block rounded-full border border-themed px-2 py-0.5 text-xs ${STATUS_STYLE[item.status]}`}
                    >
                      {statusLabel(item.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{item.name || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div>{item.email || "—"}</div>
                    <div className="text-xs text-t2">{item.account || "—"}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.preferredRole ? ROLE_LABELS[item.preferredRole] : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {twoFactorShortLabel(item.twoFactor)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div>{item.loginCount ?? 0} 次</div>
                    <div className="text-xs text-t2">{formatDateTime(item.lastLogin)}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.roles.length
                      ? roleDisplayLines(item.roles).map((line) => <div key={line}>{line}</div>)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button
                      type="button"
                      data-account-menu
                      aria-haspopup="menu"
                      aria-expanded={menu?.uid === item.uid}
                      onClick={(event) => toggleMenu(event, item.uid)}
                      className="btn-theme rounded px-3 py-1 text-xs cursor-pointer inline-flex items-center gap-1"
                    >
                      操作
                      <svg
                        className={`w-3 h-3 transition-transform ${
                          menu?.uid === item.uid ? "rotate-180" : ""
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 分頁列：每頁筆數選擇與頁次切換 */}
      {!loading && !listError && filtered.length > 0 && (
        <div className="w-full max-w-6xl flex flex-wrap items-center justify-between gap-3 mb-4 text-sm text-t2">
          <div className="flex items-center gap-2">
            <label htmlFor="accounts-page-size">每頁</label>
            <select
              id="accounts-page-size"
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
              筆，共 {filtered.length} 筆
              {filtered.length !== accounts.length && `（全部 ${accounts.length} 筆）`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(1)}
              disabled={currentPage <= 1}
              className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
            >
              第一頁
            </button>
            <button
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
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
            >
              下一頁
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={currentPage >= totalPages}
              className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
            >
              最後一頁
            </button>
          </div>
        </div>
      )}

      <hr className="w-full max-w-6xl border-themed mb-4" />

      {/* 底部操作按鈕 */}
      <div className="w-full max-w-6xl flex justify-start gap-3 mb-8">{actionButtons}</div>

      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-6xl">
          <AdSense />
        </div>
      )}

      <div className="w-full max-w-6xl mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>

      {/* 操作下拉選單：依按鈕位置以 fixed 定位，避免被表格水平捲動區裁切 */}
      {menu && menuTarget && (
        <div
          role="menu"
          data-account-menu
          aria-label={`${menuTarget.name} 的操作`}
          className="fixed z-40 min-w-[172px] rounded-lg border border-themed bg-card py-1 shadow-lg animate-fade-in"
          style={{ top: menu.top, bottom: menu.bottom, right: menu.right }}
        >
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => runMenuAction(() => openEdit(menuTarget))}
          >
            編輯
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => runMenuAction(() => openReset(menuTarget))}
          >
            重設密碼
          </button>
          {menuTarget.status === "有效" ? (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => runMenuAction(() => void handleSetStatus(menuTarget, "無效"))}
            >
              停用帳號
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => runMenuAction(() => void handleSetStatus(menuTarget, "有效"))}
            >
              啟用帳號
            </button>
          )}
          <div className="my-1 border-t border-themed" />
          <button
            type="button"
            role="menuitem"
            className="menu-item is-danger"
            onClick={() => runMenuAction(() => void handleDelete(menuTarget))}
          >
            刪除
          </button>
        </div>
      )}

      {/* 作業遮罩：儲存／刪除／狀態切換／重設密碼／批次作業期間覆蓋畫面、阻擋重複操作 */}
      {(saving || deleting || toggling || resetting || batchBusy) && (
        <BlockingMask
          text={
            toggling
              ? "更新狀態中，請稍候…"
              : resetting
                ? "重設密碼中，請稍候…"
                : deleting
                  ? "刪除中，請稍候…"
                  : batchBusy
                    ? batchBusy === "execute"
                      ? batchProgress
                        ? `批次執行中，已完成 ${batchProgress.done}/${batchProgress.total} 列，請稍候…`
                        : "批次執行中，請稍候…"
                      : "上傳預覽中，請稍候…"
                    : "儲存中，請稍候…"
          }
        />
      )}

      {/* 重設密碼 modal */}
      {resetTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
        >
          <form
            onSubmit={handleResetSubmit}
            className="bg-card rounded-2xl p-6 w-full max-w-md space-y-4 shadow-lg animate-fade-in"
          >
            <div>
              <h3 className="text-lg font-bold text-t1">重設密碼</h3>
              <p className="text-sm text-t2 mt-1">
                {resetTarget.name}（{resetTarget.account || resetTarget.email}）
              </p>
              <p className="text-xs text-t3 mt-1">
                重設後該帳號的既有登入狀態會全部失效，需重新登入；
                對方下次登入時會被要求先由本人修改密碼。
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-t2 text-sm flex items-center gap-1">
                新密碼<span className="text-t1">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder={DEFAULT_PASSWORD_PLACEHOLDER}
                  className="w-full input-theme rounded px-3 py-2 pr-10"
                />
                <PasswordToggleButton
                  visible={showPassword}
                  onToggle={() => setShowPassword((prev) => !prev)}
                  label="顯示密碼"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-t2 text-sm flex items-center gap-1">
                再輸入一次<span className="text-t1">*</span>
              </label>
              <input
                type={showPassword ? "text" : "password"}
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full input-theme rounded px-3 py-2"
              />
            </div>
            {resetError && (
              <p className="text-sm text-t1 border border-themed rounded px-3 py-2" role="alert">
                {resetError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={resetting}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
              >
                {resetting ? "重設中..." : "重設密碼"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 確認 modal：取代原生 confirm，樣式跟隨主題 */}
      {confirmRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
          onClick={() => setConfirmRequest(null)}
        >
          <div
            className="bg-card rounded-2xl p-6 w-full max-w-md space-y-4 shadow-lg animate-fade-in"
            role="alertdialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <h3 className="text-lg font-bold text-t1">確認操作</h3>
              <p className="text-sm text-t2 mt-2">{confirmRequest.message}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmRequest(null)}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const onConfirm = confirmRequest.onConfirm;
                  setConfirmRequest(null);
                  onConfirm();
                }}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                確認
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 刪除確認 modal：可選擇名冊條目處理範圍，危險警示比照「身分名冊管理」 */}
      {deleteRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
          onClick={() => setDeleteRequest(null)}
        >
          <div
            className="bg-card rounded-2xl p-6 w-full max-w-md space-y-4 shadow-lg animate-fade-in"
            role="alertdialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-3">
              <h3 className="text-lg font-bold text-t1">確認刪除</h3>
              <p className="text-sm text-t2">
                {deleteRequest.kind === "single"
                  ? `確定刪除 ${deleteRequest.target.name}（${
                      deleteRequest.target.account || deleteRequest.target.email
                    }）的帳號？`
                  : `確定執行批次刪除？共 ${deleteRequest.count} 個帳號將被刪除。`}
              </p>
              <fieldset className="space-y-2">
                <legend className="text-sm font-bold text-t1">名冊條目的處理方式</legend>
                {ROSTER_SCOPE_OPTIONS.map((value) => {
                  const copy = rosterScopeCopy(value);
                  return (
                    <label
                      key={value}
                      className="flex items-start gap-2 text-sm text-t2 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="roster-delete-scope"
                        value={value}
                        checked={deleteScope === value}
                        onChange={() => setDeleteScope(value)}
                        className="mt-0.5 cursor-pointer"
                      />
                      <span>
                        {copy.label}
                        <span className="block text-xs text-t3">{copy.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <p className="alert-danger px-3 py-2 text-sm font-bold" role="alert">
                <span className="text-danger">刪除後無法復原</span>
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteRequest(null)}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const request = deleteRequest;
                  const scope = deleteScope;
                  setDeleteRequest(null);
                  if (request.kind === "single") {
                    void applyDelete(request.target, scope);
                  } else {
                    void executeBatch(false, scope);
                  }
                }}
                className="btn-danger rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 儲存成功 modal：完成時跳出，3 秒後自動消失 */}
      {successModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
        >
          <div className="bg-card rounded-2xl p-8 text-center space-y-4 shadow-lg animate-fade-in">
            <div className="flex justify-center">
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
            </div>
            <p className="text-lg font-semibold text-t1">{successModal}</p>
            <p className="text-xs text-t3">視窗將自動關閉</p>
          </div>
        </div>
      )}

      {/* 部分完成 modal：帳號已建立但名冊條目失敗，須手動確認，不自動消失 */}
      {partialModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
        >
          <div className="bg-card rounded-2xl p-8 text-center space-y-4 shadow-lg animate-fade-in max-w-md">
            <div className="flex justify-center">
              <svg
                className="w-12 h-12 text-warning"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <p className="text-lg font-semibold text-t1">部分完成</p>
            <p className="text-sm text-t2">{partialModal}</p>
            <button
              type="button"
              onClick={() => setPartialModal(null)}
              className="btn-theme rounded-lg px-6 py-2 text-sm cursor-pointer"
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
