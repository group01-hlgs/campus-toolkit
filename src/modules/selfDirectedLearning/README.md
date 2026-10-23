# 自主學習計畫（selfDirectedLearning）

選用功能模組（外掛），掛載於 `campus-toolkit` 主程式。依 108 課綱：學校每週提供 1–3 節
彈性學習時間，學生自行訂定 1 學期 21 或 22 週以內的學習方案，可安排於彈性學習時間或
課餘時間完成，得邀請學校教師或相關領域人士擔任指導教師；於彈性學習時間實施時，
地點須在學校規範內。

1. 開發者：[takan003](https://github.com/takan003)（`https://github.com/takan003/selfDirectedLearning`）
2. 版本：0.0.2（`contractVersion` 1、`minHostVersion` 0.580）
3. 四身分入口：管理員（設定與總覽）、學生（填報送審）、教職員（審核／兼導師瀏覽全班）、家長（檢視）

## 功能摘要

1. **管理端**（`/admin/self-directed-learning`）：「管理規則」頁設定功能總開關（關閉即全站
   維護中）、開放撰寫起訖、週數填寫形式（全學期全填／彈性下限）、全學期週數與下限週數、
   校內彈性學習節次行程、開放場域、審核人員名單、給學生的說明。
2. **學生端**（`/student/self-directed-learning`）：選主題與學群、填指導老師（非必填）、依
   週數形式完成逐週課程安排（全學期形式須填滿全學期週數；彈性形式至少填到學校下限週數，
   場地＋彈性學習時間／課餘）、開放期間內送出審核、查看審查意見。
   草稿可分次儲存（未填完不擋），送出審核時才要求週數形式與每一週的學習安排／場地皆填妥。
3. **教職員端**（`/staff/self-directed-learning`）：受指定審核人員通過／退回（退回必填意見）；
   兼導師者瀏覽全班計畫。
4. **家長端**（`/parent/self-directed-learning`）：唯讀檢視綁定子女的計畫與審查狀態。
5. **總開關維護模式**：管理端關閉總開關後，學生／教職員／家長頁面一律只顯示
   「目前此功能關閉維護中」，寫入 API 回 403；管理端不受影響，可隨時改回開啟。
6. 狀態機：草稿 → 審核中 → 已通過（鎖定）／退回修改（可改再送）。

## 資料集合清單（`dataCollections`，宣告即承諾）

1. `selfDirectedLearningSettings`（doc `global`）：模組設定單文件——`enabled`（功能總開關）、
   `openAt`／`closeAt`（開放起訖 epoch ms）、`maxWeeks`（全學期週數）、`weekMode`
   （`full` 全學期全填／`flexible` 彈性下限）、`minWeeks`（彈性下限週數）、`slots`
   （節次行程）、`venues`（開放場域）、`reviewers`（審核人員 uid＋名稱）、`instructions`、
   `updatedAt`。
2. `selfDirectedLearningPlans`：學生計畫（doc id＝`{學年學期}_{uid}`）——主題、學群、指導
   老師、逐週安排（`weeks[]`：週次／內容／場地／時段）、身分欄（班級等）、`status`、
   `submittedAt`、`updatedAt`。
3. `selfDirectedLearningReviews`：審查意見（計畫 id、審核者、`decision`、`note`、`reviewedAt`；
   保留多輪歷程）。

## 掛勾需求（`hooks`）

1. `announcements`（公告）：管理端**儲存設定**時以 `publishFromModule`／`updateFromModule`
   同步一則「自主學習計畫開放撰寫」公告（固定 `sourceRef: "open-window"`，重複儲存只更新不
   重複發文；清空開放時間即 `archived` 撤回）。
2. `calendar`（行事曆）：同步一筆行程（`publishScheduleFromModule` 同 `sourceRef` 覆寫更新；
   清空開放時間即 `cancelled`）。
3. 兩者皆失敗**不阻擋**設定儲存——API 回 `hookWarning`，頁面以 Toast 提示。

## 安裝後設定方式

1. 安裝模組後至「功能模組管理」（`/admin/modules`）**啟用**本模組（預設未啟用，fail-safe 朝關）。
2. 為管理端指派本模組權限單位（`selfDirectedLearning`，權限類別「校務資料」）。
3. 開啟「管理規則」（`/admin/self-directed-learning`）：設定功能總開關、開放起訖、週數填寫
   形式與全學期／下限週數、節次行程、場域、審核人員與說明並儲存（儲存即同步公告與行事曆）。
4. 學生端需在開放期間內填報；教職員審核資格來自第 3 步的審核人員名單（管理員恆可審）。
   總開關關閉期間，非管理端一律只見「目前此功能關閉維護中」，資料不受影響。

## 開發環境

1. 本機路徑：`D:\workspace\CT\selfDirectedLearning`（宿主 `campus-toolkit` 同區並列）。
2. 掛載（宿主目錄執行，掛載前先停 dev server）：

   ```bash
   npm run module:link -- D:\workspace\CT\selfDirectedLearning --copy --watch
   ```

3. 驗 `module.lock.json` 的 `"source"` 為 `link-copy:`；驗收基準＝API 未登入回 401 而非 Build Error。

## 撰寫規範

撰寫前說明書見宿主 `docs/選用功能模組開發者指南.md`；契約規格見
`docs/主程式模組與功能模組.md`；需求與決策過程見 `docs/開發規劃書.md`。
