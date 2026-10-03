/**
 * 學校單位層級（處室／組別）設定。
 *
 * 屬「學校基本設定」模組（schoolSettings，超級專屬）的子功能 `schoolSettings.org`：
 * 管理人員自行決定學校層級數與每層名稱，並設定每個單位的層級與上級單位。
 *
 * 資料存於獨立文件 `settings/school`（結構性資料、不按學期）：
 * - 刻意不放 `settings/system`：系統設定的 PUT 是整份覆寫（只保留 roleEnabled），
 *   存同文件會在下次儲存系統設定時被清掉。
 * - 欄位：levelCount／levelLabels／units。
 *
 * 本檔不可 import `server-only`（`src/lib/*` 皆為伺服器專用），
 * 前端表單與 API 伺服器端共用這裡的驗證與搬移規則。
 */

/** 單位（處室、組、中心…） */
export interface OrgUnit {
  /** 穩定代碼：新增時產生、改名不變，供日後教職員名冊 `unit` 等欄位引用 */
  code: string;
  /** 單位名稱（同上級單位內不可重複） */
  name: string;
  /** 所在層級 1..levelCount */
  level: number;
  /** 上級單位 code；最上層（level 1）必為 null */
  parent: string | null;
}

export interface OrgStructure {
  /** 學校層級數 1..ORG_MAX_LEVEL */
  levelCount: number;
  /** 每層名稱，長度恆等於 levelCount */
  levelLabels: string[];
  /** 扁平陣列；兄弟順序＝陣列中的相對順序 */
  units: OrgUnit[];
}

export const ORG_DOC_ID = "school";
export const ORG_MAX_LEVEL = 5;
export const ORG_MAX_UNITS = 200;
export const ORG_NAME_MAX = 40;
export const ORG_LABEL_MAX = 20;
export const ORG_CODE_MAX = 64;

const LEVEL_CN = ["一", "二", "三", "四", "五"];

/** 未自訂時的預設層級名稱：第一層、第二層… */
export function defaultOrgLabel(level: number): string {
  const cn = LEVEL_CN[level - 1];
  return cn ? `第${cn}層` : `第${level}層`;
}

export function defaultOrgStructure(): OrgStructure {
  return { levelCount: 2, levelLabels: [defaultOrgLabel(1), defaultOrgLabel(2)], units: [] };
}

/** 新單位代碼：時間基底＋亂碼，同毫秒內也不會相撞 */
export function newUnitCode(): string {
  return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export type OrgValidation = { ok: true; value: OrgStructure } | { ok: false; message: string };

function readUnit(raw: unknown, levelCount: number): OrgUnit | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const code = typeof item.code === "string" ? item.code.trim().slice(0, ORG_CODE_MAX) : "";
  if (!code) return null;
  const name = typeof item.name === "string" ? item.name.trim().slice(0, ORG_NAME_MAX) : "";
  const levelRaw = Number(item.level);
  const level = Number.isInteger(levelRaw)
    ? Math.min(Math.max(levelRaw, 1), Math.max(levelCount, 1))
    : 1;
  const parent =
    typeof item.parent === "string" && item.parent.trim() ? item.parent.trim() : null;
  return { code, name, level, parent };
}

/**
 * 讀回單位設定（寬容）：只把型別與範圍修到安全值，父子關係交給驗證回報，
 * 避免資料毀損時整份作廢、管理員連看都看不到。
 */
export function readOrgStructure(raw: unknown): OrgStructure {
  if (!raw || typeof raw !== "object") return defaultOrgStructure();
  const data = raw as Record<string, unknown>;
  const levelRaw = Number(data.levelCount);
  if (!Number.isInteger(levelRaw) || levelRaw < 1 || levelRaw > ORG_MAX_LEVEL) {
    return defaultOrgStructure();
  }
  const levelCount = levelRaw;
  const rawLabels = Array.isArray(data.levelLabels) ? data.levelLabels : [];
  const levelLabels = Array.from({ length: levelCount }, (_, index) => {
    const value = rawLabels[index];
    const label = typeof value === "string" ? value.trim().slice(0, ORG_LABEL_MAX) : "";
    return label || defaultOrgLabel(index + 1);
  });

  const units: OrgUnit[] = [];
  const seen = new Set<string>();
  const rawUnits = Array.isArray(data.units) ? data.units : [];
  for (const item of rawUnits) {
    const unit = readUnit(item, levelCount);
    if (!unit || seen.has(unit.code)) continue;
    seen.add(unit.code);
    units.push(unit);
  }
  // 上級代碼不存在＝視為最上層（層級不符時由驗證回報「未指定上級單位」）
  for (const unit of units) {
    if (unit.parent !== null && !seen.has(unit.parent)) unit.parent = null;
  }

  return { levelCount, levelLabels, units };
}

/**
 * 完整驗證（API 與表單共用）。
 * 父代必為高一層，因此環狀引用不可能成立（否則需無限往下）。
 */
export function validateOrgStructure(raw: unknown): OrgValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "無效的單位層級設定內容" };
  }
  const data = raw as Record<string, unknown>;

  const levelCount = Number(data.levelCount);
  if (!Number.isInteger(levelCount) || levelCount < 1 || levelCount > ORG_MAX_LEVEL) {
    return { ok: false, message: `學校層級數需為 1 至 ${ORG_MAX_LEVEL} 的整數` };
  }

  const rawLabels = Array.isArray(data.levelLabels) ? data.levelLabels : [];
  if (rawLabels.length !== levelCount) {
    return { ok: false, message: "層級名稱的數量需與學校層級數相同" };
  }
  const levelLabels: string[] = [];
  for (let index = 0; index < levelCount; index += 1) {
    const value = rawLabels[index];
    const label = typeof value === "string" ? value.trim() : "";
    if (!label) return { ok: false, message: `第 ${index + 1} 層的層級名稱不可空白` };
    if (label.length > ORG_LABEL_MAX) {
      return {
        ok: false,
        message: `第 ${index + 1} 層的層級名稱過長（最多 ${ORG_LABEL_MAX} 字）`,
      };
    }
    levelLabels.push(label);
  }

  const rawUnits = Array.isArray(data.units) ? data.units : [];
  if (rawUnits.length > ORG_MAX_UNITS) {
    return { ok: false, message: `單位數量超過上限（最多 ${ORG_MAX_UNITS} 筆）` };
  }

  const units: OrgUnit[] = [];
  const codes = new Set<string>();
  for (let index = 0; index < rawUnits.length; index += 1) {
    const item = rawUnits[index];
    if (!item || typeof item !== "object") return { ok: false, message: "單位資料格式錯誤" };
    const entry = item as Record<string, unknown>;
    const code = typeof entry.code === "string" ? entry.code.trim().slice(0, ORG_CODE_MAX) : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const level = Number(entry.level);
    const parentRaw =
      typeof entry.parent === "string" && entry.parent.trim() ? entry.parent.trim() : null;
    const label = name || `第 ${index + 1} 筆單位`;

    if (!code) return { ok: false, message: `${label}缺少單位代碼，請重新整理頁面後再試` };
    if (codes.has(code)) {
      return { ok: false, message: "單位代碼重複，請重新整理頁面後再試" };
    }
    codes.add(code);
    if (!name) return { ok: false, message: "單位名稱不可空白" };
    if (name.length > ORG_NAME_MAX) {
      return { ok: false, message: `「${name}」名稱過長（最多 ${ORG_NAME_MAX} 字）` };
    }
    if (!Number.isInteger(level) || level < 1 || level > levelCount) {
      return { ok: false, message: `「${name}」的層級超出學校層級數` };
    }
    if (level === 1 && parentRaw !== null) {
      return { ok: false, message: `「${name}」為最上層單位，不應指定上級單位` };
    }
    if (level > 1 && parentRaw === null) {
      return { ok: false, message: `「${name}」未指定上級單位` };
    }
    units.push({ code, name, level, parent: parentRaw });
  }

  const byCode = new Map(units.map((unit) => [unit.code, unit]));
  const siblingKeys = new Set<string>();
  for (const unit of units) {
    if (unit.parent !== null) {
      const parent = byCode.get(unit.parent);
      if (!parent) return { ok: false, message: `「${unit.name}」的上級單位不存在` };
      if (parent.code === unit.code) {
        return { ok: false, message: `「${unit.name}」的上級單位不可為自己` };
      }
      if (parent.level !== unit.level - 1) {
        return { ok: false, message: `「${unit.name}」的上級單位層級不符（上級應高一層）` };
      }
    }
    const key = `${unit.parent ?? "root"}|${unit.name}`;
    if (siblingKeys.has(key)) {
      return { ok: false, message: `同一上級單位下有重複名稱：「${unit.name}」` };
    }
    siblingKeys.add(key);
  }

  return { ok: true, value: { levelCount, levelLabels, units } };
}

export type OrgPlacementResult =
  | { ok: true; value: OrgStructure }
  | { ok: false; message: string };

export function findUnit(structure: OrgStructure, code: string | null): OrgUnit | null {
  if (!code) return null;
  return structure.units.find((unit) => unit.code === code) ?? null;
}

/** 某上級之下的直屬單位（維持陣列順序）；parent 為 null 代表最上層 */
export function childrenOf(structure: OrgStructure, parent: string | null): OrgUnit[] {
  return structure.units.filter((unit) => (unit.parent ?? null) === parent);
}

export function childCountOf(structure: OrgStructure, code: string): number {
  return structure.units.filter((unit) => unit.parent === code).length;
}

/** 全部後代代碼（不含自己；visited 防資料毀損造成無窮迴圈） */
export function descendantCodes(structure: OrgStructure, code: string): Set<string> {
  const out = new Set<string>();
  const queue = [code];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const unit of structure.units) {
      if (unit.parent !== current || out.has(unit.code) || unit.code === code) continue;
      out.add(unit.code);
      queue.push(unit.code);
    }
  }
  return out;
}

/** 含自己在內的最大層級（用來判斷搬移後是否超出層級數） */
export function maxSubtreeLevel(structure: OrgStructure, code: string): number {
  const codes = new Set([code, ...descendantCodes(structure, code)]);
  let max = 0;
  for (const unit of structure.units) {
    if (codes.has(unit.code)) max = Math.max(max, unit.level);
  }
  return max;
}

/** 以樹狀順序攤平（父先於子、兄弟依陣列順序），供表格與分欄檢視共用 */
export function flattenOrgTree(structure: OrgStructure): OrgUnit[] {
  const out: OrgUnit[] = [];
  const visited = new Set<string>();
  const visit = (parent: string | null) => {
    for (const unit of childrenOf(structure, parent)) {
      if (visited.has(unit.code)) continue;
      visited.add(unit.code);
      out.push(unit);
      visit(unit.code);
    }
  };
  visit(null);
  return out;
}

/** 樹狀節點：供視覺化檢視以「母艦」方式巢狀呈現（第 1 層卡片內含第 2 層…） */
export interface OrgNode {
  unit: OrgUnit;
  children: OrgNode[];
}

/**
 * 依上級關係組成樹（兄弟依陣列順序）。
 * 只在「上級恰高一層」時連結，故不可能成環；
 * 上級不存在或層級不符的單位先當最上層，問題交由驗證回報。
 */
export function buildOrgTree(structure: OrgStructure): OrgNode[] {
  const nodes = new Map<string, OrgNode>();
  for (const unit of structure.units) nodes.set(unit.code, { unit, children: [] });
  const roots: OrgNode[] = [];
  for (const unit of structure.units) {
    const node = nodes.get(unit.code);
    if (!node) continue;
    const parent = unit.parent ? nodes.get(unit.parent) : null;
    if (parent && parent.unit.level === unit.level - 1) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** 搬到新上級的末尾（兄弟順序＝陣列相對順序，故把目標單位插到最後一個兄弟之後） */
function placeAfterSiblings(units: OrgUnit[], code: string, parent: string | null): OrgUnit[] {
  const index = units.findIndex((unit) => unit.code === code);
  if (index < 0) return units;
  const next = units.slice();
  const [moved] = next.splice(index, 1);
  if (!moved) return units;
  let insertAt = next.length;
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if ((next[i]?.parent ?? null) === parent) {
      insertAt = i + 1;
      break;
    }
  }
  next.splice(insertAt, 0, moved);
  return next;
}

/**
 * 核心搬移：依新的上級推導層級，並把整棵子樹一起平移。
 * 規則：上級不可是自己或後代、平移後最深層不可超過 levelCount。
 */
function applyPlacement(
  structure: OrgStructure,
  code: string,
  parent: string | null
): OrgPlacementResult {
  const unit = findUnit(structure, code);
  if (!unit) return { ok: false, message: "找不到該單位" };
  const targetParent = findUnit(structure, parent);
  if (parent !== null && !targetParent) return { ok: false, message: "找不到上級單位" };
  if (targetParent) {
    if (targetParent.code === code) return { ok: false, message: "不可移入自己" };
    if (descendantCodes(structure, code).has(targetParent.code)) {
      return { ok: false, message: "不可移入自己的下級單位" };
    }
  }

  const nextLevel = targetParent ? targetParent.level + 1 : 1;
  if (nextLevel > structure.levelCount) {
    return { ok: false, message: "已達學校層級數上限，無法設為此單位的下級" };
  }
  const delta = nextLevel - unit.level;
  if (maxSubtreeLevel(structure, code) + delta > structure.levelCount) {
    return { ok: false, message: "其下尚有子單位，搬移後會超出學校層級數" };
  }

  const subtree = new Set([code, ...descendantCodes(structure, code)]);
  const units = structure.units.map((entry) => {
    if (!subtree.has(entry.code)) return entry;
    if (entry.code === code) {
      return { ...entry, level: nextLevel, parent: targetParent?.code ?? null };
    }
    return { ...entry, level: entry.level + delta };
  });
  const parentCode = targetParent?.code ?? null;
  return {
    ok: true,
    value: { ...structure, units: placeAfterSiblings(units, code, parentCode) },
  };
}

/** 設定上級單位（null＝設為最上層）；拖曳與「所屬上級單位」下拉共用 */
export function setUnitParent(
  structure: OrgStructure,
  code: string,
  parent: string | null
): OrgPlacementResult {
  return applyPlacement(structure, code, parent);
}

/**
 * 直接設定層級（表格的「層級」欄）：
 * 第 1 層＝清空上級；其餘層級若原上級不符新層級則暫留空，
 * 由驗證回報「未指定上級單位」擋住儲存，直到管理員補選。
 */
export function setUnitLevel(
  structure: OrgStructure,
  code: string,
  level: number
): OrgPlacementResult {
  if (!Number.isInteger(level) || level < 1 || level > structure.levelCount) {
    return { ok: false, message: `層級需為 1 至 ${structure.levelCount} 的整數` };
  }
  const unit = findUnit(structure, code);
  if (!unit) return { ok: false, message: "找不到該單位" };
  const currentParent = findUnit(structure, unit.parent);
  const keepParent =
    level === 1 ? null : currentParent && currentParent.level === level - 1 ? unit.parent : null;

  const delta = level - unit.level;
  if (delta !== 0 && maxSubtreeLevel(structure, code) + delta > structure.levelCount) {
    return { ok: false, message: "其下尚有子單位，調整層級後會超出學校層級數" };
  }

  const subtree = new Set([code, ...descendantCodes(structure, code)]);
  const units = structure.units.map((entry) => {
    if (!subtree.has(entry.code)) return entry;
    if (entry.code === code) return { ...entry, level, parent: keepParent };
    return { ...entry, level: entry.level + delta };
  });
  return {
    ok: true,
    value: { ...structure, units: placeAfterSiblings(units, code, keepParent) },
  };
}

/**
 * 與同層的前一個／後一個兄弟對調（direction：-1 上移、1 下移）。
 * 兄弟順序＝陣列相對順序，第一層順序即全校處室的羅列順位；
 * 對調兩個元素在陣列中的位置，其餘元素位置不動。
 */
export function moveSibling(
  structure: OrgStructure,
  code: string,
  direction: -1 | 1
): OrgPlacementResult {
  const unit = findUnit(structure, code);
  if (!unit) return { ok: false, message: "找不到該單位" };
  const siblings = childrenOf(structure, unit.parent);
  const index = siblings.findIndex((item) => item.code === code);
  const target = index >= 0 ? siblings[index + direction] : undefined;
  if (!target) {
    return {
      ok: false,
      message: direction < 0 ? "已是同層的第一個單位" : "已是同層的最後一個單位",
    };
  }
  const units = structure.units.slice();
  const from = units.findIndex((item) => item.code === code);
  const to = units.findIndex((item) => item.code === target.code);
  if (from < 0 || to < 0) return { ok: false, message: "找不到該單位" };
  const moved = units[from];
  const swapped = units[to];
  if (!moved || !swapped) return { ok: false, message: "找不到該單位" };
  units[from] = swapped;
  units[to] = moved;
  return { ok: true, value: { ...structure, units } };
}

/** 同上級單位內不重複的預設名稱 */
function uniqueSiblingName(structure: OrgStructure, parent: string | null): string {
  const names = new Set(childrenOf(structure, parent).map((unit) => unit.name));
  if (!names.has("新單位")) return "新單位";
  for (let index = 2; index <= ORG_MAX_UNITS + 1; index += 1) {
    const candidate = `新單位${index}`;
    if (!names.has(candidate)) return candidate;
  }
  return `新單位${Date.now()}`;
}

/** 新增單位（parent 為 null 代表最上層）；名稱給預設值，改名在表格／卡片上直接編輯 */
export function addUnit(structure: OrgStructure, parent: string | null): OrgPlacementResult {
  if (structure.units.length >= ORG_MAX_UNITS) {
    return { ok: false, message: `單位數量已達上限（最多 ${ORG_MAX_UNITS} 筆）` };
  }
  const targetParent = findUnit(structure, parent);
  if (parent !== null && !targetParent) return { ok: false, message: "找不到上級單位" };
  const parentCode = targetParent?.code ?? null;
  const level = targetParent ? targetParent.level + 1 : 1;
  if (level > structure.levelCount) {
    return { ok: false, message: "已達學校層級數上限，無法新增子單位" };
  }
  const unit: OrgUnit = {
    code: newUnitCode(),
    name: uniqueSiblingName(structure, parentCode),
    level,
    parent: parentCode,
  };
  const units = placeAfterSiblings([...structure.units, unit], unit.code, unit.parent);
  return {
    ok: true,
    value: { ...structure, units },
  };
}

/** 刪除單位（有子單位時拒絕，需先搬移或刪除子單位） */
export function removeUnit(structure: OrgStructure, code: string): OrgPlacementResult {
  const unit = findUnit(structure, code);
  if (!unit) return { ok: false, message: "找不到該單位" };
  if (childCountOf(structure, code) > 0) {
    return { ok: false, message: `「${unit.name}」尚有子單位，請先搬移或刪除子單位` };
  }
  return {
    ok: true,
    value: { ...structure, units: structure.units.filter((entry) => entry.code !== code) },
  };
}

/** 變更學校層級數（縮小時仍有單位在更高層＝拒絕） */
export function setLevelCount(structure: OrgStructure, levelCount: number): OrgPlacementResult {
  if (!Number.isInteger(levelCount) || levelCount < 1 || levelCount > ORG_MAX_LEVEL) {
    return { ok: false, message: `學校層級數需為 1 至 ${ORG_MAX_LEVEL} 的整數` };
  }
  if (levelCount < structure.levelCount) {
    const overflow = structure.units.filter((unit) => unit.level > levelCount);
    if (overflow.length > 0) {
      const names = overflow
        .slice(0, 3)
        .map((unit) => `「${unit.name}」`)
        .join("、");
      return {
        ok: false,
        message: `仍有 ${overflow.length} 個單位位於第 ${levelCount} 層以上（${names}${
          overflow.length > 3 ? " 等" : ""
        }），請先調整這些單位`,
      };
    }
  }
  const levelLabels = Array.from({ length: levelCount }, (_, index) => {
    return structure.levelLabels[index] || defaultOrgLabel(index + 1);
  });
  return { ok: true, value: { ...structure, levelCount, levelLabels } };
}
