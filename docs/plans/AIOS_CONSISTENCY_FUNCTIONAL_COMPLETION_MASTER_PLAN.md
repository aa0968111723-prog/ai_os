# Aios 一致性與全功能閉環總計畫

狀態：可執行的 umbrella specification（本 PR 僅文件）  
日期：2026-08-14  
Repository：`aa0968111723-prog/ai_os`  
目標基準：default branch `claude/healing-migration-ai-os-erewp2`

## 1. 最終成果

把 Aios 從「已有很多強功能，但跨頁、跨入口與生成生命週期仍可能斷裂」收斂成一套可日常使用的創作系統：

1. 使用者在專案中建立或匯入角色、造型、場景、道具、素材、知識與結構化資料。
2. 故事解析、分鏡、單鏡製作、批次生成、動畫、聲音、時間軸、交付都讀取同一份 persisted project truth。
3. 每次生成使用不可變的 Shot Context Packet，結果先成為 Candidate；只有明確的人類 Adopt 才能改 current。
4. 角色、造型、場景、道具與畫風在跨鏡頭、跨版本、重試、核准等待與 reload 後仍可追溯。
5. 訓練只使用有明確權利與同意的資料；完成的 adapter 只產生候選版本，必須 Promote 才啟用。
6. Web、tRPC、REST（若有）、MCP、workflow、agent、approval resume、schedule/background 使用相同權限、成本、核准、冪等與稽核規則。
7. AI 助手能讀取當前頁面、選取範圍、專案狀態與缺口，直接完成可執行動作，不只回覆建議。
8. 預設 UX 仍是簡單的單一 Story workspace；深層能力按需展開，390px 手機可完成主流程。
9. 素材在訓練、生成、分享與匯出前有可驗證的來源／授權證據與風險結果；系統不假裝提供法院判決或律師意見。
10. 所有「完成」都由資料庫 read-back、產物、版本、收據與測試證據證明，不能由前端樂觀狀態或 mock 宣稱。

最終產品驗收句：

> Aios，把這個故事的第一幕做成可看的粗剪；人物與場景保持一致，30 點內，缺的聲音補上。完成後告訴我哪些地方仍需要我決定，以及哪些素材有商用風險。

## 2. 2026-08-14 的真實基線

### 已進 default

- #742：單一 Story workspace、chips 原地展開、真實生成／修正／交付入口。
- #743：Project Creative Context Phase 1，角色、CharacterLook、場景、道具、素材、知識與資料綁定。
- #744：rate-limit worker stdout JSON-only 的基礎修補。
- #745：Story workspace 簡化 UX 規格。
- #747：Global Assistant interaction recovery 規格。
- default HEAD：`a0bdacc1032651c62485472bbbc8ec7e3c28a141`。

### 已做在 stacked branches，但尚未收斂進 default

- #748：不可變 Shot Context Packets。
- #749：解析／分鏡／generationCommand 接線與 consistency evaluation。
- #750：一致性 dataset manifest、durable training jobs、model version Promote／rollback、Fal training adapter。
- #751：Story workspace 的 compact context/training UX。
- `agent/project-context-05-simple-ux` 相對 default：ahead 13、behind 4，狀態為 diverged；不得把「GitHub 顯示 merged」誤當成已進 default。

### 目前阻擋項

#749 有五個尚未解決的 review threads；在任何真實付費生成、adapter 訓練或對外宣稱一致性完成前必須全部修正並加入行為測試：

1. P1：所有 scene-bound 生成必須保留 current pointer，評估前不得 silent adopt。
2. P1：consistency preflight 必須在 reserve points／provider submit 前執行並能硬性拒絕。
3. P1：Shot Context Packet 必須在 submit 前同步 freeze，並把同一 payload 傳到 provider、trace 與 evaluation。
4. P2：batch／approval resume 必須使用原本凍結的 `shotContextPacketId`，不能在等待期間重新讀取已變動的 Shot。
5. P2：必要 scene preset 缺失必須阻止 adoption，不能只靠總分門檻通過。

### 並行與重疊 PR

- #726 仍 open，涉及 Creative Direction、Candidate/current、版本、成本、retry、continuity 與手機 compare；與 #748–#751 高度重疊，必須逐檔 reconciliation，不可整支盲合。
- #746 仍 open，只處理 CI worker IPC，可獨立驗證與合併；不得藉本計畫重寫 production rate-limit。
- 其他舊的 provider／dependency PR 必須先判定是否已被 default 取代，再決定關閉或 forward-port。

## 3. 不可破壞的不變式

### 單一真相來源

- 專案、角色、CharacterLook、ScenePreset、Prop、Asset、Knowledge、Database row、Shot、版本、Timeline、成本與 approval 均沿用現有資料模型。
- 不建立第二套角色庫、素材庫、故事狀態、selection store、Agent runtime、generation ledger、權限系統或 timeline。
- UI view model 只能投影 persisted state，不能成為另一份真相。

### 生成與一致性

- Freeze → preflight → cost/approval → provider → persist → evaluate → Candidate → explicit Adopt。
- Candidate 完成、訓練完成或評分及格都不能自行改 current／active model。
- 已核准 Shot、人的選擇與較新的 rev 不能被晚到的 provider callback 覆蓋。
- retry、reload、runner restart、multi-replica 與 approval resume 不重複扣點、不重複生成、不產生錯誤血緣。
- 只有受變更影響的 Shot／downstream media 被標 stale 或重新生成。

### 商用權利

- 不使用法院判決型功能，不把機器輸出寫成法律意見，不宣稱「保證合法」。
- 只做證據化的來源、授權、同意、模型條款與風險判定；結果為 `clear / needs_review / blocked / unknown`。
- 沒有證據就是 unknown，不得自動補成可商用。
- 內部團隊可以自行完成覆核；不依賴合作律師才能運作。
- 訓練、生成、外部分享與交付分別有 policy gate；權利不足時不能繞過。

### UX

- 不恢復舊四階段大導覽，不新增第二個專案管理頁。
- 預設只呈現「目前狀態、下一步、正在執行、需要決定」；模型、provider、fingerprint、lineage 與權利證據放 Advanced／details。
- 使用者不必理解 LoRA、adapter、packet 或 provider ID 才能完成主流程。

## 4. 完整能力閉環矩陣

每一列都必須同時具備：入口可達、後端真實執行、persisted read-back、權限／成本／核准一致、失敗可恢復、手機可用、可驗證證據。只有元件或 router 存在不算完成。

| 領域 | 現有真相／入口 | 必須補齊的閉環 |
| --- | --- | --- |
| Auth／團隊／專案 | auth、projects、members、groups | owner/editor/viewer、active/paused/archived、邀請、跨租戶拒絕與 audit 一致 |
| Story／世界觀 | StoryStage、story、worldview、Yjs | save/flush 衝突、parse、binding proposals、locked binding、reload 與版本一致 |
| 角色／造型 | characters、characterLooks | canonical ID、reference、同意／來源、Look 變更 impact、affected-shot regeneration |
| 場景／道具 | scenePresets、props | required preset／prop coverage、狀態版本、missing gate、跨鏡 continuity |
| 素材／知識／資料庫 | assets、knowledge、databases、dataHub | import → project bind → prompt budget → lineage → rights evidence；不把整庫送 provider |
| 分鏡／單鏡 | StoryboardStage、ShotCard、SceneStudio | packet freeze、version candidate/current、compare、adopt、refine、stale、read-back |
| 圖／影／聲音生成 | generationCommand、providers、animation/audio | model policy、preflight、cost、approval、bounded retry、storage/attach partial failure |
| 一致性訓練 | dataset manifest、training job、model version | dataset rights、去重、取消、callback 冪等、evaluation、Promote／rollback、provider kill switch |
| AI 助手 | global/project assistant、page context、action palette | 看懂 scope、列出讀取／工具／進度／阻擋、真實 action、SOURCE_PICKER 恢復、停止／重送 |
| Agent／Workflow／MCP | agent runner、workflow、MCP catalog | capability parity、ACL、approval、budget、idempotency、resume、receipt，不存在的工具不可宣稱 |
| 任務／筆記／排程 | tasks、notes、schedule、Planner | project linkage、assistant action、calendar/timezone、offline/failed sync、跨頁回到原處 |
| 協作 | collaboration、messages、decisions、presence | concurrent edit、mention、review/approval、presenter follow、版本衝突與通知不漏失 |
| 匯入／外部整合 | integrations、externalIntake、folderImport、Drive/URL/local | 連接 → 選檔 → 隔離掃描 → 匯入 → 專案 → provenance；blocked source 有真實替代動作 |
| 外部編輯／桌面 | externalEditing、Tauri/Capacitor bridge | assetId 安全交接、revision 回傳、來源保留、禁止任意 shell/path/token |
| Timeline／交付 | Animation Studio、timeline、DeliveryRoom、export/share | selected versions、聲音軌、stale/missing、rough cut、export job、share rights gate |
| 模型／成本 | models、quota、points、BYOK、provider health | 可用性、估點與實扣、退款、free-only/max-points、fallback 解釋、BYOK 邊界 |
| Admin／可觀測性 | Admin、audit、aiTrace、receipts、health | readiness 不假綠、worker lease、bounded retention、隱私化 log、可追蹤失敗 |
| 商用權利 | 新增於既有 Asset/Generation/Training/Export 邊界 | evidence、risk findings、policy decision、override reason、audit、expiry/recheck |

## 5. 執行 PR 序列

後續不得做成一支 mega runtime PR。每支 implementation PR 只處理一個主要邊界，可獨立回退；全部預設 Draft、禁止 auto-merge 與 force-push。

### FC-00 — Branch convergence 與 stop-ship 修復

Base：最新 default。

1. 建立新的 integration branch，不直接在舊 stacked branch 解衝突。
2. 逐提交 forward-port #748 → #749 → #750 → #751，先合併最新 default 的 #743/#745/#747 行為。
3. 逐檔對照 #726；保留較完整且已有真 PostgreSQL／browser evidence 的實作，拒絕重複 schema、重複 current pointer 規則與退化 router。
4. 修正 #749 五個 unresolved threads，加入能在移除保護時確實變紅的行為測試。
5. 確認 migrations `0071–0073` 的 ledger、既有資料 dry-run、唯一鍵、租戶歸屬與 forward-fix。
6. 不執行付費 provider；provider/live evidence 標示 external-blocked。

Exit gate：default 可接受的一支 clean integration Draft PR；無 unresolved P0/P1；Candidate/current、packet、preflight、batch resume 與 scene mismatch 測試全綠。

### FC-01 — Capability census 與 executable contract

1. 由 route registry、client pages、server routers、MCP catalog、workflow/agent step registry 自動產生 capability inventory。
2. 每項能力記錄 `declared / reachable / executable / persisted / recoverable / certified`，不得只有「有檔案」。
3. 建立跨入口 policy matrix 與 golden-flow harness；找出 dead shell、404、無 handler、只有文案、只有 mock 的功能。
4. 把已知 baseline failure 與本 PR 新增 failure 分開，不能以總測試數掩蓋。
5. CI 檢查 UI capability 不可指向不存在或禁止的 action。

Exit gate：repo 內有機器可讀 inventory、人工摘要與每項缺口的 owner PR；之後「所有功能完成」以此清單為準。

### FC-02 — Consistency command chain

1. 建立唯一 `GenerationCommandInput`：shotId、packetId、prompt intent、provider policy、cost policy、idempotency key、actor、source entry。
2. 對 direct、batch、agent、workflow、MCP、approval resume 做 table-driven parity test。
3. packet 在花費前 freeze；preflight fail 不 reserve、不 submit。
4. provider payload、trace、evaluation 與 lineage 引用相同 fingerprint。
5. Candidate/current、approved protection、CAS、人類優先、late callback、partial failure、retry/reload 全部以 PostgreSQL integration test 驗證。
6. identity、Look、scene、prop、style、camera、action、time/ambience 分維度評估；必要維度缺失為 hard issue，不能被平均分數沖淡。

Exit gate：Golden Consistency Set 在固定 seed/mock provider 下可重現；任何入口都不能繞過 packet/preflight/adopt。

### FC-03 — Dataset、訓練與商用權利 gate

1. 在既有 Asset lineage 上增加最小必要的 rights evidence／decision，不建立獨立素材庫。
2. Evidence 至少包含：來源 URL/檔案、取得方式、授權類型、授權範圍、作者／提供者、角色肖像／商標聲明、允許訓練與否、期限、證據快照 hash、最後檢查時間。
3. 可插拔 connector 只回傳可驗證證據；無資料時回 unknown。不得讓 LLM 單獨把素材判成合法。
4. Policy engine 產出 `clear / needs_review / blocked / unknown`、finding codes、理由、證據與允許動作。
5. Dataset manifest 只收入 `training_allowed=true` 且 project/tenant/consent 合格的 assets；manifest immutable、可追 exclusion reasons。
6. Training job 具 durable queue/lease、cancel、timeout、callback signature/idempotency、成本 approval、kill switch。
7. Model version 只有明確 Promote 改 active；rollback 保留 lineage。
8. 生成、分享、export 分別執行 rights gate；人工 override 需有權限、理由、範圍、期限與 audit。

Exit gate：無 evidence 的素材不會被誤標 clear；blocked 資料不能進訓練或商用交付；系統文案不宣稱法律保證。

### FC-04 — Story-to-delivery 真實垂直閉環

1. Story save/flush → parse/bind → storyboard → packet → image candidates → explicit adopt。
2. selected image → video；dialogue/narration/ambience/SFX/music 只補缺項。
3. current versions 投影到既有 Timeline；rough cut、preview、export、share 沿用既有管線。
4. provider success/storage fail、storage success/attach fail、某一 Shot fail、budget exhausted 都呈現 partial truth 並只重試必要步驟。
5. Delivery readiness 同時檢查 required tracks、stale assets、approval、rights decision 與 export job。

Exit gate：一句最終驗收句能完成到需要人的決定點；重新整理、關閉分頁與 runner restart 後可繼續。

### FC-05 — Agent、Database 與多入口功能平權

1. 助手的 capability registry 必須從真實 handlers/permissions 投影，不以靜態文案宣稱。
2. assistant reads 顯示來源摘要、資料時間與 scope；不揭露 private chain-of-thought。
3. assistant writes 經相同 command/policy layer，完成後 read-back 並回傳 receipt/change set。
4. Database/Knowledge/Notes/Tasks/Schedule 可在 project scope 查找、引用與建立關聯，但 provider payload 遵守最小化。
5. SOURCE_PICKER 使用 durable pending/submitted/cancelled/expired 狀態，stop/resend/clear/reconnect race-safe。
6. browser/computer runtime 不可停在 dead shell；不支援時回可操作的 local/Drive/URL 替代路徑。
7. conversation/run maps、SSE、AbortController、polling、events 都有 lifecycle/retention 上限。

Exit gate：Web/MCP/agent/workflow 對相同行為得到相同權限、成本、核准與 persisted result；助手能直接完成而非只建議。

### FC-06 — 匯入、整合與外部編輯 roundtrip

1. local file、URL、Drive/其他已連接來源走同一 Universal Intake contract。
2. 檔案類型、大小、malware/quarantine、SSRF/redirect、重複內容、tenant ownership、metadata 清理有 server gate。
3. imported asset 保留 source、license/evidence、hash、original/revision 及 project binding。
4. external editor 只交換 assetId/projectId/intent/returnPath；不得接受 executable、shell args、任意本機路徑或私人 token。
5. 回傳的新 revision 不 silent replace current；經 compare/adopt，downstream impact 可見。

Exit gate：選檔 → 匯入 → 加入專案 → 用於 Shot → 外部編輯 → 回傳 revision → adopt → export 全程 provenance 不斷。

### FC-07 — 簡單一致的全站 UX

1. Today 顯示單一下一步；Projects 顯示作品進度；AI 助手顯示當前 scope；More 只放低頻管理。
2. Project 首屏只保留故事、狀態、下一步與主 CTA；角色／場景／道具／造型／分鏡／製作／交付共用單一 reveal slot。
3. 結果優先：先看作品、問題與可修動作；設定、trace、model、rights evidence 按需展開。
4. loading/empty/error/forbidden/paused/archived/offline/partial/awaiting approval 都有一致語言與恢復動作。
5. 手機 390/430、平板 768、桌面 1280/1440 驗證；44px touch、focus restore、ARIA、reduced motion、keyboard、無橫向 overflow。
6. 任何 CTA 都必須對應真實 capability；圖片不得稱成已完成影片，training disabled 不得顯示可執行。

Exit gate：新使用者不需要理解後端概念即可完成主流程；專業使用者仍能追到 model/cost/lineage/rights。

### FC-08 — Reliability、Security、Cost 與 Operations

1. bounded concurrency、provider-aware rate limit、timeout/backoff/cancel、queue lease、graceful shutdown。
2. 多 replica 下 idempotency、quota、points、callback、job claim 與 refund 以真 PostgreSQL 驗證。
3. aggregate status/event invalidation 取代每卡無上限 polling；conversation/run/event retention 有清理策略。
4. readiness 檢查 DB schema、object storage、worker、required providers；optional provider 不使核心假死，required provider 不可假綠。
5. log/trace 不含 token、cookie、完整 prompt、私人 URL、個資或 provider secret。
6. SSRF、檔案匯入、webhook signature、cross-tenant ID、archived writes、approval bypass 有 security regression。
7. live deployment commit、migration ledger 與 runtime capability inventory 可對照；repo 綠不等於部署已更新。

Exit gate：failure injection、soak、restart、multi-replica、migration dry-run、backup/restore 與 deployment smoke 均有證據。

### FC-09 — Production certification 與 rollout

1. 對每一能力矩陣項目產生 `PASS / BLOCKED_BY_ENVIRONMENT / BLOCKED_BY_EXTERNAL_DEPENDENCY / FAIL / NOT_APPLICABLE`。
2. mock、local PostgreSQL、headed browser、真裝置、live provider 分開報告，禁止把 mock PASS 寫成 live PASS。
3. 以 feature flag/kill switch 漸進開啟 consistency training、rights enforcement、agent direct actions。
4. 建立 rollback、data forward-fix、provider disable、cost hard cap 與 incident runbook。
5. 兩輪 fresh-eye review：Creator flow；Failure/Concurrency/Security flow。

Exit gate：能力清單無未分類缺口；所有 P0/P1 關閉；核心 golden flows 有 production-like 證據；剩餘外部阻擋有明確 owner 與解除條件。

## 6. Golden flows

至少自動化以下流程；每個流程都要檢查資料庫 read-back、成本、權限、lineage、reload 與手機結果。

1. 故事 → 正確綁定角色／造型／場景／道具 → 分鏡。
2. 分鏡 → 三個真的不同的視覺方向 → Candidate，不改 current。
3. 明確 Adopt → current 改變；晚到 callback 不覆蓋。
4. 改 Look → 只標記與重生受影響 Shots。
5. 切回舊 image → downstream video stale。
6. approval 等待期間修改 Shot → resume 仍使用原 packet 或要求重新批准，不能混用。
7. preflight fail → provider 未呼叫、點數未保留。
8. required scene/prop/reference 缺失 → adoption blocked。
9. provider 429/5xx/timeout → partial result 保留、bounded retry、不重複扣點。
10. provider success + storage fail → 不 completed；安全重試 persist。
11. storage success + attach fail → 保留 asset，只重試 attach。
12. 人類並行編輯 → CAS/conflict，不覆蓋。
13. reload/tab close/runner restart → durable resume。
14. free-only/max-points → 不偷切付費 provider、不拆單繞門檻。
15. dataset 中含 unknown/blocked rights → 排除並顯示原因。
16. training succeeded → model 仍非 active；Promote 後才生效；rollback 可回復。
17. imported/external edited asset → provenance/revision/rights evidence 保留。
18. 只改旁白 → 不重生圖與影片；時間變長時只標 timing issue。
19. 補整幕聲音 → missing-only、無重複 audio generation。
20. 最終交付 → stale/missing/unapproved/rights-blocked 任一存在時不能假完成。
21. viewer/paused/archived/cross-tenant → 所有入口一致拒絕且不扣點。
22. assistant SOURCE_PICKER cancel/expire/resume → 不卡死、不重複提交。

## 7. 測試與證據

### 每支 PR 必跑

```bash
npm run typecheck
npm run check:boundaries
npm run check:hooks
npm run check:ui-primitives
npm test
npm run test:client
npm run build
```

依範圍追加：

```bash
npm run db:migrate:dry-run
npm run db:check
npm run verify:database-runtime
npm run verify:agent-db-integrity
npm run scan:agent-integrity
npm run test:ui:routes
bash scripts/run-e2e-local.sh
npm run desktop:check
npm run desktop:test
npm run audit:high
```

### 證據規則

- PostgreSQL 行為不可只用 source-grep 或 mock repository 宣稱。
- Candidate/current、成本、核准、callback、lease、migration 必須有真 PostgreSQL integration evidence。
- 主要 UX 必須有真 browser interaction，不以靜態 DOM snapshot 取代。
- 390/430/768/1280/1440 保存截圖與 measurements。
- provider 無 key／無額度／未允許付費時標示 external-blocked，不讀取、複製或輸出秘密。
- baseline failure 要在同一 base SHA 重現；introduced failure 必須修復。
- 測試必須有 mutation proof：移除關鍵 guard 時至少一項會紅。

## 8. PR 治理與不衝突規則

1. 開始前讀 default、所有 applicable `AGENTS.md`、本文件、#726、#746 與 #748–#751 最終 diff/review。
2. 先 `git status -sb`、`git remote -v`、`git fetch --all --prune`；dirty worktree 使用獨立 worktree，不 stash/reset 使用者工作。
3. 一支 PR 一個主要架構邊界；跨邊界必須寫依賴、回退與不在範圍。
4. 不把 docs plan branch 直接長成 mega implementation branch。
5. 所有功能寫入都檢查 Web/tRPC、REST、MCP、workflow、agent、approval resume、schedule/background。
6. schema additive first；先 nullable/backfill/validate，再 constraint；不得在 request path 偷跑 migration。
7. 不 auto-merge、不 force-push、不以關閉 review thread 取代修正與測試。
8. 不在沒有使用者明確授權時呼叫付費 generation/training provider。

## 9. 明確非目標

- 不重寫整站或更換 React/Express/tRPC/Drizzle/PostgreSQL 架構。
- 不建立另一套 Agent framework、LangGraph/CrewAI runtime 或第二資料庫。
- 不把專案頁改成預設節點圖、無限畫布或完整 NLE。
- 不為了「所有功能」重做已通過的 #731–#745 導覽與 Story workspace。
- 不宣稱像素級一致性；沒有 reference input 的模型只能標示 prompt/reference policy 能力。
- 不宣稱素材百分之百不侵權，也不產生法院判決式結論。
- 不把未連接、未授權或不存在的外部 API/MCP 顯示成可用。

## 10. 全案完成定義

只有同時符合以下條件，才可稱「一致性與所有功能已補齊」：

- capability inventory 的核心項目全部達到 certified，非核心項目至少有明確狀態與 owner。
- #748–#751 已安全收斂進 default，#749 五個阻擋項與 #726 重疊已解決。
- Story → Storyboard → Image → Video/Audio → Timeline → Delivery 是真實 persisted vertical slice。
- Candidate/current、packet、preflight、evaluation、training Promote、rights gate 不能被任何入口繞過。
- Agent 不只會說明，能在權限與核准內執行、恢復、read-back 並提供 receipt。
- 390px 手機與桌面主流程均可用、可存取、無重複入口與假 CTA。
- provider、storage、DB、network、callback、concurrency、reload 失敗時不假完成、不重複扣點、不覆蓋人的工作。
- live deployment SHA、schema、worker、provider readiness 與功能清單一致。
- 交付報告誠實區分 mock/local/live/external-blocked，沒有未分類 P0/P1。

## 11. 給實作代理的最短指令

> 執行本 PR 的 Aios 一致性與全功能閉環總計畫。先完成 FC-00，從最新 default 建新的 integration branch，逐提交收斂 #748–#751，處理 #749 全部 unresolved review threads，並逐檔 reconciliation #726；不要盲合。每支後續 PR 只做一個 FC 階段、保持 Draft、不 auto-merge、不 force-push、不建立第二套真相、不呼叫未授權付費 provider。持續做到該階段 Exit gate，附真 PostgreSQL、browser、mobile 與 failure-injection 證據；環境或外部服務無法驗證時誠實標示 blocker。
