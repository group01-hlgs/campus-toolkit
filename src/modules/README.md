# `src/modules/` —— 選用（外掛）功能模組掛載點

母艦（主程式）的「對街碼頭」：選用功能模組一律放在這裡，一個模組一個資料夾，
**只對自己的資料夾負責**；本目錄自身只放這份說明檔。

```
src/modules/<模組代碼>/          ← 資料夾名 ＝ manifest 的 value（全域唯一，camelCase）
├── module.json                  # manifest：唯一註冊來源（規格見下方「文件」）
├── README.md                    # 模組說明、開發者、版本、安裝後設定方式
├── admin/  api/  components/  lib/  types/   # 模組程式碼
└── package.json                 # 僅 scripts（可選）；dependencies 一律不生效（禁止）
```

## 註冊方式（期 0 批次 1 已上線）

1. 建 `src/modules/<value>/module.json`（必填欄位與範例見
   `docs/主程式模組與功能模組.md` §3.2、擴充欄位見
   `docs/模組市集與外掛開發.md` §3.3）。
2. 執行 `npm run module:scan`（或任何 `npm run dev` / `build` / `lint` ——
   `predev`/`prebuild`/`prelint`/`pretypecheck` 會自動跑）：
   - **驗證**：欄位、`value` 撞名、`routes` 前綴白名單與路徑撞名【E13】、
     `rateLimits`/`auditActions` 模組前綴、零新依賴【E10】、
     `contractVersion`／`minHostVersion`、lock↔目錄一致性【E13】等，不合規 **fail-fast**。
   - **產生**（產物在 `src/types/*.generated.ts`，**不入 git**、勿手改）：
     - `feature-modules.generated.ts`：產品層級功能模組列（`kind` 恆 `optional`）
     - `modules.generated.ts`：`permission.mode: "new"` 的權限單位列
3. `npm run lint` 通過 → `/admin/modules`「選用功能模組」表即可見到該卡
   （`status`：`planned`＝規劃中、`building`＝開發中、`live`＝已上線）。

manifest `status` 與入口規則：`live` 必須有非空 `href`；`planned`／`building`
無入口、不可啟用（既有規則不變）。

## 批次狀態（兩批切法，見規劃書 §7）

- **批次 1（本碼頭，已提供）**：掛載點、掃描器、兩張註冊表自動合併。
  模組卡、權限單位（可指派、`requireAdminModule` 認得）即時生效。
- **批次 2（未做）**：`RATE`／`ActivityAction`／`ModuleIcon` 三表合併——
  在那之前**頁面型模組**（無自訂 API）為限；API 需三表先補。
- **P2 薄轉接檔（未做）**：`routes` 目前僅驗證、尚未掛載——
  模組頁面要能開，須待 `src/app/**` 轉接檔產生器落地。
- **P3 `module:install`／`module:link`（未做）**：外部 repo 連結與安裝腳本。

## 驗證

放一份 manifest → `npm run lint` → `/admin/modules` 看得到卡片（`building` 顯示「開發中」）
→ 移除 manifest → `npm run module:scan` 還原空產物。常用指令：

```bash
npm run module:scan   # 只跑掃描器（錯誤逐項中文列出）
```
