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

## 桌面零回歸的證據

本次最硬的一條紅線是「>=768px 不得改變」。截圖證明不了這件事——字型載入與
反鋸齒讓像素比對充滿雜訊，而且紅了也不會告訴你**是什麼移動了**。

`scripts/e2e-ui/capture-desktop-layout.mjs` 改記錄真正要守的東西：桌面元素落在
哪裡、怎麼被繪製。1280／1440 兩個寬度 × 六條路由，記下 `.topbar`、
`.topbar-actions`、`.assistant-launcher`、`main#main-content`、`.card` 等選擇器的
bounding box 與關鍵 computed style，以及 document 的 scrollWidth／Height。

```sh
# 對照組：base 分支的 build
node scripts/e2e-ui/capture-desktop-layout.mjs > before.json
# 本分支的 build
node scripts/e2e-ui/capture-desktop-layout.mjs > after.json
node scripts/e2e-ui/capture-desktop-layout.mjs --diff before.json after.json
```

本分支對 base（a45b9ce）實跑結果：

```
桌面版面指紋完全一致（1280 / 1440 × 6 條路由）
```

兩份指紋存在 `desktop-layout-base.json` 與 `desktop-layout-branch.json`，
可以直接重跑上面的 `--diff` 複驗。座標比對留 1px 容差（不同 build 之間字型
hinting 會有次像素差，那不是版面變動）；`display`／`position`／`flexWrap`／
`fontSize`／可見性則要求完全相同。
