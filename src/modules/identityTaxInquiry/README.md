# 註冊身分與財稅查調模組（identityTaxInquiry）

> 狀態：0.1.0 可用骨架＋核心流程（可在主程式掛載測試）
> 宿主要求：`campus-toolkit` ≥ 0.558（使用 `requireModulePermission` 子權限閘門）

## 功能

1. **學生端**：每學期於學校開放期間確認註冊身分別（原住民、低收入戶、中低收入戶、身心障礙等，選項由管理端設定）；需要財稅查調的身分別可填寫父／母姓名與身分證字號，供承辦辦理查調；可先存草稿，截止前可修改，截止後唯讀。
1. **教職員端**：兼導師查看本班確認進度與名冊；具「財稅查調」權限者可跨班，具「查看名冊」權限者可查指定班級；可更新查調狀態（待查調／已查調／免查調）與備註。
1. **管理端**：設定啟用開關、確認開放起訖、身分別選項、需查調身分別、是否必填父母身分證字號與實施說明；查看全校統計與名冊，匯出查調名冊 CSV。
1. **家長端**：唯讀查看綁定子女的註冊身分確認結果與查調狀態；父母身分證字號一律遮蔽。

## 開發者

1. 作者：takan003（<https://github.com/takan003>）
1. 版本：0.1.0（2026-10-29）
1. 授權：MIT

## 安裝後設定

1. 於主程式 `/admin/modules` 找到「註冊身分與財稅查調」並開啟總開關。
1. 至 `/admin/identity-tax-inquiry` 設定確認開放起訖、身分別選項與需查調身分別（預設「低收入戶」「中低收入戶」），並視需要勾選「查調時必填父或母身分證字號」。
1. 指派管理子權限：`configure`（管理規則）、`viewRecords`（查看名冊）、`taxInquiry`（查調作業）、`export`（匯出）。
1. 家長入口依主程式功能模組設定開放；`provides.parent = true`。

## 資料集合（`dataCollections`）

1. `identityTaxInquirySettings`：模組設定（單文件 `default`）。
1. `identityTaxInquiryRecords`：學生每學期確認紀錄（doc id＝`{學年學期}_{uid}`）。
1. `rosterStudents`：唯讀查詢當期名冊（家長子女對應、班級名冊）。

## 複合索引（`firestoreIndexes`）

1. `rosterStudents`：`academicYear` + `semester` + `classCode`。
1. `identityTaxInquiryRecords`：`period` + `classCode`。

## 掛勾需求（`hooks`）

無。本模組不發公告、不寫行事曆。

## 稽核動作

`identity_tax_inquiry_settings_updated`／`identity_tax_inquiry_record_saved`／
`identity_tax_inquiry_record_confirmed`／`identity_tax_inquiry_tax_updated`。

## 本機開發

```bash
git clone <本 repo> identityTaxInquiry
git clone https://github.com/takan003/campus-toolkit.git
cd campus-toolkit && npm install
npm run module:link -- ../identityTaxInquiry --copy --watch   # win32 一律 --copy（E14）
npm run dev
```

改檔後由 `--watch` 同步；`npm run lint` 一律在主程式目錄執行。

## 待定案

1. 是否串接財政部／外部財稅 API（目前為名單與結果登錄、匯出）。
1. 未確認名單是否需自動通知（目前僅顯示於名冊）。
1. 是否需要附件上傳（目前僅備註欄）。
