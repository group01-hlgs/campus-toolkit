"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SPACE_LABEL_MAX,
  SPACE_MAX_LEVEL,
  SpaceOrgOption,
  SpaceStructure,
  readSpaceStructure,
  setSpaceLevelCount,
  validateSpaceStructure,
} from "@/types/school-spaces";
import SchoolSpacesTable from "@/components/SchoolSpacesTable";

type Flash = { type: "success" | "error"; text: string } | null;
type SpacesResponse = {
  success?: boolean;
  message?: string;
  setting?: unknown;
  orgUnits?: SpaceOrgOption[];
};

/**
 * 樓層空間設定編輯器（學校基本設定的子功能）。
 * 自行讀取與儲存 `GET/PUT /api/admin/school/spaces`；
 * 「隸屬單位」下拉的單位清單由 GET 一併回傳（來自單位層級設定）。
 */
export default function SchoolSpacesEditor() {
  const [saved, setSaved] = useState<SpaceStructure | null>(null);
  const [draft, setDraft] = useState<SpaceStructure | null>(null);
  const [orgUnits, setOrgUnits] = useState<SpaceOrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  /** 層級數輸入框的暫存字串：允許清空後重打，失焦或輸入無效值時回復現值 */
  const [levelInput, setLevelInput] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/school/spaces", { cache: "no-store" });
      const data: SpacesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.setting) {
        throw new Error(data?.message || `讀取失敗（HTTP ${res.status}）`);
      }
      const setting = readSpaceStructure(data.setting);
      setSaved(setting);
      setDraft(setting);
      setOrgUnits(Array.isArray(data.orgUnits) ? data.orgUnits : []);
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

  const orgCodes = useMemo(() => new Set(orgUnits.map((item) => item.code)), [orgUnits]);
  const validation = useMemo(
    () => (draft ? validateSpaceStructure(draft, { orgCodes }) : null),
    [draft, orgCodes]
  );
  const dirty = useMemo(() => {
    if (!saved || !draft) return false;
    return JSON.stringify(saved) !== JSON.stringify(draft);
  }, [saved, draft]);

  function changeLevelCount(raw: string) {
    if (!draft) return;
    setLevelInput(raw);
    const next = Number(raw);
    if (!Number.isInteger(next) || next < 1 || next > SPACE_MAX_LEVEL) return;
    const result = setSpaceLevelCount(draft, next);
    if (!result.ok) {
      setFlash({ type: "error", text: result.message });
      return;
    }
    setFlash(null);
    setDraft(result.value);
  }

  function changeLabel(index: number, label: string) {
    if (!draft) return;
    setFlash(null);
    setDraft({
      ...draft,
      levelLabels: draft.levelLabels.map((item, position) => (position === index ? label : item)),
    });
  }

  function reset() {
    if (!saved) return;
    setLevelInput(null);
    setDraft(saved);
    setFlash(null);
  }

  async function save() {
    if (!draft || !validation?.ok || saving) return;
    setSaving(true);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/school/spaces", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setting: draft }),
      });
      const data: SpacesResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `儲存失敗（HTTP ${res.status}）`);
      }
      const setting = readSpaceStructure(data.setting ?? draft);
      setSaved(setting);
      setDraft(setting);
      setFlash({ type: "success", text: data.message || "樓層空間設定已儲存" });
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "儲存失敗" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-t3 py-4">樓層空間設定載入中...</p>;
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
      {flash && (
        <p
          role={flash.type === "error" ? "alert" : "status"}
          className={`text-sm mb-3 ${flash.type === "success" ? "text-success" : "text-danger"}`}
        >
          {flash.text}
        </p>
      )}

      {/* 空間層級數與各層名稱 */}
      <div className="flex flex-wrap items-end gap-4 mb-3">
        <label className="text-sm">
          <span className="block text-t2 mb-1">空間層級數</span>
          <input
            type="number"
            min={1}
            max={SPACE_MAX_LEVEL}
            value={levelInput ?? String(draft.levelCount)}
            onChange={(event) => changeLevelCount(event.target.value)}
            onBlur={() => setLevelInput(null)}
            className="input-theme rounded px-3 py-2 text-sm w-24"
          />
        </label>
        {draft.levelLabels.map((label, index) => (
          <label key={index} className="text-sm">
            <span className="block text-t2 mb-1">第 {index + 1} 層名稱</span>
            <input
              type="text"
              maxLength={SPACE_LABEL_MAX}
              value={label}
              onChange={(event) => changeLabel(index, event.target.value)}
              className="input-theme rounded px-3 py-2 text-sm w-44"
            />
          </label>
        ))}
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

      <SchoolSpacesTable value={draft} orgUnits={orgUnits} onChange={setDraft} />
    </div>
  );
}
