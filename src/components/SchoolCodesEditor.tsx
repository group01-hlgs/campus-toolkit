"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CODES_MAX_DEPARTMENTS,
  CODES_MAX_GROUPS,
  CODES_VOC_CODE_MAX,
  CODES_VOC_NAME_MAX,
  SchoolCodesSetting,
  defaultSchoolCodes,
  readSchoolCodes,
  validateSchoolCodes,
} from "@/types/school-codes";
import { SCHOOL_CODES_SOURCES } from "@/data/schoolCodesSeed";

type Modal = { type: "success" | "error"; text: string } | null;
type ListKey = "groups" | "departments";
type CodesResponse = { success?: boolean; message?: string; setting?: unknown };

/** 儲存結果過場視窗的停留時間 */
const MODAL_DURATION_MS = 2000;

const LIST_META: Record<
  ListKey,
  { label: string; cap: number; namePlaceholder: string; codePlaceholder: string }
> = {
  groups: {
    label: "群別",
    cap: CODES_MAX_GROUPS,
    namePlaceholder: "名稱，如：機械群",
    codePlaceholder: "代碼，如：21",
  },
  departments: {
    label: "科別",
    cap: CODES_MAX_DEPARTMENTS,
    namePlaceholder: "名稱，如：機械科",
    codePlaceholder: "代碼，如：301",
  },
};

/**
 * 群別／科別代碼表編輯器（學校基本設定的子功能，系統的基礎資料庫）。
 * 自行讀取與儲存 `GET/PUT /api/admin/school/codes`；saved／draft 模式與
 * 其他學校基本設定子功能一致（還原、儲存變更、儲存遮罩與結果視窗）。
 */
export default function SchoolCodesEditor() {
  const [saved, setSaved] = useState<SchoolCodesSetting | null>(null);
  const [draft, setDraft] = useState<SchoolCodesSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [filter, setFilter] = useState<Record<ListKey, string>>({
    groups: "",
    departments: "",
  });
  /** 過場視窗的自動關閉計時器（重新彈出前先清掉舊的） */
  const modalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/school/codes", { cache: "no-store" });
      const data: CodesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.setting) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      const setting = readSchoolCodes(data.setting);
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

  const validation = useMemo(() => (draft ? validateSchoolCodes(draft) : null), [draft]);
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

  /** 修改某一列的代碼或名稱（依清單與列索引定位） */
  const changeRow = useCallback(
    (listKey: ListKey, index: number, field: "code" | "name", value: string) => {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              [listKey]: prev[listKey].map((item, position) =>
                position === index ? { ...item, [field]: value } : item
              ),
            }
          : prev
      );
    },
    []
  );

  /** 移除某一列 */
  const removeRow = useCallback((listKey: ListKey, index: number) => {
    setDraft((prev) =>
      prev ? { ...prev, [listKey]: prev[listKey].filter((_, i) => i !== index) } : prev
    );
  }, []);

  /** 在清單末尾新增一列空白列（填好代碼與名稱才能儲存） */
  const addRow = useCallback((listKey: ListKey) => {
    setDraft((prev) =>
      prev ? { ...prev, [listKey]: [...prev[listKey], { code: "", name: "" }] } : prev
    );
  }, []);

  function reset() {
    if (!saved) return;
    setDraft(saved);
    setModal(null);
  }

  /** 以內建官方清單取代目前草稿（仍需按「儲存變更」才寫入資料庫） */
  function restoreOfficial() {
    if (!window.confirm("確定用官方代碼表覆蓋目前的編輯內容？（尚未儲存的修改會遺失）")) return;
    setDraft(defaultSchoolCodes());
    setModal(null);
  }

  async function save() {
    if (!draft || !validation?.ok || saving) return;
    setSaving(true);
    setModal(null);
    try {
      const res = await fetch("/api/admin/school/codes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setting: draft }),
      });
      const data: CodesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `儲存失敗（HTTP ${res.status}）`);
      }
      const setting = readSchoolCodes(data.setting ?? draft);
      setSaved(setting);
      setDraft(setting);
      showModal("success", data.message || "代碼表已儲存");
    } catch (error) {
      showModal("error", error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-t3 py-4">代碼表載入中...</p>;
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

  return (
    <div className="mt-4">
      {/* 還原官方／還原／儲存 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-t3">
          內建預設取自課程計畫平臺（群別 {draft.groups.length} 筆、科別 {draft.departments.length} 筆）
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={restoreOfficial}
            disabled={saving}
            title="以內建的官方代碼表覆蓋目前編輯內容（需再按儲存變更才寫入）"
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            還原官方預設
          </button>
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
        本頁僅超級管理員可編輯，資料存於系統的基礎資料庫（settings/schoolCodes），
        同一資料庫的各分支共用。
      </p>

      <div className="space-y-4">
        {(["groups", "departments"] as ListKey[]).map((listKey) => {
          const meta = LIST_META[listKey];
          const keyword = filter[listKey].trim().toLowerCase();
          const rows = draft[listKey]
            .map((item, index) => ({ item, index }))
            .filter(
              ({ item }) =>
                !keyword ||
                item.code.toLowerCase().includes(keyword) ||
                item.name.toLowerCase().includes(keyword)
            );
          const capped = draft[listKey].length >= meta.cap;
          return (
            <section key={listKey} className="border border-themed rounded-lg p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-sm font-bold text-t1">{meta.label}清單</span>
                <span className="text-xs text-t3">
                  {draft[listKey].length} / {meta.cap} 筆
                </span>
                <input
                  type="search"
                  value={filter[listKey]}
                  onChange={(event) =>
                    setFilter((prev) => ({ ...prev, [listKey]: event.target.value }))
                  }
                  placeholder={`篩選${meta.label}代碼或名稱`}
                  aria-label={`篩選${meta.label}清單`}
                  className="input-theme rounded px-2 py-1 text-sm w-44 ml-auto"
                />
                <button
                  type="button"
                  onClick={() => addRow(listKey)}
                  disabled={capped}
                  title={capped ? `最多 ${meta.cap} 筆` : "於清單末尾新增一列"}
                  className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  新增一列
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm border border-themed">
                  <thead>
                    <tr className="bg-hover">
                      <th className="px-2 py-2 text-left text-xs font-bold text-t3 whitespace-nowrap">
                        代碼
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-bold text-t3 whitespace-nowrap">
                        名稱
                      </th>
                      <th className="px-2 py-2 text-left text-xs font-bold text-t3 whitespace-nowrap">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ item, index }) => (
                      <tr key={`${index}-${item.code}`} className="border-t border-themed">
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            maxLength={CODES_VOC_CODE_MAX}
                            value={item.code}
                            onChange={(event) =>
                              changeRow(listKey, index, "code", event.target.value)
                            }
                            placeholder={meta.codePlaceholder}
                            aria-label={`第 ${index + 1} 筆${meta.label}代碼`}
                            className="input-theme rounded px-2 py-1 text-sm w-28"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            maxLength={CODES_VOC_NAME_MAX}
                            value={item.name}
                            onChange={(event) =>
                              changeRow(listKey, index, "name", event.target.value)
                            }
                            placeholder={meta.namePlaceholder}
                            aria-label={`第 ${index + 1} 筆${meta.label}名稱`}
                            className="input-theme rounded px-2 py-1 text-sm w-64"
                          />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => removeRow(listKey, index)}
                            className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer"
                          >
                            移除
                          </button>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr className="border-t border-themed">
                        <td colSpan={3} className="px-2 py-2 text-xs text-t3">
                          {draft[listKey].length === 0
                            ? `尚無${meta.label}，按「新增一列」建立，或用「還原官方預設」帶入內建清單。`
                            : `沒有符合「${filter[listKey]}」的資料。`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-xs text-t3 mt-3">
        官方來源：
        <a
          href={SCHOOL_CODES_SOURCES.groups}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          群別代碼查詢
        </a>
        ／
        <a
          href={SCHOOL_CODES_SOURCES.departments}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          科別代碼查詢
        </a>
        （平台更新後可用「還原官方預設」重新帶入，再按儲存變更）。
      </p>

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
