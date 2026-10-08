/**
 * 樓層空間設定（校園空間的層級分類與空間清單）。
 *
 * 屬「學校基本設定」模組（schoolSettings，超級專屬）的子功能 `schoolSettings.spaces`：
 * 管理人員自行決定空間層級數與每層名稱（如「校區 → 大樓 → 樓層 → 空間」），
 * 並設定每個空間的中英文名稱、隸屬單位、隸屬層級、是否開放借用、容納人數與設備說明。
 *
 * 資料存於獨立文件 `settings/spaces`（結構性資料、不按學期）：
 * - 刻意不放 `settings/system`：系統設定的 PUT 是整份覆寫，混放會在下次儲存系統設定時被清掉。
 * - 欄位：levelCount／levelLabels／units。
 * - `units[].orgUnit` 引用單位層級設定（`settings/school`）的單位 code，API 儲存前會核對存在。
 *
 * 本檔不可 import `server-only`（`src/lib/*` 皆為伺服器專用），
 * 前端表單與 API 伺服器端共用這裡的驗證與搬移規則。
 */

/** 一個空間條目（教室、場地、棟別、樓層等節點） */
export interface SpaceUnit {
  /** 穩定代碼：新增時產生、改名不變，供日後預約單、行事曆地點等欄位引用 */
  code: string;
  /** 中文名稱（同上級空間內不可重複） */
  name: string;
  /** 英文名稱（可空白） */
  nameEn: string;
  /** 空間代碼（展示用，如「R-301」；可空白，填寫時全校唯一） */
  spaceCode: string;
  /** 樓層（如「3F」「B2」；可空白） */
  floor: string;
  /** 所在層級 1..levelCount（＝隸屬空間層級） */
  level: number;
  /** 上級空間 code；最上層（level 1）必為 null */
  parent: string | null;
  /** 隸屬單位 code（settings/school 的單位）；null＝未指定 */
  orgUnit: string | null;
  /** 是否開放借用（預設 true；預約等模組日後以此欄過濾） */
  openForBooking: boolean;
  /** 容納人數；null＝未填寫 */
  capacity: number | null;
  /** 空間設備說明（可空白） */
  notes: string;
}

export interface SpaceStructure {
  /** 空間層級數 1..SPACE_MAX_LEVEL */
  levelCount: number;
  /** 每層名稱，長度恆等於 levelCount */
  levelLabels: string[];
  /** 扁平陣列；兄弟順序＝陣列中的相對順序 */
  units: SpaceUnit[];
}

/** 供表單「隸屬單位」下拉與伺服器驗證共用的單位選項 */
export interface SpaceOrgOption {
  code: string;
  name: string;
}

/** 驗證上下文：單位層級設定的單位 code 集合（核對 units[].orgUnit 是否存在） */
export interface SpaceValidationContext {
  orgCodes: ReadonlySet<string>;
}

export const SPACES_DOC_ID = "spaces";
export const SPACE_MAX_LEVEL = 6;
export const SPACE_MAX_UNITS = 500;
export const SPACE_NAME_MAX = 40;
export const SPACE_NAME_EN_MAX = 60;
export const SPACE_REF_MAX = 20;
export const SPACE_FLOOR_MAX = 20;
export const SPACE_LABEL_MAX = 20;
export const SPACE_CODE_MAX = 64;
export const SPACE_ORG_UNIT_MAX = 64;
export const SPACE_NOTES_MAX = 200;
export const SPACE_CAPACITY_MAX = 999;

const LEVEL_CN = ["一", "二", "三", "四", "五", "六"];

/** 未自訂時的預設層級名稱：第一層、第二層… */
export function defaultSpaceLabel(level: number): string {
  const cn = LEVEL_CN[level - 1];
  return cn ? `第${cn}層` : `第${level}層`;
}

/**
 * 未自訂時的預設層級：兩層「樓層 → 空間」，對應一般校園場景
 * （管理人員可再改名或增減層，如「校區 → 大樓 → 樓層 → 空間」）。
 */
export function defaultSpaceStructure(): SpaceStructure {
  return { levelCount: 2, levelLabels: ["樓層", "空間"], units: [] };
}

/** 新空間代碼：時間基底＋亂碼，同毫秒內也不會相撞 */
export function newSpaceCode(): string {
  return `sp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export type SpaceValidation = { ok: true; value: SpaceStructure } | { ok: false; message: string };

function readSpace(raw: unknown, levelCount: number): SpaceUnit | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const code = typeof item.code === "string" ? item.code.trim().slice(0, SPACE_CODE_MAX) : "";
  if (!code) return null;
  const name = typeof item.name === "string" ? item.name.trim().slice(0, SPACE_NAME_MAX) : "";
  const nameEn =
    typeof item.nameEn === "string" ? item.nameEn.trim().slice(0, SPACE_NAME_EN_MAX) : "";
  const spaceCode =
    typeof item.spaceCode === "string" ? item.spaceCode.trim().slice(0, SPACE_REF_MAX) : "";
  const floor = typeof item.floor === "string" ? item.floor.trim().slice(0, SPACE_FLOOR_MAX) : "";
  const levelRaw = Number(item.level);
  const level = Number.isInteger(levelRaw)
    ? Math.min(Math.max(levelRaw, 1), Math.max(levelCount, 1))
    : 1;
  const parent =
    typeof item.parent === "string" && item.parent.trim() ? item.parent.trim() : null;
  const orgUnit =
    typeof item.orgUnit === "string" && item.orgUnit.trim()
      ? item.orgUnit.trim().slice(0, SPACE_ORG_UNIT_MAX)
      : null;
  const openForBooking = item.openForBooking !== false;
  const capacityRaw = Number(item.capacity);
  const capacity =
    item.capacity === null || item.capacity === undefined || item.capacity === ""
      ? null
      : Number.isInteger(capacityRaw) && capacityRaw >= 0 && capacityRaw <= SPACE_CAPACITY_MAX
        ? capacityRaw
        : null;
  const notes = typeof item.notes === "string" ? item.notes.trim().slice(0, SPACE_NOTES_MAX) : "";
  return { code, name, nameEn, spaceCode, floor, level, parent, orgUnit, openForBooking, capacity, notes };
}

/**
 * 讀回空間設定（寬容）：只把型別與範圍修到安全值，父子關係與隸屬單位交給驗證回報，
 * 避免資料毀損時整份作廢、管理員連看都看不到。
 */
export function readSpaceStructure(raw: unknown): SpaceStructure {
  if (!raw || typeof raw !== "object") return defaultSpaceStructure();
  const data = raw as Record<string, unknown>;
  const levelRaw = Number(data.levelCount);
  if (!Number.isInteger(levelRaw) || levelRaw < 1 || levelRaw > SPACE_MAX_LEVEL) {
    return defaultSpaceStructure();
  }
  const levelCount = levelRaw;
  const rawLabels = Array.isArray(data.levelLabels) ? data.levelLabels : [];
  const levelLabels = Array.from({ length: levelCount }, (_, index) => {
    const value = rawLabels[index];
    const label = typeof value === "string" ? value.trim().slice(0, SPACE_LABEL_MAX) : "";
    return label || defaultSpaceLabel(index + 1);
  });

  const units: SpaceUnit[] = [];
  const seen = new Set<string>();
  const rawUnits = Array.isArray(data.units) ? data.units : [];
  for (const item of rawUnits) {
    const unit = readSpace(item, levelCount);
    if (!unit || seen.has(unit.code)) continue;
    seen.add(unit.code);
    units.push(unit);
  }
  // 上級代碼不存在＝視為最上層（層級不符時由驗證回報「未指定上級空間」）
  for (const unit of units) {
    if (unit.parent !== null && !seen.has(unit.parent)) unit.parent = null;
  }

  return { levelCount, levelLabels, units };
}

/**
 * 完整驗證（API 與表單共用）。
 * 父代必為高一層，因此環狀引用不可能成立（否則需無限往下）。
 * context 省略時不核對 orgUnit 是否存在（純結構檢查）；API 儲存時會傳入單位代碼集合。
 */
export function validateSpaceStructure(
  raw: unknown,
  context?: SpaceValidationContext
): SpaceValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "無效的空間設定內容" };
  }
  const data = raw as Record<string, unknown>;

  const levelCount = Number(data.levelCount);
  if (!Number.isInteger(levelCount) || levelCount < 1 || levelCount > SPACE_MAX_LEVEL) {
    return { ok: false, message: `空間層級數需為 1 至 ${SPACE_MAX_LEVEL} 的整數` };
  }

  const rawLabels = Array.isArray(data.levelLabels) ? data.levelLabels : [];
  if (rawLabels.length !== levelCount) {
    return { ok: false, message: "層級名稱的數量需與空間層級數相同" };
  }
  const levelLabels: string[] = [];
  for (let index = 0; index < levelCount; index += 1) {
    const value = rawLabels[index];
    const label = typeof value === "string" ? value.trim() : "";
    if (!label) return { ok: false, message: `第 ${index + 1} 層的層級名稱不可空白` };
    if (label.length > SPACE_LABEL_MAX) {
      return {
        ok: false,
        message: `第 ${index + 1} 層的層級名稱過長（最多 ${SPACE_LABEL_MAX} 字）`,
      };
    }
    levelLabels.push(label);
  }

  const rawUnits = Array.isArray(data.units) ? data.units : [];
  if (rawUnits.length > SPACE_MAX_UNITS) {
    return { ok: false, message: `空間數量超過上限（最多 ${SPACE_MAX_UNITS} 筆）` };
  }

  const units: SpaceUnit[] = [];
  const codes = new Set<string>();
  const spaceCodes = new Set<string>();
  for (let index = 0; index < rawUnits.length; index += 1) {
    const item = rawUnits[index];
    if (!item || typeof item !== "object") return { ok: false, message: "空間資料格式錯誤" };
    const entry = item as Record<string, unknown>;
    const code = typeof entry.code === "string" ? entry.code.trim().slice(0, SPACE_CODE_MAX) : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const nameEn = typeof entry.nameEn === "string" ? entry.nameEn.trim() : "";
    const spaceCode = typeof entry.spaceCode === "string" ? entry.spaceCode.trim() : "";
    const floor = typeof entry.floor === "string" ? entry.floor.trim() : "";
    const level = Number(entry.level);
    const parentRaw =
      typeof entry.parent === "string" && entry.parent.trim() ? entry.parent.trim() : null;
    const orgUnitRaw =
      typeof entry.orgUnit === "string" && entry.orgUnit.trim() ? entry.orgUnit.trim() : null;
    const openForBooking = entry.openForBooking !== false;
    const capacityRaw = Number(entry.capacity);
    const capacity =
      entry.capacity === null || entry.capacity === undefined || entry.capacity === ""
        ? null
        : Number(capacityRaw);
    const notes = typeof entry.notes === "string" ? entry.notes.trim() : "";
    const label = name || `第 ${index + 1} 筆空間`;

    if (!code) return { ok: false, message: `${label}缺少空間代碼，請重新整理頁面後再試` };
    if (codes.has(code)) {
      return { ok: false, message: "空間代碼重複，請重新整理頁面後再試" };
    }
    codes.add(code);
    if (!name) return { ok: false, message: "空間中文名稱不可空白" };
    if (name.length > SPACE_NAME_MAX) {
      return { ok: false, message: `「${name}」中文名稱過長（最多 ${SPACE_NAME_MAX} 字）` };
    }
    if (nameEn.length > SPACE_NAME_EN_MAX) {
      return { ok: false, message: `「${name}」英文名稱過長（最多 ${SPACE_NAME_EN_MAX} 字）` };
    }
    if (spaceCode.length > SPACE_REF_MAX) {
      return { ok: false, message: `「${name}」的空間代碼過長（最多 ${SPACE_REF_MAX} 字）` };
    }
    if (floor.length > SPACE_FLOOR_MAX) {
      return { ok: false, message: `「${name}」的樓層過長（最多 ${SPACE_FLOOR_MAX} 字）` };
    }
    if (spaceCode) {
      if (spaceCodes.has(spaceCode)) {
        return { ok: false, message: `空間代碼「${spaceCode}」重複（「${name}」與前列空間）` };
      }
      spaceCodes.add(spaceCode);
    }
    if (!Number.isInteger(level) || level < 1 || level > levelCount) {
      return { ok: false, message: `「${name}」的層級超出空間層級數` };
    }
    if (level === 1 && parentRaw !== null) {
      return { ok: false, message: `「${name}」為最上層空間，不應指定上級空間` };
    }
    if (level > 1 && parentRaw === null) {
      return { ok: false, message: `「${name}」未指定上級空間` };
    }
    if (orgUnitRaw && orgUnitRaw.length > SPACE_ORG_UNIT_MAX) {
      return { ok: false, message: `「${name}」的隸屬單位代碼過長` };
    }
    if (orgUnitRaw && context && !context.orgCodes.has(orgUnitRaw)) {
      return { ok: false, message: `「${name}」的隸屬單位不存在，請重新整理後再選` };
    }
    if (capacity !== null) {
      if (!Number.isInteger(capacity) || capacity < 0 || capacity > SPACE_CAPACITY_MAX) {
        return {
          ok: false,
          message: `「${name}」的容納人數需為 0 至 ${SPACE_CAPACITY_MAX} 的整數`,
        };
      }
    }
    if (notes.length > SPACE_NOTES_MAX) {
      return { ok: false, message: `「${name}」的設備說明過長（最多 ${SPACE_NOTES_MAX} 字）` };
    }
    units.push({ code, name, nameEn, spaceCode, floor, level, parent: parentRaw, orgUnit: orgUnitRaw, openForBooking, capacity, notes });
  }

  const byCode = new Map(units.map((unit) => [unit.code, unit]));
  const siblingKeys = new Set<string>();
  for (const unit of units) {
    if (unit.parent !== null) {
      const parent = byCode.get(unit.parent);
      if (!parent) return { ok: false, message: `「${unit.name}」的上級空間不存在` };
      if (parent.code === unit.code) {
        return { ok: false, message: `「${unit.name}」的上級空間不可為自己` };
      }
      if (parent.level !== unit.level - 1) {
        return { ok: false, message: `「${unit.name}」的上級空間層級不符（上級應高一層）` };
      }
    }
    const key = `${unit.parent ?? "root"}|${unit.name}`;
    if (siblingKeys.has(key)) {
      return { ok: false, message: `同一上級空間下有重複名稱：「${unit.name}」` };
    }
    siblingKeys.add(key);
  }

  return { ok: true, value: { levelCount, levelLabels, units } };
}

export type SpacePlacementResult =
  | { ok: true; value: SpaceStructure }
  | { ok: false; message: string };

export function findSpace(structure: SpaceStructure, code: string | null): SpaceUnit | null {
  if (!code) return null;
  return structure.units.find((unit) => unit.code === code) ?? null;
}

/** 某上級之下的直屬空間（維持陣列順序）；parent 為 null 代表最上層 */
export function childrenSpacesOf(structure: SpaceStructure, parent: string | null): SpaceUnit[] {
  return structure.units.filter((unit) => (unit.parent ?? null) === parent);
}

export function childCountOf(structure: SpaceStructure, code: string): number {
  return structure.units.filter((unit) => unit.parent === code).length;
}

/** 全部後代代碼（不含自己；visited 防資料毀損造成無窮迴圈） */
export function descendantCodes(structure: SpaceStructure, code: string): Set<string> {
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
export function maxSubtreeLevel(structure: SpaceStructure, code: string): number {
  const codes = new Set([code, ...descendantCodes(structure, code)]);
  let max = 0;
  for (const unit of structure.units) {
    if (codes.has(unit.code)) max = Math.max(max, unit.level);
  }
  return max;
}

/** 以樹狀順序攤平（父先於子、兄弟依陣列順序），供表格檢視共用 */
export function flattenSpaceTree(structure: SpaceStructure): SpaceUnit[] {
  const out: SpaceUnit[] = [];
  const visited = new Set<string>();
  const visit = (parent: string | null) => {
    for (const unit of childrenSpacesOf(structure, parent)) {
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
export interface SpaceNode {
  unit: SpaceUnit;
  children: SpaceNode[];
}

/**
 * 依上級關係組成樹（兄弟依陣列順序）。
 * 只在「上級恰高一層」時連結，故不可能成環；
 * 上級不存在或層級不符的空間先當最上層，問題交由驗證回報。
 */
export function buildSpaceTree(structure: SpaceStructure): SpaceNode[] {
  const nodes = new Map<string, SpaceNode>();
  for (const unit of structure.units) nodes.set(unit.code, { unit, children: [] });
  const roots: SpaceNode[] = [];
  for (const unit of structure.units) {
    const node = nodes.get(unit.code);
    if (!node) continue;
    const parent = unit.parent ? nodes.get(unit.parent) : null;
    if (parent && parent.unit.level === unit.level - 1) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** 搬到新上級的末尾（兄弟順序＝陣列相對順序，故把目標空間插到最後一個兄弟之後） */
function placeAfterSiblings(units: SpaceUnit[], code: string, parent: string | null): SpaceUnit[] {
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
  structure: SpaceStructure,
  code: string,
  parent: string | null
): SpacePlacementResult {
  const unit = findSpace(structure, code);
  if (!unit) return { ok: false, message: "找不到該空間" };
  const targetParent = findSpace(structure, parent);
  if (parent !== null && !targetParent) return { ok: false, message: "找不到上級空間" };
  if (targetParent) {
    if (targetParent.code === code) return { ok: false, message: "不可移入自己" };
    if (descendantCodes(structure, code).has(targetParent.code)) {
      return { ok: false, message: "不可移入自己的下級空間" };
    }
  }

  const nextLevel = targetParent ? targetParent.level + 1 : 1;
  if (nextLevel > structure.levelCount) {
    return { ok: false, message: "已達空間層級數上限，無法設為此空間的下級" };
  }
  const delta = nextLevel - unit.level;
  if (maxSubtreeLevel(structure, code) + delta > structure.levelCount) {
    return { ok: false, message: "其下尚有子空間，搬移後會超出空間層級數" };
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

/** 設定上級空間（null＝設為最上層）；表格「上級空間」下拉共用 */
export function setSpaceParent(
  structure: SpaceStructure,
  code: string,
  parent: string | null
): SpacePlacementResult {
  return applyPlacement(structure, code, parent);
}

/**
 * 插到指定上級之下的第 index 個位置（index 依「不含自己」的同層順序計算，
 * 即視覺化檢視卡片間空隙所標示的位置）。
 * 先走 applyPlacement 的整棵子樹平移規則，再把空間插進目標位置，
 * 因此跨層搬移與同層換位共用同一套限制。
 */
export function placeSibling(
  structure: SpaceStructure,
  code: string,
  parent: string | null,
  index: number
): SpacePlacementResult {
  const placed = applyPlacement(structure, code, parent);
  if (!placed.ok) return placed;
  const units = placed.value.units.slice();
  const from = units.findIndex((item) => item.code === code);
  if (from < 0) return { ok: false, message: "找不到該空間" };
  const moved = units.splice(from, 1)[0];
  if (!moved) return { ok: false, message: "找不到該空間" };
  const siblings = units.filter((item) => (item.parent ?? null) === parent);
  const wanted = Number.isInteger(index) ? index : siblings.length;
  const target = Math.max(0, Math.min(wanted, siblings.length));
  const anchor = siblings[target];
  const last = siblings[siblings.length - 1];
  let to = units.length;
  if (anchor) {
    const at = units.findIndex((item) => item.code === anchor.code);
    if (at < 0) return { ok: false, message: "找不到該空間" };
    to = at;
  } else if (last) {
    const at = units.findIndex((item) => item.code === last.code);
    if (at < 0) return { ok: false, message: "找不到該空間" };
    to = at + 1;
  }
  units.splice(to, 0, moved);
  return { ok: true, value: { ...placed.value, units } };
}

/**
 * 直接設定層級（表格的「層級」欄）：
 * 第 1 層＝清空上級；其餘層級若原上級不符新層級則暫留空，
 * 由驗證回報「未指定上級空間」擋住儲存，直到管理員補選。
 */
export function setSpaceLevel(
  structure: SpaceStructure,
  code: string,
  level: number
): SpacePlacementResult {
  if (!Number.isInteger(level) || level < 1 || level > structure.levelCount) {
    return { ok: false, message: `層級需為 1 至 ${structure.levelCount} 的整數` };
  }
  const unit = findSpace(structure, code);
  if (!unit) return { ok: false, message: "找不到該空間" };
  const currentParent = findSpace(structure, unit.parent);
  const keepParent =
    level === 1 ? null : currentParent && currentParent.level === level - 1 ? unit.parent : null;

  const delta = level - unit.level;
  if (delta !== 0 && maxSubtreeLevel(structure, code) + delta > structure.levelCount) {
    return { ok: false, message: "其下尚有子空間，調整層級後會超出空間層級數" };
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
 * 兄弟順序＝陣列相對順序，第一層順序即全校空間的羅列順位。
 */
export function moveSpaceSibling(
  structure: SpaceStructure,
  code: string,
  direction: -1 | 1
): SpacePlacementResult {
  const unit = findSpace(structure, code);
  if (!unit) return { ok: false, message: "找不到該空間" };
  const siblings = childrenSpacesOf(structure, unit.parent);
  const index = siblings.findIndex((item) => item.code === code);
  const target = index >= 0 ? siblings[index + direction] : undefined;
  if (!target) {
    return {
      ok: false,
      message: direction < 0 ? "已是同層的第一個空間" : "已是同層的最後一個空間",
    };
  }
  const units = structure.units.slice();
  const from = units.findIndex((item) => item.code === code);
  const to = units.findIndex((item) => item.code === target.code);
  if (from < 0 || to < 0) return { ok: false, message: "找不到該空間" };
  const moved = units[from];
  const swapped = units[to];
  if (!moved || !swapped) return { ok: false, message: "找不到該空間" };
  units[from] = swapped;
  units[to] = moved;
  return { ok: true, value: { ...structure, units } };
}

/** 同上級空間內不重複的預設名稱 */
function uniqueSiblingName(structure: SpaceStructure, parent: string | null): string {
  const names = new Set(childrenSpacesOf(structure, parent).map((unit) => unit.name));
  if (!names.has("新空間")) return "新空間";
  for (let index = 2; index <= SPACE_MAX_UNITS + 1; index += 1) {
    const candidate = `新空間${index}`;
    if (!names.has(candidate)) return candidate;
  }
  return `新空間${Date.now()}`;
}

/** 新增空間（parent 為 null 代表最上層）；名稱給預設值，其餘欄位在表格上直接編輯 */
export function addSpace(structure: SpaceStructure, parent: string | null): SpacePlacementResult {
  if (structure.units.length >= SPACE_MAX_UNITS) {
    return { ok: false, message: `空間數量已達上限（最多 ${SPACE_MAX_UNITS} 筆）` };
  }
  const targetParent = findSpace(structure, parent);
  if (parent !== null && !targetParent) return { ok: false, message: "找不到上級空間" };
  const parentCode = targetParent?.code ?? null;
  const level = targetParent ? targetParent.level + 1 : 1;
  if (level > structure.levelCount) {
    return { ok: false, message: "已達空間層級數上限，無法新增子空間" };
  }
  const unit: SpaceUnit = {
    code: newSpaceCode(),
    name: uniqueSiblingName(structure, parentCode),
    nameEn: "",
    spaceCode: "",
    floor: "",
    level,
    parent: parentCode,
    orgUnit: null,
    openForBooking: true,
    capacity: null,
    notes: "",
  };
  const units = placeAfterSiblings([...structure.units, unit], unit.code, unit.parent);
  return { ok: true, value: { ...structure, units } };
}

/** 刪除空間（有子空間時拒絕，需先搬移或刪除子空間） */
export function removeSpace(structure: SpaceStructure, code: string): SpacePlacementResult {
  const unit = findSpace(structure, code);
  if (!unit) return { ok: false, message: "找不到該空間" };
  if (childCountOf(structure, code) > 0) {
    return { ok: false, message: `「${unit.name}」尚有子空間，請先搬移或刪除子空間` };
  }
  return {
    ok: true,
    value: { ...structure, units: structure.units.filter((entry) => entry.code !== code) },
  };
}

/** 變更空間層級數（縮小時仍有空間在更高層＝拒絕） */
export function setSpaceLevelCount(
  structure: SpaceStructure,
  levelCount: number
): SpacePlacementResult {
  if (!Number.isInteger(levelCount) || levelCount < 1 || levelCount > SPACE_MAX_LEVEL) {
    return { ok: false, message: `空間層級數需為 1 至 ${SPACE_MAX_LEVEL} 的整數` };
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
        message: `仍有 ${overflow.length} 個空間位於第 ${levelCount} 層以上（${names}${
          overflow.length > 3 ? " 等" : ""
        }），請先調整這些空間`,
      };
    }
  }
  const levelLabels = Array.from({ length: levelCount }, (_, index) => {
    return structure.levelLabels[index] || defaultSpaceLabel(index + 1);
  });
  return { ok: true, value: { ...structure, levelCount, levelLabels } };
}
