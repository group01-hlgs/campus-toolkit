"use client";

import { useEffect, useMemo, useRef, useState, FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import {
  ROSTER_BATCH_MODES,
  ROSTER_BATCH_MODE_LABELS,
  ROSTER_BATCH_STRATEGIES,
  ROSTER_COLUMNS,
  ROSTER_FIELDS,
  ROSTER_ROLES,
  ACCOUNT_FIELD_KEYS,
  RosterBatchMode,
  RosterBatchPreview,
  RosterBatchResult,
  RosterBatchRow,
  RosterBatchStrategy,
  RosterColumnKey,
  RosterFieldDef,
  RosterFieldKey,
  RosterInput,
  RosterMember,
  RosterRole,
  isImportableRole,
  isRosterRole,
  rosterBatchFieldHints,
} from "@/types/roster";
import {
  ADMIN_MODULES,
  BASE_ADMIN_MODULES,
  ROLE_LABELS,
  STAFF_ATTRIBUTES,
  statusLabel,
  type AccountStatus,
  type StaffAttribute,
  type UserRole,
} from "@/types/users";
import { logout } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import RoleEnablePanel from "@/components/RoleEnablePanel";

type Flash = { type: "success" | "error"; text: string } | null;

/** 綁定既有帳號的查詢結果（/api/admin/roster?lookup=…） */
interface BindTarget {
  uid: string;
  email: string;
  account: string;
  name: string;
  roles: UserRole[];
}

/** 批次管理卡片的模式說明（新增模式依所選身分列出辨識鍵與必填欄位），分點回傳 */
function batchHint(mode: RosterBatchMode, role: RosterRole, strategy: RosterBatchStrategy): string[] {
  if (mode === "create") {
    if (!isImportableRole(role)) {
      return ["家長身分不提供檔案匯入，請以「新增家長」表單建立。"];
    }
    const { identify, required, optional } = rosterBatchFieldHints(role);
    const points = [
      `辨識欄位：${identify}（兩者都填須指向同一帳號）`,
      `必填欄位：${required}；可選欄位（可留空）：${optional}`,
      "以辨識欄位找到既有帳號後建立本期名冊條目；同一帳號同期僅一筆，查無帳號之列略過，批次不建立帳號、不設密碼",
      "寫入方式「追加」＝在同期既有名冊之上繼續增加，已存在者略過",
      "寫入方式「覆蓋」＝先刪除同期既有的該身分名冊，再依檔案新增（檔案即完整名單），刪除後無法復原",
      "覆蓋時檔案每一列都須通過檢查：預覽有略過列時不可執行",
    ];
    if (strategy === "replace" && role === "admin") {
      points.push("管理員的覆蓋不刪除自己的管理員身分與最後一位有效管理員（檔案包含者仍會覆寫重建）");
    }
    points.push("單批最多 900 列");
    return points;
  }
  if (mode === "update") {
    return [
      "辨識欄位：電子郵件地址或帳號（兩者都填須指向同一帳號）",
      "除辨識欄位外皆無必填：空白＝不修改，只更新有填值的欄位（含姓名）",
      "本期無此身分名冊資料之列略過；電子郵件、帳號與密碼請至「使用者帳號管理」維護",
    ];
  }
  return [
    "辨識欄位：電子郵件地址或帳號（兩者都填須指向同一帳號）",
    "只刪除該列本期的名冊條目；帳號與其他學期資料保留",
    "刪除後無法復原",
  ];
}

/** 批次範例檔（存於 docs/，由 /api/admin/downloads 提供下載；依模式與身分提供） */
const BATCH_SAMPLE_FILES: {
  mode: RosterBatchMode;
  role: RosterRole;
  href: string;
  label: string;
  caption: string;
}[] = [
  {
    mode: "create",
    role: "student",
    href: "/api/admin/downloads/範例_身分名冊管理_學生批次新增.xlsx",
    label: "學生批次新增範例",
    caption: "表頭為電子郵件地址或帳號、姓名與該身分的名冊欄位",
  },
  {
    mode: "update",
    role: "student",
    href: "/api/admin/downloads/範例_身分名冊管理_學生批次修改.xlsx",
    label: "學生批次修改範例",
    caption: "表頭為辨識欄位（電子郵件地址或帳號）與欲修改的欄位，留空表示不修改",
  },
  {
    mode: "delete",
    role: "student",
    href: "/api/admin/downloads/範例_身分名冊管理_學生批次刪除.xlsx",
    label: "學生批次刪除範例",
    caption: "表頭為辨識欄位（電子郵件地址或帳號），用來指定要刪除的列",
  },
  {
    mode: "create",
    role: "staff",
    href: "/api/admin/downloads/範例_身分名冊管理_教職員批次新增.xlsx",
    label: "教職員批次新增範例",
    caption:
      "表頭為電子郵件地址或帳號、姓名與該身分的名冊欄位；屬性限教師／兼導師／兼行政／職員，導師等兼任職務請填在職稱",
  },
  {
    mode: "update",
    role: "staff",
    href: "/api/admin/downloads/範例_身分名冊管理_教職員批次修改.xlsx",
    label: "教職員批次修改範例",
    caption: "表頭為辨識欄位（電子郵件地址或帳號）與欲修改的欄位，留空表示不修改",
  },
  {
    mode: "delete",
    role: "staff",
    href: "/api/admin/downloads/範例_身分名冊管理_教職員批次刪除.xlsx",
    label: "教職員批次刪除範例",
    caption: "表頭為辨識欄位（電子郵件地址或帳號），用來指定要刪除的列",
  },
  {
    mode: "create",
    role: "admin",
    href: "/api/admin/downloads/範例_身分名冊管理_管理員批次新增.xlsx",
    label: "管理員批次新增範例",
    caption:
      "表頭為電子郵件地址或帳號、姓名與該身分的名冊欄位；屬性限一般／超級（必填），指定功能模組選填、超級管理員不需填",
  },
  {
    mode: "update",
    role: "admin",
    href: "/api/admin/downloads/範例_身分名冊管理_管理員批次修改.xlsx",
    label: "管理員批次修改範例",
    caption: "表頭為辨識欄位（電子郵件地址或帳號）與欲修改的欄位，留空表示不修改",
  },
  {
    mode: "delete",
    role: "admin",
    href: "/api/admin/downloads/範例_身分名冊管理_管理員批次刪除.xlsx",
    label: "管理員批次刪除範例",
    caption: "表頭為辨識欄位（電子郵件地址或帳號），用來指定要刪除的列",
  },
];

const BATCH_ACTION_LABELS: Record<RosterBatchRow["action"], string> = {
  create: "新增",
  update: "修改",
  delete: "刪除",
  skip: "略過",
};

function describeBatchRow(item: RosterBatchRow): string {
  if (item.action === "skip") {
    return `第 ${item.row} 列 · 略過「${item.key}」：${item.reason}`;
  }
  const changes = (item.changes ?? [])
    .map((change) => `${change.label} ${change.from || "（空）"} → ${change.to || "（空）"}`)
    .join("、");
  return `第 ${item.row} 列 · ${BATCH_ACTION_LABELS[item.action]}「${item.key}」${
    changes ? `：${changes}` : ""
  }`;
}

/** 全部身分欄位的空白表單（帳號欄位＋各名冊專屬欄位） */
function buildEmptyForm(): Record<RosterFieldKey, string> {
  const out = {} as Record<RosterFieldKey, string>;
  for (const fields of Object.values(ROSTER_FIELDS)) {
    for (const field of fields) out[field.key] = "";
  }
  return out;
}
const EMPTY_FORM = buildEmptyForm();

/** 屬於「使用者帳號」（無學年度學期）的表單欄位 */
function isAccountField(key: RosterFieldKey): boolean {
  return (ACCOUNT_FIELD_KEYS as readonly string[]).includes(key);
}

/** 狀態標籤配色：有效＝綠、停用＝黃 */
const STATUS_STYLE: Record<AccountStatus, string> = {
  有效: "text-success",
  無效: "text-warning",
};

/** 清單儲格值：該身分沒有這個欄位時顯示破折號 */
function cellValue(member: RosterMember, key: RosterColumnKey): string {
  if (key === "preferredRole") {
    if (!member.preferredRole) return "—";
    return ROLE_LABELS[member.preferredRole] || member.preferredRole;
  }
  if (key === "modules") {
    // 超級＝全開由屬性決定，與欄位內容無關（欄位可能為空值）
    if (member.attribute === "超級") return "超級（全部）";
    const modules = member.modules ?? [];
    if (modules.length === 0) return "—";
    const labels = ADMIN_MODULES.filter((item) => modules.includes(item.value)).map(
      (item) => item.label
    );
    return labels.join("、") || "—";
  }
  const record = member as unknown as Record<string, string | undefined>;
  return record[key] || "—";
}

/** 全螢幕遮罩（儲存／刪除／匯入中）：淡入過場並擋住下方所有操作 */
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

export default function RosterPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [role, setRole] = useState<RosterRole>("student");
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [flash, setFlash] = useState<Flash>(null);

  // 新增／編輯表單
  const [formOpen, setFormOpen] = useState(false);
  const [editingUid, setEditingUid] = useState("");
  const [form, setForm] = useState<Record<RosterFieldKey, string>>(EMPTY_FORM);
  // 新增＝綁定既有帳號（一個帳號最多四種身分）；帳號與密碼屬「使用者帳號管理」
  const [bindKey, setBindKey] = useState("");
  const [bindTarget, setBindTarget] = useState<BindTarget | null>(null);
  const [bindLoading, setBindLoading] = useState(false);
  const [bindError, setBindError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  // 儲存成功提示 modal：完成時跳出，3 秒後自動消失
  const [successModal, setSuccessModal] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // 批次管理：上傳試算表 → 預覽 → 確認執行（卡片預設收合）
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRole, setBatchRole] = useState<RosterRole>("student");
  const [batchMode, setBatchMode] = useState<RosterBatchMode>("create");
  // 寫入策略（僅新增模式）：追加＝保留既有條目；覆蓋＝先清空本期該身分再新增
  const [batchStrategy, setBatchStrategy] = useState<RosterBatchStrategy>("append");
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchBusy, setBatchBusy] = useState<"" | "preview" | "execute">("");
  const [batchPreview, setBatchPreview] = useState<RosterBatchPreview | null>(null);
  const [batchResult, setBatchResult] = useState<RosterBatchResult | null>(null);
  const [batchError, setBatchError] = useState("");
  const batchFileRef = useRef<HTMLInputElement>(null);

  // 確認對話 modal：取代原生 confirm，樣式跟隨主題（danger＝破壞性操作以紅色確認鈕）
  const [confirmRequest, setConfirmRequest] = useState<{
    message: string;
    onConfirm: () => void;
    danger?: boolean;
  } | null>(null);

  function askConfirm(message: string, onConfirm: () => void, danger = false) {
    setConfirmRequest({ message, onConfirm, danger });
  }

  // 操作欄下拉選單（與「使用者帳號管理」一致）：記錄開啟的列與定位
  const [menu, setMenu] = useState<{
    uid: string;
    right: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  // 選單開啟時：點外部、按 Esc、捲動頁面都收合
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-roster-menu]")) return;
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

  /** 依按鈕位置開啟操作選單；同一列再按一次即收合 */
  function toggleMenu(event: ReactMouseEvent<HTMLButtonElement>, uid: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu((prev) => {
      if (prev?.uid === uid) return null;
      const openUp = rect.bottom + 200 > window.innerHeight;
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

  // 確認 modal：Esc 取消
  useEffect(() => {
    if (!confirmRequest) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmRequest(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmRequest]);

  const loadMembers = async (targetRole: RosterRole) => {
    setLoading(true);
    setListError("");
    try {
      const res = await fetch(`/api/admin/roster?role=${targetRole}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || "帳號清單載入失敗");
      }
      setMembers(Array.isArray(data.members) ? data.members : []);
    } catch (error) {
      setMembers([]);
      setListError(error instanceof Error ? error.message : "帳號清單載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
      })
      .catch((error) => console.error("載入設定失敗:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setKeyword("");
    closeForm();
    void loadMembers(role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  function closeForm() {
    setFormOpen(false);
    setEditingUid("");
    setForm(EMPTY_FORM);
    setBindKey("");
    setBindTarget(null);
    setBindError("");
    setFormError("");
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setBindKey("");
    setBindTarget(null);
    setBindError("");
    setEditingUid("");
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(member: RosterMember) {
    const next = { ...EMPTY_FORM };
    const record = member as unknown as Record<string, unknown>;
    for (const field of ROSTER_FIELDS[role]) {
      if (field.key === "modules") {
        // 超級＝全開，儲存值多為系統預設（非使用者勾選），不帶入表單；
        // 使用者未重新勾選即視為未提供，儲存為空值
        next.modules = record.attribute === "超級" ? "" : (member.modules ?? []).join(",");
        continue;
      }
      const value = record[field.key];
      next[field.key] = typeof value === "string" ? value : "";
    }
    setForm(next);
    setBindKey("");
    setBindTarget(null);
    setBindError("");
    setEditingUid(member.uid);
    setFormError("");
    setFormOpen(true);
  }

  /** 綁定既有帳號：以電子郵件或帳號查詢，確認該帳號本期具備哪些身分 */
  async function handleLookup() {
    if (bindLoading) return;
    const key = bindKey.trim();
    if (!key) {
      setBindError("請輸入要綁定的電子郵件或帳號");
      setBindTarget(null);
      return;
    }
    setBindLoading(true);
    setBindError("");
    setBindTarget(null);
    setFormError("");
    try {
      const res = await fetch(`/api/admin/roster?lookup=${encodeURIComponent(key)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setBindError(data?.message || "查無此帳號");
        return;
      }
      const account = data.account;
      if (!account || typeof account.uid !== "string") {
        setBindError("查無此帳號");
        return;
      }
      setBindTarget({
        uid: account.uid,
        email: typeof account.email === "string" ? account.email : "",
        account: typeof account.account === "string" ? account.account : "",
        name: typeof account.name === "string" ? account.name : "",
        roles: Array.isArray(account.roles) ? account.roles : [],
      });
    } catch (error) {
      setBindError(error instanceof Error ? error.message : "查無此帳號");
    } finally {
      setBindLoading(false);
    }
  }

  function handleField(key: RosterFieldKey, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleModule(value: string) {
    setForm((prev) => {
      const list = prev.modules
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const next = list.includes(value)
        ? list.filter((item) => item !== value)
        : [...list, value];
      return { ...prev, modules: next.join(",") };
    });
  }

  /** 名冊專屬欄位驗證（建立／綁定／編輯都會檢查），與伺服器規則一致 */
  function validateRosterFields(): string | null {
    if (role === "student" && !form.studentId.trim()) return "請填寫學號";
    if (role === "admin") {
      if (form.attribute !== "一般" && form.attribute !== "超級") {
        return "請選擇管理員屬性（一般／超級）";
      }
      // 指定功能模組為可選欄位，未指定＝該一般管理員暫無可用功能模組
    }
    return null;
  }

  /** 儲存完成的成功訊息：跳出 modal，3 秒後自動消失（重複呼叫會重置計時） */
  function showSuccessModal(text: string) {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSuccessModal(text);
    successTimerRef.current = setTimeout(() => {
      setSuccessModal(null);
      successTimerRef.current = null;
    }, 3000);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const roleLabel = ROSTER_ROLES.find((item) => item.value === role)?.label ?? "身分";
    const isEdit = Boolean(editingUid);

    let message: string | null;
    if (isEdit) {
      message = validateRosterFields();
    } else if (!bindTarget) {
      message = "請先查詢要綁定的帳號";
    } else if (bindTarget.roles.includes(role)) {
      message = `此帳號本期已具備${roleLabel}身分`;
    } else {
      message = validateRosterFields();
    }
    if (message) {
      setFormError(message);
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const input: RosterInput = { ...form };
      const body: Record<string, unknown> = isEdit
        ? { role, uid: editingUid, input }
        : { role, uid: bindTarget!.uid, input };
      const res = await fetch("/api/admin/roster", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFormError(data?.message || "儲存失敗");
        return;
      }
      setFlash({ type: "success", text: data.message || "已儲存" });
      showSuccessModal(data.message || "已儲存");
      closeForm();
      await loadMembers(role);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(member: RosterMember) {
    const label = `${member.name}（${member.account || member.email}）`;
    const roleLabel = ROSTER_ROLES.find((item) => item.value === role)?.label ?? "身分";
    askConfirm(
      `確定刪除 ${label} 的本期${roleLabel}名冊資料？只刪除本期資料，帳號與其他學期資料保留（如需刪除帳號，請至「使用者帳號管理」）。`,
      () => void performDelete(member),
      true
    );
  }

  async function performDelete(member: RosterMember) {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/roster", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, uid: member.uid }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFlash({ type: "error", text: data?.message || "刪除失敗" });
        return;
      }
      setFlash({ type: "success", text: data.message || "已刪除" });
      showSuccessModal(data.message || "已刪除");
      if (editingUid === member.uid) closeForm();
      await loadMembers(role);
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "刪除失敗" });
    } finally {
      setDeleting(false);
    }
  }

  /**
   * 設定「本期該身分」的名冊狀態。
   * 帳號層狀態（能否登入）於「使用者帳號管理」工作表調整。
   */
  async function handleSetStatus(member: RosterMember, status: AccountStatus) {
    if (toggling) return;
    const current = member.rosterStatus;
    if (status === current) return;
    const label = `${member.name}（${member.account || member.email}）`;
    const roleLabel = ROSTER_ROLES.find((item) => item.value === role)?.label ?? "身分";
    const question =
      status === "有效"
        ? `確定恢復 ${label} 本期${roleLabel}身分狀態為「有效」？`
        : `確定停用 ${label} 本期${roleLabel}身分？僅停用本期該身分，其他身分與帳戶登入不受影響。`;
    if (!window.confirm(question)) return;

    setToggling(true);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, uid: member.uid, status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFlash({ type: "error", text: data?.message || "狀態更新失敗" });
        return;
      }
      setFlash({ type: "success", text: data.message || "狀態已更新" });
      showSuccessModal(data.message || "狀態已更新");
      if (editingUid === member.uid) closeForm();
      await loadMembers(role);
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "狀態更新失敗",
      });
    } finally {
      setToggling(false);
    }
  }

  function clearBatchSelection() {
    setBatchFile(null);
    setBatchPreview(null);
    setBatchResult(null);
    setBatchError("");
    if (batchFileRef.current) batchFileRef.current.value = "";
  }

  function selectBatchMode(mode: RosterBatchMode) {
    setBatchMode(mode);
    setBatchStrategy("append");
    clearBatchSelection();
  }

  function selectBatchStrategy(strategy: RosterBatchStrategy) {
    if (strategy === batchStrategy) return;
    setBatchStrategy(strategy);
    clearBatchSelection();
  }

  /** 覆蓋模式：有略過列時禁止執行（避免清空後建不出來），伺服端也會擋下 */
  const replaceBlocked =
    batchMode === "create" &&
    batchStrategy === "replace" &&
    (batchPreview?.skipped ?? 0) > 0;
  /** 覆蓋模式已完成預覽，等待使用者確認執行 */
  const replacePending =
    batchMode === "create" && batchStrategy === "replace" && Boolean(batchPreview);

  function runBatch(dryRun: boolean) {
    if (!batchFile || batchBusy) return;
    if (dryRun) {
      void executeBatch(true);
      return;
    }
    if (replaceBlocked) return;
    const roleLabel = ROSTER_ROLES.find((item) => item.value === batchRole)?.label ?? "身分";
    const question =
      batchMode === "delete"
        ? `確定執行批次刪除？共 ${
            batchPreview?.deleted ?? 0
          } 筆本期${roleLabel}名冊資料將被刪除，帳號與其他學期資料保留。`
        : batchMode === "create" && batchStrategy === "replace"
          ? `確定執行「新增（覆蓋）」？將先刪除本期既有 ${
              batchPreview?.cleared ?? 0
            } 筆${roleLabel}名冊，再依檔案新增 ${
              batchPreview?.created ?? 0
            } 筆；不在檔案內的資料會一併刪除，刪除後無法復原。`
          : `確定執行批次「${ROSTER_BATCH_MODE_LABELS[batchMode]}」？共 ${
              batchPreview?.total ?? 0
            } 列。`;
    askConfirm(
      question,
      () => void executeBatch(false),
      batchMode === "delete" || (batchMode === "create" && batchStrategy === "replace")
    );
  }

  async function executeBatch(dryRun: boolean) {
    if (!batchFile || batchBusy) return;
    setBatchBusy(dryRun ? "preview" : "execute");
    setBatchError("");
    try {
      const body = new FormData();
      body.append("mode", batchMode);
      body.append("role", batchRole);
      body.append("strategy", batchStrategy);
      body.append("dryRun", dryRun ? "true" : "false");
      body.append("file", batchFile);
      const res = await fetch("/api/admin/roster/batch", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || "批次作業失敗");
      }
      if (dryRun) {
        setBatchResult(null);
        setBatchPreview(data.preview as RosterBatchPreview);
      } else {
        setBatchPreview(null);
        setBatchResult(data.result as RosterBatchResult);
        setBatchFile(null);
        if (batchFileRef.current) batchFileRef.current.value = "";
        if (batchRole === role) await loadMembers(role);
        showSuccessModal(data.message || "批次作業完成");
      }
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : "批次作業失敗");
    } finally {
      setBatchBusy("");
    }
  }

  /** 屬性欄位：教職員＝教師／兼導師／兼行政／職員；管理員＝一般／超級 */
  function renderAttributeSelect(field: RosterFieldDef) {
    const options =
      role === "admin"
        ? [
            { value: "", label: "請選擇屬性" },
            { value: "一般", label: "一般（指定功能模組）" },
            { value: "超級", label: "超級（全開）" },
          ]
        : [
            { value: "", label: "請選擇屬性" },
            ...STAFF_ATTRIBUTES.map((value) => ({ value, label: value })),
            // 資料庫殘留的非標準值照原樣顯示，避免選單變成空白
            ...(!STAFF_ATTRIBUTES.includes(form.attribute as StaffAttribute) &&
            form.attribute
              ? [{ value: form.attribute, label: form.attribute }]
              : []),
          ];
    return (
      <div key={field.key} className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="text-t2 sm:w-40 shrink-0 flex items-center gap-1">
          {field.label}
          {role === "admin" && <span className="text-t1">*</span>}
        </label>
        <select
          value={form.attribute}
          onChange={(e) => handleField("attribute", e.target.value)}
          className="flex-1 input-theme rounded px-3 py-2"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {role === "staff" && (
          <span className="text-xs text-t3 sm:max-w-64">
            教師＝純教學；兼導師＝任導師；兼行政＝組長／主任等行政職或職員編制；職員＝專任行政人員。
          </span>
        )}
      </div>
    );
  }

  /** 指定功能模組（可選）：一般管理員勾選可使用的功能；超級管理員全開、不需勾選 */
  function renderModules() {
    const isSuper = form.attribute === "超級";
    const selected = form.modules
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    // 基本模組（系統設定）不列入指派：入口對每位管理員顯示，可用功能僅超級管理員
    const assignable = ADMIN_MODULES.filter(
      (module) => !(BASE_ADMIN_MODULES as readonly string[]).includes(module.value)
    );
    return (
      <div className="flex flex-col sm:flex-row sm:items-start gap-2">
        <label className="text-t2 sm:w-40 shrink-0">指定功能模組</label>
        <div className="flex-1 flex flex-wrap gap-x-4 gap-y-2">
          {assignable.map((module) => (
            <label key={module.value} className="flex items-center gap-1.5 text-sm text-t1">
              <input
                type="checkbox"
                checked={isSuper || selected.includes(module.value)}
                disabled={isSuper}
                onChange={() => toggleModule(module.value)}
                className="accent-current"
              />
              {module.label}
            </label>
          ))}
          <span className="w-full text-xs text-t3">
            可選欄位：只記錄您實際勾選的內容，未勾選也能儲存；「系統設定」入口一律顯示、但可用功能僅超級管理員，故不列入指派；
            超級管理員＝全開，由屬性判定、不看此欄位。
          </span>
        </div>
      </div>
    );
  }

  /** 單一表單欄位：屬性／模組為特殊控制項，其餘為文字／電子郵件輸入 */
  function renderField(field: RosterFieldDef) {
    if (field.key === "attribute") return renderAttributeSelect(field);
    if (field.key === "modules") return renderModules();
    // 編輯時帳號欄位唯讀：姓名／信箱／帳號屬帳號層
    const readOnly = Boolean(editingUid) && isAccountField(field.key);
    return (
      <div key={field.key} className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="text-t2 sm:w-40 shrink-0 flex items-center gap-1">
          {field.label}
          {field.required && !readOnly && <span className="text-t1">*</span>}
        </label>
        <input
          type={field.key === "email" || field.key === "studentEmail" ? "email" : "text"}
          value={form[field.key] ?? ""}
          onChange={(e) => handleField(field.key, e.target.value)}
          readOnly={readOnly}
          autoComplete="off"
          className={`flex-1 input-theme rounded px-3 py-2 ${readOnly ? "opacity-75" : ""}`}
        />
      </div>
    );
  }

  function handleBack() {
    router.push("/admin");
  }

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return members;
    return members.filter((member) => {
      const record = member as unknown as Record<string, unknown>;
      return Object.entries(record)
        .filter(([field]) => field !== "uid" && field !== "lastLogin")
        .map(([field, value]) => {
          const text = Array.isArray(value) ? value.join(" ") : String(value ?? "");
          return field === "status" || field === "rosterStatus"
            ? `${text} ${statusLabel(value as AccountStatus)}`
            : text;
        })
        .some((value) => value.toLowerCase().includes(key));
    });
  }, [members, keyword]);

  const columns = ROSTER_COLUMNS[role];
  const menuTarget = menu ? members.find((item) => item.uid === menu.uid) : null;
  // 家長不提供檔案匯入：新增模式下鎖住檔案選擇與上傳預覽
  const batchCreateBlocked = batchMode === "create" && !isImportableRole(batchRole);
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
      <div className="w-full max-w-5xl mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">身分名冊管理</h2>
      </div>

      {/* 操作按鈕 */}
      <div className="w-full max-w-5xl flex justify-end gap-3 mb-4">{actionButtons}</div>

      <hr className="w-full max-w-5xl border-themed mb-4" />

      {/* 身分啟用／停用（原「身分管理」頁併入本頁頂端） */}
      <div className="w-full max-w-5xl mb-6">
        <RoleEnablePanel />
      </div>

      {/* 批次管理：上傳試算表 → 預覽 → 確認執行（原「Excel 匯入」整併於此，預設收合） */}
      <div className="w-full max-w-5xl border border-themed rounded-lg bg-card p-4 mb-6">
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
            {/* 身分選擇：切換時同步帶動下方名冊分頁 */}
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <label htmlFor="roster-batch-role" className="text-sm text-t2">
                身分
              </label>
              <select
                id="roster-batch-role"
                value={batchRole}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!isRosterRole(next)) return;
                  setBatchRole(next);
                  setRole(next);
                  clearBatchSelection();
                }}
                className="input-theme rounded px-3 py-2 text-sm"
              >
                {ROSTER_ROLES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-t3">
                Excel／CSV（.xlsx、.xls、.csv），上傳後先預覽再執行
              </span>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {ROSTER_BATCH_MODES.map((item) => (
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

            {/* 寫入策略：僅新增模式，追加＝保留既有條目 */}
            {batchMode === "create" && !batchCreateBlocked && (
              <div className="flex flex-wrap items-center gap-4 mb-3">
                <span className="text-sm text-t2">寫入方式</span>
                {ROSTER_BATCH_STRATEGIES.map((item) => (
                  <label
                    key={item.value}
                    className="flex items-center gap-2 text-sm text-t2 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="roster-batch-strategy"
                      value={item.value}
                      checked={batchStrategy === item.value}
                      onChange={() => selectBatchStrategy(item.value)}
                      className="cursor-pointer"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
                <span className="text-xs text-t3">
                  {ROSTER_BATCH_STRATEGIES.find((item) => item.value === batchStrategy)?.hint}
                </span>
              </div>
            )}

            {/* 覆蓋警語：選到覆蓋就先提醒破壞性 */}
            {batchMode === "create" &&
              !batchCreateBlocked &&
              batchStrategy === "replace" && (
                <p className="text-sm text-danger font-medium mb-3" role="alert">
                  警語：覆蓋會刪除同期既有的全部該身分名冊（不在檔案內者會一併刪除），刪除後無法復原。
                </p>
              )}

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
                disabled={batchCreateBlocked}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
              >
                選擇檔案
              </button>
              <span className="text-sm text-t2">
                {batchFile ? batchFile.name : "尚未選擇檔案"}
              </span>
              <button
                type="button"
                onClick={() => void runBatch(true)}
                disabled={!batchFile || batchCreateBlocked}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
              >
                上傳預覽
              </button>
              {batchPreview && (
                <>
                  <button
                    type="button"
                    onClick={() => void runBatch(false)}
                    disabled={replaceBlocked}
                    className={`rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50 ${
                      replacePending ? "btn-danger" : "btn-theme"
                    }`}
                  >
                    {replacePending ? "確認覆蓋" : "確認執行"}
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
              {batchHint(batchMode, batchRole, batchStrategy).map((item) => (
                <li key={item}>{item}</li>
              ))}
              {BATCH_SAMPLE_FILES.filter(
                (item) => item.role === batchRole && item.mode === batchMode
              ).map((item) => (
                <li key={item.href}>
                  範例檔下載：
                  <a
                    href={encodeURI(item.href)}
                    download
                    className="text-t2 underline hover:text-t1"
                  >
                    {item.label}
                  </a>
                  ，可另存修改後再上傳（{item.caption}）
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
                  {batchPreview.strategy === "replace"
                    ? `預覽（覆蓋）：先刪除本期既有 ${batchPreview.cleared} 筆，再新增 ${batchPreview.created} 筆、更新 ${batchPreview.updated} 筆、刪除 ${batchPreview.deleted} 筆、略過 ${batchPreview.skipped} 筆（共 ${batchPreview.total} 列）`
                    : `預覽：新增 ${batchPreview.created} 筆、更新 ${batchPreview.updated} 筆、刪除 ${batchPreview.deleted} 筆、略過 ${batchPreview.skipped} 筆（共 ${batchPreview.total} 列）`}
                </p>
                {batchPreview.strategy === "replace" && (
                  <p className="text-xs text-danger font-medium mb-2" role="alert">
                    警語：執行後將刪除本期既有 {batchPreview.cleared} 筆資料，不在檔案內的資料會一併刪除，無法復原。
                  </p>
                )}
                {replaceBlocked && (
                  <p className="text-xs text-danger mb-2" role="alert">
                    覆蓋模式不允許略過列：請先修正略過的列並重新上傳預覽，才能執行。
                  </p>
                )}
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
                  批次作業完成：
                  {batchResult.cleared > 0 ? `覆蓋刪除 ${batchResult.cleared} 筆、` : ""}
                  新增 {batchResult.created} 筆、更新 {batchResult.updated} 筆、刪除{" "}
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

      {/* 身分分頁 */}
      <div className="w-full max-w-5xl flex flex-wrap gap-2 mb-4">
        {ROSTER_ROLES.map((item) => (
          <button
            key={item.value}
            onClick={() => setRole(item.value)}
            className={`rounded-lg px-4 py-2 text-sm cursor-pointer border ${
              role === item.value
                ? "btn-theme"
                : "border-themed text-t2 bg-card hover:text-t1"
            }`}
          >
            {item.tab}
          </button>
        ))}
      </div>

      {/* 工具列：搜尋、新增 */}
      <div className="w-full max-w-5xl flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜尋姓名、帳號、信箱、學號或班級"
          className="flex-1 min-w-[200px] input-theme rounded px-3 py-2"
        />
        <button
          onClick={openCreate}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          新增{ROSTER_ROLES.find((item) => item.value === role)?.label}
        </button>
      </div>

      {/* 提示訊息 */}
      {flash && (
        <div
          className="w-full max-w-5xl mb-4 rounded-lg border border-themed px-4 py-3 text-sm text-t1 bg-card"
          role="status"
        >
          {flash.text}
        </div>
      )}

      {/* 新增／編輯表單 */}
      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-5xl border border-themed rounded-lg p-6 mb-4 bg-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-t1">
              {editingUid ? "編輯" : "新增"}
              {ROSTER_ROLES.find((item) => item.value === role)?.label}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="btn-theme rounded-lg px-3 py-1.5 text-sm cursor-pointer"
            >
              取消
            </button>
          </div>

          {editingUid ? (
            <div className="space-y-4">
              <p className="text-sm font-bold text-t2 border-b border-themed pb-1">
                帳號資料（唯讀）
              </p>
              {ROSTER_FIELDS[role]
                .filter((field) => isAccountField(field.key))
                .map(renderField)}
              <p className="text-xs text-t3">
                姓名、電子郵件、帳號（含密碼、慣用身分與帳號狀態）請至「使用者帳號管理」維護。
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm font-bold text-t2 border-b border-themed pb-1">
                綁定既有帳號
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-t2 sm:w-40 shrink-0">電子郵件或帳號</label>
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={bindKey}
                    onChange={(e) => {
                      setBindKey(e.target.value);
                      setBindTarget(null);
                      setBindError("");
                    }}
                    placeholder="例如 name@school.edu 或 student01"
                    autoComplete="off"
                    className="flex-1 input-theme rounded px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={() => void handleLookup()}
                    disabled={bindLoading}
                    className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                  >
                    {bindLoading ? "查詢中..." : "查詢帳號"}
                  </button>
                </div>
              </div>
              {bindTarget && (
                <div className="border border-themed rounded-lg p-3 text-sm text-t1 bg-page">
                  <p className="font-bold">
                    {bindTarget.name}（{bindTarget.account || bindTarget.email}）
                  </p>
                  <p className="text-t2 mt-1">電子郵件：{bindTarget.email || "（無，以帳號登入）"}</p>
                  <p className="text-t2 mt-1">
                    本期已具備身分：
                    {bindTarget.roles.length
                      ? bindTarget.roles.map((item) => ROLE_LABELS[item]).join("、")
                      : "無"}
                  </p>
                </div>
              )}
              {bindError && (
                <p className="text-sm text-t1 border border-themed rounded px-3 py-2" role="alert">
                  {bindError}
                </p>
              )}
              <p className="text-xs text-t3">
                一個帳號最多具備四種身分（同身分同期間僅一筆）；本頁只建立名冊條目，
                不建立帳號、不處理密碼——帳號請先至「使用者帳號管理」建立。
              </p>
            </div>
          )}

          {ROSTER_FIELDS[role].some((field) => !isAccountField(field.key)) && (
            <div className="space-y-4 mt-5">
              <p className="text-sm font-bold text-t2 border-b border-themed pb-1">
                {settings.academicYear} 學年度 第{settings.semester}學期 名冊
              </p>
              {ROSTER_FIELDS[role]
                .filter((field) => !isAccountField(field.key))
                .map(renderField)}
            </div>
          )}

          <p className="text-sm text-t3 mt-3">
            {role === "admin"
              ? "管理員另可指定屬性與功能模組（超級＝全開）。"
              : "名冊欄位屬於本學年度學期，切換學期後需重新維護。"}
          </p>

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

      {/* 帳號清單 */}
      <div className="w-full max-w-5xl border border-themed rounded-lg bg-card mb-4 overflow-x-auto">
        {loading ? (
          <p className="p-6 text-center text-t3">帳號清單載入中...</p>
        ) : listError ? (
          <p className="p-6 text-center text-t1">{listError}</p>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="border-b border-themed">
              <tr className="text-t2">
                <th className="px-3 py-2 font-medium whitespace-nowrap">狀態</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">姓名</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">對應使用者</th>
                {columns.map((column) => (
                  <th key={column.key} className="px-3 py-2 font-medium whitespace-nowrap">
                    {column.label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium whitespace-nowrap text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + 4}
                    className="px-3 py-6 text-center text-t3"
                  >
                    {members.length === 0 ? "目前沒有資料" : "沒有符合的資料"}
                  </td>
                </tr>
              )}
              {filtered.map((member) => (
                <tr key={member.uid} className="border-b border-themed last:border-0 text-t1">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`inline-block rounded-full border border-themed px-2 py-0.5 text-xs ${STATUS_STYLE[member.rosterStatus]}`}
                    >
                      {statusLabel(member.rosterStatus)}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{member.name || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div>{member.email || "—"}</div>
                    <div className="text-xs text-t2">{member.account || "—"}</div>
                  </td>
                  {columns.map((column) => (
                    <td key={column.key} className="px-3 py-2 whitespace-nowrap">
                      {cellValue(member, column.key)}
                    </td>
                  ))}
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button
                      type="button"
                      data-roster-menu
                      aria-haspopup="menu"
                      aria-expanded={menu?.uid === member.uid}
                      onClick={(event) => toggleMenu(event, member.uid)}
                      className="btn-theme rounded px-3 py-1 text-xs cursor-pointer inline-flex items-center gap-1"
                    >
                      操作
                      <svg
                        className={`w-3 h-3 transition-transform ${
                          menu?.uid === member.uid ? "rotate-180" : ""
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                        />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {menu && menuTarget && (
        <div
          role="menu"
          data-roster-menu
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
          {menuTarget.rosterStatus === "有效" ? (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => runMenuAction(() => void handleSetStatus(menuTarget, "無效"))}
            >
              停用
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => runMenuAction(() => void handleSetStatus(menuTarget, "有效"))}
            >
              啟用
            </button>
          )}
          <div className="my-1 border-t border-themed" />
          <button
            type="button"
            role="menuitem"
            className="menu-item is-danger"
            onClick={() => runMenuAction(() => handleDelete(menuTarget))}
          >
            刪除（無法復原）
          </button>
        </div>
      )}

      <hr className="w-full max-w-5xl border-themed mb-4" />

      {/* 底部操作按鈕 */}
      <div className="w-full max-w-5xl flex justify-start gap-3 mb-8">{actionButtons}</div>

      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-5xl">
          <AdSense />
        </div>
      )}

      <div className="w-full max-w-5xl mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>

      {/* 作業遮罩：儲存／刪除／狀態切換／批次作業期間覆蓋畫面、阻擋重複操作 */}
      {(saving || deleting || toggling || batchBusy) && (
        <BlockingMask
          text={
            toggling
              ? "更新狀態中，請稍候…"
              : deleting
                ? "刪除中，請稍候…"
                : batchBusy
                  ? batchBusy === "execute"
                    ? "批次執行中，請稍候…"
                    : "上傳預覽中，請稍候…"
                  : "儲存中，請稍候…"
          }
        />
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
              {/* 危險操作統一警示：四種身分的刪除都無法復原 */}
              {confirmRequest.danger && (
                <p className="alert-danger mt-3 px-3 py-2 text-sm font-bold" role="alert">
                  <span className="text-danger">刪除後無法復原</span>
                </p>
              )}
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
                className={`rounded-lg px-4 py-2 text-sm cursor-pointer ${
                  confirmRequest.danger ? "btn-danger" : "btn-theme"
                }`}
              >
                確認
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
    </div>
  );
}
