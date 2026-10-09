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

## 註冊方式（期 0 批次 1＋2 已上線）

1. 建 `src/modules/<value>/module.json`（必填欄位與範例見
   `docs/主程式模組與功能模組.md` §3.2、擴充欄位見
   `docs/模組市集與外掛開發.md` §3.3）。
2. 執行 `npm run module:scan`（或任何 `npm run dev` / `build` / `lint` ——
   `predev`/`prebuild`/`prelint`/`pretypecheck` 會自動跑）：
   - **驗證**：欄位、`value` 撞名、`routes` 前綴白名單與路徑撞名【E13】、
     `rateLimits`/`auditActions` 模組前綴、零新依賴【E10】、
     `contractVersion`／`minHostVersion`、lock↔目錄一致性【E13】等，不合規 **fail-fast**。
   - **產生**（產物**不入 git**、勿手改）：
     - `src/types/feature-modules.generated.ts`：產品層級功能模組列（`kind` 恆 `optional`）
     - `src/types/modules.generated.ts`：`permission.mode: "new"` 的權限單位列
     - `src/lib/rate.generated.ts`：限流桶，併入 `lib/rate-limit.ts` 的 `RATE`（批次 2）
     - `src/lib/activity-actions.generated.ts`：稽核動作，併入 `lib/audit.ts` 的 `ActivityAction`（批次 2）
     - `src/app/**` 薄轉接檔（P2）＋ `src/app/.gitignore`：依 `routes` 掛載模組實體，
       **實體存在才產生**（未實作＝尚未掛載）；滯留轉接檔自動刪除、不入 commit
3. `npm run lint` 通過 → `/admin/modules`「選用功能模組」表即可見到該卡
   （`status`：`planned`＝規劃中、`building`＝開發中、`live`＝已上線）。

manifest `status` 與入口規則：`live` 必須有非空 `href`；`planned`／`building`
無入口、不可啟用（既有規則不變）。

## 批次狀態（兩批切法，見規劃書 §7）

- **批次 1（已上線）**：掛載點、掃描器、功能模組列與權限單位表自動合併。
  模組卡、權限單位（可指派、`requireAdminModule` 認得）即時生效。
- **批次 2（已上線）**：`RATE`／`ActivityAction` 兩表自動合併——manifest 的
  `rateLimits`／`auditActions`（須帶模組代碼前綴，與內建撞名即報錯）產生列
  併入兩表，API 型模組可呼叫 `enforceRateLimit(RATE.X)` 並寫自訂稽核動作。
  `ModuleIcon` 不需合併：icon key 未註冊時既有程式碼自動用預設圖示（fallback）。
- **P2 薄轉接檔（已上線）**：依 `routes` 產生 `src/app/**` re-export 轉接檔——
  實體路徑＝路由路徑鏡像在模組根（如 `/admin/foo` → `admin/foo/page.tsx`，
  `/api/admin/foo` → `api/admin/foo/route.ts`，可選同目錄 `layout.tsx`）；
  **實體存在才掛載**（manifest 可先註冊後實作）；滯留轉接檔與 `src/app/.gitignore`
  由掃描器自動同步，轉接檔不入 commit。
- **P3 `module:install`／`module:link`（未做）**：外部 repo 連結與安裝腳本。

## 驗證

放一份 manifest → `npm run lint` → `/admin/modules` 看得到卡片（`building` 顯示「開發中」）
→ 移除 manifest → `npm run module:scan` 還原空產物。常用指令：

```bash
npm run module:scan   # 只跑掃描器（錯誤逐項中文列出）
```
