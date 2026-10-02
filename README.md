# 數位校園工具箱

整合校園資訊、身分入口與管理功能的校園工具平台。以角色（學生／家長／教職員／管理員）分流首頁，支援帳號密碼與 Google 登入、CSS 主題切換、管理後台與排行榜等，並具備：

- **兩步驟驗證**（TOTP 通行碼 + Email 驗證碼）
- **忘記密碼信件**（SMTP 寄送重設連結）
- **身分名冊／使用者帳號批次作業**（Excel 匯入、匯出與範本下載）
- **操作紀錄**（管理後台可查核帳號與設定異動）
- **贊助廣告開關**（管理後台可一鍵關閉，預設關閉）

歡迎感興趣的使用者 fork 自架。**不想打指令就按下方「一鍵部署」**；想自己動手，請先完成「環境變數」與「首次啟動」流程，缺金鑰無法運作。

## 一鍵部署（給不想碰終端機的人）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftakan003%2Fcampus-toolkit&env=NEXT_PUBLIC_FIREBASE_API_KEY,NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,NEXT_PUBLIC_FIREBASE_PROJECT_ID,NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,NEXT_PUBLIC_FIREBASE_APP_ID,SESSION_SECRET,FIREBASE_SERVICE_ACCOUNT_KEY,ALLOW_BOOTSTRAP_ADMIN&envDefaults=%7B%22ALLOW_BOOTSTRAP_ADMIN%22%3A%22true%22%7D&envDescription=%E5%A1%AB%E5%85%A5%E4%BD%A0%E8%87%AA%E5%B7%B1%E7%9A%84%20Firebase%20Web%20%E8%A8%AD%E5%AE%9A%E8%88%87%E9%87%91%E9%91%B0%EF%BC%9BALLOW_BOOTSTRAP_ADMIN%20%E4%BF%9D%E6%8C%81%20true%20%E4%BB%A5%E4%BE%BF%E7%A8%8D%E5%BE%8C%E5%BB%BA%E7%AB%8B%E9%A6%96%E4%BD%8D%E7%AE%A1%E7%90%86%E5%93%A1%EF%BC%8C%E5%BB%BA%E5%AE%8C%E8%AB%8B%E5%9B%9E%20Vercel%20%E6%94%B9%E7%82%BA%20false%E3%80%82%E6%AC%84%E4%BD%8D%E8%AA%AA%E6%98%8E%E8%88%87%E5%8F%96%E5%BE%97%E6%96%B9%E5%BC%8F%E8%A6%8B%20README%E3%80%8C%E7%92%B0%E5%A2%83%E8%AE%8A%E6%95%B8%E3%80%8D%E4%B8%80%E7%AF%80%E3%80%82&envLink=https%3A%2F%2Fgithub.com%2Ftakan003%2Fcampus-toolkit%2Fblob%2Fmain%2FREADME.md%23%E7%92%B0%E5%A2%83%E8%AE%8A%E6%95%B8&project-name=campus-toolkit&repository-name=campus-toolkit)

按下去之後，Vercel 會**自動把程式碼複製到你的 GitHub 帳號**、開好專案，並出現一張表單要你貼 9 個環境變數（欄位說明與取得方式就在表單旁，連到本 README）。填完按 Deploy 就上線了。

**這條路砍掉了**：Fork、clone、`npm install`、`cp .env.example`、編輯 `.env.local`、`npm run dev`、Vercel Import、手動抄環境變數到 Vercel —— 終端機一行指令都不用打。

### 按按鈕之前：先備妥 Firebase（沒辦法省）

按鈕只負責「搬程式＋上線」，**Firebase 那間機房還是得自己開**，因為表單要填的值都出自那裡。照下方「架設流程總覽」的**第 1 步**與**第 3 步**做完（約 10 分鐘），手上有這 9 個值就能按：

- 6 個 `NEXT_PUBLIC_*`（Firebase Web 應用程式設定）
- `SESSION_SECRET`（一行 `openssl rand -base64 32` 產生）
- `FIREBASE_SERVICE_ACCOUNT_KEY`（服務帳號私鑰，整段 JSON）
- `ALLOW_BOOTSTRAP_ADMIN`（已預填 `true`，不用動）

### 按按鈕之後：還有 4 件事

1. **建首位管理員**：開你的網址 `/setup`（線上直接建，不需要本機）。建完登入。
2. **立刻關掉建管開關**：Vercel 專案 → Settings → Environment Variables → 把 `ALLOW_BOOTSTRAP_ADMIN` 改為 `false` → Redeploy。**這步不要拖**，否則任何人開你的網址 `/setup` 都能搶建管理員。
3. **Firebase 授權網域**：Firebase Console → Authentication → 設定 → 授權的網域，加上你的 Vercel 網址，否則 Google 登入會被擋。
4. **Firestore 規則**：把本 repo 的 `firestore.rules` 貼進 Firebase Console → Firestore → 規則 後發布（見「Firebase 專案設定」第 5 點）。

其餘（SMTP 寄信、`APP_BASE_URL`、`TRUST_PROXY`）都是選填，之後隨時到 Vercel 的 Environment Variables 補即可。

> 想在本機跑、想改程式碼、或想先測過再上線？往下看完整的手動流程。

## 架設流程總覽（手動路徑，給第一次自架的人）

把整件事想成「辦好帳號 → 把程式搬回家 → 填設定 → 開張 → 上線」，大約是這樣：

### 第 1 步：開設 3 種帳號（都免費）

| 帳號 | 用途（白話） |
|------|----------------|
| [GitHub](https://github.com/) | 存放程式碼；按 Fork 把本專案複製到你自己的帳號下 |
| [Firebase](https://console.firebase.google.com/) | 當「資料庫＋Google 登入」的後台；所有帳號、設定都存在這裡 |
| [Vercel](https://vercel.com/) | 當「網站主機」；把 GitHub 上的程式自動架成網站（只在本機跑的話可以先跳過） |

走「一鍵部署」也一樣要開這 3 個帳號 —— 差別只在第 2、4、7 步由 Vercel 代勞。

### 第 2 步：把程式搬到自己名下

> 走上方「一鍵部署」的話，**這步整個跳過**（Vercel 會自動把程式複製到你帳號）。

1. 開啟本專案頁面，按 **Fork**，選自己的 GitHub 帳號。
2. 在電腦上把 fork 出來的 repo clone 下來，執行 `npm install`。
   （macOS／Linux 用 `cp .env.example .env.local`；Windows 命令提示字元請用 `copy .env.example .env.local`。）

### 第 3 步：去 Firebase 開一間「虛擬機房」

1. Firebase Console → **新增專案**（名字隨意）。
2. 啟用 **Google 登入**（Authentication → Sign-in method → Google）。
3. 新增 **Web 應用程式**，複製一串設定（API Key 等 6 個 `NEXT_PUBLIC_*`）。
4. 下載**服務帳號私鑰**（專案設定 → 服務帳號 → 產生新的私鑰）。
5. 把 Firestore 安全規則設成本 repo 的 `firestore.rules`（預設不給瀏覽器直接讀寫，比較安全）。
   ⚠️ 本 repo 的 `.firebaserc` 還綁著原作者的專案 ID，執行 `firebase deploy` 前請先改成你的專案，或直接在 Console 貼上規則（見下方「Firebase 專案設定」第 5 點）。

### 第 4 步：填環境變數（把第 3 步拿到的東西貼進去）

```bash
cp .env.example .env.local
```

編輯 `.env.local`，至少填好：

- Firebase 的 6 個 `NEXT_PUBLIC_*`（第 3 步）
- `SESSION_SECRET`（亂數字串，可用 `openssl rand -base64 32`）
- `FIREBASE_SERVICE_ACCOUNT_KEY`（第 3 步下載的私鑰，整段 JSON 貼上）
- `ALLOW_BOOTSTRAP_ADMIN=true`（**只**為了建立第一個管理員，之後要改回 false）
- `SMTP_*` + `APP_BASE_URL`（**建議**：不填的話「忘記密碼」與 Email 驗證碼信件無法寄出，其他功能不受影響）

欄位細節見下方「環境變數」。

### 第 5 步：本機跑起來、開出第一個管理員

```bash
npm run dev
```

瀏覽器開 `http://localhost:3000/setup` → 填資料建立**管理員** → 回首頁用這組帳號登入。  
成功後把 `ALLOW_BOOTSTRAP_ADMIN` 改回 `false` 並重啟，避免日後有人免驗證建管。

### 第 6 步（可選）：補一點測試資料

專案根目錄執行 `node scripts/reset-users-roster.mjs`，會備份並重建使用者帳號（`users`）與四份身分名冊（`rosterStudents` / `rosterParents` / `rosterStaff` / `rosterAdmins`），種入一組測試帳號與範本資料。

### 第 7 步：上線到 Vercel

> 不想手動 Import 的話，回到上方「一鍵部署」按鈕即可，Vercel 會接手這一步（含環境變數表單）。

1. 回 GitHub，到 Vercel **Import** 你 fork 的 repo。
2. 把 `.env.local` 裡的變數全部抄到 Vercel 的 Environment Variables。
3. Deploy，拿到網址就能開玩。  
   （若 Google 登入被擋，去 Firebase → Authentication → 設定 → **授權的網域** 加上你的網址。）

### 一張圖看完

手動路徑：

```text
開 3 個帳號 ── Fork 到 GitHub ── clone + npm install
       │                                │
       ▼                                ▼
  Firebase 建專案                 填 .env.local
  （Google 登入、私鑰、            （設定 + session 金鑰）
   Firestore 規則）                       │
       │                                ▼
       └──────────────► npm run dev → /setup 建管理員
                                         │
                                         ▼
                              （可選）種子測試帳號
                                         │
                                         ▼
                              Vercel Import → 填環境變數 → 上線
```

一鍵部署路徑（第 2、4、5、7 步合而為一）：

```text
開 3 個帳號 ── Firebase 建專案（第 1、3 步）
                    │
                    ▼
            按 Deploy to Vercel → 貼 9 個環境變數 → Deploy
                    │
                    ▼
            網址 /setup 建管理員 → 關 ALLOW_BOOTSTRAP_ADMIN
                    │
                    ▼
            Firebase 授權網域 + Firestore 規則 → 完成
```

以下為較細的技術說明與指令。

## 技術架構

| 項目 | 技術 |
|------|------|
| 前端框架 | Next.js 16+（App Router） |
| 語言 | TypeScript |
| 樣式 | Tailwind CSS 4 |
| 認證 | Firebase Authentication（Google）＋ 自建帳號密碼（bcrypt） |
| 資料庫 | Cloud Firestore（一律由伺服端 Admin SDK 存取） |
| Session | JWT（`jose`，HS256）＋ HttpOnly Cookie |
| 部署 | Vercel（本機亦可 `next start`） |

## 需求

- Node.js 20.9+（建議 LTS；Next.js 16 的最低要求）
- npm
- 一組自己的 [Firebase](https://console.firebase.google.com/) 專案
- （上線）Vercel 帳號

## 快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 建立環境變數（Windows 命令提示字元改用 copy .env.example .env.local）
cp .env.example .env.local
# 編輯 .env.local，欄位說明見下一節

# 3. 啟動開發伺服器
npm run dev
```

瀏覽器開啟 `http://localhost:3000`。金鑰齊全前，登入與後台 API 會失敗，屬預期行為。

## 環境變數

完整欄位請對照 [`.env.example`](.env.example)。複製到 `.env.local`（或 `.env`）後填入：

### Firebase 前端設定（公開設定，會出現在瀏覽器）

於 Firebase Console → 專案設定 → 你的 Web 應用程式取得：

| 變數 | 說明 |
|------|------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Web API Key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | 例如 `your-project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | 專案 ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | 例如 `your-project.appspot.com` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Web App ID |

### 伺服端機密（切勿提交到 Git、切勿加上 `NEXT_PUBLIC_` 前綴）

| 變數 | 必填 | 說明 |
|------|------|------|
| `SESSION_SECRET` | 是 | 簽 session JWT 用，**至少 32 字元**。可用 `openssl rand -base64 32` 產生 |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | 是 | Firebase 服務帳號金鑰。Console → 專案設定 → 服務帳號 → 產生新的私鑰；可貼**整段 JSON 字串**或其 **base64** |
| `ALLOW_BOOTSTRAP_ADMIN` | 首次啟動 | 僅在建立「第一個管理員」時設為 `true`，建完請改回 `false` |

### 寄信 SMTP（忘記密碼、Email 驗證碼用）

不填也能登入與使用主要功能，但**「忘記密碼」會直接回 503**、Email 驗證碼信寄不出去。設定步驟（以學校 Google Workspace 專用信箱為例）見 [`.env.example`](.env.example) 內的詳細註解。

| 變數 | 必填 | 說明 |
|------|------|------|
| `SMTP_HOST` | 建議 | SMTP 位址，Gmail 為 `smtp.gmail.com` |
| `SMTP_PORT` | 否 | 預設 `465`（`SMTP_SECURE=true` 時）或 `587` |
| `SMTP_USER` | 建議 | 寄信帳號 |
| `SMTP_PASS` | 建議 | 應用程式密碼（**不可**用一般登入密碼，Google 已停用基本驗證） |
| `SMTP_FROM` | 否 | 寄件者顯示名稱與地址，例：`數位校園工具箱 <noreply@school.edu.tw>` |

### 其他

| 變數 | 必填 | 說明 |
|------|------|------|
| `APP_BASE_URL` | 正式環境建議 | 站台對外網址，用於信件中的重設連結。未設定時改用請求來源，Host 遭偽造可能使連結指向攻擊者網域 |
| `TRUST_PROXY` | 否 | 僅在可信反向代理／平台（如 Vercel，自動 `VERCEL=1`）覆寫 forwarding header 時設 `true`；直接 `next start` 暴露請維持不設 |

## Firebase 專案設定

1. **建立專案**：Firebase Console 新增專案（Analytics 可關）。
2. **啟用 Google 登入**：Authentication → Sign-in method → 啟用 **Google**，並**關閉** Email/Password、匿名等其他登入方式（伺服端只接受 `sign_in_provider === "google.com"` 且 `email_verified` 的 token）。
3. **建立 Web 應用程式**：專案設定 → 一般 → 新增 Web 應用，將設定貼入 `.env.local` 的 `NEXT_PUBLIC_*`。
4. **服務帳號金鑰**：專案設定 → 服務帳號 → 產生新的私鑰（下載 JSON），整段貼入 `FIREBASE_SERVICE_ACCOUNT_KEY`（或先 base64 編碼再貼）。
5. **部署 Firestore 規則**：本 repo 的 [`firestore.rules`](firestore.rules) 預設**拒絕所有客戶端讀寫**（資料只走伺服端 Admin SDK），請部署：

   ```bash
   firebase deploy --only firestore:rules
   ```

   ⚠️ 執行前請先確認 `.firebaserc` 的 `default` 已改成**你自己的** Firebase 專案 ID（fork 後仍是原作者的 `campus-toolkit-e77e4`，不改會因無權限而失敗）。也可以不裝 Firebase CLI，直接在 Console → Firestore → 規則 貼上相同內容後發布。

## 首次啟動（建立管理員）

1. 確認 `.env.local` 已設 `ALLOW_BOOTSTRAP_ADMIN=true`，且 `SESSION_SECRET`、`FIREBASE_SERVICE_ACCOUNT_KEY` 已填。
2. 啟動 `npm run dev`，開啟 **`/setup`**，建立第一個管理員帳號（密碼至少 8 碼）。
3. 成功後登入首頁，再把 `ALLOW_BOOTSTRAP_ADMIN` 改為 `false`（或移除）並重啟，避免資料庫被清空後可免驗證建管。

### （選用）種子角色資料

專案根目錄執行：

```bash
node scripts/reset-users-roster.mjs
```

會先將 `users`、`rosterStudents`、`rosterParents`、`rosterStaff`、`rosterAdmins` 匯出到 `backups/` 備份，再清空重建並種入測試帳號與範本資料（當期名冊）。此指令**直接連線 Firestore**（需 `FIREBASE_SERVICE_ACCOUNT_KEY`），不會經過 HTTP，因此不提供 API 端點。

## 常用指令

| 指令 | 說明 |
|------|------|
| `npm run dev` | 開發伺服器（會先更新 `src/version.json`） |
| `npm run build` | 生產建置 |
| `npm start` | 執行生產建置 |
| `npm run lint` | ESLint 檢查 + TypeScript 型別檢查（`tsc --noEmit`） |
| `npm run typecheck` | 只跑 TypeScript 型別檢查 |

## 專案結構

```
campus-toolkit/
├── public/                 # 靜態資源（含 ads.txt）
├── scripts/
│   └── version.js          # 依 git commit 數更新 version.json
├── src/
│   ├── app/                # App Router 頁面與 API
│   │   ├── api/            # REST API（auth、admin、account、settings、排行榜…）
│   │   ├── admin/          # 管理後台
│   │   ├── student|parent|staff/  # 各角色首頁與帳號頁
│   │   └── setup/          # 首次建立管理員
│   ├── components/         # UI 元件
│   ├── contexts/           # React Context（主題等）
│   ├── lib/                # Firebase、session、驗證、rate limit…
│   ├── styles/             # 全域樣式與主題 CSS 變數
│   ├── types/              # TypeScript 型別
│   └── proxy.ts            # 路由保護（角色頁 Session 檢查）
├── docs/                   # 資料模型與身分名冊／帳號批次範例檔（xlsx）
├── firestore.rules         # Firestore 安全規則（預設全拒絕）
├── next.config.ts          # CSP／安全標頭等
└── .env.example            # 環境變數範本
```

## 部署（Vercel）

兩條路都可以：上方「一鍵部署」按鈕（Vercel 代勞前三項），或手動：

1. Import Git Repo 至 Vercel。
2. 在專案 **Environment Variables** 加入與 `.env.local` 相同的變數（機密變數勿用 `NEXT_PUBLIC_`）。
3. Deploy。Framework 預設 Next.js 即可。
4. **授權網域不會自動加入**：若 Google 登入被擋，請到 Firebase Authentication → 設定 → **授權的網域** 手動加上你的網址（Vercel 的 `*.vercel.app` 與自訂網域都要補）。
5. 若是用按鈕部署：建完首位管理員後，把 `ALLOW_BOOTSTRAP_ADMIN` 改回 `false` 並 Redeploy。

## 安全注意事項

- **`.env`、`.env.local`、服務帳號 JSON 一律已被 `.gitignore` 排除，請勿強制加入版本庫。**
- 機密只放本機環境變數與 Vercel 環境變數。
- `FIREBASE_SERVICE_ACCOUNT_KEY`、`SESSION_SECRET` 洩漏時請立刻於 Firebase 重產生私鑰並更換 session secret（所有 session 會失效）。
- Firestore 規則維持伺服端全權管理；勿對客戶端開放讀寫，除非你清楚資料面風險。
- 管理員首任建立後務必關閉 `ALLOW_BOOTSTRAP_ADMIN`。

## 關於廣告（AdSense）

全站廣告區預設**關閉**。要開啟或關閉：管理後台 → **系統設定 → 外觀與顯示 → 贊助廣告**（僅超級管理員可改），改完立即生效，不需重新部署。

- **想完全不放廣告**：維持預設「隱藏」即可，AdSense script 根本不會載入。
- **想放自己的廣告**：程式碼中的廣告帳號硬編在 [`src/components/AdSense.tsx`](src/components/AdSense.tsx)（`ca-pub-...` 與版位 `slot`），`public/ads.txt` 也指向同一帳號。請把這兩處改成你自己的 AdSense 帳號與版位，再把開關打開；若未更換就開啟，刊登的是**原作者**的廣告帳號。

## 貢獻與開發流程

歡迎送 Pull Request。本專案的 commit 規範如下（詳見 [`AGENTS.md`](AGENTS.md)）：

1. `npm run lint`（ESLint + tsc）確認通過。
2. `node scripts/version.js` — 依 commit 數將版本號 +1，寫入 `src/version.json`。
3. commit，訊息結尾附上版本號，例：`…（版本號更新至 0.232）`。
4. `git push`。

## 文件

- [`docs/資料模型.md`](docs/資料模型.md) — 資料模型
- [`docs/`](docs/) — 身分名冊／使用者帳號批次範例檔（xlsx）與版面截圖

## 授權

[MIT](LICENSE)
