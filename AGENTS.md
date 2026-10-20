<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 工作環境與流程協議（必讀）

收到「工作環境檢查」指令時，重溫本節並確認三個專案路徑與 git 狀態。

### 專案角色

| 代號 | 路徑 | 角色 |
|------|------|------|
| **A** | `D:\workspace\campus-toolkit` | 主程式（本機測試用）。用來掛載安裝 C。**沒有明確指令請勿修改與 push** |
| **B** | `D:\workspace\campus-toolkit-marketplace` | 模組市集。C 打包後上架到這裡 |
| **C** | `D:\workspace\(自訂模組程式名稱)` | 正在開發的選用功能模組（如 `examRegistration`） |

### 指令對應流程

收到 **「修改C選用模組程式」**：
1. 只在 C 專案中修改
2. 修改後同步到 A 已掛載的模組（重新 `module:link --copy`）測試
3. 將 C push 至遠端

收到 **「打包」**：
1. 將 C 打包並上架到 B 市集，完成後 B push
2. **絕不更動或 push 到 A**

收到 **「修改A主程式」**：
1. 針對 A 進行修改
2. push A，**請勿將本機掛載安裝的選用功能模組 push 上去**（模組產物已列入 `.gitignore`，正常 commit 不會帶入）

### 標準配置流程（新環境或重啟時）

1. 三個專案 `git pull`（必要時 `reset --hard origin/main` 強制覆蓋）
2. 啟動 A 本機伺服器（`npm run dev`）
3. 將 C 掛載安裝進入 A（`npm run module:link -- <C路徑> --copy`）

## 資料庫讀取規範（必讀）

新增或修改任何 Firestore 讀取的程式碼前，先讀 `docs/資料庫讀取規範.md`
（六條鐵律：先問要不要讀、過濾下推、精準查詢、禁 N+1 與分塊、同請求復用、
快取＋寫後失效）。改完依該文末檢查清單逐項核對，再走下方流程。

## UI 約定

0. **響應式設計＋CSS 主題（必讀）**：此系統適用於電腦、平板、手機等行動裝置，
   瀏覽器視窗寬度差異大。所有頁面與元件一律採用響應式設計
   （Tailwind 斷點：`sm:` 640px／`md:` 768px／`lg:` 1024px／`xl:` 1280px），
   禁止寫死寬度（如 `w-[800px]`）；表格過寬時以外層
   `overflow-x-auto` 橫向捲動處理，不裁切內容。
   並隨時注意 CSS 主題套用機制（詳見 `docs/主程式模組與功能模組.md` §3.5）：
   色彩一律使用語意 token（`bg-card`、`text-t1/t2/t3`、`text-danger`、
   `border-themed`、`btn-theme`／`btn-danger` 等），
   **禁止寫死色票**（如 `bg-white`、`text-gray-500`、`#333`）、
   **禁止模組自帶 CSS 檔**、CSS 變數取用**不得加 fallback**
   （宿主保證 token 必有值，fallback 會掩蓋缺漏）。
1. **跳出訊息一律用主題化 modal**：禁止使用 `window.confirm`／`window.alert`／
   `window.prompt`。確認、成功、錯誤訊息一律以 `role="dialog"`／`role="alertdialog"`
   ＋`aria-modal="true"` 的 React modal 呈現，樣式套用目前 CSS 主題
   （`bg-card`、`text-t1/t2/t3`、`text-danger`、`border-themed`、`btn-theme`／`btn-danger`）。
   參考實作：`src/app/admin/accounts/page.tsx`（確認／刪除確認／成功／部分完成 modal）、
   `src/components/SchoolClassesEditor.tsx`（成功／錯誤 modal）。
2. **省流模式的「顯示列表」按鈕須附有效資料總數**：凡以 `RevealListCard`（或同等
   省流閘門）取代列表的頁面，必須先以 count 聚合端點取得總數，並透過 `summary`
   prop 顯示（如「目前發布中 N 筆」），不得只放一個無資訊的按鈕。
   參考實作：`src/app/admin/announcements/page.tsx`（`/api/admin/announcements/count`）、
   `src/app/admin/calendar/page.tsx`、`src/app/admin/roster/page.tsx`。
3. **清單分頁規則**：
   - **無班級前提**的清單／列表（如公告、行事曆、場次）：提供常用分頁功能
     （每頁筆數下拉＋頁碼導覽）。
   - **有班級前提**的清單／列表（如名冊、帳號）：預設以「班級」為分頁單位
     （依班級代碼分組切頁），使用者仍可切換為其他分頁方式。
4. **收合／展開一律用 SVG 箭頭，不用按鈕**：所有「收合／展開」控制
   （卡片、清單、表單、說明面板等）一律以原生 `<details>`／`<summary>`
   實作，圖示統一使用共用元件 `src/components/DisclosureArrow.tsx`
   （展開時箭頭自動旋轉）。**禁止**再以 `<button>` 搭配「收合／展開」文字
   或 ▲／▼ 字元切換；`aria-expanded` 由 `<details>` 自帶，必要時以
   `aria-controls` 指向內容區 id。
5. **儲存結果訊息一律用 Toast 浮動訊息**：儲存成功／失敗的反饋統一使用
   `src/components/Toast.tsx` 元件，禁止使用全螢幕遮罩 modal 或 inline alert。
   - 引入方式：`import Toast, { type ToastMessage } from "@/components/Toast";`
   - State 定義：`const [toast, setToast] = useState<ToastMessage | null>(null);`
   - JSX 使用：`<Toast message={toast} onClose={() => setToast(null)} />`
   - 觸發方式：`setToast({ kind: "success", text: "已儲存" })` 或
     `setToast({ kind: "error", text: "儲存失敗" })`
   - Toast 元件會在 2 秒後自動消失，樣式使用 CSS 主題配色
     （`--success` 綠底、`--danger` 紅底白字）。
   - 儲存中的過場動畫（BlockingMask）保留不移除，僅移除儲存結果的過場動畫。
   - **不適用於 C 選用功能模組**（examRegistration 使用自己的 FlashModal）。

## 修改完成後的流程

1. `npm run lint`（eslint + tsc）確認通過
2. `npm run version:bump`（即 `node scripts/version.js`：依 commit 數 +1 寫入 `src/version.json`；
   `dev`/`build` **不**重算，版本號一律以已 commit 的檔案為準，各部署環境顯示才會一致）
3. commit（訊息結尾附「版本號更新至 0.xxx」）
4. `git push`
