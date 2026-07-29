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
