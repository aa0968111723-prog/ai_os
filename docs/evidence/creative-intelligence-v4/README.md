# Creative Direction v4 — 瀏覽器證據

擷取自本機 E2E_MOCK 環境（假生成、真狀態機、真資料庫）。

- `desktop-01-proposals.png` — 選一鏡後：目前創作狀態 ＋ Aios 視覺方向提案（提案不寫入任何東西）
- `desktop-02-directions.png` — 換個方向再試一次：意圖列 ＋ 三個真的不同的方向 ＋ 合計估點
- `desktop-03-batch-running.png` — 逐方向狀態：每個方向各自一列，不是整批一個數字
- `desktop-04-batch-settled.png` — 三個方向都完成：各自成為真實版本，current 指標未被移動
- `desktop-06-compare-grid.png` — 結算後自動並排：方向標籤、CURRENT、血緣、保持了哪些家族
- `desktop-07-compare-ab.png` — Compare 快速切換：同位置換圖，一次只掛一個媒體元素
- A/B 快速切換量測：切換鍵 3 個，同時掛載的媒體元素 1 個
- `desktop-05-partial-after-reload.png` — 重新整理後：A 成功／B 失敗 仍分別顯示（批次身分存在 generations.params，不在前端記憶）
- `mobile-390-01-tray.png` — 390px：底部面板停在分頁列上方（不再覆蓋），提案與目前狀態可讀
- `mobile-390-02-directions.png` — 390px：方向卡單欄／雙欄不溢出，按鈕 ≥44px
- `mobile-390-03-batch.png` — 390px：逐方向狀態清單
- `mobile-390-04-compare.png` — 390px：Compare 全螢幕、單欄、關閉鍵在安全區內
- 390px Compare 關閉鍵量測：{"found":true,"height":44,"width":44,"top":33,"tappable":true}

量測見 `measurements.json`。
