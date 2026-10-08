"use client";

import { useMemo, useState } from "react";
import {
  SpaceNode,
  SpacePlacementResult,
  SpaceStructure,
  SpaceUnit,
  buildSpaceTree,
  descendantCodes,
  findSpace,
  maxSubtreeLevel,
  placeSibling,
  setSpaceParent,
} from "@/types/school-spaces";

/**
 * 樓層空間設定的視覺化檢視：以第 1 層空間為「母艦」，第 2 層卡片巢狀放在母艦內，
 * 第 3 層以下依此類推；卡片顯示中文名稱（有空間代碼時一併顯示）。
 * 原生 HTML5 拖曳（滑鼠）：
 * - 拖到某張卡片＝設為其下級（整棵子樹一起平移，排到該上級的末尾）；
 * - 拖到卡片之間的空隙＝插到該位置（同層換位，例如把 A 放到 B、C 之間）；
 * - 拖到最外層空白處＝設為最上層。
 * 禁止拖入自己或後代、禁止超出空間層級數。
 * 新增、改名、屬性編輯、刪除與上移／下移請用「表格」檢視；行動裝置不支援 HTML5 拖曳亦同。
 */
export default function SpaceTree({
  value,
  onChange,
}: {
  value: SpaceStructure;
  onChange: (next: SpaceStructure) => void;
}) {
  const [dragCode, setDragCode] = useState<string | null>(null);
  const [overTarget, setOverTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const roots = useMemo(() => buildSpaceTree(value), [value]);
  const rootOver = overTarget === "root" && dragCode !== null;

  /** 搬入某上級（null＝最上層）是否合法：不可為自己或後代，且子樹不可超出層級數 */
  function canDropInto(parent: string | null): boolean {
    if (!dragCode) return false;
    if (parent === null) return true;
    const parentUnit = findSpace(value, parent);
    const dragged = findSpace(value, dragCode);
    if (!parentUnit || !dragged) return false;
    if (parent === dragCode) return false;
    if (descendantCodes(value, dragCode).has(parent)) return false;
    const delta = parentUnit.level + 1 - dragged.level;
    return maxSubtreeLevel(value, dragCode) + delta <= value.levelCount;
  }

  /** 拖到卡片＝設為其下級（排到末尾） */
  function canDrop(target: string): boolean {
    if (!dragCode) return false;
    if (target === dragCode) return false;
    const dragged = findSpace(value, dragCode);
    const destination = findSpace(value, target);
    if (!dragged || !destination) return false;
    return canDropInto(target);
  }

  function apply(result: SpacePlacementResult): boolean {
    if (!result.ok) {
      setNotice(result.message);
      return false;
    }
    setNotice("");
    onChange(result.value);
    return true;
  }

  function finishDrag() {
    setDragCode(null);
    setOverTarget(null);
  }

  function dropOnCard(target: string) {
    if (!dragCode) return;
    apply(setSpaceParent(value, dragCode, target));
    finishDrag();
  }

  function dropInGap(parent: string | null, index: number) {
    if (!dragCode) return;
    apply(placeSibling(value, dragCode, parent, index));
    finishDrag();
  }

  function dropOnRoot() {
    if (!dragCode) return;
    apply(setSpaceParent(value, dragCode, null));
    finishDrag();
  }

  /** 卡片之間的空隙：插到該位置（同層換位或跨層搬入） */
  function renderGap(parent: string | null, index: number, key: string) {
    const targetKey = `gap:${parent ?? "root"}#${index}`;
    const isOver = overTarget === targetKey;
    const allowed = canDropInto(parent);
    return (
      <div
        key={key}
        data-drop-gap
        className={`rounded-sm transition-all ${isOver ? "h-6" : dragCode ? "h-4" : "h-3"}`}
        style={
          isOver
            ? { background: "var(--primary)" }
            : dragCode
              ? { background: "color-mix(in srgb, var(--primary) 25%, transparent)" }
              : undefined
        }
        onDragOver={(event) => {
          event.stopPropagation();
          if (!allowed) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOverTarget(targetKey);
        }}
        onDragLeave={(event) => {
          if (overTarget !== targetKey) return;
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setOverTarget(null);
        }}
        onDrop={(event) => {
          event.stopPropagation();
          if (!dragCode || !allowed) return;
          event.preventDefault();
          dropInGap(parent, index);
        }}
      />
    );
  }

  function cardProps(unit: SpaceUnit, depth: number) {
    const isDragging = dragCode === unit.code;
    const isOver = overTarget === unit.code;
    return {
      "data-space-card": true,
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
        finishDrag();
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
        dropOnCard(unit.code);
      },
      className: `rounded-lg border border-themed p-2 cursor-grab active:cursor-grabbing${
        isDragging ? " opacity-60" : ""
      } ${depth === 0 ? "bg-card" : "bg-hover"}`,
      style: isOver ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined,
    };
  }

  /**
   * 一層的兄弟們（含前後空隙）。
   * 空隙的 index 依「不含被拖曳空間」的順序計算，
   * 因此同層拖曳時，拖到 B、C 之間＝插到第 1 個與第 2 個之間。
   */
  function renderSiblings(children: SpaceNode[], parent: string | null, depth: number) {
    const out: React.ReactNode[] = [];
    let position = 0;
    children.forEach((child, i) => {
      const isDragged = dragCode === child.unit.code;
      out.push(renderGap(parent, position, `gap:${parent ?? "root"}:${i}`));
      out.push(renderNode(child, depth));
      if (!isDragged) position += 1;
    });
    out.push(renderGap(parent, position, `gap:${parent ?? "root"}:end`));
    return out;
  }

  function renderNode(node: SpaceNode, depth: number): React.ReactNode {
    return (
      <div key={node.unit.code} {...cardProps(node.unit, depth)}>
        <span
          className={`block break-all text-t1 ${
            depth === 0 ? "font-bold" : depth === 1 ? "font-medium" : "font-normal"
          }`}
        >
          {node.unit.name}
          {node.unit.spaceCode ? `（${node.unit.spaceCode}）` : ""}
        </span>
        {node.children.length > 0 && (
          <div className="mt-2 flex flex-col pl-3 border-l-2 border-themed">
            {renderSiblings(node.children, node.unit.code, depth + 1)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="select-none">
      <p className="text-sm text-t3 mb-3">
        以第 1 層空間為母艦，其下空間放在卡片內。拖曳時卡片間會出現空隙：
        拖到空隙＝插到該位置（可調同層順位），拖到某張卡片＝設為其下級（排到該上級末尾、整棵子樹一起平移），
        拖到最外層空白處＝設為最上層。禁止拖入自己或後代。
        新增、改名、屬性編輯、刪除與上移／下移請用「表格」檢視；行動裝置不支援拖曳亦同。
      </p>

      {notice && (
        <p className="text-danger text-sm mb-2" role="alert">
          {notice}
        </p>
      )}

      <div
        className="w-full rounded-lg border border-dashed border-themed p-3 min-h-32 flex flex-col"
        style={rootOver ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined}
        onDragOver={(event) => {
          if (!canDropInto(null)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOverTarget("root");
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setOverTarget(null);
        }}
        onDrop={(event) => {
          if (!dragCode) return;
          event.preventDefault();
          dropOnRoot();
        }}
      >
        {roots.length === 0 && (
          <p className="text-xs text-t3 px-1 py-6 text-center">
            尚無空間，請到「表格」檢視按「新增最上層空間」開始。
          </p>
        )}
        {renderSiblings(roots, null, 0)}
      </div>
    </div>
  );
}
