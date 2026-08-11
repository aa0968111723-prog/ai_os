# Assistant Brain v2 驗收矩陣

| 情境 | 必須行為 | 禁止行為 |
|---|---|---|
| 「從 Google Drive 選資料加入目前專案」且 page 無 projectId | 解析 working project；不唯一就問；選完同一 goal 繼續 Drive picker | 回一句相同文字後標已完成 |
| Drive / file / folder picker 已開但尚未選檔 | WAITING_USER_INPUT | COMPLETED |
| 「雲端內有多少素材？」來源不明 | 問來源 | 自動回答 Project Assets 數量 |
| Google Photos remote count 無 listing capability | 明確說無法驗證 remote count；可提供 imported count | 把 imported/project count 冒充 remote count |
| 「不是 Drive，是 Photos」 | CORRECT 原 goal source 並重新匹配 capability | 開新無關 request |
| 「對」/「第二個」 | 優先回答 pending question / active goal | 當成 standalone ASK |
| 「這些整理一下」且 previous result 有 assetIds | classify_asset + job verification | 只回教學文字 |
| 「把這些放到 Shot 3」 | resolve typed result + shot + attach + read-back | 重新要求上傳 / 猜 shot |
| DesiredOutcome 需要寫入 | tool result + verification 才 completed | LLM text = success |
| capability unavailable | 說明 boundary + 真實替代方案 | silent substitute |
| 外部/高風險 action | 現有 confirmation/approval gate | 繞過 ACL / approval |
| 完成任何 action | 保留原 conversation，結果卡提供可選 View action | 強制跳頁 |

## Release gate

- Mobile 390×844 真實流程通過
- Desktop 1280×900 真實流程通過
- typecheck / server tests / client tests / build / boundaries / UI primitives / hooks 全綠
- 若有 migration，fresh PostgreSQL schema drift none
- 真實 tool trace 證明 action 有執行；不能用 mock completion card 代替
