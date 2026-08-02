# Notion 整合修復驗證

## 根本原因

Aios 原本只辨識 `notion.so`、`www.notion.so` 與 `*.notion.site`。`app.notion.com`、`www.notion.com`、`notion.com` 與其他官方子網域會被誤判成一般網頁，接著進入 HTML 抓取流程，最後只取得 Notion SPA 的 `JavaScript must be enabled` 空殼。

## 修復內容

- 統一辨識 `notion.so`、`notion.com`、`notion.site` 與其子網域。
- 避免 `fake-notion.com`、`notion.com.example.com` 等相似網域誤判。
- 自動移除 `source=copy_link`、`pvs`、`v` 與 hash 等不影響 Page ID 的參數。
- 支援 32 碼 Page ID 與標準 UUID。
- Notion 連結固定走官方 API，禁止回退一般網頁爬取。
- 對 401、403、404、429、5xx 提供可操作的中文錯誤訊息。

## 人工驗證

1. 到「連接的資料來源」確認 Notion token 驗證成功。
2. 在 Notion 父層頁面執行 `⋯ → Connections → Add connections → Aios`。
3. 到「知識與資料」貼入 `app.notion.com`、`notion.com` 或 `notion.site` 頁面連結。
4. 確認系統取得頁面文字，而不是 `JavaScript must be enabled`。
5. 使用未授權頁面測試，確認畫面提示到 Connections 授權。

---

# 第二輪：Notion 資料庫（表格）無法選頁、無法抓到

## 根本原因

「頁面」與「資料庫」在 Notion API 是兩種物件，兩處都只處理了頁面：

1. **選不到**——`searchNotionPages` 對 `/v1/search` 送
   `filter: { property: "object", value: "page" }`，把資料庫整類濾掉。
   使用者就算已把資料庫分享給整合，選頁器裡也永遠找不到它。
   標題解析也只掃 `properties` 的 title 欄；資料庫標題在頂層 `title` 陣列
   （`properties` 裡的 title 是欄位「定義」，值是 `{}`），所以即使列出來也會全變成「未命名」。
2. **抓不到**——`fetchNotionText` 只走 `GET /v1/blocks/{id}/children`。資料庫不是一般頁面，
   這條路讀不到任何一列，回 400／404，使用者看到「Notion API 錯誤（400）」或誤導的「頁面未授權」。
   資料庫必須走 `GET /v1/databases/{id}`（欄位定義）＋ `POST /v1/databases/{id}/query`（每一列），
   而且欄位值在每列的 `properties` 裡，不在 blocks。

## 修復內容

- 選頁器同時列出頁面與資料庫，前端以圖示與「資料庫」標示區分（`page_size` 30 → 50）。
- 標題解析支援資料庫的頂層 `title` 陣列；未命名資料庫給專屬替代字。
- 匯入時自動判斷是頁面或資料庫，不必使用者先分辨：
  blocks 路徑回 400／404，或成功但零內容（Notion 對資料庫 id 有時回 200 空陣列）時，
  改走 databases query；確定不是資料庫才丟回原本的頁面錯誤（站方 token 退回邏輯不變）。
- 資料庫抽成純文字表格：標題行＋欄位名列＋每列值（`|` 分隔）。
  欄位順序固定（title 欄排頭、其餘依名稱），重新匯入不會整份 diff。
- `notionPropertyText` 涵蓋 title/rich_text/number/select/status/multi_select/date/checkbox/
  url/email/phone/people/files/relation/unique_id/created_time/formula/rollup 等型別。
- 單次匯入上限 500 列（沿用既有 `MAX_TEXT_CHARS`），擋上萬列的表拖垮匯入。
- 401/403/429/5xx 不會多打一次資料庫端點，直接回原本的可操作訊息。

## 人工驗證

1. 在 Notion 開啟**資料庫本身那一頁**（不是單一列的頁面），`⋯ → Connections → Aios`。
2. 到「知識與資料」→「從 Notion 選頁／資料庫」，確認資料庫出現在清單、標題正確、標示為「資料庫」。
3. 勾選匯入，確認匯入的文字是欄位名＋各列的值，不是「Notion API 錯誤（400）」。
4. 直接貼資料庫網址（含 `?v=` 檢視參數）匯入，確認結果與選頁器一致。
5. 用未授權的資料庫測試，確認仍提示到 Connections 授權。
