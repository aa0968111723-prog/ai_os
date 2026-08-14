# 全站導覽去重 — 驗證證據

## 自動化（PR 4 分支）

| 檢查 | 結果 |
| --- | --- |
| targeted client（導覽／說明中心／資料中心錨點） | 27 passed |
| typecheck / boundaries / ui-primitives / hooks | PASS |
| `npm test` | 2934 passed / 119 skipped |
| `npm run test:client` | 1861 passed |
| `npm run build` | PASS |

涵蓋契約：四項底欄、More 兩層、說明中心分頁、`/models` `/community` `/downloads` 仍掛真頁、資料中心 `#knowledge-map`／`#hub-downloads`、助手「靈感頻道」連結、#683 U10 CSS。

## 瀏覽器 20 條流程

狀態：**BLOCKED_BY_ENVIRONMENT**

此 Cloud Agent 環境沒有可用的登入 session，無法實際操作已登入殼層（底欄、More sheet、今日安排、頭像、未讀、PWA safe area、軟鍵盤）。

待有登入帳號後，在下列尺寸各跑一次規格 §8 流程，截圖放本目錄：

- 390×844
- 430×932
- 768×1024
- 1280×800
- 1440×900
