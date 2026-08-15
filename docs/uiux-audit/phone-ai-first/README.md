# Phone AI-First 驗收證據

`scripts/e2e-ui/verify-phone-ai-first.mjs` 在真實 Chromium 上跑完驗收矩陣後產出的截圖與
`metrics.json`。重跑方式：

```sh
TARGET_URL=http://127.0.0.1:3000 TEST_EMAIL=… TEST_PW=… \
  node scripts/e2e-ui/verify-phone-ai-first.mjs
```

腳本會走完 3 支手機 × 3 台平板 × 2 台桌機，斷言「哪個寬度拿到哪一套 UI」，並從
network log 記下手機實際下載的 JS 與實際打出去的 API。截圖每次重跑都會產生全部八張，
版控裡只留每個級距一張代表。

`metrics.json` 的 `homeInteractive` 是「畫面可以用了」那一刻的累計，`homeSettled`
是連閒置預載（例如 posthog）都跑完之後——後者會把刻意延後載入的東西也算進來，
只看它會讓「延後載入」看起來沒有效果，所以兩個都記。

Bundle 的靜態切面（gzip、只算 eager 的模組圖閉包）另由
`node scripts/measure-phone-payload.mjs` 產出，兩者量的是不同的東西：
這裡量「瀏覽器實際抓了多少」，那裡量「這條路由在畫面可用前非抓不可的是多少」。
