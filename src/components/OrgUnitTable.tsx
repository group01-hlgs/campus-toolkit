"use client";

import { useMemo, useState } from "react";
import {
  ORG_NAME_MAX,
  OrgPlacementResult,
  OrgStructure,
  addUnit,
  childCountOf,
  flattenOrgTree,
  removeUnit,
  setUnitLevel,
  setUnitParent,
} from "@/types/org";

/**
 * 單位層級設定的表格檢視（傳統方式）：
 * 每列一個單位，欄位為層級／單位名稱／所屬上級單位／子單位數／操作。
 * 「所屬上級單位」下拉只列出上一層的單位；改層級若使上級失效則清空上級，
 * 由驗證回報「未指定上級單位」擋住儲存。
 */
export default function OrgUnitTable({
  value,
  onChange,
}: {
  value: OrgStructure;
  onChange: (next: OrgStructure) => void;
}) {
  const [notice, setNotice] = useState("");

  const rows = useMemo(() => flattenOrgTree(value), [value]);

  function apply(result: OrgPlacementResult): boolean {
    if (!result.ok) {
      setNotice(result.message);
      return false;
    }
    setNotice("");
    onChange(result.value);
    return true;
  }

  function rename(code: string, name: string) {
    setNotice("");
    onChange({
      ...value,
      units: value.units.map((unit) => (unit.code === code ? { ...unit, name } : unit)),
    });
  }

  function addTopLevel() {
    apply(addUnit(value, null));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-t3">
          改層級或上級單位會連同其下所有子單位一起調整；未指定上級單位時無法儲存。
        </p>
        <button
          type="button"
          onClick={addTopLevel}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer whitespace-nowrap"
        >
          新增最上層單位
        </button>
      </div>

      {notice && (
        <p className="text-danger text-sm mb-2" role="alert">
          {notice}
        </p>
      )}

      <div className="border border-themed rounded-lg bg-card overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-themed">
            <tr>
              <th className="px-3 py-2 font-medium whitespace-nowrap">層級</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">單位名稱</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">所屬上級單位</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">子單位</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-t3">
                  尚未建立單位，請按「新增最上層單位」開始。
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const parentMissing = row.level > 1 && !row.parent;
              const parentOptions = value.units.filter((unit) => unit.level === row.level - 1);
              const children = childCountOf(value, row.code);
              const canAddChild = row.level < value.levelCount;
              return (
                <tr key={row.code} className="border-b border-themed last:border-0 text-t1">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <select
                      value={row.level}
                      onChange={(event) =>
                        apply(setUnitLevel(value, row.code, Number(event.target.value)))
                      }
                      className="input-theme rounded px-2 py-1.5 text-sm"
                      aria-label={`${row.name || "單位"}的層級`}
                    >
                      {Array.from({ length: value.levelCount }, (_, index) => index + 1).map(
                        (level) => (
                          <option key={level} value={level}>
                            {level}（{value.levelLabels[level - 1]}）
                          </option>
                        )
                      )}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={row.name}
                      maxLength={ORG_NAME_MAX}
                      onChange={(event) => rename(row.code, event.target.value)}
                      placeholder="單位名稱"
                      className={`input-theme rounded px-2 py-1.5 text-sm w-full min-w-40${
                        row.name.trim() ? "" : " is-invalid"
                      }`}
                      aria-label="單位名稱"
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <select
                      value={row.parent ?? ""}
                      disabled={row.level === 1}
                      onChange={(event) =>
                        apply(setUnitParent(value, row.code, event.target.value || null))
                      }
                      className={`input-theme rounded px-2 py-1.5 text-sm${
                        parentMissing ? " is-invalid" : ""
                      }`}
                      aria-label={`${row.name || "單位"}的所屬上級單位`}
                    >
                      {row.level === 1 && <option value="">（最上層）</option>}
                      {parentMissing && <option value="">（請選擇上級單位）</option>}
                      {parentOptions.map((unit) => (
                        <option key={unit.code} value={unit.code}>
                          {unit.name}
                        </option>
                      ))}
                    </select>
                    {parentMissing && (
                      <span className="block text-xs text-danger mt-1">請選擇上級單位</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-t3">
                    {children > 0 ? `${children} 個` : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => apply(addUnit(value, row.code))}
                        disabled={!canAddChild}
                        title={canAddChild ? "在此單位下新增子單位" : "已達學校層級數上限"}
                        className="btn-theme rounded px-3 py-1.5 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        ＋子單位
                      </button>
                      <button
                        type="button"
                        onClick={() => apply(removeUnit(value, row.code))}
                        className="btn-danger rounded px-3 py-1.5 text-xs cursor-pointer"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
