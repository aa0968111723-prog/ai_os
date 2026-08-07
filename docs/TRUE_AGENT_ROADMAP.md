# 真代理路線圖：一個提示詞操作一切／AI 操作白板／接管全站

> 對應需求（產品擁有者原話）：「他要可以創建專案，專案內所有東西欄位功能剪輯都要可以一個提示詞操作，還有特別的是白板他可以操作筆，操作白板完成提示詞作品並送到分鏡，另外還能操作接管整個網站（瀏覽器不能就用手機app和桌面原生）整個操作，做一個真正的ai代理」
>
> 本文與 `GLOBAL_ASSISTANT_PLAN.md`（全站助手入口）互補：入口 UX 看那份，本文只覆蓋三個「真代理」需求的可行性判定與路徑。
> 撰於 2026-08-07。五路架構盤點（白板文件模型／剪輯管線／agentRunner 引擎／UI 操演基元／原生殼能力）的整合產出；承重 file:line 已抽驗（含一處盤點修正，見 A 節）。

所有承重引用都已親驗（含一處需要修正的盤點結論）。以下是可行性判定報告。

# 三大需求可行性判定（A／B／C）

> 判定前提：本報告只覆蓋三個新需求的可行性與路徑，入口 UX 交由 GLOBAL_ASSISTANT_PLAN.md，不重複。所有 file:line 均為盤點引用，其中承重者我已親自抽驗（抽驗發現一處盤點需修正，見 A 節）。

---

## A. 一個提示詞操作一切（建專案／欄位／功能／剪輯）

### 1. 可行性判定：分三層，各層答案不同

**先修正盤點的一處事實**（我親驗後發現，直接影響本節判定）：「MCP 分鏡唯讀」不完全正確。`mcp.ts:18` 的唯讀註解只涵蓋基礎工具組；`server/services/mcpWriteExpansion.ts` 已存在分鏡寫入工具——`add_scene`（:62）、`update_scene`（:77，但只收 title/prompt/voiceover/durationSec，見 :479-482）、`set_scene_visual`（:88-92）、`generate_into_scene`（:105）。**真正缺的精確清單是：reorder、trim（trimStartMs/trimEndMs）、remove/insertAfter、ambience 欄位**——MCP 端與站內 agent 步驟兩邊都缺（AgentStep 12 種 kind 無任何 edit 型，agentRunner.ts:71-83，已親驗）。

- **剪輯：現在就能做的低成本擴充。** 盤點已驗證關鍵推論成立：時間軸唯一真相就是 scenes 表（server/db/schema/projects.ts:170-202），buildRenderPlan 與 layoutTimeline 是 scenes 列的無狀態純推導（renderPlan.ts:89-130、shared/timeline.ts:152-174），MP4 預覽／交付包／剪映草稿全部同源。**AI 會改 scenes 就會剪輯，render 端零改動。** 資料層寫入 mutation 全齊且有守門（scenes.ts:420 setVisualFromAsset、:525 insertAfter、:1008 reorder，均親驗；update 含 trim 出點>入點守門）。
- **建專案：可做，但不能塞進專案代理。** run 綁單一 projectId，整套 ACL／冪等／跨專案防呆以它為軸（agentRunner.ts:601-614、1031-1033）。兩個合法落點：(a) 單步「建專案」走全站助手的 ResolvedAction→確認→runAction（單步動作本來就不需要 agent）；(b) 多步「建專案並鋪內容」落在 campaign 層新增 `create_project` 組級步驟（groupCampaignCore 的 5 種步驟擴充，結構成本與專案端相同）。
- **「所有欄位」：不建議承諾「一次交付」，這層要誠實。** 欄位級全覆蓋是工具面覆蓋度工程，且撞上紅線二（NIM spike 未解前工具數受限）——不能靠無限加 MCP 工具堆出來。正確策略是高價值動詞優先＋「落空提示詞」量測驅動後續（助理端記錄哪些指令找不到對應工具）。

### 2. 正確的技術路徑（資料流）

**單步 vs 多步分流**：一個提示詞先經意圖解析——單步動作（改一個欄位、建專案）直接走既有 callTool + ResolvedAction 確認契約，不進 agentRunner；多步計畫（「把這五鏡重排並各縮到 3 秒」）走 planAgentCore 的「一個提示詞→計畫→一次核准→自動執行」既有骨架（agentCore.ts:564-944）。**A 的骨架已存在，缺的只是動作種類。**

**剪輯四件套（agent 端）**：新增 4 種 kind——`reorder_scenes`／`update_scene`（含 durationSec/trim/voiceover/ambience）／`set_scene_visual`／`remove_scene`（可選）。每種按盤點的固定 5 檔插入點照抄模式：agentRunner kind union＋advanceRun 分支、agentPlanning schema＋resolve、agentCore planner prompt 清單、AgentCard 前端 kind 表（AgentCard.tsx:38-76）。冪等注意：reorder 傳整串 orderedIds 天然可重放；update 建議把 before 值寫進既有審計（auditAgentStep 自動涵蓋新 kind）以補「無 undo」的洞。

**MCP 端補洞**：在 mcpWriteExpansion 補 reorder／trim，update_scene 補 ambience——重用 scenesRouter 同一套守門。

**planner prompt 要教的領域規則**：durationSec 是整數 1-60 秒，sub-second 節奏只能靠 trim 毫秒（修剪後鏡長由修剪區間決定）；轉場/特效資料模型無此欄（RenderShotPlan 無 transition、LAYER_LANE 僅 1+3 軌），提示詞涉及時回覆「交付包進 Premiere」。

**明確的不做**：AI 可以「剪好」但不能替使用者「按輸出」——成片唯一路徑是客戶端 mediabunny（伺服器無 ffmpeg 是定案，exporter.ts:1-5）；`adobe_render_timeline` 是外部帳號且標注 mock（mcpWriteExpansion.ts:313-314），不算雲端合成翻案。

### 3. 與紅線的關係

- 寫入必確認：沿用**計畫層一次核准**（approveAgentCore＝一次授權全部估點，agentCore.ts:947-1008）；edit 型步驟 0 點數，核准即涵蓋。`remove_scene` 與覆蓋已綁素材的 `set_scene_visual` 屬破壞性，建議前置 `request_approval` 或初版乾脆不給（遵循 applyScript「永不刪除、省略不清空」的既有站規）。
- 工具數紅線：優先擴 **agent kind**（站內 planner 走 zod 結構化輸出，不吃 native tool calling，不受 NIM spike 牽制）；MCP 工具數增量延後到 spike 解掉。
- 0 新依賴：純手寫分支照抄，OK。390px：AgentCard 逐步顯示已存在。

### 4. 粗估

| 階段 | 內容 | 人天 |
|---|---|---|
| A1 | 剪輯四件套 agent kind＋planner＋前端表＋測試 | 5-8 |
| A2 | MCP 補 reorder/trim/ambience | 2-3 |
| A3 | campaign 層 create_project | 3-5 |
| A4 | 欄位長尾：落空量測機制先行 | 2（後續持續） |

### 5. 風險與依賴

- **五處手寫清單無 registry**（盤點明列）：漏同步一處就是靜默故障，尤其 prompt 清單與前端 kind 表——建議 A1 附一支「kind 清單一致性」單測。
- planner 排錯順序改壞 scenes：reorder 有交易＋序號鎖兜底，但語意錯誤（排錯順序本身）只能靠核准畫面＋審計 before 值＋agent-trace 每步預覽讓人看得見。
- **不確定**：免費 NIM 檔位的規劃品質對 12→16 種 kind 的排錯率影響未知，需觀察。

---

## B. AI 操作白板的筆（提示詞→畫→送分鏡）

### 1. 可行性判定：管線今天就通，真風險只在筆畫品質

資料層零架構阻力，全數親驗或盤點確認：BoardDoc 是純 JSON（boardDoc.ts:18-32，親驗）；parseBoard/sanitizeBrush 本來就是為不可信外部輸入設計的防禦入口（boardDoc.ts:126-197）；renderBoard 是決定性純函式（boardRender.ts:155-157、32-40）;`pushStroke` 逐筆注入＋增量 raster 就是「AI 逐筆畫」的現成骨架（useBoardSession.ts:104-113 親驗、WhiteboardCanvas.tsx:109-126）；白板→分鏡通路一行不用改（saveBoardToShot：exportBoardPng→/api/upload→setVisualFromAsset，StudioAiPanel.tsx:86-107 親驗、scenes.ts:420-437）。

**要先補的只有兩樣**：一段重播排程程式碼（無架構阻力），以及**品質 spike**——LLM 空間推理弱是真實限制，不粉飾：直接吐座標畫「作品」不可行，畫分鏡草圖級簡筆畫（構圖框、火柴人、運鏡箭頭）可行性高但未驗證。**先做 1-2 天 spike，不過關就停**。

### 2. 正確的技術路徑（資料流）

**核心設計一：不讓 LLM 直接吐點陣列。** 中間插一層「繪圖原語 DSL」：LLM 輸出高階原語序列（`line/polyline/ellipse/rect/arrow/stick_figure/frame` ＋語意標籤＋筆刷選擇），經 zod 驗證（仿 completePlanDraftSchema 的靜默丟棄不合格步驟模式）；伺服器端**展開器純函式**把原語展開成 Stroke[]——點密度、筆壓曲線、手繪抖動由展開器決定性合成，可單測。出廠前 clamp：筆畫數 ≤400（取 lite 上限從嚴，boardDoc.ts:62-70）、單筆 ≤2 萬點、色彩收斂 #rrggbb、座標鎖在 boardSizeForFormat 的白板座標系內。

**核心設計二：v1 不做即時串流，做「本地重播演出」。** 一次 tRPC 請求回整份 BoardDoc JSON（計點沿用規劃費「先預留、多退少補」模式）；前端收到後**逐筆切片餵 pushStroke＋rAF 排程**——筆一筆長出來的動畫效果由前端合成，不需要動 realtime。點級時間戳本來就不存在（boardRender.ts:55-56 明寫以點距近似速度），固定速率播放即可；「還原手繪節奏」不承諾。這個決策砍掉整條 SSE/WS 串流基建（盤點指出那是唯一真正缺席的基礎設施），成本降一個量級，觀感幾乎不減。

**送到分鏡**：重播完，使用者按「送到分鏡」→ 原路 saveBoardToShot。**不做**伺服器端直出 PNG：renderBoard 移植 node-canvas 理論可行但 node-canvas 是原生執行期依賴，違反紅線四；而且「使用者在場看完再按送出」剛好就是寫入確認紅線的正確落點——約束反而讓產品形狀更對。

**品質備援（v2 擇一，spike 後決定）**：(a) 站內生圖→掛參考底圖層（WhiteboardCanvas 本有 `<img>` 層）→AI 描邊或人描；(b) 生圖→向量化→SVG path 取樣成折線 Stroke——agentDag.ts:21 的 adobeJobId 預留插槽顯示 Adobe 非同步工作通道本就在規劃中，可作落點。

### 3. 與紅線的關係

- 花錢：LLM 繪圖呼叫計點，按鈕觸發＋事前顯示點數。
- 寫入：AI 只寫 localStorage 草稿（本來就是裝置本地、可丟棄），落到 scene 的那一步由使用者按確認。
- 390px：從嚴取 lite 400 筆上限，手機直接可用。0 依賴：DSL／展開器／重播全手寫。

### 4. 粗估

| 階段 | 內容 | 人天 |
|---|---|---|
| B0 | 品質 spike（原語 DSL 真實出圖水準；**gate：不過關就停**） | 1-2 |
| B1 | DSL schema＋展開器（純函式＋單測） | 3-4 |
| B2 | 伺服器端點＋計點＋clamp | 2-3 |
| B3 | 前端重播＋StudioAiPanel UI＋送分鏡確認 | 3-4 |
| 合計 | | 9-13 |

### 5. 風險與依賴

- **LLM 空間佈局品質是硬天花板**（spike 前標不確定）。期望管理必須向使用者說清楚：這是「分鏡草圖助手」不是「AI 畫師」——好在分鏡草圖語言本來就是簡筆畫，語境契合。
- 草稿綁裝置（studioStorage.ts:73-75）：AI 畫完的 doc 換裝置就沒了——v1 接受；要跨裝置就存成 JSON asset（小改）。
- 重播節奏是合成的、非手繪節奏——誠實標注，不承諾。

---

## C. 「接管整個網站」（使用者以為要原生殼）

### 1. 可行性判定：必須先糾正前提，再給正確形狀

**誠實糾正一：「瀏覽器做不到所以要原生」是錯的。** 操作自家 app 完全不需要原生殼——app 本體就是同一個 webview 裡的同源 SPA，兩個殼對它零增量：Tauri 殼僅 4 個檔案交接 command（desktop.toml:4-9，親驗），Capacitor 殼零 plugin、零自訂原生碼（capacitor.build.gradle 空 dependencies、MainActivity 一行殼），**兩者皆無任何 DOM 自動化／JS 注入／事件模擬 API**。同源 JS 在瀏覽器裡能做到的，原生殼不增不減。原生殼的真正增量只有：Tauri 的本機剪輯軟體交接（handoff.rs——這確實是 web 做不到的），與深層連結／視窗管理；Capacitor 殼目前甚至是**通知負增量**（Android System WebView 不支援 Push API，比 Chrome 裝的 PWA 還弱）。**「為 AI 代理上原生」在這個層面不建議做**；反過來，因為兩殼都是 server.url 直連正式站（capacitor.config.ts:15-23），web 層做好操演，**三端自動同享，一次都不用另做**。

**誠實糾正二：「真正的 AI 代理」的執行面其實已經存在。** agentRunner 就是伺服器端背景執行（關頁續跑）、多步 DAG、審批、冪等、審計的真代理引擎，完成時 Web Push 推到手機（agentRunner.ts:727-731）。缺的不是「代理」，是**演出面**——讓使用者看得見 AI 正在操作哪裡、隨時能停。

### 2. 正確的技術路徑（資料流）

**形狀：後端工具執行＋前端操演，不是模擬點擊。** 模擬 DOM 點擊被否決的理由：脆弱（改版即斷）、繞過工具內 ACL 與確認流、與 390px 手機 DOM 不同構、無審計。而操演基元大多現成：兩顆 reveal 匯流排（workbenchNav.ts:9-47、projectContextNav.ts:9-63）、flashAnchor（discuss.ts:43-53）、**完整的鏡像跟隨引擎**（realtime.tsx 的 STABLE_ID_SELECTOR／ensureAnchorExpanded／applyMirrorViewportLock／CursorOverlay，:59-60、244-352、709-813）、nonce 填表三通道＋CreationAction「AI 填表、人按送出」契約（creationActions.ts:12-27）。

資料流：`agentRunner 每步完成 → realtime 新增伺服器端 broadcast API（現只 export attachRealtime，realtime.ts:403 親驗）→ WS 新訊息型別 agent-step{runId, stepId, kind, status, anchor?} → 前端常駐 HUD 接收 → goTo(path, {reveal}) 導航 → 掛載後 replay reveal（discuss.ts:18-35 pending-key 雙軌範本推廣）→ ensureAnchorExpanded＋flashAnchor 落地 → 寫入類步驟前端只填表不送出（CreationAction submitted:false）→ HUD 常駐「停止」按 agents.stop`。

**缺口清單（照盤點，共 7 項）**：
1. 伺服器→前端代理進度推播（現況 4s/8s 輪詢，AgentCard.tsx:281-293；agentRunner 零 realtime import）
2. 跨頁 reveal（監聽者全在 ProjectPage；dashboard/planner 無匯流排）
3. 集中 goTo(path, {reveal})（現靠 pushState＋PopStateEvent hack，tauriDesktop.ts:99-106）
4. AI 合成游標 peer（CursorOverlay 只認 WS 真人連線）
5. 全域急停 HUD（停止按鈕只在 AgentCard，AgentCard.tsx:112-120）
6. 填表 nonce 通道只覆蓋工作台三表單＋助理輸入框（其餘表單要比照補）
7. 小修：flashAnchor 硬寫 smooth，未守 reduced-motion（discuss.ts:46）

### 3. 與紅線的關係

- **急停 HUD 就是使用者主權的具體化**：跨頁常駐、隨時可按停，配 agent-trace 每步實際結果——「自主代理」與「主權」的切法維持：計畫層一次核准＋高風險步驟 request_approval＋隨時急停，全沿用既有審批。
- 操演本身是唯讀演出（跳頁／高亮／填表不送出），寫入仍走既有確認流，紅線一不動。
- 0 依賴：原生 WS 已有，broadcast 是既有伺服器的新函式。390px：mirror 引擎已處理巢狀捲動鎖定，HUD 需 sheet 化設計。

### 4. 粗估

| 階段 | 內容 | 人天 |
|---|---|---|
| C1 | WS agent-step 型別＋server broadcast＋agentRunner 掛鉤＋AgentCard 改推播驅動（輪詢保留為 fallback） | 4-6 |
| C2 | goTo 工具＋跨頁 reveal 交棒（pending-key 推廣） | 3-5 |
| C3 | 全域 HUD＋急停＋AI 合成游標／錨點跟隨 | 5-8 |
| C4 | 填表通道逐表單推廣 | 每表單 0.5-1（長尾） |
| 原生殼 | **0（不做；跟使用者溝通：三端自動獲得）** | 0 |

### 5. 風險與依賴

- 依賴 realtime 通道擴建（C1）：現協定只轉播客戶端訊息，server 主動推播是新面——但輪詢仍在，推播失敗只是退化不是故障。
- 「接管**整個**網站」永遠是覆蓋度漸進（同 A 的欄位長尾），不可能一次交付——要跟使用者把「一切」重新定義成「持續擴大的動詞清單＋落空量測」。
- 合成 AI 游標與真人協作游標的視覺區辨要設計，避免誤導「有人在線上」。

---

## 建議順序與第一個可交付 demo

**順序：B → A1 → C1-C3 → A2/A3/C4。**

**第一個 demo（B，9-13 人天含 spike）：「說一句話 → 白板上筆一筆畫出分鏡草圖 → 按確認送到分鏡 → ShotStrip 出現新圖」。** 理由：
1. **視覺衝擊最大**：逐筆重播是全站唯一「看得見 AI 動手」的時刻，遠比表單自動填入更像「真正的 AI 代理」，直接回應使用者的想像。
2. **成本最低、獨立性最高**：不動 realtime、不動工具面、不動審批，資料層與送分鏡通路全是現成（親驗）；重播只是前端排程程式碼。
3. **零紅線衝突**：花錢按鈕觸發、寫入落在使用者按的那顆確認鈕上。
4. **為 A 與 C 鋪路**：demo 第二幕天然接 A1（「再把這五鏡重排、各縮 3 秒」）串成一條龍；重播的「看著 AI 操作」心智模型就是 C 操演的預告片。

**風險對沖**：B0 spike（1-2 天）不過關就停損，fallback demo 改為 A1 剪輯四件套＋agent-trace（「一句話重排分鏡並改節奏」，5-8 人天）——衝擊力次之但確定性最高，因為「AI 會改 scenes 就會剪輯」已被盤點與我的抽驗雙重確認。

**要向使用者誠實傳達的三件事**：(1) 原生殼不是「真 AI 代理」的前提，web 做好三端全有——省下的是整條原生開發線；(2) AI 畫畫的品質天花板是「分鏡草圖」不是「畫作」，spike 後才承諾；(3) 「一個提示詞操作一切」的「一切」是持續擴大的動詞清單，首發覆蓋剪輯與高價值欄位，用落空量測決定下一批。