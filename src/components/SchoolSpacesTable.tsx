"use client";

import { useMemo, useState } from "react";
import {
  SPACE_CAPACITY_MAX,
  SPACE_NAME_EN_MAX,
  SPACE_NAME_MAX,
  SPACE_NOTES_MAX,
  SpaceOrgOption,
  SpacePlacementResult,
  SpaceStructure,
  addSpace,
  childCountOf,
  childrenSpacesOf,
  flattenSpaceTree,
  moveSpaceSibling,
  removeSpace,
  setSpaceLevel,
  setSpaceParent,
} from "@/types/school-spaces";

/**
 * 樓層空間設定的表格檢視：
 * 每列一個空間，欄位為層級／中文名稱／英文名稱／上級空間／隸屬單位／
 * 開放借用／容納人數／設備說明／操作。
 * 「上級空間」下拉只列出上一層的空間；改層級若使上級失效則清空上級，
 * 由驗證回報「未指定上級空間」擋住儲存。
 */
export default function SchoolSpacesTable({
  value,
  orgUnits,
  onChange,
}: {
  value: SpaceStructure;
  orgUnits: SpaceOrgOption[];
  onChange: (next: SpaceStructure) => void;
}) {
  const [notice, setNotice] = useState("");

  const rows = useMemo(() => flattenSpaceTree(value), [value]);

  function apply(result: SpacePlacementResult): boolean {
    if (!result.ok) {
      setNotice(result.message);
      return false;
    }
    setNotice("");
    onChange(result.value);
    return true;
  }

  function patch(code: string, fields: Partial<(typeof value.units)[number]>) {
    setNotice("");
    onChange({
      ...value,
      units: value.units.map((unit) => (unit.code === code ? { ...unit, ...fields } : unit)),
    });
  }

  function addTopLevel() {
    apply(addSpace(value, null));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-t3">
          改層級或上級空間會連同其下所有子空間一起調整；未指定上級空間時無法儲存。
          「上移／下移」調整同層順位；「隸屬單位」選自單位層級設定的單位清單。
        </p>
        <button
          type="button"
          onClick={addTopLevel}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer whitespace-nowrap"
        >
          新增最上層空間
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
              <th className="px-3 py-2 font-medium whitespace-nowrap">中文名稱</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">英文名稱</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">上級空間</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">隸屬單位</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">開放借用</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">容納人數</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">設備說明</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-t3">
                  尚未建立空間，請按「新增最上層空間」開始。
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const parentMissing = row.level > 1 && !row.parent;
              const parentOptions = value.units.filter((unit) => unit.level === row.level - 1);
              const children = childCountOf(value, row.code);
              const canAddChild = row.level < value.levelCount;
              const siblings = childrenSpacesOf(value, row.parent);
              const siblingIndex = siblings.findIndex((unit) => unit.code === row.code);
              const canUp = siblingIndex > 0;
              const canDown = siblingIndex >= 0 && siblingIndex < siblings.length - 1;
              return (
                <tr key={row.code} className="border-b border-themed last:border-0 text-t1">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <select
                      value={row.level}
                      onChange={(event) =>
                        apply(setSpaceLevel(value, row.code, Number(event.target.value)))
                      }
                      className="input-theme rounded px-2 py-1.5 text-sm"
                      aria-label={`${row.name || "空間"}的層級`}
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
                      maxLength={SPACE_NAME_MAX}
                      onChange={(event) => patch(row.code, { name: event.target.value })}
                      placeholder="中文名稱"
                      className={`input-theme rounded px-2 py-1.5 text-sm w-full min-w-36${
                        row.name.trim() ? "" : " is-invalid"
                      }`}
                      aria-label="中文名稱"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={row.nameEn}
                      maxLength={SPACE_NAME_EN_MAX}
                      onChange={(event) => patch(row.code, { nameEn: event.target.value })}
                      placeholder="英文名稱（可空白）"
                      className="input-theme rounded px-2 py-1.5 text-sm w-full min-w-36"
                      aria-label={`${row.name || "空間"}的英文名稱`}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <select
                      value={row.parent ?? ""}
                      disabled={row.level === 1}
                      onChange={(event) =>
                        apply(setSpaceParent(value, row.code, event.target.value || null))
                      }
                      className={`input-theme rounded px-2 py-1.5 text-sm${
                        parentMissing ? " is-invalid" : ""
                      }`}
                      aria-label={`${row.name || "空間"}的上級空間`}
                    >
                      {row.level === 1 && <option value="">（最上層）</option>}
                      {parentMissing && <option value="">（請選擇上級空間）</option>}
                      {parentOptions.map((unit) => (
                        <option key={unit.code} value={unit.code}>
                          {unit.name}
                        </option>
                      ))}
                    </select>
                    {parentMissing && (
                      <span className="block text-xs text-danger mt-1">請選擇上級空間</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <select
                      value={row.orgUnit ?? ""}
                      onChange={(event) => patch(row.code, { orgUnit: event.target.value || null })}
                      className="input-theme rounded px-2 py-1.5 text-sm"
                      aria-label={`${row.name || "空間"}的隸屬單位`}
                    >
                      <option value="">（未指定）</option>
                      {orgUnits.map((unit) => (
                        <option key={unit.code} value={unit.code}>
                          {unit.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={row.openForBooking}
                      onChange={(event) => patch(row.code, { openForBooking: event.target.checked })}
                      className="cursor-pointer"
                      aria-label={`${row.name || "空間"}是否開放借用`}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <input
                      type="number"
                      min={0}
                      max={SPACE_CAPACITY_MAX}
                      value={row.capacity ?? ""}
                      onChange={(event) => {
                        const text = event.target.value;
                        if (text === "") {
                          patch(row.code, { capacity: null });
                          return;
                        }
                        const next = Number(text);
                        if (!Number.isInteger(next) || next < 0 || next > SPACE_CAPACITY_MAX) return;
                        patch(row.code, { capacity: next });
                      }}
                      placeholder="未填寫"
                      className="input-theme rounded px-2 py-1.5 text-sm w-24"
                      aria-label={`${row.name || "空間"}的容納人數`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={row.notes}
                      maxLength={SPACE_NOTES_MAX}
                      onChange={(event) => patch(row.code, { notes: event.target.value })}
                      placeholder="設備說明（可空白）"
                      className="input-theme rounded px-2 py-1.5 text-sm w-full min-w-40"
                      aria-label={`${row.name || "空間"}的設備說明`}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <div className="inline-flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => apply(moveSpaceSibling(value, row.code, -1))}
                        disabled={!canUp}
                        title={canUp ? "與上一個同層空間對調順位" : "已是同層的第一個空間"}
                        className="btn-theme rounded px-3 py-1.5 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        onClick={() => apply(moveSpaceSibling(value, row.code, 1))}
                        disabled={!canDown}
                        title={canDown ? "與下一個同層空間對調順位" : "已是同層的最後一個空間"}
                        className="btn-theme rounded px-3 py-1.5 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        下移
                      </button>
                      <button
                        type="button"
                        onClick={() => apply(addSpace(value, row.code))}
                        disabled={!canAddChild}
                        title={canAddChild ? "在此空間下新增子空間" : "已達空間層級數上限"}
                        className="btn-theme rounded px-3 py-1.5 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        ＋子空間
                      </button>
                      <button
                        type="button"
                        onClick={() => apply(removeSpace(value, row.code))}
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
