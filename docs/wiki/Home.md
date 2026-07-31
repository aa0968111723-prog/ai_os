# Aios（ai_os）維基

**AI Director OS**：團隊 AI 創作與協作作業系統的產品與工程說明。

本維基整理**產品概念**與**系統如何把專案上下文餵給 AI**，方便產品、設計與開發對齊。公開倉庫文件採中性表述；業務領域用語以各組織自行設定為準。

## 目錄

| 頁面 | 說明 |
|------|------|
| [世界觀與一句話故事](世界觀與一句話故事) | 世界觀是什麼、一句話故事的幫助 |
| [世界觀與一句關鍵訊息](世界觀與一句關鍵訊息) | 關鍵訊息（主張）與 logline 的分工 |
| [世界觀調性多選](世界觀調性多選) | 調性多選：主副、出圖前 2、建議組合 |
| [世界觀 Chips 複選與優先序](世界觀-chips-複選與優先序) | 主軸／調性／風格總則：多選與優先序 |
| [世界觀如何注入 AI 生成](世界觀如何注入-AI-生成) | 真的會被模型吃到嗎？哪些路徑會／不會 |
| [協作與鏡像跟隨](協作與鏡像跟隨) | 雙人 presence、游標、鏡像精準度 |

## 程式碼對應（給工程）

- 世界觀 schema／格式化：`shared/worldview.ts`
- 生成注入單一真相：`server/services/generationCore.ts` → `effectivePromptParts`
- 單元測試：`server/services/generationCore.test.ts`、`shared/worldview.test.ts`

## 維護

- 倉庫：https://github.com/aa0968111723-prog/ai_os  
- 倉庫內文稿來源：`docs/wiki/`（可用 `scripts/sync-wiki.sh` 同步到本 Wiki）  
- 有與程式行為衝突時，以**程式與測試**為準，並回寫本維基。
