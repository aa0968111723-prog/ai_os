# AIOS Mobile Companion — 架構與交付說明

> 手機 App 的產品定位重構：**Web 是工作室，App 是 AI Companion，AIOS Orb 是入口**。
> 本文是這次重構的 Architecture Audit、設計決策與尚未完成項目的單一出處。

---

## 0. 一句話總結

手機原生 App 不再是「桌面版的縮小版」，而是一個 Orb-first 的 AI 夥伴：
打開就看到球 → 說一句話 → 讀真實專案進度 → 執行真實 Action → 即時看到結果 →
需要完整編輯時深連結回 Web 工作站。

**桌面、平板、手機瀏覽器一行行為都沒有改變。**

---

## 1. Architecture Audit（重構前的既有資產）

這次重構最重要的發現是：**站內已經有八成的地基**，缺的是產品外殼與 Orb。
以下是 audit 結果，以及每一項的處置。

| 既有資產 | 位置 | 這次的處置 |
|---|---|---|
| Phone/Desktop 路由層分岔（<768px） | `client/src/mobile/PhoneRoute.tsx` | **不動**。手機 Web 仍走它 |
| 產品模式斷點 768 / 平板用桌面版 | `client/src/lib/viewport.ts` | **不動**，Companion 沿用同界線 |
| 手機首屏唯讀彙總 | `server/routers/phone.ts` | **不動**，另建 `companion.ts` 服務不同問題 |
| 全站 AI 助手（意圖判定／能力路由／確認卡／執行驗證／Undo／軌跡） | `server/routers/globalAssistant.ts`（2.5k 行） | **完全重用**。Companion 一行助手邏輯都沒有重寫 |
| 能力表 ＋ 風險等級 | `shared/assistantExecution.ts` | **投影**成 Companion 三檔確認政策 |
| 助手 → 手機卡片的投影接縫 | `client/src/lib/phoneAssistantBridge.ts` | **重用**（Orb 的 thinking／waiting 來自它） |
| 「把這句話交給 Aios」事件接縫 | `client/src/lib/assistantCompose.ts` | **重用**（Companion 送出走同一條） |
| 助手面板本體 | `client/src/app/components/GlobalAssistantSheet.tsx` | **重用**（Companion 掛同一個元件） |
| WebSocket 即時（專案房 `p:`／組房 `g:`、認證、心跳、連線上限、跨實例 bus） | `server/services/realtime.ts` | **加一種訊息**，不新建連線 |
| Web Push ＋ 站內收件匣 | `server/routers/push.ts`、`notifications.ts` | **重用**，加一層優先序投影 |
| Capacitor Android 薄殼（`server.url` 直連線上站） | `capacitor.config.ts`、`android/` | **擴充**：Widget ＋ 捷徑 ＋ 狀態橋 |
| 既有小球四態 CSS 開關 | `client/src/lib/orbState.ts` | **不動**，八態投影回四態 |

### Audit 結論

1. **不需要新後端**（任務書 §14）。Companion 只加了一支唯讀 router。
2. **不需要新 realtime**（§15）。既有 `/ws` 加一種 message type 就夠。
3. **不需要新助手**（§5）。既有的意圖判定與確認流程本來就滿足需求。
4. **平板的紅線（§13）已經是既有行為**——`PHONE_MAX_WIDTH = 767.98`，平板用桌面版。
   Companion 再加一個條件（必須是原生 App），所以平板連「不小心被降級」的路徑都沒有。
5. 真正缺的是：**Orb**、**Companion 外殼**、**語音**、**深連結**、**離線佇列**、
   **通知優先序**、**Widget**。這次補上的就是這七項。

---

## 2. AI Companion 架構圖

```
┌─────────────────────── 手機原生 App（Capacitor WebView）───────────────────────┐
│                                                                              │
│   AiosOrb ──tap──▶ GlobalAssistantSheet（既有）                                │
│      │    ──hold─▶ useVoiceInput（Web Speech）──▶ 逐字稿 ──放開──┐             │
│      │    ──swipe up──▶ 任務分頁                                 │             │
│      │                                                          ▼             │
│      │                                             composeToAssistant()（既有）│
│      │                                                          │             │
│   狀態 ▲                                                        │             │
│      ├── voice.status（listening）                              │             │
│      ├── usePhoneAssistantTurn（thinking / waiting_confirmation）│             │
│      └── useCompanionRealtime（executing / progress / failed）   │             │
│                                                                 │             │
│   CompanionHome ── trpc.companion.digest ──▶ companionDigest()（純函式）        │
│        └── 最多 3 張智慧卡 ──▶ compose ／ open_web ／ open_tab                  │
│                                    │                            │             │
│   OrbWidgetBridge ──▶ Android Widget                            │             │
└─────────────────────────────────────────────────────────────────┼─────────────┘
                                                                  │
        ┌─────────────────────────────────────────────────────────┘
        ▼
┌────────────────────────────── 伺服器（既有，未改動）──────────────────────────┐
│  globalAssistant.ask                                                        │
│     → classifyAssistantRequest（意圖）                                       │
│     → selectAssistantCapabilities（能力路由）                                 │
│     → runToolLoop（工具迴圈）                                                 │
│     → executeDirectSiteActions ／ siteActionProposals（確認閘）                │
│     → runSiteActionCore + readBackVerification（執行＋讀回驗證）               │
│     → undoSiteAction（可撤銷者）                                              │
│                                                                             │
│  generationCore ──▶ publishCompanionEvent ──▶ /ws 房間 p: 與 g:              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**關鍵不變式**：Companion 端**沒有任何 mutation**。所有寫入都經既有的
`runSiteActionCore`，因此 ACL、CAS、確認政策、點數扣抵與讀回驗證一項都沒有繞過。

---

## 3. Orb State Machine

八態，定義在 `shared/companionOrb.ts`（純函式，26 個測試）。

```
                    ┌──────────────── listening（優先序 100）
                    │                 使用者正按著螢幕，任何背景訊號都搶不走
                    │
      idle ◀────────┼──────────────── waiting_confirmation（80）
       ▲            │                 有提議／審核等你拍板
       │            ├──────────────── error（70）        ── TTL 3.2s ──▶ idle
       │            ├──────────────── executing（60）    ── 帶進度環
       │            ├──────────────── thinking（50）
       │            ├──────────────── success（40）      ── TTL 2.2s ──▶ idle
       └────────────┴──────────────── notification（30） ── TTL 4.0s ──▶ idle
```

| 狀態 | 視覺 | 來源 |
|---|---|---|
| `idle` | 緩慢呼吸 ＋ 微微漂浮 | 沒有其他訊號 |
| `listening` | 音量圈跟著振幅（`--orb-amp`） | `useVoiceInput` |
| `thinking` | 內部光流三團反向旋轉、粒子加速（**不是 spinner**） | 助手那一輪 `running` |
| `executing` | 金環變成進度環 | WS `generation_started/progress` |
| `waiting_confirmation` | 柔和脈衝 ＋ amber 光暈 | 待確認提議／`approval_required` |
| `success` | 一次性 mint 光暈擴散（**不是煙火**） | 這一輪有已驗證收據 |
| `error` | 陶土色 ＋ 一次輕微擺動（**畫面不變警告頁**） | WS `generation_failed` |
| `notification` | 輕輕點頭兩下 | 未讀提醒 |

### 設計取捨

- **純投影**：`deriveOrbState(signals)` 不吃「上一個狀態」，同樣訊號永遠同一顆球。
  一次性狀態的退場計時器留在元件層——把時間放進純函式會讓它測不動。
- **零 requestAnimationFrame**：整顆球是 SVG ＋ CSS keyframes，
  transform／opacity 都在合成執行緒。idle 時主執行緒**一幀都不做事**。
- **音量走 CSS 變數**：15Hz 的 `setState` 會讓 18 顆粒子節點每秒重繪十五次；
  寫 `--orb-amp` 只讓合成執行緒重算一個 scale。

### 動畫降級（`orbMotionPlan`）

| tier | 粒子 | 呼吸 | 漂浮 | 光流 | 觸發 |
|---|---|---|---|---|---|
| `full` | 18 | ✓ | 6px | ✓ | 預設 |
| `reduced` | 0 | ✓ | — | — | prefers-reduced-motion／省電／saveData／CPU ≤ 4 核 |
| `still` | 0 | — | — | — | 記憶體 ≤ 2GB／**App 在背景** |

`reduced` 與 `still` 是**連 DOM 節點都不建**，不是用 CSS 藏起來。
另有 `@media (prefers-reduced-motion: reduce)` 作為最後一道保險（系統設定改了即時生效）。

---

## 4. Agent Action Registry（風險與確認政策）

`shared/companionActions.ts` 把既有 `ASSISTANT_CAPABILITIES` 的 risk
投影成手機情境的三檔政策。**沒有第二份能力表。**

| 既有 risk | Companion tier | 確認方式 |
|---|---|---|
| `READ` | `low` | 直接執行，不打斷 |
| `SAFE_WRITE` | `medium` | 可撤銷 → 直接做＋Undo；不可撤銷 → 確認卡 |
| `COSTFUL` | `medium` | 同上（`animation_execute_repair` 因不可撤銷 → 確認卡） |
| `EXTERNAL` / `DESTRUCTIVE` | `high` | 一定出確認卡 |

明確覆寫（`TIER_OVERRIDES`）：

| 能力 | tier | 理由 |
|---|---|---|
| `add_character` | high | 永久改角色 Reference＝之後每張圖都跟著變 |
| `send_dm` | high | 對外、不可撤回 |
| `add_schedule_item` | high | 可能同步到 Google Calendar |
| `orchestrate_group_campaign` | high | 大型批次花費 |
| `animation_adopt_candidate` | medium | 換掉現用畫面，但可復原 |

**未登錄的能力一律 high／confirm_card**——新增能力的人忘了想手機情境時，
最壞後果是多一張確認卡，而不是靜默執行一個沒人審過的寫入。

---

## 5. Deep Link 設計

`shared/companionDeepLink.ts` ＋ `client/src/companion/openInBrowser.ts`。

| target | 站內路徑 | 說明 |
|---|---|---|
| `project` | `/p/:id` | 專案頁 |
| `storyboard` | `/p/:id#stage-board` | 同一頁的錨點 |
| `production` | `/p/:id#stage-create` | |
| `delivery` | `/p/:id#stage-deliver` | |
| `characters` / `scenes` | `/p/:id#sec-characters` / `#sec-scenes` | |
| `studio` | `/studio/:id` | 動畫創作室（獨立路由） |
| `tasks` / `notifications` | `/collab` | 協作中心 |
| `projects` | `/dashboard#projects` | |

### 三條安全規則

1. **網址契約以既有路由為準**。任務書舉例的 `/projects/:id/storyboard` 在本站是 404；
   實際契約是 `/p/:id` ＋ 錨點。錨點字串從 `mobile/stages.ts` 取（它又從
   `STORY_INLINE_SECTIONS` 推導），不在 Companion 裡自己寫。
2. **`projectId` 一律驗 UUID**。那個值常常來自模型輸出或語音轉出來的文字。
3. **origin 永遠來自 `location.origin`**，絕不來自輸入。
   讓模型指定 host 等於讓它把帶著 session 的使用者導去任何網站。
   `//evil.example` 這種 protocol-relative 路徑會被擋下。

開啟方式：優先用 Capacitor Browser 外掛開**系統瀏覽器**（不是 App 內的 WebView——
在 WebView 裡導走等於把 Companion 換掉），失敗退回 `window.open(..., "noopener")`。

---

## 6. Realtime Event 設計

**沒有第二套 realtime。** 既有 `/ws` 加一種 message type：

```jsonc
{
  "type": "companion-event",
  "kind": "generation_completed",
  "projectId": "…", "groupId": "…",
  "entityId": "…", "entityLabel": "A07",
  "count": 3, "progress": 0.68,
  "occurredAt": "2026-08-19T…"
}
```

舊客戶端的 `onmessage` 是 switch＋default 不處理，收到不認得的 type 會安靜忽略 →
**對桌面版零影響**。

### 事件來源（`server/services/generationCore.ts`）

| kind | 觸發點 |
|---|---|
| `generation_started` | 生成翻成 `running` |
| `generation_completed` | 成品落地（與既有 `publishToProject` 同一處） |
| `generation_failed` | 兩條失敗路徑（provider 失敗、空輸出） |
| `approval_required` | 落入 `awaiting_approval` |

### 扇出

`publishCompanionEvent` 同時發到 `p:<projectId>` 與 `g:<groupId>`。
**組房是必要的**：Companion 首頁沒有開任何專案，只發專案房的話手機在首頁什麼都收不到。
`projectId → groupId` 有行程內快取（專案的所屬組在產品上不會變）。

### 客戶端

`shared/companionRealtime.ts` 的 reducer 做**樂觀計數**（球在 200ms 內轉起來），
權威狀態仍靠查詢覆蓋。

- **進度事件不觸發 refetch**——那只是把輪詢換個名字重新發明一遍。
- 只有離散狀態轉換（completed／failed／approval／batch／quota）才回伺服器對答案。
- 計數一律夾在 0 以上：漏收一則 `started` 之後不會顯示「-1 個生成中」。
- 重連成功呼叫一次 `onResync`——斷線期間的事件補不回來（房間不留歷史），
  所以權威狀態靠重抓，不假裝事件流沒斷過。

---

## 7. Mobile / Tablet / Desktop 斷點

`shared/companionSurface.ts`（`PHONE_MAX_WIDTH = 767.98`，與 `client/src/lib/viewport.ts` 同值）。

| 裝置 | 外殼 | surface | 產品 |
|---|---|---|---|
| 桌機（≥1280px） | 任何 | `workspace` | 完整創作工作站 |
| 平板（768–1279px） | 任何（**含原生 App**） | `workspace` | 完整創作工作站 |
| 手機（≤767.98px） | 瀏覽器 | `mobile_web` | 進度／素材／輕操作（既有 `.m-*` 殼層） |
| 手機（≤767.98px） | 原生 App | `companion` | AI Companion |

### 兩條紅線

1. **平板不准被降級**。就算有人在平板上裝了 APK 也一樣拿 `workspace`。
   `?surface=companion` 在平板／桌機上**無效**（只在手機寬度生效）。
2. **Companion 綁「原生 App」而不是「手機」**。手機瀏覽器的使用者多半是點連結進來的，
   他要的是看那個東西；把手機 Web 也換成 Companion 等於讓每一條分享連結都打不開它承諾的內容。

### Companion 只接管首頁

`COMPANION_HOME_ROUTES = { "/", "/dashboard", "/companion" }`。
`/p/:id`、`/studio/:id`、`/collab` 等深連結照舊走既有路由表——那些網址是通知、
分享與書籤的契約，不能因為外殼換了就失效。

---

## 8. 通知優先序

`shared/companionNotifications.ts`。五級：

| 優先序 | 推播 | 震動 | Orb 提醒 | 例 |
|---|---|---|---|---|
| `critical` | ✓ | ✓ | ✓ | 點數用完、≥5 筆生成同時失敗 |
| `action_required` | ✓ | ✓ | ✓ | 等你確認、生成失敗、一致性低於門檻 |
| `completed` | ✓ | — | ✓ | 生成完成、批次跑完 |
| `informational` | — | — | ✓ | 專案有更動 |
| `silent` | — | — | — | 生成開始、進度、代理步驟 |

- **正在看這個專案時降一級**：畫面上已經即時更新了，再推一則只是重複他剛看到的東西。
- **合併視窗**：生成完成 60s、失敗 30s——一次來十筆不能推十次。
- 所有事件都仍進站內收件匣，分級只影響**打擾強度**。

---

## 9. 離線與弱網

`client/src/companion/offlineQueue.ts`。唯一的規則：**不要假裝已經做完了**。

1. 收下的東西叫「待送出」，UI 照這個字面顯示（`offlineAcknowledgement()`）。
2. 只排隊**使用者說的那句話**，不排隊已解析的動作——離線時決定的「安全」
   半小時後可能已經不安全（那個素材可能已被別人刪了）。
3. 上限 10 句、TTL 6 小時、先進先出。離線半天不該累積四十句然後在連上網的那一秒
   全部送出去燒點數。
4. 連線恢復時把最新那句**填回輸入框**，不自動送出——按不按由人決定。

---

## 10. 手機桌面桌寵（Android）

| 項目 | 檔案 |
|---|---|
| Widget Provider | `android/app/src/main/java/app/aios/mobile/OrbWidgetProvider.java` |
| 狀態儲存 | `OrbWidgetState.java`（SharedPreferences） |
| Web→原生橋 | `OrbWidgetPlugin.java`（Capacitor plugin，唯一方法 `setState`） |
| 版面／圖 | `res/layout/widget_aios_orb.xml`、`res/drawable/orb_widget_*.xml` |
| 規格 | `res/xml/aios_orb_widget_info.xml` |
| 長按捷徑 | `res/xml/shortcuts.xml`（說一句話／看任務） |

### 三條設計原則

1. **不依賴高風險權限**（任務書 §9）。Widget 只用系統的 AppWidget 機制，
   `INTERNET` 以外**零新增權限**。`SYSTEM_ALERT_WINDOW` 的浮動泡泡沒有做，
   而且不打算讓核心功能依賴它。
2. **狀態單向流**：Web 算好 → plugin 寫 SharedPreferences → Widget 重畫。
   Widget 跑在 launcher 行程裡，拿不到 WebView 的 cookie；要它自己查 API
   就得在原生層再實作一次登入與 token 保管，那正是 §14 禁止的事。
   代價（誠實記載）：**App 從未打開過時 Widget 顯示預設 idle**。
3. **`updatePeriodMillis = 0`**：不排週期喚醒。資料來源根本不在這一端，
   排一個 30 分鐘的喚醒只會在使用者沒開 App 的日子裡白白耗電。

深連結：點球 → `/`；點麥克風 → `/?voice=1`（Web 端讀到後直接開錄音，
並用 `replaceState` 把參數拿掉，免得每次返回首頁又被打開麥克風）。

---

## 11. 檔案清單

### 新增：`shared/`（純函式，全部有測試）

| 檔案 | 內容 | 測試數 |
|---|---|---|
| `companionOrb.ts` | Orb 八態機、優先序、a11y 文案、動畫降級 | 26 |
| `companionActions.ts` | Action Registry（風險 → 確認政策） | 14 |
| `companionDeepLink.ts` | 深連結組裝與安全驗證 | 15 |
| `companionDigest.ts` | 首頁投影（問候／主動提示／≤3 卡） | 13 |
| `companionNotifications.ts` | 通知五級優先序 | 12 |
| `companionRealtime.ts` | 線路格式 ＋ 樂觀 reducer | 17 |
| `companionSurface.ts` | 裝置 × 外殼 → 產品策略 | 12 |

### 新增：`server/`

| 檔案 | 內容 |
|---|---|
| `routers/companion.ts` | `digest`（首頁事實）、`context`（Context Awareness 包）。唯讀 |
| `routers/companion.contract.test.ts` | 授權／回收桶／上限／「不准另建後端」的契約（15 測試） |

### 修改：`server/`

| 檔案 | 改動 |
|---|---|
| `services/realtime.ts` | ＋`publishCompanionEvent()`（既有房間，新 message type） |
| `services/generationCore.ts` | ＋四處事件發布（started／completed／failed／approval） |
| `routers/index.ts` | 註冊 `companion` |

### 新增：`client/src/companion/`

| 檔案 | 內容 |
|---|---|
| `AiosOrb.tsx` | Orb 元件（SVG＋CSS，零 rAF，手勢，a11y） |
| `CompanionApp.tsx` | 三格外殼（AI／任務／我）＋ 助手面板擁有權 |
| `CompanionHome.tsx` | 首頁（問候／球／輸入／卡／離線／深連結） |
| `CompanionTasks.tsx` | 任務分頁（照打擾強度排序） |
| `CompanionMe.tsx` | 我（換組／開 Web／動畫層級／切回工作站） |
| `useOrbMotion.ts` | 動畫層級（reduced-motion／電量／背景即時反應） |
| `useVoiceInput.ts` | Web Speech ＋ AnalyserNode 音量，含清理 |
| `useCompanionRealtime.ts` | 薄 WS 訂閱（不是 useCollab） |
| `offlineQueue.ts` | 離線指令佇列 |
| `openInBrowser.ts` | 深連結開系統瀏覽器 |
| `orbWidgetBridge.ts` | 推狀態給 Android Widget |

### 修改：`client/src/`

| 檔案 | 改動 |
|---|---|
| `app/AppShell.tsx` | 判斷 surface；Companion 只接管首頁路由 |
| `lib/companionSurface.ts` | 新增：surface hook ＋ `<html data-surface>` |
| `styles.companion.css` | 新增：Companion tokens ＋ Orb ＋ 外殼（跟 chunk 走，不進 index.css） |

---

## 12. 效能

| 指標 | 結果 |
|---|---|
| Companion JS chunk | **27.0 KB**（gzip 10.3 KB） |
| Companion CSS chunk | **15.5 KB**（gzip 3.2 KB） |
| 桌面首屏 bundle | **未改變**（Companion 是 lazy chunk，桌面不下載） |
| Orb idle 時的主執行緒工作 | **0**（純 CSS 合成動畫，零 rAF） |
| 首頁查詢數 | **1**（`companion.digest`），無輪詢 |
| 即時更新 | WS 推送；進度事件不觸發 refetch |

`CompanionTasks` 與 `CompanionMe` 各自再 lazy（2.5KB／4.2KB），
所以開 App 只付首頁的錢。

---

## 13. 尚未完成 / 已知限制（誠實清單）

1. **iOS 沒有 Widget**。這次只做 Android（任務書指定 Android 優先）。
   iOS 需要 WidgetKit ＋ App Group，是另一條原生工作。
2. **Widget 在 App 從未開啟過時顯示 idle**。原因與取捨見 §10。
3. **語音在 iOS Safari／部分 WebView 不可用**。`useVoiceInput` 會回
   `supported: false`，UI 退到文字輸入——不是壞掉，但 iOS 使用者拿不到按住說話。
4. **`freshResults` 用 12 小時時間窗近似「還沒看過」**。站內沒有 per-user 已讀水位；
   要精確就得新增一張表，超出這次範圍。
5. **`companion.context` 尚未接進助手的提示詞組裝**。它已經可查、有授權、有上限，
   但把它塞進 `globalAssistant.ask` 的 context 需要改動既有助手的提示詞，
   風險高於這次的 vertical slice 目標——列為下一階段第一項。
6. **`companionActions` 的政策尚未強制在執行路徑上**。目前伺服器仍用既有的
   `canDirectlyExecuteCapability`（行為與重構前完全相同）。這一層是**投影**，
   要讓它真的擋下 high risk 需要在 `executeDirectSiteActions` 加一道判斷——
   那會改變桌面版的行為，必須單獨評估。
7. **沒有實機效能量測**。Cold/Warm start、FPS、電量、記憶體需要真機與
   Android Studio profiler，本環境做不到。降級策略是靜態能力訊號驅動的
   （核心數／記憶體／省電／背景），不是量測驅動的。
8. **`?tab=tasks` 捷徑進 Companion 才有效**。在手機瀏覽器上那個參數不做事。
9. **三個 pg 測試的 import 邊界例外**（`collabDoc.pg.test.ts`、`dataIntegrity.pg.test.ts`）
   是隨上一個 commit 進來的，這次補登記進 allowlist 與 ADR，**不是**這次新增的違規。

---

## 14. 建議下一階段

| 優先 | 項目 | 理由 |
|---|---|---|
| P0 | 把 `companion.context` 接進 `globalAssistant.ask` 的上下文 | 「這張重做」「繼續下一幕」要真的知道指的是什麼 |
| P0 | 在 `executeDirectSiteActions` 落實 `companionActions` 的 high risk 閘 | 目前政策只是投影，沒有強制力 |
| P1 | 實機效能量測（cold start／FPS／電量）＋ 依結果調 `orbMotionPlan` 的門檻 | 現在的門檻是保守推測 |
| P1 | Rich Card：把 Generation Result Card（一致性 %、接受／重做）接上既有一致性評估 | 資料已在 `generation_consistency_evaluations` |
| P2 | iOS WidgetKit | 對稱補齊 |
| P2 | 主動提醒的推播端（目前只有站內優先序，推播文案尚未走 `companionNotificationCopy`） | 讓 §8 的分級真的影響推播 |
| P3 | Floating Bubble（Android，optional enhancement，不得成為核心路徑） | 任務書 §9 的紅線已寫明 |

---

## 15. Native v1（Android）

### 15.1 選型：Capacitor（繼續），但這次把 native bridge 做真

Audit 結論（任務書 B2）：

- repo 已有 Capacitor 8 殼（`server.url` 直連線上站）、APK CI（`apk.yml`，tag 觸發、簽章）。
- 前端 100% TypeScript／tRPC contracts；auth 是 cookie session（WebView cookie jar 持有）。
- realtime 是自有 WS；push 是 Web Push（VAPID）。
- React Native ＝ 重寫全部 UI 與資料層、複製 business logic（任務書明令禁止複製後端／另建 App 專用邏輯）。
- TWA ＝ 零 native 能力（Widget／SpeechRecognizer／自訂 scheme 都做不到）。

**Capacitor 是唯一同時滿足「最大共用 TS contracts」與「真 native 能力」的選項。**

#### 哪些是真 native bridge、哪些是 Web UI（誠實邊界）

| 層 | 實作 | 性質 |
|---|---|---|
| Orb／對話／卡片／離線佇列 | #794 的 Web Companion（surface=companion） | Web UI（WebView 內） |
| 語音辨識 | `AiosSpeechPlugin.java`（系統 SpeechRecognizer） | **真 native**（WebView 沒有 Web Speech API——沒有這個 bridge，APK 內按住 Orb 只能退回打字） |
| 桌面 Widget | `OrbWidgetProvider/State/Plugin`（#794） | **真 native**（AppWidget＋SharedPreferences 單向狀態） |
| 深連結 | `AiosSchemeRouter.java`（aios://→https 轉譯）＋ App Links | **真 native**（intent 層） |
| 快捷 | `shortcuts.xml`（語音／任務） | **真 native** |
| Auth | WebView cookie jar（session cookie） | 平台能力（見 15.4） |

### 15.2 語音（B5）

long press → `AiosSpeech.start()`（plugin 自帶 RECORD_AUDIO 權限流程）
→ SpeechRecognizer 裝置端辨識 → `partialResult` 事件逐字稿即時顯示
→ 放開 → `stopAsync()` 等最終結果 ≤800ms → `composeToAssistant()`
→ 既有意圖判定／能力路由：DIRECT 寫入直接執行（executeDirectSiteActions）、
COSTFUL/HIGH 出既有提議卡——**不是把文字填進 input 就算了**。

音量圈由 plugin 的 `rms` 事件餵（onRmsChanged dB 正規化 0–1），不再 getUserMedia，
避免雙重佔麥。App 進背景 `handleOnPause` 強制收麥（Java 端雙保險）。
隱私：辨識在裝置端，音訊不經 AIOS 伺服器；plugin 不落錄音檔、不 log 逐字稿
（`shared/androidManifest.contract.test.ts` 守住）。

### 15.3 確定性重跑（B7/B8/B9 垂直切片）

失敗卡「全部重跑」（單一專案，`actionId=retry_generation`）
→ `companion.failedGenerations`（唯讀：筆數＋預估點數）
→ `CompanionRetryConfirm` 確認卡（B9 Confirmation 規格：幾筆、預估幾點、就這樣做／先不要）
→ 逐筆 `generation.retry`（既有端點：完整還原角色定裝／場景／道具／分鏡綁定，
走 executeGenerationCommand 真扣點）
→ 逐筆誠實回報（N 成功、M 失敗＋首個錯誤）→ WS companion-event 讓 Orb 即時轉 executing。

多專案聚合的失敗卡維持 compose 給助手（沒有唯一目標專案時不猜）。

### 15.4 Auth（B15）

- session cookie 存在 **WebView cookie jar**（Android 系統層，app-private），
  不是 SharedPreferences、不是 JS 可讀的 localStorage token。
- capacitor.config `androidScheme=https` ＋ `server.url` 為 https——cookie 全程 Secure。
- 登出＝既有 `auth.logout`（清 server session＋cookie）；token 過期＝既有 401 →
  SessionGate 轉登入頁；revoked session＝realtime 心跳重驗（≤60s 斷線）＋下一請求 401。
- 多裝置＝既有 sessions 表本來就是 per-device；deviceTrust 機制原樣適用。
- 禁止清單核對：無 plaintext token 落地、無 password 存 SharedPreferences、
  無 hardcoded API key、Java 端不 log 任何 auth 資料（contract test 守住權限清單與 Log 呼叫）。

### 15.5 通知（B13）——已知限制

Capacitor WebView 沒有 Web Push（PushManager 不存在）；真 FCM push 需要
google-services.json（apk.yml 已預留掛點）→ **下一個 PR**。本版：

- 站內事件照 #794 的優先序進收件匣＋WS 即時（App 開著時 Orb／任務分頁即時反應）。
- 已安裝 App 時，通知 email／瀏覽器推播裡的 https 連結經 App Links 直開 App。

### 15.6 App Links / Deep Link 契約（B10）

https（正典，分享／通知一律用它；未裝 App 自然退回瀏覽器）：
`/p/:id`、`/p/:id#stage-board`、`/studio/:id`、`/collab`、`/dashboard#projects`

aios://（App 在場表面專用：Widget／捷徑；MainActivity 轉譯成上列 https 同路徑）：
`project/:id`、`storyboard/:id`、`studio/:id`、`generation/:id`、`voice`、`tasks`、`home`

對照表有兩份實作（TS `parseAiosUri` ＋ Java `AiosSchemeRouter`，冷啟動時 WebView
還沒起來只能在原生層轉譯），`companionDeepLink.test.ts` 用 source 斷言鎖住兩邊同步。

驗證：`/.well-known/assetlinks.json` 由 `ANDROID_APPLINK_SHA256` 環境變數驅動
（`server/services/appLinks.ts`）；未設定 → 404 → 驗證失敗 → 連結開瀏覽器（功能無損）。
