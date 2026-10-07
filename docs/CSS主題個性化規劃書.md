# 數位校園工具箱 — CSS 主題個性化規劃書（主程式側）

> **狀態**：規劃定稿，尚未實作
> **適用範圍**：`campus-toolkit` 主程式（Next.js 16 + Firebase）
> **對應文件**：`docs/主題市集規劃書.md`（外部獨立市集）、`docs/資料庫讀取規範.md`（Firestore 讀取鐵律）、`docs/資料模型.md`（資料表）
> **參考來源**：`D:\workspace\exampleGAS\數位校園GAS站大本營\` 之 `CSS主題細緻化規劃書.md`、`數位校園GAS站主題市集\主題市集規劃書.md`

---

## 一、背景與現況

### 1.1 目標

1. 使用者可**自由套用與變更** CSS 主題，且偏好**跟著帳號走**（換電腦、清快取都不遺失）。
2. 使用者可**匯入 / 匯出 / 複製**主題 JSON，打造專屬外觀。
3. 提供**線上主題編輯器**（即時預覽），作為內建功能模組，同時服務「個性化主題」頁與外部市集投稿。
4. 透過**外部獨立主題市集**取得社群主題，一鍵安裝到本系統。
5. 全部新頁面遵守**響應式設計**，適應各種寬度的瀏覽器。

### 1.2 既有資產（已就緒，可直接沿用）

| 資產 | 位置 | 現況 |
|---|---|---|
| 10 套內建主題 | `src/lib/themes.ts:3-404`（`builtinThemes`）、`:406`（`getThemeById`）、`:410`（`defaultTheme`） | 完整可用 |
| 33 鍵色彩型別 | `src/types/theme.ts:1-35`（`ThemeColors`）、`:37-42`（`Theme`）、`:44-54`（`ThemeId`） | 完整可用 |
| 主題套用引擎 | `src/contexts/ThemeContext.tsx:47-54`（`applyTheme` 逐鍵 `setProperty`） | 完整可用 |
| 解析優先序雛形 | `src/contexts/ThemeContext.tsx:37-45`：`強制 > 帳號 > localStorage > 預設` | 寫法已正確，但帳號層未接線 |
| 主題切換抽屜 | `src/components/ThemeToggle.tsx`（143 行） | 僅 10 內建，無匯入匯出 |
| Admin 強制主題 | `src/types/settings.ts:17`、`src/app/api/settings/route.ts:38`、`src/app/admin/settings/page.tsx:143-168` | 已上線 |
| 帳號主題欄位 | `src/types/users.ts:251`（`cssThemeId`）、`:253`（`installedThemes`）；初始化於 `src/lib/roster.ts:332-333` | **已建欄位，零讀寫** |
| CSS 變數基底與工具類 | `src/styles/globals.css:3-38`（`:root`）、`:321-429`（主題化 utility） | 完整可用 |
| CSP | `src/proxy.ts:36` `style-src 'self' 'unsafe-inline' …` | inline 樣式無阻礙 |

### 1.3 缺口

| # | 缺口 | 位置 |
|---|---|---|
| 1 | `campusUserTheme` 是**死鍵**，全專案無任何地方寫入 → 主題偏好跟瀏覽器走、不跟帳號走 | `src/contexts/ThemeContext.tsx:38` |
| 2 | `users.cssThemeId` / `users.installedThemes` 無任何 API 讀寫、無任何 UI 顯示 | `src/types/users.ts:251-253` |
| 3 | 抽屜只有 10 內建主題，無匯入 / 匯出 / 複製 / 市集入口 | `src/components/ThemeToggle.tsx:84-126` |
| 4 | 無「個性化主題」功能頁；`RoleSettings` 為空頁 | `src/components/RoleSettings.tsx:102-129` |
| 5 | 無主題 JSON 驗證、無 Schema 規格、無線上編輯器 | 全專案 |
| 6 | RWD 只用 `sm:` 與 `xl:`，**`md:` 與 `lg:` 完全未使用**；無共用 breakpoint hook | 全專案 73 個檔案 |

### 1.4 GAS 已定案、本文件直接沿用的設計

以下結論來自 `CSS主題細緻化規劃書.md`，兩支 GAS 程式已實作並實測通過，本文件不再重新討論：

1. **混合架構**：帳號欄位為唯一事實來源，localStorage 為快取與未登入後備。
2. **解析優先序**：`Admin 強制 > 使用者帳號欄位 > localStorage > 系統預設`；空值即不介入。
3. **ID 前綴 = 本體可取得性**：`builtin:` 永遠在系統內；`market:` 可由伺服器取回；`custom:` / `imported:` 只在建立者的瀏覽器。
4. **方案 A**：帳號欄位只收 `builtin:` 與 `market:`，`custom:` / `imported:` 不進帳號欄位。
5. **方案 B-lite**：「已安裝清單」伺服器化，格式 `[{id, name, installedAt}]`，主題本體仍由市集取回。
6. **來源標籤**：清單每筆顯示「內建 / 市集 / 自訂 / 匯入」，並在三處關鍵位置提供說明。

---

## 二、主題 JSON Schema（唯一規格來源）

### 2.1 檔案位置

新增 `src/types/theme-package.ts`。本節是**全系統唯一的 Schema 規格來源**；外部市集的對應實作須與本節逐條一致（市集側規格見 `docs/主題市集規劃書.md` 第二章，兩份文件的 §2/§2 欄位與驗證規則完全相同）。

### 2.2 完整格式

```json
{
  "schema_version": 1,
  "id": "market:6f1c9a3e-2b44-4d1a-8c7e-9a2b3c4d5e6f",
  "name": "暗紫夜行",
  "author": "張家誠",
  "authorEmail": "takan003@gms.hlgs.hlc.edu.tw",
  "authorUrl": "",
  "description": "暗色系舒適主題，適合長時間使用",
  "tags": ["暗色", "護眼", "夜間"],
  "version": "1.2.0",
  "preview": {
    "dot": "#7c8cf0",
    "background": "#1a1a2e",
    "primary": "#7c8cf0"
  },
  "colors": {
    "--bg": "#1a1a2e",
    "--bg2": "#16213e",
    "…": "其餘 31 鍵見 2.3"
  }
}
```

| 欄位 | 必填 | 型別 | 規則 |
|---|---|---|---|
| `schema_version` | 是 | number | 目前固定 `1`；不等於 1 → 拒絕 |
| `id` | 是 | string | `^(builtin\|market\|imported\|custom):[A-Za-z0-9:_-]{1,64}$` |
| `name` | 是 | string | 去除前後空白後 1～40 字元 |
| `colors` | 是 | object | 鍵必須**全部**落在 2.3 白名單內（出現未知鍵＝拒絕，不做靜默忽略） |
| `author` | 否 | string | ≤ 40 字元，預設 `""` |
| `authorEmail` | 否 | string | ≤ 100 字元，投稿聯絡用 |
| `authorUrl` | 否 | string | ≤ 200 字元；須為 `https://` 開頭或空字串 |
| `description` | 否 | string | ≤ 300 字元 |
| `tags` | 否 | string[] | 陣列 ≤ 8 個，每項 ≤ 12 字元 |
| `version` | 否 | string | 建議 semver（`1.2.0`），非 semvar 不擋但會正規化顯示 |
| `preview` | 否 | object | `{dot, background, primary}` 三鍵皆為 hex；缺值時由 `colors` 推導（`dot=primary`、`background=bg`） |

**必要欄位**：`id`、`name`、`colors`。其餘缺省時由驗證層補齊。

### 2.3 colors 白名單（33 鍵）

| 分類 | 鍵 |
|---|---|
| 核心 18 鍵（舊協議，所有端點必備相容） | `--bg` `--bg2` `--t1` `--t2` `--t3` `--bd` `--bd2` `--card` `--sh` `--primary` `--primary-hover` `--danger` `--success` `--warning` `--radius` `--font-sans` `--font-mono` `--transition` |
| 擴充 15 鍵（按鈕與連結） | `--primary-text` `--primary-text-hover` `--primary-block` `--btn-secondary` `--btn-secondary-hover` `--btn-secondary-text` `--btn-secondary-text-hover` `--btn-danger` `--btn-danger-hover` `--btn-danger-text` `--btn-danger-text-hover` `--btn-disabled` `--btn-disabled-text` `--link` `--link-hover` |

實作時以 `src/types/theme.ts` 的 `ThemeColors` 為準，常數宣告為：

```ts
export const THEME_COLOR_KEYS = [
  "--bg", "--bg2", /* …33 鍵全列… */
] as const;
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
export const THEME_CORE_KEY_COUNT = 18;
```

**缺值處理**：核心 18 鍵缺值時，以 `defaultTheme.colors`（`builtin:white`）對應值補齊；擴充 15 鍵缺值時，由主程式既有 `globals.css` 的 `color-mix()` 與繼承行為自然承擔，不需補值（與 GAS `THEME_FALLBACK` 行為一致）。

### 2.4 值驗證規則

| 類型 | 鍵 | 規則 |
|---|---|---|
| 顏色 | `--bg` `--bg2` `--t1` `--t2` `--t3` `--bd` `--bd2` `--card` `--primary` `--primary-hover` `--primary-text` `--primary-text-hover` `--primary-block` `--danger` `--success` `--warning` `--btn-secondary` `--btn-secondary-hover` `--btn-secondary-text` `--btn-secondary-text-hover` `--btn-danger` `--btn-danger-hover` `--btn-danger-text` `--btn-danger-text-hover` `--btn-disabled` `--btn-disabled-text` `--link` `--link-hover` | `^#[0-9a-fA-F]{3}$`、`^#[0-9a-fA-F]{6}$` 或 `^#[0-9a-fA-F]{8}$`，長度 ≤ 9 |
| 陰影 | `--sh` | `^[0-9a-zA-Z ,.#()%/-]{0,120}$`，**禁止** `;` `{` `}` `<` `>` `url(` `expression(` `@` |
| 尺寸 / 時間 | `--radius` `--transition` | 同上白名單字元，長度 ≤ 60；`--radius` 建議 `0`～`32px`、`--transition` 建議 `0`～`1s` |
| 字型 | `--font-sans` `--font-mono` | 同上白名單字元，長度 ≤ 80；禁止 `url(` 與 `@import` |

**為什麼要嚴格擋值**：主題值最終由 `document.documentElement.style.setProperty(key, value)` 注入。`setProperty` 本身不會執行腳本，但若放行 `;` 或 `url()`，攻擊者可藉 CSS 注入改變版面、讀取外部資源。白名單＋字元過濾後，本機匯入與市集下載的 JSON 都不可能造成上述風險。

### 2.5 與現有 `Theme` 的相容層

現有 `Theme`（`src/types/theme.ts:37-42`）的 `preview` 是 `string`，而 Schema 的 `preview` 是物件。**不改動現有 `Theme` 與 `builtinThemes`**，改以轉換函式銜接：

```ts
// src/lib/theme-package.ts
export function toTheme(pkg: ThemePackage): Theme;          // preview: pkg.preview.background
export function toPackage(theme: Theme): ThemePackage;      // id/name/colors + 推導 preview
export function validateThemePackage(raw: unknown, opts?: {
  mode: "import" | "install" | "submit";   // 匯入 / 安裝市集主題 / 投稿
}): { ok: true; pkg: ThemePackage } | { ok: false; message: string };
```

- `mode: "import"` 允許 `imported:` / `custom:`；`mode: "install"` 只允許 `market:`；`mode: "submit"` 只允許 `market:`（伺服端重簽）。
- `ThemeId` union（`src/types/theme.ts:44-54`）維持 10 個內建 id 不變；執行期其餘 id 一律以 `string` 處理（現有 `setTheme(id: ThemeId | string)` 已支援）。

### 2.6 ID 前綴規範

| 前綴 | 簽發者 | 本體位置 | 可進 `users.cssThemeId` | 可卸載 |
|---|---|---|---|---|
| `builtin:` | 系統 | 程式碼（`src/lib/themes.ts`） | 是 | 否 |
| `market:{uuid}` | 市集（伺服端重簽） | 市集資料庫，主程式伺服端取回 | 是 | 是 |
| `imported:{uuid}` | 本機匯入（`crypto.randomUUID()`） | `localStorage.campusTheme_{id}` | **否** | 是 |
| `custom:{uuid}` | 線上編輯器 | `localStorage.campusTheme_{id}` | **否** | 是 |

---

## 三、主題解析優先序

### 3.1 規則

新增純函式 `src/lib/theme-resolve.ts`，**全系統唯一實作點**（ThemeContext、安裝頁、管理端強制設定都呼叫它）：

```
resolveThemeId({ forcedId, accountThemeId, localThemeId, defaultId })
  = forcedId || accountThemeId || localThemeId || defaultId
```

| 規則 | 說明 |
|---|---|
| 強制絕對化 | `settings.cssThemeId` 有值時，帳號欄位與 localStorage **全部不介入** |
| 空值不介入 | 任一層為空字串、`null`、`undefined` 視為「該層不存在」，往下找 |
| 本體缺失降級 | 解析出的 id 為 `market:` 而本體不在快取 → 先套 `defaultTheme` 維持畫面，背景 `fetchMarketTheme(id)` 成功後重套；失敗保留預設並記錄 `console.warn` |
| `custom:` / `imported:` 跨機 | 本體只在原瀏覽器；他機解析到但查無本體 → 降級預設，UI 顯示「此主題僅存於原裝置」提示 |

### 3.2 各執行緒的來源

| 來源 | 讀取點 | 寫入點 |
|---|---|---|
| 強制 | `localStorage.campusToolkitForcedTheme`（由 `src/app/admin/settings/page.tsx:197,233` 同步） | Admin 系統設定存檔時；`ThemeContext.setForcedTheme` |
| 帳號 | `session.cssThemeId`（由 `/api/auth/me` 回傳）→ 寫入 `localStorage.campusUserTheme` | `PUT /api/me/theme` 成功回應 |
| 本機 | `localStorage.campusToolkitTheme` | `ThemeContext.setTheme`（非強制時） |
| 預設 | `defaultTheme.id`（`builtin:white`） | — |

---

## 四、主題本體儲存層

新增 `src/lib/theme-store.ts`（全部為 client-side）。

### 4.1 localStorage 鍵表

| Key | 內容 | 狀態 |
|---|---|---|
| `campusToolkitTheme` | 目前啟用的主題 id | 既有，保留 |
| `campusToolkitForcedTheme` | Admin 強制主題 id | 既有，保留 |
| `campusUserTheme` | 帳號主題 id | **本次接線**（目前為死鍵） |
| `campusTheme_{id}` | 主題本體 JSON（`ThemePackage` 字串） | 新增 |
| `campusThemeCacheAt_{id}` | 本體快取的時間戳（毫秒） | 新增，`market:` 30 分鐘更新檢查 |
| `campusThemeInstalled` | `[{id, name, installedAt}]` | 新增，伺服端 `users.installedThemes` 的本機快取 |
| `campusCardOrder.{role\|admin}` | 首頁卡片順序 | 既有，與主題無關 |

> 鍵名刻意沿用 GAS 語意（`*_Installed`、`_{id}` 快取），便於日後對照兩邊文件。

### 4.2 API

```ts
readTheme(id: string): ThemePackage | null;
writeTheme(pkg: ThemePackage): void;              // 寫本體 + 時間戳
removeTheme(id: string): void;                    // 本體 + 時間戳
listInstalled(): InstalledEntry[];                // 伺服端清單為準，合併本機
isThemeCached(id: string): boolean;
fetchMarketTheme(id: string): Promise<ThemePackage | null>;  // GET /api/market/themes/[id]
isStale(id: string, ttlMs?: number): boolean;     // 預設 30 分鐘
isDarkColor(hex: string): boolean;                // 自 ThemeContext.tsx:56 搬出
```

### 4.3 安裝清單

格式與 GAS 完全一致，前端零轉換：

```ts
interface InstalledEntry { id: string; name: string; installedAt: number; }
```

- **只收 `market:`**：`builtin:` 不需記錄（隨系統提供）；`custom:` / `imported:` 本體不在伺服器端、跨裝置取不回，不進清單。
- 上限 400 筆（`users.installedThemes` 是單一文字欄位，每筆約 100 字元，400 筆約 40KB，仍在 Firestore 欄位安全範圍內）。
- 與強制主題無關：任何登入使用者皆可增刪清單；強制只影響「啟用」。

---

## 五、帳號欄位接線（0 額外 Firestore 讀取）

### 5.1 讀取：`/api/auth/me`

`src/app/api/auth/me/route.ts` 已在第 15 行解構並剝除 `__user`（伺服器端快取，含敏感欄位）。本項改動**復用 `session.__user`，不新增任何 Firestore 讀取**：

```ts
// 追加到回傳的 user 物件（沿用既有 ...user 展開模式）
cssThemeId: typeof session.__user?.cssThemeId === "string" ? session.__user.cssThemeId : "",
installedThemes: typeof session.__user?.installedThemes === "string" ? session.__user.installedThemes : "[]",
```

前端 `fetchSession()` 取得後，由 `ThemeProvider` 寫入 `localStorage.campusUserTheme` 與 `campusThemeInstalled`（僅在非強制時寫 `campusUserTheme`，行為與 `setTheme` 一致）。

### 5.2 寫入：新增 `GET/PUT /api/me/theme`

| 方法 | 認證 | 行為 | 讀取成本 |
|---|---|---|---|
| `GET` | 已登入 | 回 `{ cssThemeId, installedThemes }` | **0 讀**（復用 `verifySession.__user`） |
| `PUT` | 已登入 | 更新兩個欄位之一 | **1 寫**（`users/{uid}`） |

`PUT` body：

```ts
{
  cssThemeId?: string;          // 省略＝不改
  installedThemes?: InstalledEntry[];
}
```

伺服端驗證：

1. `cssThemeId` 若有值 → 必須匹配 `^builtin:[\w:-]{1,64}$` 或 `^market:[\w:-]{1,64}$`（**方案 A**：`custom:` / `imported:` 拒絕，回 400 並附「自訂主題僅存於本機，請下載 JSON 備份」訊息）。
2. `installedThemes` → 必須為陣列、≤ 400 筆、每筆恰含 `id` / `name` / `installedAt` 三鍵、`id` 一律 `market:` 前綴、`name` ≤ 40 字元。
3. 兩欄位皆以**完整覆蓋**方式寫入（本機為唯一編輯來源），不做伺服器端 merge。
4. 失敗一律回 400 + 中文訊息，不寫入。

### 5.3 防抖回寫

`ThemeContext.setTheme` 與 `installTheme` / `uninstallTheme` 成功後，以 **800ms 防抖**呼叫 `PUT /api/me/theme`（對齊 GAS `_scheduleUserThemeSave` 的 800ms 慣例）。強制主題期間**不回寫 `cssThemeId`**（但安裝清單照寫）。

### 5.4 讀取規範檢視

依 `docs/資料庫讀取規範.md` 第六節清單逐項核對：

- [x] 未新增任何查詢（無 `where`、無整表掃描）
- [x] 讀過的資料同請求內復用（`__user` 復用，符合鐵律 5）
- [x] 回應不含 `passwordHash` 等敏感欄位（`__user` 仍在剝除清單內，新增的兩個欄位是獨立平鋪）
- [x] 無清單類新增 → 不需 `cachedListRead` / `invalidateAdminListCache`
- [x] 無 N+1、無 `getAll`、無 `in` 查詢
- [x] 無 `onSnapshot`、無輪詢

**結論：主程式側本次改動零新增 Firestore 讀取，僅 1 次寫入（使用者主動變更時）。**

---

## 六、來源標籤與說明文案

### 6.1 標籤

```ts
// src/lib/theme-package.ts
export const THEME_SOURCE_LABELS: Record<string, string> = {
  builtin: "內建",
  market: "市集",
  custom: "自訂",
  imported: "匯入",
};
export function themeSourceOf(id: string): keyof typeof THEME_SOURCE_LABELS;
```

顯示位置：主題中心抽屜每一筆、個性化主題頁清單每一筆、市集安裝按鈕旁。樣式沿用既有 badge 慣例（`bg-page` 底、`text-t2`、rounded、`text-xs`）。

### 6.2 三處說明文案

| # | 位置 | 文案 |
|---|---|---|
| 1 | 線上主題編輯器「下載 JSON」按鈕旁 | 「自訂主題只存在於目前瀏覽器，換電腦不會自動帶過去。請下載 JSON 保存備份；想在任何裝置使用，請投稿到主題市集。」 |
| 2 | 個性化主題頁「匯入 JSON」區塊上方 | 「匯入的主題僅存於這台裝置。匯入前請確認 JSON 來源可信，系統僅接受 33 鍵白名單內的色值。」 |
| 3 | 個性化主題頁收合小節「主題來源說明」 | 以 §6.1 四列表格說明「內建＝系統固定 10 套」「市集＝換電腦自動取回」「自訂＝只有這台瀏覽器」「匯入＝同自訂，需下載備份」 |

---

## 七、匯入 / 匯出 / 複製

### 7.1 匯入

- 入口：主題中心抽屜底部按鈕、個性化主題頁拖曳區（兩處共用 `ThemeImportDropzone` 元件）。
- 流程：`File.text()` → `JSON.parse`（try/catch，失敗回「檔案不是合法 JSON」）→ `validateThemePackage(raw, { mode: "import" })` → 以 `imported:{crypto.randomUUID()}` 重簽 id → `writeTheme()` → 自動安裝並套用 → toast 提示。
- 限制：檔案 ≤ 50KB；`accept=".json,application/json"`；拖曳與點擊選檔兩種操作都要有。
- 驗證失敗時**逐項列出**錯誤（哪個鍵、什麼問題），不清空使用者已選的檔案。

### 7.2 匯出

- 匯出單一：目前主題或清單中任一項 → `Blob` + `URL.createObjectURL` + 臨時 `<a download>` → 檔名 `theme-{name}.json`（`name` 經 `encodeURIComponent` 後的檔案系統安全化）。
- 匯出全部已安裝（含本體）：`campus-theme-backup.json`，格式 `{ schema_version: 1, exportedAt: number, themes: ThemePackage[] }`。**第一期實作，列為選用功能。**
- CSP 無影響：`blob:` 已在 `img-src`（`src/proxy.ts:37`），且下載不經由 fetch。

### 7.3 複製

`navigator.clipboard.writeText(JSON.stringify(pkg, null, 2))`；失敗時（非 HTTPS 或權限不足）回退為選取文字框讓使用者手動複製。

---

## 八、UI 規格

### 8.1 主題中心抽屜（改寫 `src/components/ThemeToggle.tsx`）

觸發鈕維持現有右上角圓形按鈕（`src/app/layout.tsx` 掛載點不變）。

| 區塊 | 規格 |
|---|---|
| 標題列 | 「選擇主題」＋關閉鈕（既有） |
| 分頁 | 兩個 tab：「內建」（10 套）／「已安裝」（`market:` + `imported:` + `custom:`）；未安裝時已安裝分頁顯示空狀態 |
| 清單項目 | 色點（`theme.preview`）＋名稱＋**來源徽章**＋目前啟用打勾（既有結構擴充） |
| hover 動作 | 「匯出 JSON」小圖示按鈕（`title="匯出 JSON"`） |
| 強制狀態 | 頂部顯示「管理員已強制主題，無法切換」提示條，清單置灰 |
| 底部 | 三個入口按鈕：「個性化主題」「主題市集」「匯入 JSON」＋「共 N 款主題」統計 |

**RWD**：行動裝置（< `sm`）抽屜改為全寬 `w-full`；`sm` 以上 `min-width: 240px; max-width: 85vw`。既有 `pointerEvents` / `aria-hidden` / `overflow-hidden` 防水平空白的處理（`ThemeToggle.tsx:49`）保留。

### 8.2 個性化主題頁 `/{role}/theme`

新共用元件 `src/components/PersonalizeTheme.tsx`，四身分各建一個一行頁：`src/app/{student,parent,staff}/theme/page.tsx`。

版型比照 `RoleSettings.tsx` 三段式（標題區 → 頁首按鈕組 → hr → 功能卡 → hr → 底部按鈕組 → 廣告 → 版權）。

| 區塊 | 內容 |
|---|---|
| A 目前主題 | 大色塊預覽（16:9）＋名稱＋來源徽章＋33 鍵色票縮圖列 |
| B 內建主題 | `grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`，每卡可點擊套用 |
| C 已安裝主題 | 同網格；每卡含「套用」「匯出」「卸載」三個動作；卸載需確認對話框 |
| D 匯入區 | 拖曳區＋選檔按鈕＋說明文案（§6.2 第 2 條） |
| E 編輯器入口 | 卡片：「線上主題編輯器 — 自訂專屬配色，即時預覽」→ `/​{role}/theme/studio` |
| F 市集 CTA | 全寬區塊：「前往主題市集 — 瀏覽社群主題，一鍵安裝」→ `/​{role}/theme/market`（或外部市集網址） |
| G 來源說明 | 收合小節 `<details>`，內含 §6.1 表格 |
| H 強制提示 | 有強制主題時，A 區顯示提示且 B/C 套用按鈕 disabled |

**三態**：B/C 區塊載入中顯示骨架卡（`--bg2` 底 + CSS 脈動）、空狀態顯示 SVG＋提示、失敗顯示錯誤＋重試。

### 8.3 首頁卡片

`src/components/RoleHome.tsx:101-114` 的 `entryCards` 加一列：

```ts
{
  icon: <svg …/>,            // 調色盤 / 油漆刷 SVG（stroke="currentColor"）
  label: "個性化主題",
  id: "personalize",
  href: `${ROLE_HOME[role]}/theme`,
}
```

排序放在「系統設定」之後。`src/app/admin/page.tsx` 的 `MODULES` 衍生卡片同步加一列（管理員入口，href `/admin/theme`）。

> 個人「設定」頁（`RoleSettings`）**維持空頁不動**：其註解已明載「個人偏好、非功能模組入口」，主題入口統一在「個性化主題」，避免兩處重複。

### 8.4 內建功能模組註冊

`src/types/feature-modules.ts` 的 `RAW_FEATURE_MODULES` 加一列（內建列區段末尾）：

```ts
{
  value: "themeStudio",
  label: "線上主題編輯器",
  kind: "builtin",
  status: "live",
  description: "以視覺化方式調整配色、圓角與字型，即時預覽並匯出主題 JSON。",
  href: "/admin/theme",       // 管理端入口；各身分入口由首頁卡片提供
  author: DEFAULT_MODULE_AUTHOR,
  provides: { student: true, parent: true, staff: true, admin: true },
},
```

- `kind: "builtin"` → 恆為啟用，不入 `featureModulesEnabled`（`readFeatureModulesEnabled` 只處理 `optional`，`src/types/feature-modules.ts:259-267`）。
- `provides` 四身分全 `true` → 顯示開關（`featureModuleRoles`）對四身分皆生效，缺省＝顯示。
- 該列會自動出現在 `/admin/modules` 功能模組管理頁（唯讀展示）。

---

## 九、線上主題編輯器 `ThemeStudio`

### 9.1 元件規格

新增 `src/components/ThemeStudio.tsx`（client component），**唯一的編輯器實作**，掛在兩處：

1. 主程式：`/{role}/theme/studio`（個性化主題頁的 E 區入口）
2. 外部市集：`/studio`（投稿頁的「線上創作」按鈕；市集側複製本元件，見市集規劃書 §7）

### 9.2 版面

```
┌────────────────────────────────┬──────────────────────────────┐
│ 基底下拉（10 內建 + 空白）      │  即時預覽                     │
│ ── 主要色 ──                   │  ┌────────────────────────┐  │
│ 主色 / 主色懸停 / 主色文字      │  │ 標題區（--t1）           │  │
│ 危險 / 成功 / 警告              │  │ 卡片（--card + --bd）     │  │
│ ── 背景與文字 ──                │  │ 表單 input/select/button │  │
│ 背景 / 背景2 / t1 / t2 / t3    │  │ 表格 / 程式碼區塊         │  │
│ 邊框 / 邊框2 / 卡片 / 陰影      │  │ 連結 / 警示框            │  │
│ ── 按鈕 ──                      │  └────────────────────────┘  │
│ 次要按鈕（4 欄）/ 危險按鈕（4 欄）│  [套用到整個系統] [還原]       │
│ 停用按鈕（2 欄）/ 連結（2 欄）   │                              │
│ ── 特殊 ──                      │  JSON 輸出（唯讀 <pre>）      │
│ 圓角滑桿 0–32px                 │                              │
│ 過渡滑桿 0–1s                   │  [複製 JSON] [下載 JSON]     │
│ 字型下拉（sans / mono）         │  [安裝並套用]                 │
└────────────────────────────────┴──────────────────────────────┘
```

- **RWD**：`grid grid-cols-1 lg:grid-cols-2 gap-4`；`lg` 以下預覽區在表單**之前**（先看到結果）。
- 色票欄位一律 `<input type="color">` + 旁邊 hex 文字輸入（雙向同步，hex 輸入需通過 §2.4 顏色 regex 才套用）。
- 陰影 `--sh` 提供 5 段預設下拉（無 / 輕 / 中 / 重 / 極重），並允許自訂文字。
- 陰影、圓角、過渡、字型、`--btn-*`、`--link*` 等**非直接對應 `<input type=color>` 的欄位**，一律用文字或下拉，避免實作過度複雜。

### 9.3 即時預覽機制

採「**本頁即時套用＋還原**」而非 iframe：

1. 進入頁面時以 `document.documentElement` 的現行計算值抓一份基準（`getComputedStyle` 取 33 鍵），作為「還原」快照。
2. 使用者每次變更 → 對 `document.documentElement` 執行 `setProperty`（與 `applyTheme` 同一條路），整頁立即變色。
3. 「還原」按鈕 → 以快照值全部 `setProperty` 回去。
4. 「套用到整個系統」→ 簽發 `custom:{uuid}` → `installTheme()` → 走正常解析路徑（含 `campusToolkitTheme` 寫入與防抖回寫帳號）。
5. 離開頁面若未儲存 → `beforeunload` 有變更時提示。

> 為避免編輯期間污染全域狀態，進入時暫存當前 id，離開時若未按「套用」則以快照還原。

### 9.4 簽發與輸出

- 編輯器簽發 `custom:{uuid}`（`crypto.randomUUID()`）。
- 「複製 JSON」/「下載 JSON」輸出 §2.2 完整格式。
- 「安裝並套用」→ 寫 `campusTheme_custom:{uuid}` → 安裝（進本機清單，**不進 `users.cssThemeId`**，因方案 A 拒絕 `custom:`）→ 提示 §6.2 第 1 條文案。

---

## 十、響應式設計規格

### 10.1 斷點表

沿用 Tailwind v4 預設，不自訂 `@theme`：

| 斷點 | 寬度 | 用途 |
|---|---|---|
| （預設） | < 640px | 單欄、抽屜全寬、按鈕與輸入全寬 |
| `sm` | ≥ 640px | 表單改橫排、網格 2 欄 |
| `md` | ≥ 768px | 內容容器加寬、工具列整併（**本次補齊**） |
| `lg` | ≥ 1024px | 網格 3 欄、編輯器雙欄（**本次補齊**） |
| `xl` | ≥ 1280px | 網格 4 欄、管理端表格滿版 |

### 10.2 通用規格（新頁一律遵守）

| 項目 | 規格 |
|---|---|
| 卡片網格 | `grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` |
| 表單列 | `flex flex-col sm:flex-row sm:items-center gap-2` + 標籤 `sm:w-40` |
| 搜尋框 | `w-full sm:w-72` |
| 表格 | 外層 `overflow-x-auto`、`whitespace-nowrap`；**優先考慮窄螢幕改卡片式列表**（新頁不新增表格） |
| 抽屜 / 側欄 | 行動全寬，桌機 `min-width: 240px`、`max-width: 85vw` |
| 觸控目標 | 最小 40×40px（行動）；圖示按鈕至少 `p-2` |
| 內容寬 | 沿用 `.content-width`（`globals.css:325-328`：`width: 80vw; min-width: 286px`）或頁面自訂 `max-w-2xl` / `max-w-5xl` |
| 水平捲動 | 沿用 `globals.css:40-47` 的 `html, body { overflow-x: clip }`；**新增元件不得依賴水平捲動** |
| JS 斷點 | 盡量用 CSS；確需 JS 時新增 `src/hooks/useBreakpoint.ts`（`window.matchMedia` + `change` 聽），**不直接讀 `window.innerWidth`** |

### 10.3 本次改動頁面的斷點走查清單

- [ ] 主題中心抽屜（8.1）
- [ ] 個性化主題頁（8.2）
- [ ] 線上主題編輯器（9.2）
- [ ] 首頁「個性化主題」卡片（8.3）

---

## 十一、資料模型異動

`docs/資料模型.md` 表 1（`users`）補充兩欄的正式規格：

| 欄位 | 型態 | 預設值 | 說明 | 可收值 |
|---|---|---|---|---|
| `cssThemeId` | string | `""` | 目前啟用的主題 id；空值＝未設定（走 localStorage / 預設） | `builtin:*`、`market:*` |
| `installedThemes` | string | `"[]"` | 已安裝主題清單，JSON 陣列字串 `[{id,name,installedAt}]`；空值視為 `[]` | `market:*`，≤ 400 筆 |

兩欄位**已存在於程式**（`src/types/users.ts:251-253`、初始化於 `src/lib/roster.ts:332-333`），本次僅補文件與讀寫接線，**不需要改 Firestore 結構、不需要 migration**。

`settings/system.cssThemeId`（Admin 強制主題）維持現狀不動。

---

## 十二、異動檔案清單

### 12.1 新增

| 檔案 | 內容 |
|---|---|
| `src/types/theme-package.ts` | `ThemePackage` 型別、33 鍵白名單常數、`THEME_SOURCE_LABELS` |
| `src/lib/theme-package.ts` | `validateThemePackage`、`toTheme`、`toPackage`、`themeSourceOf` |
| `src/lib/theme-resolve.ts` | `resolveThemeId`（唯一解析實作） |
| `src/lib/theme-store.ts` | localStorage 本體層、安裝清單、`fetchMarketTheme` |
| `src/app/api/me/theme/route.ts` | `GET` / `PUT` 帳號主題欄位 |
| `src/app/api/market/themes/[id]/route.ts` | 伺服端向市集取回主題 JSON（`MARKET_URL` 常數、https 白名單、≤50KB、狀態碼 200） |
| `src/components/PersonalizeTheme.tsx` | 個性化主題頁主體 |
| `src/app/student/theme/page.tsx` | 一行 `<PersonalizeTheme role="student" />` |
| `src/app/parent/theme/page.tsx` | 同上 `parent` |
| `src/app/staff/theme/page.tsx` | 同上 `staff` |
| `src/app/theme/studio/page.tsx` | 線上主題編輯器頁（或併入個性化頁的子路由） |
| `src/components/ThemeStudio.tsx` | 編輯器元件 |
| `src/components/ThemeImportDropzone.tsx` | 拖曳匯入元件 |
| `src/hooks/useBreakpoint.ts` | JS 斷點 hook（僅在確有需要時使用） |

### 12.2 修改

| 檔案 | 變更 |
|---|---|
| `src/contexts/ThemeContext.tsx` | 接線 `campusUserTheme`；新增 `installTheme` / `uninstallTheme` / `installedThemes` / `isForced`；`setTheme` 防抖回寫；本體缺失時背景取回 |
| `src/components/ThemeToggle.tsx` | 分頁、來源徽章、匯出、底部三入口、RWD |
| `src/app/api/auth/me/route.ts` | 回應新增 `cssThemeId` / `installedThemes`（復用 `__user`） |
| `src/components/RoleHome.tsx` | `entryCards` 加「個性化主題」卡 |
| `src/app/admin/page.tsx` | 卡片清單加同名入口 |
| `src/types/feature-modules.ts` | `RAW_FEATURE_MODULES` 加 `themeStudio` |
| `docs/資料模型.md` | `users` 兩欄規格補充 |
| `docs/資料庫讀取規範.md` | 「各類資料的讀法」表加一行：帳號主題欄位走 `__user` 復用（0 讀） |

### 12.3 不動

`src/lib/themes.ts`（10 內建）、`src/types/theme.ts`（`Theme` / `ThemeColors` / `ThemeId`）、`src/styles/globals.css`、`src/app/admin/settings/page.tsx`（強制主題）、`src/components/RoleSettings.tsx`（維持空頁）、`firestore.rules`。

---

## 十三、驗收清單

### 功能
- [ ] 登入後在 A 電腦選主題，B 電腦開啟即為同一主題（帳號欄位生效）
- [ ] 清除 localStorage 後重新登入，主題仍正確（帳號欄位生效）
- [ ] 匯入合法 JSON → 套用成功 → 來源徽章顯示「匯入」
- [ ] 匯入含未知 `colors` 鍵的 JSON → 明確拒絕並列出該鍵
- [ ] 匯入含 `url()` / `;` 色值的 JSON → 明確拒絕
- [ ] 匯出目前主題 → 檔名正確、內容為 §2.2 完整格式
- [ ] 匯出的 JSON 可再匯入（往返一致）
- [ ] 安裝市集主題 → 進「已安裝」清單、徽章「市集」、換電腦可取回
- [ ] 卸載市集主題 → 清單移除、帳號欄位同步
- [ ] `custom:` 主題不會被寫入 `users.cssThemeId`（PUT 回 400）
- [ ] Admin 設定強制主題 → 使用者無法切換、提示條出現；解除強制 → 恢復個人主題
- [ ] 編輯器即時預覽、「還原」可完全回到進入前狀態
- [ ] 編輯器「安裝並套用」後整站變色

### RWD
- [ ] 360px / 768px / 1024px / 1440px 四寬度走查 §10.3 清單
- [ ] 全程無水平捲動（`overflow-x: clip` 不被突破）
- [ ] 抽屜在行動裝置全寬且可完整捲動

### 品質
- [ ] `npm run lint`（eslint + tsc）通過
- [ ] `docs/資料庫讀取規範.md` 第六節清單逐項核對通過
- [ ] 開發中無 `console.log`（僅允許 `error` / `warn`）

### 交付流程
依 `AGENTS.md`：`npm run lint` → `npm run version:bump` → commit（訊息結尾附「版本號更新至 0.xxx」）→ `git push`。

---

## 十四、開發分期

| 期 | 內容 | 依賴 |
|---|---|---|
| 1 | Schema 與驗證（§2）、`theme-resolve`（§3）、`theme-store`（§4）、帳號接線（§5） | 無 |
| 2 | 抽屜升級（§8.1）、匯入匯出（§7）、個性化主題頁（§8.2）、首頁卡片（§8.3） | 期 1 |
| 3 | `ThemeStudio` 編輯器（§9）＋功能模組註冊（§8.4） | 期 2 |
| 4 | `/api/market/themes/[id]` 取回、安裝頁 | 期 1（可與期 2/3 平行） |
| 5 | RWD 走查（§10）、驗收（§13） | 期 2、3 |

外部市集的開發與本文件期數**無強依賴**：期 4 的取回端點可用市集的測試環境先行驗證。
