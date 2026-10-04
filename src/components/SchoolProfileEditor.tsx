"use client";

import { useEffect, useMemo, useState } from "react";
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

type Flash = { type: "success" | "error"; text: string } | null;
type ProfileResponse = { success?: boolean; message?: string; profile?: unknown };

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
  const [flash, setFlash] = useState<Flash>(null);
  /** 年制輸入框的暫存字串：允許清空後重打，失焦或輸入無效值時回復現值 */
  const [yearInputs, setYearInputs] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/school/profile", { cache: "no-store" });
      const data: ProfileResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.profile) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      const profile = readSchoolProfile(data.profile);
      setSaved(profile);
      setDraft(profile);
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

  function toggleStage(stage: StageValue, checked: boolean) {
    if (!draft) return;
    setFlash(null);
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
    setFlash(null);
    setDraft({
      ...draft,
      stages: draft.stages.map((item) => (item.stage === stage ? { ...item, years } : item)),
    });
  }

  function changePrincipal(value: string) {
    if (!draft) return;
    setFlash(null);
    setDraft({ ...draft, principal: value });
  }

  function addVicePrincipal() {
    if (!draft || draft.vicePrincipals.length >= PROFILE_MAX_VICE_PRINCIPALS) return;
    setFlash(null);
    setDraft({ ...draft, vicePrincipals: [...draft.vicePrincipals, ""] });
  }

  function changeVicePrincipal(index: number, value: string) {
    if (!draft) return;
    setFlash(null);
    setDraft({
      ...draft,
      vicePrincipals: draft.vicePrincipals.map((item, position) =>
        position === index ? value : item
      ),
    });
  }

  function removeVicePrincipal(index: number) {
    if (!draft) return;
    setFlash(null);
    setDraft({
      ...draft,
      vicePrincipals: draft.vicePrincipals.filter((_, position) => position !== index),
    });
  }

  function addCampus() {
    if (!draft || draft.campuses.length >= PROFILE_MAX_CAMPUSES) return;
    setFlash(null);
    setDraft({
      ...draft,
      campuses: [...draft.campuses, { id: newCampusId(), name: "", address: "", phone: "" }],
    });
  }

  function changeCampus(id: string, field: "name" | "address" | "phone", value: string) {
    if (!draft) return;
    setFlash(null);
    setDraft({
      ...draft,
      campuses: draft.campuses.map((campus) =>
        campus.id === id ? { ...campus, [field]: value } : campus
      ),
    });
  }

  function removeCampus(id: string) {
    if (!draft || draft.campuses.length <= PROFILE_MIN_CAMPUSES) return;
    setFlash(null);
    setDraft({ ...draft, campuses: draft.campuses.filter((campus) => campus.id !== id) });
  }

  function reset() {
    if (!saved) return;
    setYearInputs({});
    setDraft(saved);
    setFlash(null);
  }

  async function save() {
    if (!draft || !validation?.ok || saving) return;
    setSaving(true);
    setFlash(null);
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
      setFlash({ type: "success", text: data.message || "校務基本資料已儲存" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "儲存失敗" });
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

  return (
    <div className="mt-4">
      {flash && (
        <p
          role={flash.type === "error" ? "alert" : "status"}
          className={`text-sm mb-3 ${flash.type === "success" ? "text-success" : "text-danger"}`}
        >
          {flash.text}
        </p>
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
              setFlash(null);
              setDraft({ ...draft, website: event.target.value });
            }}
            placeholder="https://www.school.edu.tw"
            className="input-theme rounded px-3 py-2 text-sm w-full max-w-md"
          />
        </label>
      </section>
    </div>
  );
}
