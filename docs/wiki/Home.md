# Aios（ai_os）維基

**AI Director OS**：團隊 AI 創作與協作作業系統的產品與工程說明。

公開倉庫文件採中性表述；業務領域用語以各組織自行設定為準。

## 先看這頁

| 頁面 | 說明 |
|------|------|
| **[一頁看懂・產品總覽](一頁看懂-產品總覽)** | 整站主線、功能地圖、新能力、錢與失敗（對齊站內 `/help`） |

站內完整白話版：登入 → 帳號選單 → **怎麼用**（`/help`）。

## 世界觀與注入

| 頁面 | 說明 |
|------|------|
| [世界觀與一句話故事](世界觀與一句話故事) | 世界觀是什麼、一句話故事的幫助 |
| [世界觀與一句關鍵訊息](世界觀與一句關鍵訊息) | 關鍵訊息（主張）與 logline 的分工 |
| [世界觀調性多選](世界觀調性多選) | 調性多選：主副、出圖前 2、建議組合 |
| [世界觀 Chips 複選與優先序](世界觀-chips-複選與優先序) | 主軸／調性／風格總則：多選與優先序 |
| [世界觀如何注入 AI 生成](世界觀如何注入-AI-生成) | 真的會被模型吃到嗎？哪些路徑會／不會 |

## 卡片、知識、協作

| 頁面 | 說明 |
|------|------|
| [角色定裝卡](角色定裝卡) | 角色外觀鎖定、生成勾選注入、跨鏡一致 |
| [場景設定卡](場景設定卡) | 色板／光線鎖定、生成勾選注入、跨鏡一致 |
| [素材設定卡](素材設定卡) | 道具／物件外觀材質鎖定、生成勾選注入、跨鏡一致 |
| [專案知識庫](專案知識庫) | 長文素材、釘選優先、本次知識優先、注入預覽與配額 |
| [協作與鏡像跟隨](協作與鏡像跟隨) | 雙人 presence、游標、鏡像精準度、誰在線 |

## 路線圖與維運（工程）

| 文件（repo `docs/`） | 說明 |
|------|------|
| [RAG 知識庫路線圖](https://github.com/aa0968111723-prog/ai_os/blob/docs/rag-and-asset-backup-drills/docs/product/rag-knowledge-base-roadmap.md) | 現行知識注入 vs 向量 RAG；啟動條件與 MVP 邊界 |
| [素材備份與還原演練](https://github.com/aa0968111723-prog/ai_os/blob/docs/rag-and-asset-backup-drills/docs/%E7%B4%A0%E6%9D%90%E5%82%99%E4%BB%BD%E8%88%87%E9%82%84%E5%8E%9F%E6%BC%94%E7%B7%B4.md) | 每週／每月／每季 checklist（成對備份） |
| [維運手冊](https://github.com/aa0968111723-prog/ai_os/blob/docs/rag-and-asset-backup-drills/docs/%E7%B6%AD%E9%81%8B%E6%89%8B%E5%86%8A.md) | 遷移、備份、應變、環境變數總冊 |

## 程式碼對應（給工程）

- 世界觀 schema／格式化：`shared/worldview.ts`
- 角色／場景錨點：`server/services/cardAnchors.ts`
- 生成注入：`server/services/generationCore.ts` → `effectivePromptParts`／`withSceneAnchor`
- 知識注入：`shared/knowledgeInject.ts`、`server/routers/knowledge.ts`
- 素材落地／備份：`server/services/storage.ts`、`server/services/assetBackup.ts`
- 站內說明頁：`client/src/pages/HelpPage.tsx`
- 單元測試：`server/services/generationCore.test.ts`、`shared/worldview.test.ts`、`server/services/cardAnchors.test.ts`

## 維護

- 倉庫：https://github.com/aa0968111723-prog/ai_os  
- 文稿來源：`docs/wiki/`（`scripts/sync-wiki.sh` 可同步到 GitHub Wiki）  
- 與程式衝突時，以**程式與測試**為準，並回寫本維基與 Help 頁。
