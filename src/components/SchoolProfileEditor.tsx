"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EDUCATION_STAGES,
  PROFILE_ADDRESS_MAX,
  PROFILE_CAMPUS_NAME_MAX,
  PROFILE_MAX_CAMPUSES,
  PROFILE_MAX_VICE_PRINCIPALS,
  PROFILE_MAX_YEARS,
  PROFILE_MIN_CAMPUSES,
  PROFILE_NAME_MAX,
  PROFILE_PHONE_MAX,
  PROFILE_WEBSITE_MAX,
  SchoolProfile,
  StageValue,
  defaultYearsFor,
  newCampusId,
  readSchoolProfile,
  validateSchoolProfile,
} from "@/types/school-profile";
import { defaultSchoolCodes, readSchoolCodes, type VocCodeRow } from "@/types/school-codes";

type Modal = { type: "success" | "error"; text: string } | null;

/** 儲存結果過場視窗的停留時間 */
const MODAL_DURATION_MS = 2000;
type ProfileResponse = { success?: boolean; message?: string; profile?: unknown };
type CodesResponse = { success?: boolean; message?: string; setting?: unknown };

/** 高級中等學校的階段值（類型複選區只在勾選此階段時出現） */
const SENIOR_HIGH_STAGE: StageValue = "seniorHigh";

/** 一筆「代碼＋名稱」的識別鍵（複選判重用） */
function typeKey(item: VocCodeRow): string {
  return `${item.code}\u0000${item.name}`;
}

/**
 * 校務基本資料編輯器（學校基本設定的子功能）。
 * 自行讀取與儲存 `GET/PUT /api/admin/school/profile`；
 * 沿用單位層級設定的 saved／draft 模式：還原與儲存共用同一份未儲存狀態。
 */
export default function SchoolProfileEditor() {
  const [saved, setSaved] = useState<SchoolProfile | null>(null);
  const [draft, setDraft] = useState<SchoolProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  /** 過場視窗的自動關閉計時器（重新彈出前先清掉舊的） */
  const modalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 年制輸入框的暫存字串：允許清空後重打，失焦或輸入無效值時回復現值 */
  const [yearInputs, setYearInputs] = useState<Record<string, string>>({});
  /** 高級中等學校類型的候選清單（取自各式代碼表；讀取失敗退回內建官方清單） */
  const [typeOptions, setTypeOptions] = useState<VocCodeRow[]>(
    () => defaultSchoolCodes().schoolTypes
  );

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [res, codesRes] = await Promise.all([
        fetch("/api/admin/school/profile", { cache: "no-store" }),
        fetch("/api/admin/school/codes", { cache: "no-store" }).catch(() => null),
      ]);
      const data: ProfileResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.profile) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      const profile = readSchoolProfile(data.profile);
      setSaved(profile);
      setDraft(profile);
      if (codesRes && codesRes.ok) {
        const codesData: CodesResponse | null = await codesRes.json().catch(() => null);
        if (codesData?.success && codesData.setting) {
          setTypeOptions(readSchoolCodes(codesData.setting).schoolTypes);
        }
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

  const validation = useMemo(() => (draft ? validateSchoolProfile(draft) : null), [draft]);
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

  function toggleStage(stage: StageValue, checked: boolean) {
    if (!draft) return;
    setModal(null);
    const exists = draft.stages.some((item) => item.stage === stage);
    if (checked && !exists) {
      setDraft({
        ...draft,
        stages: [...draft.stages, { stage, years: defaultYearsFor(stage) }],
      });
      return;
    }
    if (!checked && exists) {
      setDraft({ ...draft, stages: draft.stages.filter((item) => item.stage !== stage) });
      setYearInputs((prev) => {
        const next = { ...prev };
        delete next[stage];
        return next;
      });
    }
  }

  function changeYears(stage: StageValue, raw: string) {
    if (!draft) return;
    setYearInputs((prev) => ({ ...prev, [stage]: raw }));
    const years = Number(raw);
    if (!Number.isInteger(years) || years < 1 || years > PROFILE_MAX_YEARS) return;
    setModal(null);
    setDraft({
      ...draft,
      stages: draft.stages.map((item) => (item.stage === stage ? { ...item, years } : item)),
    });
  }

  /** 高級中等學校類型複選：以「代碼＋名稱」判重，勾選即加入、取消即移除 */
  function toggleSeniorType(option: VocCodeRow, checked: boolean) {
    if (!draft) return;
    setModal(null);
    const exists = draft.seniorHighTypes.some((item) => typeKey(item) === typeKey(option));
    if (checked && !exists) {
      setDraft({ ...draft, seniorHighTypes: [...draft.seniorHighTypes, { ...option }] });
      return;
    }
    if (!checked && exists) {
      setDraft({
        ...draft,
        seniorHighTypes: draft.seniorHighTypes.filter(
          (item) => typeKey(item) !== typeKey(option)
        ),
      });
    }
  }

  function changePrincipal(value: string) {
    if (!draft) return;
    setModal(null);
    setDraft({ ...draft, principal: value });
  }

  function addVicePrincipal() {
    if (!draft || draft.vicePrincipals.length >= PROFILE_MAX_VICE_PRINCIPALS) return;
    setModal(null);
    setDraft({ ...draft, vicePrincipals: [...draft.vicePrincipals, ""] });
  }

  function changeVicePrincipal(index: number, value: string) {
    if (!draft) return;
    setModal(null);
    setDraft({
      ...draft,
      vicePrincipals: draft.vicePrincipals.map((item, position) =>
        position === index ? value : item
      ),
    });
  }

  function removeVicePrincipal(index: number) {
    if (!draft) return;
    setModal(null);
    setDraft({
      ...draft,
      vicePrincipals: draft.vicePrincipals.filter((_, position) => position !== index),
    });
  }

  function addCampus() {
    if (!draft || draft.campuses.length >= PROFILE_MAX_CAMPUSES) return;
    setModal(null);
    setDraft({
      ...draft,
      campuses: [...draft.campuses, { id: newCampusId(), name: "", address: "", phone: "" }],
    });
  }

  function changeCampus(id: string, field: "name" | "address" | "phone", value: string) {
    if (!draft) return;
    setModal(null);
    setDraft({
      ...draft,
      campuses: draft.campuses.map((campus) =>
        campus.id === id ? { ...campus, [field]: value } : campus
      ),
    });
  }

  function removeCampus(id: string) {
    if (!draft || draft.campuses.length <= PROFILE_MIN_CAMPUSES) return;
    setModal(null);
    setDraft({ ...draft, campuses: draft.campuses.filter((campus) => campus.id !== id) });
  }

  function reset() {
    if (!saved) return;
    setYearInputs({});
    setDraft(saved);
    setModal(null);
  }

  async function save() {
    if (!draft || !validation?.ok || saving) return;
    setSaving(true);
    setModal(null);
    try {
      const res = await fetch("/api/admin/school/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: draft }),
      });
      const data: ProfileResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `儲存失敗（HTTP ${res.status}）`);
      }
      const profile = readSchoolProfile(data.profile ?? draft);
      setSaved(profile);
      setDraft(profile);
      setYearInputs({});
      showModal("success", data.message || "校務基本資料已儲存");
    } catch (error) {
      showModal("error", error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-t3 py-4">校務基本資料載入中...</p>;
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

  const stageValues = new Set(draft.stages.map((item) => item.stage));
  const showSeniorTypes = stageValues.has(SENIOR_HIGH_STAGE);
  const seniorSelectedKeys = new Set(draft.seniorHighTypes.map(typeKey));
  const seniorOptions: VocCodeRow[] = [...typeOptions];
  const seniorOptionKeys = new Set(seniorOptions.map(typeKey));
  for (const item of draft.seniorHighTypes) {
    if (!seniorOptionKeys.has(typeKey(item))) {
      seniorOptionKeys.add(typeKey(item));
      seniorOptions.push(item);
    }
  }

  return (
    <div className="mt-4">
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
        <p className="text-danger text-sm mb-2" role="alert">
          {validation.message}
        </p>
      )}
      <p className="text-xs text-t3 mb-3">
        {dirty ? "有尚未儲存的變更，記得按「儲存變更」。" : "已與伺服器同步。"}
      </p>

      {/* 教育階段與年制 */}
      <section className="border border-themed rounded-lg p-4 mb-4">
        <h4 className="font-bold text-t1">教育階段與學校年制</h4>
        <p className="text-sm text-t3 mt-1 mb-3">
          勾選本校設有的教育階段，並填寫各階段的修業年數（例如國民小學 6 年制、高級中等學校 3 年制）。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {EDUCATION_STAGES.map((option) => {
            const checked = stageValues.has(option.value);
            const current = draft.stages.find((item) => item.stage === option.value);
            return (
              <div
                key={option.value}
                className="flex items-center gap-3 border border-themed rounded-lg px-3 py-2"
              >
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggleStage(option.value, event.target.checked)}
                    className="cursor-pointer"
                  />
                  <span className={checked ? "text-t1" : "text-t2"}>{option.label}</span>
                </label>
                {checked && (
                  <label className="flex items-center gap-1 text-sm ml-auto">
                    <span className="text-t3">年制</span>
                    <input
                      type="number"
                      min={1}
                      max={PROFILE_MAX_YEARS}
                      value={yearInputs[option.value] ?? String(current?.years ?? "")}
                      onChange={(event) => changeYears(option.value, event.target.value)}
                      onBlur={() =>
                        setYearInputs((prev) => {
                          const next = { ...prev };
                          delete next[option.value];
                          return next;
                        })
                      }
                      aria-label={`${option.label}學校年制`}
                      className="input-theme rounded px-2 py-1 text-sm w-16"
                    />
                    <span className="text-t3">年</span>
                  </label>
                )}
              </div>
            );
          })}
        </div>
        {showSeniorTypes && (
          <div className="border-t border-themed mt-3 pt-3">
            <p className="text-sm text-t2">高級中等學校類型清單（可複選）</p>
            <p className="text-xs text-t3 mt-1 mb-2">
              勾選本校辦理的類型，只描述學校辦理哪些類型學制，與年制設定無關；
              選項可在「學校基本設定 → 各式代碼表」維護。
            </p>
            {seniorOptions.length === 0 ? (
              <p className="text-xs text-t3">
                類型清單目前沒有選項，請先到「各式代碼表」新增「高級中等學校類型」。
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {seniorOptions.map((option) => {
                  const checked = seniorSelectedKeys.has(typeKey(option));
                  return (
                    <label
                      key={typeKey(option)}
                      className="flex items-center gap-2 border border-themed rounded-lg px-3 py-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => toggleSeniorType(option, event.target.checked)}
                        className="cursor-pointer"
                      />
                      <span className="text-xs text-t3">{option.code}</span>
                      <span className={checked ? "text-t1" : "text-t2"}>{option.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-t3 mt-2">
              {draft.seniorHighTypes.length === 0
                ? "尚未勾選類型（可留白）。"
                : `已勾選 ${draft.seniorHighTypes.length} 種。`}
            </p>
          </div>
        )}
        {draft.stages.length === 0 && (
          <p className="text-xs text-t3 mt-2">尚未選擇教育階段，可先留白、日後再補。</p>
        )}
      </section>

      {/* 校長與副校長 */}
      <section className="border border-themed rounded-lg p-4 mb-4">
        <h4 className="font-bold text-t1">現任校長與副校長</h4>
        <div className="mt-3">
          <label className="text-sm">
            <span className="block text-t2 mb-1">現任校長</span>
            <input
              type="text"
              maxLength={PROFILE_NAME_MAX}
              value={draft.principal}
              onChange={(event) => changePrincipal(event.target.value)}
              placeholder="請輸入現任校長姓名（可留空）"
              className="input-theme rounded px-3 py-2 text-sm w-full max-w-sm"
            />
          </label>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-sm text-t2">現任副校長（可多位）</span>
            <button
              type="button"
              onClick={addVicePrincipal}
              disabled={draft.vicePrincipals.length >= PROFILE_MAX_VICE_PRINCIPALS}
              className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              新增副校長
            </button>
            <span className="text-xs text-t3">
              {draft.vicePrincipals.length} / {PROFILE_MAX_VICE_PRINCIPALS}
            </span>
          </div>
          {draft.vicePrincipals.length === 0 ? (
            <p className="text-xs text-t3">目前未登錄副校長。</p>
          ) : (
            <div className="grid gap-2">
              {draft.vicePrincipals.map((name, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={PROFILE_NAME_MAX}
                    value={name}
                    onChange={(event) => changeVicePrincipal(index, event.target.value)}
                    placeholder={`第 ${index + 1} 位副校長姓名`}
                    aria-label={`第 ${index + 1} 位副校長`}
                    className="input-theme rounded px-3 py-2 text-sm w-full max-w-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeVicePrincipal(index)}
                    className="btn-theme rounded-lg px-3 py-2 text-xs cursor-pointer"
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 校區資料 */}
      <section className="border border-themed rounded-lg p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h4 className="font-bold text-t1">校區資料</h4>
            <p className="text-sm text-t3 mt-1">
              單一校區填 1 筆；多校區請按「新增校區」逐筆填寫地址與電話。
            </p>
          </div>
          <button
            type="button"
            onClick={addCampus}
            disabled={draft.campuses.length >= PROFILE_MAX_CAMPUSES}
            className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            新增校區
          </button>
        </div>

        <div className="grid gap-3 mt-3">
          {draft.campuses.map((campus, index) => (
            <div key={campus.id} className="border border-themed rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm font-bold text-t2">校區 {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeCampus(campus.id)}
                  disabled={draft.campuses.length <= PROFILE_MIN_CAMPUSES}
                  className="btn-theme rounded-lg px-3 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  刪除校區
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="block text-t2 mb-1">校區名稱</span>
                  <input
                    type="text"
                    maxLength={PROFILE_CAMPUS_NAME_MAX}
                    value={campus.name}
                    onChange={(event) => changeCampus(campus.id, "name", event.target.value)}
                    placeholder="如：本部、分部"
                    className="input-theme rounded px-3 py-2 text-sm w-full"
                  />
                </label>
                <label className="text-sm">
                  <span className="block text-t2 mb-1">學校電話</span>
                  <input
                    type="tel"
                    maxLength={PROFILE_PHONE_MAX}
                    value={campus.phone}
                    onChange={(event) => changeCampus(campus.id, "phone", event.target.value)}
                    placeholder="如：07-1234567"
                    className="input-theme rounded px-3 py-2 text-sm w-full"
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="block text-t2 mb-1">學校地址</span>
                  <input
                    type="text"
                    maxLength={PROFILE_ADDRESS_MAX}
                    value={campus.address}
                    onChange={(event) => changeCampus(campus.id, "address", event.target.value)}
                    placeholder="請輸入完整校區地址"
                    className="input-theme rounded px-3 py-2 text-sm w-full"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 學校官網 */}
      <section className="border border-themed rounded-lg p-4">
        <h4 className="font-bold text-t1">學校官網</h4>
        <p className="text-sm text-t3 mt-1 mb-3">
          請輸入完整網址（需為 http:// 或 https:// 開頭），可留空。
        </p>
        <label className="text-sm">
          <span className="block text-t2 mb-1">官網地址</span>
          <input
            type="url"
            maxLength={PROFILE_WEBSITE_MAX}
            value={draft.website}
            onChange={(event) => {
              if (!draft) return;
              setModal(null);
              setDraft({ ...draft, website: event.target.value });
            }}
            placeholder="https://www.school.edu.tw"
            className="input-theme rounded px-3 py-2 text-sm w-full max-w-md"
          />
        </label>
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
