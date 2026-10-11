# 升學考試與模擬考校內報名模組（examRegistration）

> 狀態：M1 完成（期 7 驗收通過）；M2 ①名額②CSV③統計④審核已實作，⑤公告撤回卡宿主 P5；M3（報名義務/不報名/繳費/封存）已實作
> 宿主要求：`campus-toolkit` ≥ 0.391（P4 啟用閘需 0.390+）

## 定位

校內升學考試與模擬考的**選考科目登錄**：承辦教職員建立報名場次與科目清單、指定對象（年級＋班級），
學生在開放期間勾選要考的科目（可改、可取消，截止後唯讀）；承辦查看每科人數與名單。
兩種報名方式：**先到先得**（每科可設名額上限，額滿即止）與**審核錄取**（學生送志願序、承辦逐人錄取）。
費用欄位僅作資訊顯示；公告撤回／更新待宿主 P5。

## MVP（M1）範圍

| 頁面/API | 路徑 | 誰可用 |
|---|---|---|
| 學生頁 | `/student/exam-registration` | 學生 |
| 管理頁 | `/admin/exam-registration` | 具 `examRegistration` 權限單位者 |
| API | `/api/exam-registration` | 學生（GET 場次＋我的登錄、POST 登錄/志願序、DELETE 取消） |
| API | `/api/admin/exam-registration` | 管理員（POST 建立、PATCH 編輯/狀態/審核、GET 名單 `?eventId=`、GET CSV `?eventId=&format=csv`） |

**場次狀態機**：`draft → open → closed → archived`（唯一狀態機；登錄文件有＝已登錄，取消＝刪除）

**四個已拍板決策**：
1. 登錄＝勾選科目（非場次名額審核）
2. 對象指定到**年級＋班級**（伺服端強制過濾）
3. 家長不開放（`provides.parent = false`）
4. 費用僅作資訊顯示

## Firestore 資料模型

`examEvents`（場次，科目內嵌）：
- `title` / `examType`（mock|entrance|other）/ `examDate`（**YYYY-MM-DD 字串**，日期僅日、不涉時區）/ `location` / `note`
- `deadline`：timestamp（之後唯讀；`open` 且過期一律收斂為 `closed`，承辦忘記關也不會誤放行）
- `subjects`：`[{ key, label, capacity? }]` 內嵌陣列（1～15 項；`key` 在改名／排序時保留，登錄鍵才不失效）；`capacity` 省略或 0＝不限，上限 999（M2 ①）
- `target`：`{ grades: string[], classes: string[] }`（年級必填、班級選填——兩者都要）
- `fee`：number
- `examMode`：`first-come|review`（M2 ④；缺省 `first-come`，M1 資料向後相容）
- `status`：`draft|open|closed|archived`（`draft→open⇄closed→archived`，`archived` 不可逆；一般情況以歸檔代替刪除，**無登錄的場次可硬刪除**）
- `createdBy` / `createdAt` / `updatedAt`

`examRegistrations`（選考登錄，一人一場次一份）：
- **文件 id ＝ `eventId__studentUid`（決定論）**——唯一性由文件 id 直接保證，不需額外查重
- `eventId` / `studentUid` / `studentName` / `studentClass` / `studentGrade` / `studentId` / `seatNo`（寫入時去正規化；學號座號供 CSV 造冊）
- `subjectKeys`：`string[]`（`review` 模式有序＝志願序；科目被刪除時，舊鍵自動失效）
- `reviewStatus`：`pending|admitted|waitlist|rejected`（缺省 pending；僅 `review` 場次有意義）
- `createdAt` / `updatedAt`

**索引**：`examEvents: status(in)+examDate`、`examEvents: examDate DESC`（管理清單）；
`examRegistrations: eventId+studentUid`（決定論 id）、`studentUid`（我的登錄）——等值查詢不需複合索引。
**未來**若加 `where(status==)+orderBy(examDate)` 類組合查詢，記得在 manifest 補 `firestoreIndexes` 宣告（驗收觀察項）。

**快取與失效**：學生場次清單 `cachedRead` 30 秒（前綴 `exam-registration:`，寫後 `invalidateReadCache`
前綴清除、不 bump epoch）；管理清單與名單 `cachedListRead`（寫後 `invalidateAdminListCache` bump `cacheEpoch`）。
同一次寫入兩者都失效——名單即時反映登錄、場次變更 30 秒內全站可見。

**伺服端把關**：對象過濾（年級/班級）→ 截止鎖（deadline/status）→ 決定論 id upsert/刪除 →
寫後快取失效 → 全部寫操作 `logActivity` 稽核。掛勾（發公告／寫行事曆）在場次 `open` 時觸發，
失敗僅記 log、不影響儲存。

## 權限與掛勾

- 權限單位：`mode:"new"`、`category:"校務資料"`；管理頁/API 走 `requireAdminModule("examRegistration")`
- 限流：`EXAM_REGISTRATION_LIST`（120/分鐘）、`EXAM_REGISTRATION_MUTATE`（20/分鐘）、`EXAM_REGISTRATION_ADMIN`（60/分鐘）
- 稽核：`exam_registration_event_created`／`event_updated`／`recorded`／`withdrawn`／`reviewed`（M2 ④）
- **回寫主程式（掛勾）**：`hooks: ["announcements", "calendar"]`——場次開放時經
  `publishFromModule()` 發系統公告、經 `publishScheduleFromModule()` 把考試日寫進行事曆（upsert）。
  **禁止**直接寫 announcements／collections 平行集合；公告的跨模組撤回介面尚未提供（主程式 P5 候選），
  M1 先只發佈、不撤回。

## M2 實作狀態

### ① 每科名額上限（先到先得）— 已實作

- `subjects` 項目 `{ key, label, capacity? }`——`capacity` 省略或 0＝不限（M1 資料向後相容），上限 999。
- 登錄時 transaction 讀該場次全部登錄（排除本人），統計各科現有人數；任一勾選科目額滿即整筆拒絕
  （409「『XX科』已額滿（名額 n 名）」）。取消即釋放名額（無候補佇列）。
- UI：學生頁科目旁顯示「n/m」（額滿「n/m 額滿」並 disable，本人已選者保留可取消）；
  承辦名單面板各科長條圖（純 CSS 寬度百分比，額滿紅字）。

### ② 造冊 CSV 匯出 — 已實作

- 管理 API `GET /api/admin/exam-registration?eventId=&format=csv`；管理頁名單面板「匯出 CSV」連結。
- 欄位：班級、學號、座號、姓名、選考科目名稱、登錄時間；依 `班級→座號→姓名` 排序。
- 檔頭含 BOM（Excel 直開中文不亂碼）；`Content-Disposition` 用 RFC 5987 UTF-8 檔名；限流沿用 `EXAM_REGISTRATION_ADMIN`。

### ③ 統計圖表 — 已實作

- 名單面板各科人數長條圖（純 CSS，【E10】不引圖表函式庫）；有設名額顯示 `n/m`（額滿紅字）、無名額顯示 `n 人`。
- 資料用名單 API 的 `summary.bySubject`（含 `capacity`/`full`），不加查詢。

### ④ 審核錄取（第二軌）— 已實作

- `examEvents.examMode: "first-come" | "review"`（缺省 `first-come`，M1 資料向後相容）；管理表單「報名方式」選單。
- `review` 模式：登錄＝志願序（`subjectKeys` 有序）；無名額即時鎖。
- 登錄文件 `reviewStatus: pending|admitted|waitlist|rejected`（缺省 pending）。
- 承辦名單每列審核下拉（PATCH `{ id, registrationId: studentUid, reviewStatus }`，稽核 `exam_registration_reviewed`）；
  學生頁志願序上下鍵排序＋顯示審核結果。
- **未做**（待拍板）：轉 `admitted` 發錄取公告（掛鉤只發佈不撤回，放榜場景需先有撤回介面）、備取上限／放榜時間欄位。

### ⑤ 公告撤回／更新 — 卡宿主 P5

- 等主程式 P5 `publishFromModule` 撤回/更新介面落地後串：
  場次改期→更新公告；`archived`→撤回公告；行事曆同理（`publishScheduleFromModule` 已 upsert，撤回待宿主）。
- 契約先記：目前 `syncExamEventHooks` 只發佈不回頭，M2 前不得繞過掛鉤直寫。

### 場次硬刪除（M2 後補，應需求新增；M3.5 微調連動名單）

- `DELETE /api/admin/exam-registration?id=`：硬刪除場次**連同該場次全部登錄名單一併刪除**（對齊 GAS `deletePipeAndSheet`——刪管道連同名單工作表；分批 400 筆）。
- 稽核 `exam_registration_event_deleted`（details 含連動刪除筆數）；UI 確認框提醒：曾開放的場次，公告與行事曆**不會**自動撤回（P5 前手動封存）。

### 場次清單省流與分頁（M3.5 微調）

- 省流閘門修正：`useDataSaver().ready` 判定前**不得**載入清單（省流模式下白打一發請求），與公告／帳號清單一致；關鍵字搜尋為「省流閘門外」——輸入即載入清單再本機過濾（同公告／行事曆）。
- 標準分頁：純前端切片（每頁 10/20/50/100，預設 20），第一頁／上一頁／頁次／下一頁／最後一頁；篩選條件變動回第一頁；不增加 Firestore 讀取。

## M3 實作狀態

### 報名義務（required／optional）— 已實作

- `examEvents.registrationMode: "required" | "optional"`（缺省 `optional`，舊資料相容）；管理表單「報名義務」選單。
- `required`：學生頁警示條「本場次為**必須報名**，不參加請勾選不報名並說明原因」。
- `optional`：勾不報名一律 400「自由報名場次不需勾選不報名——不登錄即可」。

### 不報名登錄（optOut）— 已實作

- 登錄文件 `optOut: boolean`（缺省 false）＋`optOutReason: string`（上限 200 字，必填）。
- `optOut=true` 為合法狀態：不算已報名、不佔名額、不計費用；名單「報名情形」欄顯示「不報名」。
- 額滿統計、`bySubject`、容量 transaction 一律排除 optOut。
- 稽核 `details` 含 `optOut`/`optOutReason`。

### 繳費身分與費用試算 — 已實作

- 場次 `basicFee: { standard, reduced }`（取代 M1 的 flat `fee`，舊資料回退 `{standard: fee, reduced: 0}`）。
- 科目 `feeStandard`/`feeReduced`（缺省 0）。
- 登錄文件 `feeCode: "1" | "2" | "3"`、`feeAmount: number`（試算快照，封存後不隨費率變動）。
- 費率規則：`1` 一般生＝基本費 standard＋科目 feeStandard；`2` 低收入戶＝免繳 0；`3` 中低收入戶＝基本費 reduced＋科目 feeReduced。
- 學生頁繳費身分 radio（顯示順序 1、3、2）＋動態應繳費用預覽。
- 名單/CSV 顯示繳費身分與應繳費用。

### 資料封存（archived）— 已實作

- 登錄文件 `archived: boolean`（缺省 false）＋`archivedAt: number`。
- 學生自我封存 `PATCH /api/exam-registration { eventId }`（冪等；稽核 `exam_registration_archived`）。
- 封存後 upsert／withdraw 一律 409「資料已封存，無法修改/取消——請聯繫承辦解除封存」；審核 PATCH 亦 409。
- 承辦解除 `PATCH /api/admin/exam-registration { id, registrationId, unarchive: true }`（稽核 `exam_registration_unarchived`）。
- 名單/CSV「資料封存」欄；名單統計列新增已封存數。

### 列印版面（另存 PDF）— 已實作

- 學生頁「下載為PDF」→ `RegistrationPrintSheet`（`hidden print:block`＋`print:hidden` 包螢幕 UI）＋`window.print()`，由瀏覽器另存 PDF——不引函式庫（【E10】）。
- 未封存時先 ConfirmModal 提醒「封存後較不易誤改」。

### 稽核動作（8 個）

`exam_registration_event_created` / `event_updated` / `event_deleted` / `recorded` / `withdrawn` / `reviewed` / `archived` / `unarchived`

### M3 實測結果（2026-10-11）

| # | 動作 | 預期 | 結果 |
|---|---|---|---|
| 1 | 建 required 場次（basicFee 30/15＋科目費 100/50、150/75） | 建立成功、`registrationMode=required` | ✅ |
| 2 | 學生 GET | 場次可見、新欄位齊全；舊場次向後相容 | ✅ |
| 3 | optOut＋原因 | 成功、feeAmount=0 | ✅ |
| 4 | optOut 無原因 | 400「勾選不報名時，請說明原因」 | ✅ |
| 5 | feeCode=1（國文+數學） | feeAmount=280（30+100+150） | ✅ |
| 6 | feeCode=3 | feeAmount=140（15+50+75） | ✅ |
| 7 | feeCode=2 | feeAmount=0 | ✅ |
| 8 | 學生封存 | archived=true | ✅ |
| 9 | 封存後 upsert | 409「資料已封存…」 | ✅ |
| 10 | 封存後 withdraw | 409 | ✅ |
| 11 | 重複封存 | 幂等 no-op success | ✅ |
| 12 | 承辦解除封存 | archived=false；其後 upsert 正常 | ✅ |
| 13 | optional 場次 optOut | 400「自由報名場次不需勾選不報名…」 | ✅ |
| 14 | 名單統計 | registered/optOut/archived 三計數正確 | ✅ |
| 15 | CSV | 11 欄含報名情形/不報名原因/繳費身分/應繳費用/資料封存 | ✅ |
| 16 | 測試資料清理 | withdraw→硬刪場次；preferredRole 還原 | ✅ |

### 待拍板（已依設計稿預設實作，調整處）

| # | 問題 | 目前實作 |
|---|---|---|
| 1 | 名額上限要「每科」還是「場次總額」？ | 每科（考場座位語意）；總額另議 |
| 2 | 額滿時是否保留「候補佇列」？ | 不做，取消即釋放 |
| 3 | 審核錄取要不要志願序排序 UI（拖曳）？ | 上下鍵排序 |
| 4 | CSV 要不要含家長聯絡資料？ | 不含（M1 名冊未存，需另接，另立需求） |
| 5 | `examMode=review` 的備取上限、放榜時間欄位？ | 視第一所實裝學校需求再定 |

## M3.6 實作狀態（三項精緻化，2026-10-11）

### 考試日期起訖 — 已實作

- `examEvents.examEndDate: string`（YYYY-MM-DD；`""`＝單日，舊資料相容）；管理表單「考試日期」起日＋訖日（訖日 min=起日，留空＝單日）。
- `formatExamDateRange()`：單日原樣、多日 `起 ~ 訖`（對齊 GAS `renderPipeInfo` 考程顯示）；學生卡片、清單、名單、列印表、公告描述一律改用。
- 行事曆宿主全天事件僅支援單日：多日以**起日**入曆（已知限制），描述內帶區間。

### 報名開放時間起訖 — 已實作

- `examEvents.registrationOpenAt: number`（epoch ms；`0`＝轉開放即可報，舊資料相容）＋既有 `deadline`（關閉）。
- `effectiveExamStatus` 三態（對齊 GAS `_checkTimeWindow`）：`upcoming`（未到開放）／`open`／`closed`（已過截止）；`StudentExamEvent.status` 收斂為 `"upcoming" | "open" | "closed"`。
- 學生端 upcoming：唯讀（表單停用、無送出鈕）、徽章顯示「MM/DD HH:mm 開放」；伺服端 upsert 同步 409「報名尚未開放」（即使承辦未轉狀態也不誤放行）。
- 驗證：`registrationOpenAt < deadline`（表單與 `parseExamEventDraft` 雙層）；管理表單「報名開放」datetime-local（留空＝轉開放即可報）；清單「報名期間」欄顯示起訖。

### 考試地點選項（僅升學考試）— 已實作

- `examEvents.locationOptions: ExamLocationOption[]`（`{ code, label, isDefault? }`；**無數量上限**，code ≤20 唯一、label ≤40；對齊 GAS 管道「試場」欄 `代碼,名稱[,預設]`）。
- 僅 `examType="entrance"` 顯示管理器；`mock`/`other` 伺服端 `parseExamEventDraft` 強制 `locationOptions=[]`。
- 管理表單提供 **單筆新增**（代碼＋名稱）與 **批次新增**（每行 `代碼,考區名稱`）兩種建置方式，會合併到同一份清單並檢查重複代碼；可在清單中指定任一筆為「預設」並用上下箭頭調整順序。
- `isDefault`：最多一項（多標保留第一、其餘清除）；未標＝第一項為預設。
- 登錄 `locationCode: string`：學生單選下拉（預設項自動選中）；場次有選項時必選（空值取預設項；無對應 400）；optOut 恆空。無選項＝不出下拉、顯示「試場由主辦單位分配」。
- 展示一律反查名稱：名單新增「試場」欄（有選項才出現）、CSV 輸出**名稱非代碼**、列印表與封存摘要、公告描述、行事曆地點（取預設項名稱）。

### 備註自動編號（管理表單）— 已實作

- 場次「備註（選填）」支援多行輸入：按 Enter 斷行後，儲存時會自動整理為 `1. ...`、`2. ...`、`3. ...` 編號格式（空行會略過）。

### 省流模式條目數提示（管理表單）— 已實作

- 場次清單在省流模式未展開時，會先顯示目前場次總筆數（輕量 `summary=count` 查詢），避免看不到清單時無法判斷是否已有資料。
- 場次清單統計顯示樣式已對齊行事曆（顯示在省流提示區塊中、位於「顯示場次列表」按鈕上方）。

### 場次清單版型整理（管理表單）— 已實作

- 「場次」欄僅顯示場次名稱；「重要日期」欄整併為「考試日期」與「報名日期」兩行（有起訖時上下兩行，單日僅顯示一行）；「操作」欄以每行兩按鈕並列，按鈕文字縮小顯示。

### 學生頁版型對齊（帳號、身分與安全管理）— 已實作

- 學生端報名頁改為與「帳號、身分與安全管理」一致的版型骨架：系統標題區、頁首/頁尾返回與登出按鈕、底部廣告區（`sponsorAdEnabled`）與版權區（`copyrightNotice`）。
- 報名卡片移除冗長說明；「考試地點／繳費身分／選考科目」改為左右兩欄（左標題、右操作內容）版型。
- 「考試日期」「報名期間」在起訖皆有值時改為上下兩行；新增「應考服務」欄位（非冷氣試場勾選＋特殊需求文字）。

### CSV 欄位（11 → 12）

`班級,學號,座號,姓名,報名情形,選考科目,不報名原因,繳費身分,應繳費用,考試地點,資料封存,登錄時間`（「考試地點」在應繳費用後；無選項或 optOut 為空）。

## M1 驗收指引（期 7 輕量驗收）

### 前置與啟用

```bash
git clone https://github.com/takan003/examRegistration.git
git clone https://github.com/takan003/campus-toolkit.git && cd campus-toolkit && npm install
npm run module:link -- ../examRegistration --copy   # win32 一律 --copy（E14）
npm run dev
```

1. `/admin/modules` → 找到「升學考試與模擬考校內報名」→ **開總開關**（預設未啟用 fail-safe；入口卡與首頁卡片隨之出現）。
2. 權限：名冊 `attribute＝超級` 自動全開；其他身分需名冊條目 `modules` 含 `examRegistration`（無權限＝頁面 403、API 403「權限不足」）。
3. 測試帳號 `takan003@gms.hlgs.hlc.edu.tw`／`111zzzZZZ`（四身分，超級）。**其名冊＝3 年 301**——建場次時對象年級選 3、班級填 301，學生端才看得到。

### 劇本（每步的預期）

| # | 動作 | 預期 |
|---|---|---|
| 1 | 管理頁建場次（科目 ≥2、對象 3／301） | 存為**草稿**；稽核 `event_created`；**不**發公告/行事曆 |
| 2 | 狀態「開放報名」 | 公告**恰 1 則**（【報名開放】…）、行事曆**恰 1 筆**（考試日，allDay）；再按一次開放**不會**再發 |
| 3 | 學生頁勾 2 科送出 | 顯示「已登錄 2 項」；再改勾 1 科→「已更新你的選考科目」 |
| 4 | 空勾選／亂填科目 key | 400「請至少勾選一個科目」／「勾選的科目與本場次不符」 |
| 5 | 管理端看名單（`?eventId=`） | 該生登錄科目與 byClass/bySubject 統計正確 |
| 6 | 狀態「已封存」→ 學生再送 | 409「報名已截止」；已勾科目唯讀保留；取消也 409 |
| 7 | 學生「取消報名」（須先重開） | 刪除登錄文件；清單回「尚未登錄」 |
| 8 | 稽核 | `event_created` 1、`event_updated` 依操作數、`recorded`＝登錄次數、`withdrawn`＝取消次數 |
| 9 | 無權限帳號打 API／頁 | 403；未啟用時入口卡不顯示 |

### 已知事項

- **P4 啟用閘**：學生端 API 接 `requireFeatureModuleEnabled`（主程式 0.390+）——模組停用後 API 回 403「尚未啟用」；
  管理端 API 刻意不接（停用時管理員仍需配置）。超級 bypass 由宿主處理。
- session 閒置約 60 分鐘即失效，驗收中途逾時請重新登入（非 bug）。
- 公告**沒有** API 刪除（主程式 405），重發/刪除走公告管理頁；行事曆為 upsert（同 `sourceRef` 不會疊床）。
- `open → open`（重送開放）不發公告；只有**轉為**開放才發佈一次。
- 測試殘留已於驗收後清理（issue #1 #5/#6：場次封存、兩則公告封存、行事曆取消，全走 App 路徑留稽核）。
  再測試請自建場次；測試資料建議加 `dev_` 前綴或改用 Emulator——兩台 dev 共用正式 Firestore。

## 在另一台電腦開發

```bash
git clone <本 repo> examRegistration
git clone https://github.com/takan003/campus-toolkit.git
cd campus-toolkit && npm install
# .env.local（8 個值見 campus-toolkit/.env.example）
npm run module:link -- ../examRegistration --copy
npm run dev
```

win32：junction 被 Turbopack 擋住（E14），一律用 `--copy`；改檔後重跑一次同步。
模組資料夾**勿放** `.git`/`node_modules`/`.next` 之外的宿主依賴——零新依賴是協議【E10】。
