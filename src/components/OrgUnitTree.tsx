"use client";

import { useMemo, useState } from "react";
import {
  OrgNode,
  OrgPlacementResult,
  OrgStructure,
  OrgUnit,
  buildOrgTree,
  descendantCodes,
  findUnit,
  maxSubtreeLevel,
  setUnitParent,
} from "@/types/org";

/**
 * 單位層級設定的視覺化檢視：以第 1 層單位為「母艦」，第 2 層卡片巢狀放在母艦內，
 * 第 3 層以下依此類推；卡片只顯示單位名稱。
 * 原生 HTML5 拖曳（滑鼠）：拖到某張卡片＝設為其下級（整棵子樹一起平移），
 * 拖到最外層空白處＝設為最上層。禁止拖入自己或後代、禁止超出學校層級數。
 * 新增、改名、刪除請用「表格」檢視；行動裝置不支援 HTML5 拖曳亦同。
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

  const roots = useMemo(() => buildOrgTree(value), [value]);
  const rootOver = overTarget === "root" && dragCode !== null;

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

  function cardProps(unit: OrgUnit, depth: number) {
    const isDragging = dragCode === unit.code;
    const isOver = overTarget === unit.code;
    return {
      "data-unit-card": true,
      draggable: true,
      onDragStart: (event: React.DragEvent) => {
        event.stopPropagation();
        setDragCode(unit.code);
        setNotice("");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", unit.code);
      },
      onDragEnd: (event: React.DragEvent) => {
        event.stopPropagation();
        endDrag();
      },
      onDragOver: (event: React.DragEvent) => {
        event.stopPropagation();
        if (!canDrop(unit.code)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOverTarget(unit.code);
      },
      onDragLeave: (event: React.DragEvent) => {
        if (overTarget !== unit.code) return;
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOverTarget(null);
      },
      onDrop: (event: React.DragEvent) => {
        event.stopPropagation();
        if (!dragCode) return;
        event.preventDefault();
        drop(unit.code);
      },
      className: `rounded-lg border border-themed p-2 cursor-grab active:cursor-grabbing${
        isDragging ? " opacity-60" : ""
      } ${depth === 0 ? "bg-card" : "bg-hover"}`,
      style: isOver ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined,
    };
  }

  function renderNode(node: OrgNode, depth: number): React.ReactNode {
    return (
      <div key={node.unit.code} {...cardProps(node.unit, depth)}>
        <span
          className={`block break-all text-t1 ${
            depth === 0 ? "font-bold" : depth === 1 ? "font-medium" : "font-normal"
          }`}
        >
          {node.unit.name}
        </span>
        {node.children.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 pl-3 border-l-2 border-themed">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="select-none">
      <p className="text-sm text-t3 mb-3">
        以第 1 層單位為母艦，其下單位放在卡片內；拖曳單位卡片到另一張卡片＝設為其下級
        （其下子單位會連同調整層級），拖到最外層空白處＝設為最上層單位。
        新增、改名與刪除請用「表格」檢視；行動裝置不支援拖曳亦同。
      </p>

      {notice && (
        <p className="text-danger text-sm mb-2" role="alert">
          {notice}
        </p>
      )}

      <div
        className="w-full rounded-lg border border-dashed border-themed p-3 min-h-32 flex flex-col gap-2"
        style={rootOver ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined}
        onDragOver={(event) => {
          if (!canDrop(null)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOverTarget("root");
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setOverTarget(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          drop(null);
        }}
      >
        {roots.length === 0 && (
          <p className="text-xs text-t3 px-1 py-6 text-center">
            尚無單位，請到「表格」檢視按「新增最上層單位」開始。
          </p>
        )}
        {roots.map((node) => renderNode(node, 0))}
      </div>
    </div>
  );
}
