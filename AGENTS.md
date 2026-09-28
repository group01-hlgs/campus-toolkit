<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 修改完成後的流程

1. `npm run lint`（eslint + tsc）確認通過
2. `node scripts/version.js`（依 commit 數計算，版本號 +1，寫入 `src/version.json`）
3. commit（訊息結尾附「版本號更新至 0.xxx」）
4. `git push`
