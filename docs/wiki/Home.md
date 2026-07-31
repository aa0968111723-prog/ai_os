# Aios（ai_os）維基

釋迦牟尼佛救世基金會 · 弘法內容創作與協作系統（內部工具）說明。

本維基整理**產品概念**與**系統如何把內容餵給 AI**，方便非工程夥伴與開發者對齊。

## 目錄

| 頁面 | 說明 |
|------|------|
| [世界觀與一句話故事](世界觀與一句話故事) | 世界觀是什麼、一句話故事的幫助 |
| [世界觀如何注入 AI 生成](世界觀如何注入-AI-生成) | 真的會被模型吃到嗎？哪些路徑會／不會 |
| [協作與鏡像跟隨](協作與鏡像跟隨) | 雙人 presence、游標、鏡像精準度 |

## 程式碼對應（給工程）

- 世界觀 schema／格式化：`shared/worldview.ts`
- 生成注入單一真相：`server/services/generationCore.ts` → `effectivePromptParts`
- 單元測試：`server/services/generationCore.test.ts`、`shared/worldview.test.ts`

## 維護

- 倉庫：https://github.com/aa0968111723-prog/ai_os  
- 有與程式行為衝突時，以**程式與測試**為準，並回寫本維基。
