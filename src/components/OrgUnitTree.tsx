"use client";

import { useMemo, useState } from "react";
import {
  OrgPlacementResult,
  OrgStructure,
  addUnit,
  descendantCodes,
  findUnit,
  flattenOrgTree,
  maxSubtreeLevel,
  removeUnit,
  setUnitParent,
} from "@/types/org";

/**
 * 單位層級設定的視覺化檢視：每個層級一欄，卡片顯示名稱、所屬上級與操作。
 * 原生 HTML5 拖曳（滑鼠）：拖到卡片＝設為其下級（整棵子樹一起平移一層），
 * 拖到第 1 層欄位空白處＝設為最上層。禁止拖入自己或後代、禁止超出學校層級數。
 * 行動裝置不支援 HTML5 拖曳，改用表格檢視操作。
 */
export default function OrgUnitTree({
  value,
  onChange,
}: {
  value: OrgStructure;
  onChange: (next: OrgStructure) => void;
}) {
  const [dragCode, setDragCode] = useState<string | null>(null);
  const [overTarget, setOverTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const ordered = useMemo(() => flattenOrgTree(value), [value]);
  const byLevel = useMemo(() => {
    const map = new Map<number, string[]>();
    for (let level = 1; level <= value.levelCount; level += 1) map.set(level, []);
    for (const unit of ordered) {
      if (unit.level <= value.levelCount) map.get(unit.level)?.push(unit.code);
    }
    return map;
  }, [ordered, value.levelCount]);

  /** 是否可放置：目標不可為自己或後代，且搬移後最深層不可超過學校層級數 */
  function canDrop(target: string | null): boolean {
    if (!dragCode) return false;
    if (target === null) return true;
    if (target === dragCode) return false;
    const dragged = findUnit(value, dragCode);
    const destination = findUnit(value, target);
    if (!dragged || !destination) return false;
    if (descendantCodes(value, dragCode).has(target)) return false;
    const delta = destination.level + 1 - dragged.level;
    return maxSubtreeLevel(value, dragCode) + delta <= value.levelCount;
  }

  function apply(result: OrgPlacementResult): boolean {
    if (!result.ok) {
      setNotice(result.message);
      return false;
    }
    setNotice("");
    onChange(result.value);
    return true;
  }

  function drop(target: string | null) {
    if (!dragCode) return;
    apply(setUnitParent(value, dragCode, target));
    setDragCode(null);
    setOverTarget(null);
  }

  function endDrag() {
    setDragCode(null);
    setOverTarget(null);
  }

  return (
    <div className="select-none">
      <p className="text-sm text-t3 mb-3">
        拖曳單位卡片到另一張卡片＝設為其下級（其下子單位會連同調整層級）；拖到第 1
        層欄位空白處＝設為最上層單位。行動裝置請改用「表格」檢視。
      </p>

      {notice && (
        <p className="text-danger text-sm mb-2" role="alert">
          {notice}
        </p>
      )}

      <div className="flex gap-3 items-start overflow-x-auto pb-2">
        {Array.from({ length: value.levelCount }, (_, index) => index + 1).map((level) => {
          const codes = byLevel.get(level) ?? [];
          const isRootColumn = level === 1;
          const rootOver = isRootColumn && overTarget === "root" && dragCode !== null;
          return (
            <div
              key={level}
              className="min-w-56 flex-1 rounded-lg border border-themed bg-card p-2"
              style={rootOver ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined}
              onDragOver={(event) => {
                if (!isRootColumn) return;
                if ((event.target as HTMLElement).closest("[data-unit-card]")) return;
                if (!canDrop(null)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOverTarget("root");
              }}
              onDragLeave={(event) => {
                if (!isRootColumn || overTarget !== "root") return;
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setOverTarget(null);
              }}
              onDrop={(event) => {
                if (!isRootColumn) return;
                event.preventDefault();
                drop(null);
              }}
            >
              <div className="flex items-center justify-between gap-2 px-1 mb-2">
                <h4 className="text-sm font-bold text-t2">
                  第 {level} 層｜{value.levelLabels[level - 1]}
                </h4>
                {isRootColumn && (
                  <button
                    type="button"
                    onClick={() => apply(addUnit(value, null))}
                    className="btn-theme rounded px-2 py-1 text-xs cursor-pointer"
                  >
                    ＋最上層
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2 min-h-24">
                {codes.length === 0 && (
                  <p className="text-xs text-t3 px-1 py-3 text-center border border-dashed border-themed rounded">
                    {level === 1 ? "拖曳單位到這裡" : "尚無單位"}
                  </p>
                )}

                {codes.map((code) => {
                  const unit = findUnit(value, code);
                  if (!unit) return null;
                  const parentName = findUnit(value, unit.parent)?.name ?? "";
                  const isDragging = dragCode === unit.code;
                  const isOver = overTarget === unit.code;
                  const canAddChild = unit.level < value.levelCount;
                  return (
                    <div
                      key={unit.code}
                      data-unit-card
                      draggable
                      title="拖曳以設定上級單位"
                      onDragStart={(event) => {
                        setDragCode(unit.code);
                        setNotice("");
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", unit.code);
                      }}
                      onDragEnd={endDrag}
                      onDragOver={(event) => {
                        if (!canDrop(unit.code)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = "move";
                        setOverTarget(unit.code);
                      }}
                      onDragLeave={(event) => {
                        if (overTarget !== unit.code) return;
                        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          return;
                        }
                        setOverTarget(null);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        drop(unit.code);
                      }}
                      className={`rounded-lg border border-themed bg-hover p-3 cursor-grab active:cursor-grabbing${
                        isDragging ? " opacity-60" : ""
                      }`}
                      style={isOver ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-t1 break-all">{unit.name}</span>
                        <span className="text-xs text-t3 whitespace-nowrap">
                          {value.levelLabels[unit.level - 1] ?? `第 ${unit.level} 層`}
                        </span>
                      </div>
                      <p className="text-xs text-t3 mt-1 truncate">
                        上級：{parentName || "（最上層）"}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => apply(addUnit(value, unit.code))}
                          disabled={!canAddChild}
                          title={canAddChild ? "在此單位下新增子單位" : "已達學校層級數上限"}
                          className="btn-theme rounded px-2 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          ＋子單位
                        </button>
                        <button
                          type="button"
                          onClick={() => apply(removeUnit(value, unit.code))}
                          className="btn-danger rounded px-2 py-1 text-xs cursor-pointer"
                        >
                          刪除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
