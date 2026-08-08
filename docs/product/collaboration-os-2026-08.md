# 協作作業系統 2026-08：實作狀態

> 判斷每一項修改是否值得的唯一標準：
> **它有沒有讓 3–8 個人真的更容易一起把一支作品做完？**
>
> 本文件記錄的是**目前 HEAD 的真實狀態**。計畫中但尚未實作的一律標 NOT STARTED，
> 不寫成已完成。

分支：`claude/collab-os-realtime-redesign-l1ohl4`

---

## 一、修改前發現的真實問題

### P0-1　併發修改會靜默消失（最嚴重）

`scenes` / `stories` / `story_scenes` / `characters` / `character_looks` /
`scene_presets` / `props` 的每一支 update 都是 `WHERE id = ?`，沒有任何併發條件。

兩個人同時改同一格，後寫的人贏，先寫的人**畫面上不會紅、不會跳、沒有任何訊號**——
下一次輪詢回來時他自己打的字就是不見了。

`story.save` 最嚴重：它是整份全文覆寫，而編輯器每 800ms autosave 一次。
兩人同時打字時，其中一人的整段內容會被對方的全文覆蓋，而且是每 800ms 覆蓋一次。

> 既有的 partial patch（只 set 有傳入的欄位）擋得住「A 改 name、B 改 appearance」，
> 但擋不住兩人改**同一欄**——而那正是同一格分鏡上最常發生的事。

### P1-1　首頁的協作區資訊價值太低

只有一排名字 chip（「組內在線 Bruce 韋澔」）。它回答不了任何一個使用者真正會問的
問題：誰在忙什麼、有什麼找我、哪裡卡住了、哪個專案有討論。

底層其實已經有 notifications 收件匣、messages 標注、project_tasks（含 approval）
——這些能力全都存在，只是藏得太深，沒有被整合進「我的下一步是什麼」。

### P2-1　鏡像跟隨同步的是像素，不是內容

既有的鏡像跟隨同步捲動量、游標比例、錨點矩形。它在兩台同尺寸桌機上很準，但它同步的是
「螢幕長什麼樣」而不是「在看什麼東西」——手機與桌機版面不同，pixel-perfect
從定義上就做不到。而且它是單方面的：沒有「我要帶大家看」這個動作。

### P2-2　presence 只有 userId 粒度

同一個人 Tab A 開故事、Tab B 開分鏡時，跟隨者會在兩個分頁的位置之間來回彈跳。

---

## 二、已經存在、因此**沒有重做**的能力

以下全部驗證過確實存在且可用，一律強化／整合而非另起爐灶：

| 能力 | 位置 |
| --- | --- |
| WebSocket `/ws`、project room、group room | `server/services/realtime.ts` |
| Presence、彩色游標、focus zone、anchorPeers | `client/src/realtime.tsx` |
| 鏡像跟隨（像素級） | `useCollabMirrorFollow` |
| Redis 跨實例 bus、scoped invalidate、`publishToProject` | `server/services/realtimeBus.ts` |
| 專案留言、@mention、reply、reaction、pinned、語音留言＋轉錄、@助手 | `server/routers/messages.ts` |
| 留言轉待辦／筆記 | 既有 |
| 通知收件匣（先落列再推播；push 只是加速通道） | `server/services/notify.ts` |
| 圖上定點標注（`anchorAssetId` / `ax` / `ay` / `tMs` / `resolvedAt`） | `messages` schema |
| 標注釘死在被畫下的那一版、不自動浮動 | `SceneAnnotationLayer` |
| `openCountsByScene`（一支查詢算完整專案，不 N+1） | `messages.ts` |
| `project_tasks`（含 `taskType='approval'`） | `server/db/schema/agents.ts` |
| Story-first 四階段 ①故事 ②分鏡 ③製作 ④成片 | 既有 |

**沒有建立** MessageSystemV2 / RealtimeV2 / NewCollabEngine /
AlternativeNotificationSystem，也沒有搬去 Supabase / Liveblocks / Firebase。

---

## 三、本次實作

### Phase 0　併發安全（**DONE**）

**Migration**：`drizzle/0051_collab_revisions.sql`
七張表各加 `rev integer not null default 0`（純新增、`IF NOT EXISTS`、既有列以
DEFAULT 0 補齊、無資料搬移、重跑為 no-op）。

**契約**（`shared/revision.ts`）
```
UPDATE ... SET ..., rev = rev + 1 WHERE id = ? AND rev = expectedRev
影響 0 列 = 撞到了
```

條件下在 UPDATE 本身而不是「先 SELECT 比 rev 再 UPDATE」——後者兩個語句之間仍有空窗，
兩個請求可以雙雙讀到 rev=3、雙雙認為安全、雙雙寫入。

**rev 撞了不是立刻失敗**，先做逐欄三方比對（`classifyRevisionPatch`）：

| baseline / patch / current | 判定 | 行為 |
| --- | --- | --- |
| patch == current | noop | 不寫 |
| baseline == current | mergeable | 直接合併落地 |
| 其餘 | contested | 丟結構化 CONFLICT |

A 改提示詞、B 改旁白時兩份修改根本不衝突，直接合併。
只比 rev 的系統會把這種情況誤判成衝突，逼使用者為一件沒有衝突的事做選擇；
假警報多了，人就會開始無腦點「用我的」——那時這套機制反而變成資料遺失的幫兇。

**衝突 UI**（`client/src/components/ConflictNotice.tsx`）
不是「儲存失敗」，而是「韋澔剛剛更新了這一鏡」＋ `[比較差異] [查看新版] [重新套用我的修改]`。
「重新套用」仍然走一次併發檢查——無條件寫回只是把靜默覆蓋換了個按鈕名字。

`expectedRev` 是 optional：強制會讓每一支既有呼叫端（agent effect、解析落庫、匯入、
背景 runner）在漏帶時整個壞掉，而那些路徑本來就不是併發熱點。

### Phase 1　協作聚合、首頁、協作中心（**DONE**）

`collaboration.summary` 一支伺服器聚合，取代前端拼十幾支：
```
onlinePeers / unreadMentions / unreadReplies / openAnnotations
myTasks / pendingApprovals / attention / threads / recentActivity / activeProjects
```

- 未解決標注用**單一 group-by** 算完整組（走既有 `messages_open_annotation_idx`），
  不逐專案 N+1。
- presence 從記憶體房間投影（`groupPresence`），與畫面上的在場名單同一個真相。
  **不含座標、不落歷史**——presence 是「現在誰在哪」，不是行蹤紀錄。
- 「找我」依**阻塞程度**排序（approval 100 > agent_confirm 95 > annotation 80 >
  mention 60 > reply 50 > task 40 > 一般更新），時間只是同層之內的第二鍵。
  依時間排序的話這一頁只會變成另一條 feed。
- 討論依「專案 × 內容物件」分組：「Shot 08 有 5 則」比「這個專案有 23 則」有用得多。
- Activity ≠ Notification，刻意分開。

**首頁**：`CollabPanel` 取代那排名字 chip；只攤最重要的一兩件，其餘去協作中心。
完全沒事時整區不顯示——空的協作區比沒有更糟（它教使用者忽略這一塊）。

**協作中心** `/collab`：找我／討論／任務／動態四個分頁，全部是同一支聚合的四個切面。

### Phase 2　Presenter 與語意視圖（**DONE**）

**協定新增**（`server/services/realtime.ts` ↔ `client/src/realtime.tsx`）

| 訊息 | 方向 | 內容 |
| --- | --- | --- |
| `view` | 雙向 | `{ connId, view: ViewState }` |
| `present` | 雙向 | `{ connId, active, reason: "stopped"\|"disconnected", view }` |
| `hello` | 下行 | 新增 `views[]`、`presenters[]`、`self.connId` |

`ViewState`：`section / storySceneId / sceneId / tab / drawer / modal / filter / assetId`。
逐欄夾制後才轉發（它會進查詢鍵與 CSS 選擇器）——與 cursor 的 anchor、
invalidate 的 scope 同一條原則：不信任 client。

**三條不可違反的規則**

1. **絕不未經同意切走畫面。** `present` 在伺服器端只做廣播；協定層就不給
   「切走別人畫面」這個能力。收到它的客戶端只會長出一張邀請卡。
2. **跟隨者自己一動就暫停。** 顯示「已暫停跟隨（你自己捲動了）[回到 Bruce]」，
   絕不硬拉回去。
3. **主講者離線就明說是誰離線。** 絕不自動改跟另一個在線的人。

**connId**：跟隨鎖定 userId + connId，多分頁不再彈跳。

**暫停守衛的設計**：用「聽哪些事件」而不是 `isTrusted`。程式化捲動
（`scrollTo`／`scrollIntoView`，也就是跟隨自己造成的那些）發出的 `scroll` 事件
`isTrusted` 同樣是 true——拿它分辨「人的手」根本分不出來。改成只聽
`wheel`/`touchmove`/`pointerdown`/`keydown`，並刻意不聽 `scroll`。

**像素鏡像保留而非取代**：同尺寸桌機上它更細膩，兩者互補——
viewState 先把人帶到正確的物件，鏡像再對齊細部。

---

## 四、實機驗證抓到的三個缺陷（單元測試全綠時）

`scripts/e2e-ui/verify-presenter.mjs`（兩個真帳號、兩個 browser context、真 WebSocket）
第一次跑只過 9/12。三個都是「狀態機正確、接上真實網路之後行為錯誤」：

1. **主講者按下按鈕自己畫面沒反應** — `present` 廣播帶了 `except: client`，
   主講者收不到自己那一則，而 selfPresenting 的唯一真相來源就是它。
2. **純捲動時 viewState 不變** — 只從 focus zone 推導，而 zone 只在
   「進入某個編輯區塊」時才變。新增 `detectVisibleSection()` 並於 scroll 時回報。
3. **主講者關掉分頁時跟隨狀態列整條消失**（而非顯示「暫時離線」）— **訊息競態**：
   斷線時伺服器發兩則獨立訊息（`present active=false` 與 `presence`），抵達順序不保證，
   而舊版靠「他還在不在在場名單裡」去推——讀到還沒更新的名單，把斷線判成自己結束。
   改成由協定層把原因講明（`reason`）。

> 任何「靠另一則訊息的副作用去推斷本則訊息語意」的設計都會這樣壞。
> 正確的做法是讓訊息自己帶著語意。

修正後 **12/12 通過**。

---

## 五、尚未完成（誠實標記）

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| Phase 3　Project Header / Shot 卡協作狀態 | **PARTIAL** | Shot 卡的 anchorPeers、`⚑ N` 未解決標注、討論數皆已存在且沿用；Header 的「點某人 → 看到他正在 Shot 08 → 跟隨畫面」尚未接上新的 `describeViewState`（目前仍是舊的鏡像跟隨入口）。 |
| Phase 4　Universal contextual comments、影片 tMs 留言、Generation 版本審查 | **NOT STARTED** | `messages.tMs` 與 `anchorAssetId` 欄位已存在且標注已釘版；但「點留言 seek 到 00:18」「播放頭接近時高亮」「thread 綁 generationId」尚未實作。 |
| Phase 5　Yjs Story 共編（`/ws-doc`、CRDT、inline comment、RelativePosition、snapshot compaction、materialize 回 `stories.content`） | **NOT STARTED** | 見下方「為什麼沒做 Yjs」。 |
| Phase 6　AI Collaboration Coordinator | **NOT STARTED** | 既有 `@助手` 保留未動。`collaboration.summary` 已經是它未來要讀的那份結構化上下文（messages / annotations / tasks / approvals / activity），但「整理討論、找 blocker、把 change request 轉 task、整理 decision」尚未實作。 |
| Decision 概念（新 `decisions` 表 vs reuse） | **NOT STARTED** | 已評估：應為**獨立新表**（decision 的生命週期與 message 不同——message 是時間軸上的一句話，decision 是會被反覆引用的定案；硬塞進 message 會讓「已解決」與「已定案」永遠分不開）。尚未建表。 |
| 留言 `intent`（comment / question / suggestion / change_request / decision / blocker） | **NOT STARTED** | |
| 留言完整生命週期的 provenance 資料鏈 | **PARTIAL** | `project_tasks.sourceMessageId` 已存在（留言→任務那一段接得起來）；「任務→generation→新版本→通知原提議者→審核→解決→Decision Log」尚未串完。 |

### 為什麼沒做 Yjs

計畫本身寫明的前置條件是「P0 revision safety、P1 Collaboration Hub、P2 Presenter
都穩定之後才正式導入 CRDT」。本次把這三項做完並實機驗證通過，但 Yjs 是一個獨立且
大得多的工程（新 `/ws-doc` 傳輸層、`collab_documents` 持久化與 snapshot compaction、
awareness 與現有 Presence 的顏色／名稱共用、RelativePosition 的 inline comment、
以及最關鍵的「materialize 回 `stories.content` 讓 story parser / AI / export /
version history / search 全部繼續工作」）。

把它塞進同一批交付，只會得到一個沒有實機驗證過的半成品混進 production path——
而那正是計畫第三十條明列的禁止事項。

**目前的故事編輯仍然不是 Google Docs 式共編**，文件不假裝它是：
它是 local draft → debounce save → remote adoption，
差別只在於**現在它至少不會靜默吃掉別人的內容**（撞到會出衝突卡讓人決定）。

---

## 六、驗證結果

| 項目 | 結果 |
| --- | --- |
| `npm run typecheck` | ✅ 0 錯誤 |
| `npm test`（含 `RUN_PG_INTEGRATION=1` 打真 PostgreSQL） | 2174 passed / 2 failed / 6 skipped |
| `npm run test:client` | ✅ 1395 passed（165 檔） |
| `npm run check:boundaries` | ✅ OK（763 檔，11 條既有例外，未新增） |
| `npm run check:ui-primitives` | ✅ 裸 class 0（基準線 0，未退化） |
| `npm run check:hooks` | ✅ OK |
| `npm run build` | ✅ 成功 |
| `npm run db:check` | ✅ schema drift: none |
| `npm run db:migrate:dry-run` | ✅ 無 DDL／ledger 寫入 |
| 實機雙瀏覽器 Presenter 驗證 | ✅ 12/12 |

**2 個失敗是既有問題，與本次修改無關**：`server/services/deviceTrust.pg.test.ts`
的裝置標籤分隔符斷言（`Windows・Chrome` vs `Windows · Chrome`）。
以 `git stash` 在未修改的樹上重跑，失敗完全相同——它們只是因為本次首度啟用
`RUN_PG_INTEGRATION=1` 才被暴露出來。

---

## 七、已知風險

1. **`rev` 只保護有帶 `expectedRev` 的呼叫端。** 背景 runner、AI 代理、解析落庫仍不帶，
   它們與人的編輯之間仍可能互相覆蓋（但 rev 會遞增，所以人的下一次儲存**會**撞到並
   得到提示）。這是刻意的取捨，不是遺漏。
2. **`detectVisibleSection` 依賴階段標頭的 id**（`#stage-story` / `#stage-board` 等）。
   有人改動那些 id 而沒有同步這裡的話，語意跟隨會安靜地退化成「只跟 zone」。
3. **Presenter 的跟隨人數是保守估計**（房內人數 − 1），不是真的統計誰按了加入——
   協定裡沒有 join 的回報。顯示偏多不偏少。
4. **多實例下的 `groupPresence` 只看本機房間**。跨 replica 的在場名單走 Redis 名冊
   （presence 廣播正確），但首頁聚合目前只投影本機——設了 `REDIS_URL` 的多實例部署下
   首頁人數可能少算。單一行程部署（現況）不受影響。
