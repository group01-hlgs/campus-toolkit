# 數位校園工具箱

整合校園資訊、身分入口與管理功能的校園工具平台。以角色（學生／家長／教職員／管理員）分流首頁，支援帳號密碼與 Google 登入、CSS 主題切換、管理後台與排行榜等。

歡迎感興趣的使用者 fork 自架。請先完成下方「環境變數」與「首次啟動」流程，缺金鑰無法運作。

## 架設流程總覽（給第一次自架的人）

把整件事想成「辦好帳號 → 把程式搬回家 → 填設定 → 開張 → 上線」，大約是這樣：

### 第 1 步：開設 3 種帳號（都免費）

| 帳號 | 用途（白話） |
|------|----------------|
| [GitHub](https://github.com/) | 存放程式碼；按 Fork 把本專案複製到你自己的帳號下 |
| [Firebase](https://console.firebase.google.com/) | 當「資料庫＋Google 登入」的後台；所有帳號、設定都存在這裡 |
| [Vercel](https://vercel.com/) | 當「網站主機」；把 GitHub 上的程式自動架成網站（只在本機跑的話可以先跳過） |

### 第 2 步：把程式搬到自己名下

1. 開啟本專案頁面，按 **Fork**，選自己的 GitHub 帳號。
2. 在電腦上把 fork 出來的 repo clone 下來，執行 `npm install`。

### 第 3 步：去 Firebase 開一間「虛擬機房」

1. Firebase Console → **新增專案**（名字隨意）。
2. 啟用 **Google 登入**（Authentication → Sign-in method → Google）。
3. 新增 **Web 應用程式**，複製一串設定（API Key 等 6 個 `NEXT_PUBLIC_*`）。
4. 下載**服務帳號私鑰**（專案設定 → 服務帳號 → 產生新的私鑰）。
5. 把 Firestore 安全規則設成本 repo 的 `firestore.rules`（預設不給瀏覽器直接讀寫，比較安全）。

### 第 4 步：填環境變數（把第 3 步拿到的東西貼進去）

```bash
cp .env.example .env.local
```

編輯 `.env.local`，至少填好：

- Firebase 的 6 個 `NEXT_PUBLIC_*`（第 3 步）
- `SESSION_SECRET`（亂數字串，可用 `openssl rand -base64 32`）
- `FIREBASE_SERVICE_ACCOUNT_KEY`（第 3 步下載的私鑰，整段 JSON 貼上）
- `ALLOW_BOOTSTRAP_ADMIN=true`（**只**為了建立第一個管理員，之後要改回 false）

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

1. 回 GitHub，到 Vercel **Import** 你 fork 的 repo。
2. 把 `.env.local` 裡的變數全部抄到 Vercel 的 Environment Variables。
3. Deploy，拿到網址就能開玩。  
   （若 Google 登入被擋，去 Firebase → Authentication → 設定 → **授權的網域** 加上你的網址。）

### 一張圖看完

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

- Node.js 20+（建議 LTS）
- npm
- 一組自己的 [Firebase](https://console.firebase.google.com/) 專案
- （上線）Vercel 帳號

## 快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 建立環境變數
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

## Firebase 專案設定

1. **建立專案**：Firebase Console 新增專案（Analytics 可關）。
2. **啟用 Google 登入**：Authentication → Sign-in method → 啟用 **Google**，並**關閉** Email/Password、匿名等其他登入方式（伺服端只接受 `sign_in_provider === "google.com"` 且 `email_verified` 的 token）。
3. **建立 Web 應用程式**：專案設定 → 一般 → 新增 Web 應用，將設定貼入 `.env.local` 的 `NEXT_PUBLIC_*`。
4. **服務帳號金鑰**：專案設定 → 服務帳號 → 產生新的私鑰（下載 JSON），整段貼入 `FIREBASE_SERVICE_ACCOUNT_KEY`（或先 base64 編碼再貼）。
5. **部署 Firestore 規則**：本 repo 的 [`firestore.rules`](firestore.rules) 預設**拒絕所有客戶端讀寫**（資料只走伺服端 Admin SDK），請部署：

   ```bash
   firebase deploy --only firestore:rules
   ```

   或在 Firebase Console → Firestore → 規則 貼上相同內容後發布。

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
| `npm run lint` | Lint |

## 專案結構

```
campus-toolkit/
├── public/                 # 靜態資源（含 ads.txt）
├── scripts/
│   └── version.js          # 依 git commit 數更新 version.json
├── src/
│   ├── app/                # App Router 頁面與 API
│   │   ├── api/            # REST API（auth、admin、seed、排行榜…）
│   │   ├── admin/          # 管理後台
│   │   ├── student|parent|staff/  # 各角色首頁與帳號頁
│   │   └── setup/          # 首次建立管理員
│   ├── components/         # UI 元件
│   ├── contexts/           # React Context（主題等）
│   ├── lib/                # Firebase、session、驗證、rate limit…
│   ├── styles/             # 全域樣式與主題 CSS 變數
│   ├── types/              # TypeScript 型別
│   └── proxy.ts            # 路由保護（角色頁 Session 檢查）
├── docs/                   # 規劃與規格文件
├── firestore.rules         # Firestore 安全規則（預設全拒絕）
├── next.config.ts          # CSP／安全標頭等
└── .env.example            # 環境變數範本
```

## 部署（Vercel）

1. Import Git Repo 至 Vercel。
2. 在專案 **Environment Variables** 加入與 `.env.local` 相同的變數（機密變數勿用 `NEXT_PUBLIC_`）。
3. Deploy。Framework 預設 Next.js 即可。
4. 上線後網域會自動出現在 Firebase Authentication → 設定 → **授權的網域**；若用自訂網域登入失敗，請在此補上。

## 安全注意事項

- **`.env`、`.env.local`、服務帳號 JSON 一律已被 `.gitignore` 排除，請勿強制加入版本庫。**
- 機密只放本機環境變數與 Vercel 環境變數。
- `FIREBASE_SERVICE_ACCOUNT_KEY`、`SESSION_SECRET` 洩漏時請立刻於 Firebase 重產生私鑰並更換 session secret（所有 session 會失效）。
- Firestore 規則維持伺服端全權管理；勿對客戶端開放讀寫，除非你清楚資料面風險。
- 管理員首任建立後務必關閉 `ALLOW_BOOTSTRAP_ADMIN`。

## 文件

- [`docs/PLANNING.md`](docs/PLANNING.md) — 主題與資安規劃
- [`docs/`](docs/) — 網站規劃、主程式／模組架構與資安規格書

## 授權

[MIT](LICENSE)
