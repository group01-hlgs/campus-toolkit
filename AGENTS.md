<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 資料庫讀取規範（必讀）

新增或修改任何 Firestore 讀取的程式碼前，先讀 `docs/資料庫讀取規範.md`
（六條鐵律：先問要不要讀、過濾下推、精準查詢、禁 N+1 與分塊、同請求復用、
快取＋寫後失效）。改完依該文末檢查清單逐項核對，再走下方流程。

## 修改完成後的流程

1. `npm run lint`（eslint + tsc）確認通過
2. `npm run version:bump`（即 `node scripts/version.js`：依 commit 數 +1 寫入 `src/version.json`；
   `dev`/`build` **不**重算，版本號一律以已 commit 的檔案為準，各部署環境顯示才會一致）
3. commit（訊息結尾附「版本號更新至 0.xxx」）
4. `git push`
