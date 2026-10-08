"use client";

import { useMemo, useState } from "react";
import {
  ORG_NAME_MAX,
  OrgPlacementResult,
  OrgStructure,
  addUnit,
  childCountOf,
  childrenOf,
  flattenOrgTree,
  moveSibling,
  removeUnit,
  setUnitLevel,
  setUnitParent,
} from "@/types/org";

/** 操作欄的圖示按鈕內容（上移／下移／新增子單位／刪除） */
function IconArrowUp() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
    </svg>
  );
}

function IconArrowDown() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
      />
    </svg>
  );
}

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
          「上移／下移」調整同層順位，第一層順序即全校處室的羅列順位。
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
              const siblings = childrenOf(value, row.parent);
              const siblingIndex = siblings.findIndex((unit) => unit.code === row.code);
              const canUp = siblingIndex > 0;
              const canDown = siblingIndex >= 0 && siblingIndex < siblings.length - 1;
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
                    <div className="inline-flex flex-wrap justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => apply(moveSibling(value, row.code, -1))}
                        disabled={!canUp}
                        title={canUp ? "與上一個同層單位對調順位" : "已是同層的第一個單位"}
                        aria-label="上移"
                        className="rounded p-1 text-t2 hover:text-t1 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <IconArrowUp />
                      </button>
                      <button
                        type="button"
                        onClick={() => apply(moveSibling(value, row.code, 1))}
                        disabled={!canDown}
                        title={canDown ? "與下一個同層單位對調順位" : "已是同層的最後一個單位"}
                        aria-label="下移"
                        className="rounded p-1 text-t2 hover:text-t1 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <IconArrowDown />
                      </button>
                      <button
                        type="button"
                        onClick={() => apply(addUnit(value, row.code))}
                        disabled={!canAddChild}
                        title={canAddChild ? "在此單位下新增子單位" : "已達學校層級數上限"}
                        aria-label="新增子單位"
                        className="rounded p-1 text-t2 hover:text-t1 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <IconPlus />
                      </button>
                      <button
                        type="button"
                        onClick={() => apply(removeUnit(value, row.code))}
                        title="刪除此單位"
                        aria-label="刪除"
                        className="rounded p-1 text-danger hover:opacity-70 cursor-pointer"
                      >
                        <IconTrash />
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
