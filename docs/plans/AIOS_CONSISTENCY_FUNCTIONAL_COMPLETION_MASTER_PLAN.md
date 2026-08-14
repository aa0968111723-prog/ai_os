# Aios 腳本專案全分鏡一致性與全功能閉環總計畫

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

> Aios，把這個故事的第一幕做成可看的粗剪；同一批人物在山嵐、海灘、街頭與安老院的每個分鏡都要保持身份、造型、場景狀態、道具與畫風一致，30 點內，缺的聲音補上。完成後告訴我哪些地方仍需要我決定，以及哪些素材有商用風險。

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

## 4. 腳本專案一致性生產系統（全案核心）

本計畫的最終目的不是做一個「一致性功能」，而是讓一份腳本在被拆成幾十個場景、分鏡與圖影音素材後，仍然像同一部作品。

UI/UX、資料庫、Shot Context Packet、生成模型、素材庫與訓練都必須服務同一份 **Project Consistency Graph**：

```text
腳本／世界規則
→ canonical 角色、造型、場景、道具、風格與聲音
→ 每段劇情綁定 canonical IDs
→ 每個 Shot 凍結完整 Context Packet
→ 圖／影／聲音 provider 使用同一份約束
→ 生成結果以相同約束評估
→ Candidate 比較與人類 Adopt
→ downstream continuity 與 affected-shot 更新
→ Timeline／交付仍能追到同一份腳本與素材血緣
```

### 4.1 「一致」在腳本專案中的定義

一致性不是每張圖長得一模一樣，而是該維持的部分穩定、腳本要求改變的部分可以明確改變：

| 維度 | 必須保持 | 允許改變的條件 |
| --- | --- | --- |
| 人物身份 | 臉部特徵、年齡感、身形、髮型核心特徵、角色 ID | 腳本明確成長、受傷、變身或時間跳躍 |
| 人物造型 | 當前 CharacterLook、服裝、配件、色彩、標誌性物件 | 換裝事件或新 Look 被明確採用 |
| 場景身份 | location/preset、空間語彙、建築與地理特徵 | 劇情換場、場景狀態版本改變 |
| 時空狀態 | 時段、天氣、季節、光線方向、前後鏡連續性 | 劇情註明時間經過或天候轉變 |
| 道具 | 所有者、外觀、手持位置、損壞／使用狀態 | 劇情中的取得、交接、遺失、破損 |
| 視覺風格 | 畫風、palette、質感、鏡頭語言、長寬比 | 使用者明確建立新的章節／序列風格 |
| 動作連續 | 人物位置、朝向、進出畫、動作開始／結束狀態 | 鏡頭省略、轉場或腳本明確跳接 |
| 聲音身份 | 角色聲線、語速基線、口音、環境聲世界 | 情緒表演、場景切換或劇情需求 |
| 故事事實 | 人物關係、目標、已知資訊、世界規則 | 腳本 revision 經確認後更新 |

系統必須同時避免兩種錯誤：

- **漂移**：同一角色跨鏡變臉、服裝亂換、場景忽然換建築、道具憑空消失。
- **過度鎖死**：腳本明明要求換裝、下雨、夜晚或情緒轉折，卻因一致性鎖定而無法改變。

### 4.2 Project Consistency Graph

不要把所有內容壓成一段超長 prompt。資料庫以 canonical nodes + versioned edges 表達整部作品：

**Nodes**

- Story / Act / Sequence / Scene / Shot
- Character / CharacterLook / voice profile
- ScenePreset / environment state
- Prop / prop state / ownership
- Asset / approved reference / candidate / current version
- Style profile / palette / camera language / sound world
- Knowledge / structured data / rights evidence
- Active consistency model version（若有）

**Edges**

- Story mention → canonical entity binding
- Character → active Look in a Scene/Shot
- Character/Scene/Prop → approved reference assets
- Shot → required characters/looks/scene/props/style
- Shot → previous/next continuity state
- Generation → exact frozen packet/model/provider/source assets
- Candidate → parent/current/derived assets
- Timeline item → selected Shot asset version
- Training manifest/model → included approved assets and rights decision

Graph 以既有 tables 與 additive mapping/packet structures 實作；不得另建一套脫離現有 records 的「AI 記憶資料庫」。

### 4.3 腳本解析不是只抽文字，而是建立可確認的綁定

腳本進站後必須依序：

1. 切分 Act / Sequence / Scene / Shot intent，保留原始 script revision 與文字範圍。
2. 抽取人物、造型提示、場景、時段、天氣、道具、動作、情緒、對白、聲音與畫風要求。
3. 將名稱／別名／代稱解析到 project canonical IDs。
4. 高信心且唯一的結果可建立 proposal；模糊或衝突項目顯示「需要確認」。
5. 使用者確認／鎖定後，重跑 parse 不得覆蓋 locked binding。
6. 每個 Scene/Shot 都能回溯到使用的 script revision、text range 與 binding decision。

原始名稱不能直接成為生成唯一依據。例如同名角色、同一角色多套服裝、同一地點不同時段，都必須先解析成明確 ID/version/state。

### 4.4 每個 Shot 的完整 Context Packet

每個分鏡在生成前凍結不可變 packet。它不是只有 prompt，而是該鏡頭的完整製作合約：

```text
ShotContextPacket
├─ projectId / storyRevision / sceneId / shotId / fingerprint
├─ narrative: script range, goal, action, emotion, dialogue
├─ characters[]: canonical ID, Look ID, identity refs, pose/state
├─ scene: preset ID, environment state, time, weather, lighting
├─ props[]: canonical ID, owner, state, required refs
├─ style: project/sequence style, palette, aspect ratio, camera rules
├─ continuity: previous end-state, this start/end-state, next constraints
├─ sound: voice IDs, ambience, music/SFX intent
├─ references[]: asset ID, role, priority, crop/region, rights state
├─ modelPolicy: required capabilities, active adapter, fallback limits
├─ negativeConstraints: forbidden drift/conflicts
└─ rights/cost/approval snapshot
```

Packet 必須在扣點與 provider submit 前同步 freeze。等待核准、排隊、重試與 callback 都使用同一個 packet ID；若使用者修改 canonical 資料，舊 packet 仍代表當時的歷史，新狀態只會使相依 Shot stale。

### 4.5 混合人物、場景與素材的規則

同一鏡通常會混合人物定裝圖、場景照片、道具圖、風格圖、前一鏡畫面與構圖參考。系統不能把全部圖片無差別塞給模型：

| Reference role | 只負責 | 不得覆蓋 |
| --- | --- | --- |
| `identity` | 臉、身形、角色辨識 | 服裝、場景、構圖 |
| `look` | 當鏡服裝、配件、髮妝狀態 | 角色身份、場景 |
| `scene` | 空間、建築、地理、環境狀態 | 人物身份、服裝 |
| `prop` | 道具外觀與狀態 | 人物或場景風格 |
| `style` | palette、媒材、光影、整體畫風 | canonical identity/scene facts |
| `composition` | 鏡位、景別、位置關係 | 角色與物件身份 |
| `continuity` | 前一鏡可見狀態 | 本鏡腳本明確要求的變更 |

必要規則：

- 每份 reference 有 canonical owner、role、priority、approved/current、quality 與 rights state。
- identity 與 Look 分開；換衣服不能順便換臉，換表情不能順便換服裝。
- 兩份素材若在人數、服裝、場景或風格上衝突，preflight 必須提示或阻擋，不能交給模型隨機平均。
- provider 必須真的支援需要的 reference input／adapter 能力；不支援時不得假裝已鎖定。
- Prompt compiler 依 provider capability 轉換同一 packet，但不能重新發明另一份上下文。
- 任何自動裁切、去背、合成或外部編輯產物都保留 parent asset lineage。

### 4.6 圖片、影片與聲音共享同一個世界

一致性不能只停在分鏡圖：

- **圖片生成**：使用人物 identity/Look、ScenePreset、Prop、Style 與 continuity refs。
- **影片生成**：必須以被採用的 image/current version 或明確 reference 為 parent，保留人物、場景與動作起迄；不能拿未採用 candidate 偷生成影片。
- **配音**：對白綁定 character voice ID、語言、聲線與情緒，不因換 provider 漂移成另一個人。
- **環境音／音效／配樂**：綁 Scene/Sequence sound world，跨鏡延續 span，不每鏡重新隨機生成。
- **Timeline／粗剪**：只使用各 Shot 的 selected current versions；任何 parent 改變要標記 downstream stale。
- **交付**：檢查缺漏、stale、未採用 candidate、未核准、rights blocker 與聲畫不同步。

### 4.7 生成後評估與採用

每個 output 必須對原 packet 評估，而不是只判斷「圖片好不好看」：

- identity match
- Look/costume match
- scene/location/state match
- prop presence/ownership/state
- style/palette/camera match
- action/composition intent
- previous/next continuity
- dialogue/voice/audio match（適用時）
- required reference coverage
- safety/rights/technical validity

必要人物、Look、ScenePreset 或 Prop 缺失是 hard issue，不能被其他高分平均掉。評估輸出 findings、dimension scores 與 repair suggestions，但即使全部通過也只產生 Candidate；只有使用者明確 Adopt 才改 current。

### 4.8 跨鏡頭 continuity state

每個 Shot 除了靜態設定，還要保存 start/end state：

- 人物位置、朝向、姿勢、表情、傷勢、濕／乾、髒污程度
- 目前 CharacterLook 與配件
- 手上／場內道具、所有者與狀態
- 場景時段、天氣、光向、群眾與可見背景
- 動作在鏡頭開始與結束時的階段
- dialogue/narration/music/ambience 的時間連續

下一鏡繼承前一鏡 end state，再套用腳本明確 delta。若 Scene 切換、蒙太奇或時間跳躍，必須用 transition type 解釋哪些狀態不需延續，不能一律硬接或一律重置。

### 4.9 變更後只更新受影響內容

依賴圖決定 stale 範圍：

- 改 Character identity → 該角色出現的 image/video Shots。
- 改一個 Look → 只影響使用該 Look 的 Shots。
- 改 ScenePreset/time/weather → 只影響該場景與依賴它的 downstream media。
- 改 Prop state → 只影響需要該狀態的 Shot range。
- 改 Style profile → 影響其 scope 內尚未鎖定或經使用者確認要更新的 Shots。
- 改旁白文字 → voice/timing/captions，不能重生人物與場景。
- 切換 current image → 以其他 parent 生成的 video/timeline item 變 stale。

UI 先告知「影響 6 鏡、預估成本、哪些已核准」，由使用者選擇全部或部分更新。系統生成新 Candidates，保留舊 current 與所有版本。

### 4.10 訓練的角色：加強，不是取代資料治理

一致性訓練只有在以下條件成立時才出現：

- 足夠多已核准且身份一致的角色／專案素材。
- dataset rights 與 training consent 可驗證。
- 資料已去除錯角、錯 Look、低品質、重複與衝突樣本。
- provider 真的配置，且使用者明確允許付費訓練。

訓練產生 candidate adapter/model version；評估通過仍需 Promote。即使有 adapter，Shot 仍需要 canonical IDs、Look、ScenePreset、Prop、packet、reference roles 與 explicit Adopt。訓練不能掩蓋錯誤綁定或混亂素材。

### 4.11 使用者實際感受到的幫助

預設 UX 不顯示 graph、fingerprint 或 adapter 細節，而是：

- 寫完腳本後顯示「已辨識 7 位人物、5 個場景、3 項需要確認」。
- 生成前顯示「人物與場景已套用」，必要時只問缺少的 Look／場景狀態。
- 分鏡上顯示「一致」「需確認」「2 項漂移」「受角色換裝影響」。
- 點問題直接看到受影響 Shots、原因、reference 對照與「只重做這些鏡頭」。
- 每次生成後先看 Candidates 的人物／場景／道具差異，再採用。
- Assistant 可回答「為什麼第 8 鏡人物不一致？」並從 packet、references、evaluation 與 lineage 給出可執行修復。
- 交付前回答「哪些鏡頭仍不一致、缺素材或有商用風險」。

使用者只需要管理故事與必要決定，深層資料綁定、傳遞、評估與影響計算由系統完成。

### 4.12 本腳本專案的端到端驗收情境

以同一冒險團隊依序經過山嵐、淺水灣海灘、街頭、仁濟安老院與音樂挑戰為例：

1. 團隊每位角色先建立 canonical identity、目前 Look、聲線與 approved references。
2. 山嵐、淺水灣、街頭、安老院分別建立 ScenePreset；同地點的早晚／晴雨是 environment state，不複製成無關場景。
3. 藏寶圖、愛心、清潔工具、樂器等建立 Prop 與劇情狀態／所有權。
4. Script parser 將每次出場、換裝、地點、道具交接、情緒與對白綁到 IDs。
5. 每個 Shot packet 繼承團隊畫風與前一鏡 continuity，只套用本鏡的鏡位、動作與劇情 delta。
6. 團體鏡、雙人鏡、單人特寫即使混用不同人物 reference，也必須維持各自身份與 Look，不互相污染。
7. 場景從海灘切到街頭時可以換環境，但人物不能變臉；下雨時可變濕，下一鏡仍要延續濕衣狀態，除非腳本跳時。
8. 某位角色定裝更新後，系統只標記該角色使用舊 Look 的 Shots，不重做沒有他的鏡頭。
9. 多模型產生的圖、影片與聲音都記錄相同 packet/lineage；能力不足的模型不得被選為需要強 reference lock 的任務。
10. 最終 Storyboard、Timeline 與 Delivery 能逐鏡顯示使用的人物、Look、場景、道具、current asset、consistency findings 與修復狀態。

通過標準：不看 prompt，只看整套分鏡與粗剪，觀眾仍能辨認這是同一批人物在同一個世界中完成連續冒險，而不是每一鏡重新抽卡。

### 4.13 腳本一致性實作切片

- **SCRIPT-C0：Consistency Graph projection** — 盤點 canonical nodes/edges，建立 project/scene/shot dependency projection，不新增第二真相。
- **SCRIPT-C1：Script binding closure** — script range → canonical IDs → proposal/confirm/lock → Shot materialization。
- **SCRIPT-C2：Full Shot Packet compiler** — 人物/Look/場景/道具/style/continuity/sound/reference roles 的 deterministic fingerprint。
- **SCRIPT-C3：Provider-aware reference mixing** — capability gate、role/priority、conflict preflight、同 packet 多 provider compiler。
- **SCRIPT-C4：Cross-shot continuity** — start/end state、transition delta、sequence propagation 與 targeted stale。
- **SCRIPT-C5：Evaluation and repair loop** — hard issues、Candidate compare、explicit Adopt、affected-shot regeneration。
- **SCRIPT-C6：Image → Video/Audio → Timeline closure** — parent lineage、current-only assembly、downstream stale 與 delivery readiness。

依賴：FC-00 → SCRIPT-C0 → C1 → C2 → C3/C4 → C5 → C6。UI-DB-C0 應與 SCRIPT-C0 共用 projection contract，但各 PR 仍保持單一責任與可回退。

## 5. UI/UX × 資料庫 × 一致性整合核心

這三層不得分開實作。UI 不能自己猜完成度；資料庫不能只有資料卻沒有可操作的狀態；一致性引擎不能只產生分數卻無法在創作流程中被看見、修正與恢復。

### 5.1 唯一閉環

```text
既有 project-scoped records
→ server-side workspace projection
→ Story workspace 顯示狀態／缺口／下一步
→ 使用者確認或執行動作
→ 共用 command + policy + transaction
→ persisted result / event / receipt
→ query invalidation 或既有 event stream
→ 重新讀取 workspace projection
```

禁止以下捷徑：

- Client 依「按過按鈕」或本地 state 顯示完成。
- UI 自行用不同公式計算 ready、coverage 或 consistency。
- Agent/MCP 直接寫表而略過 command/policy layer。
- 生成 callback 只更新畫面，不更新 persisted candidate、lineage、evaluation 與 receipt。
- 為了 dashboard 再建一組可變的統計真相表；優先使用可重算 projection，必要 cache 必須可失效與重建。

### 5.2 資料庫真相與讀取投影

沿用現有 `projects`、故事/Yjs、characters、characterLooks、scenePresets、props、assets、knowledge、data_files/data_rows、scenes、generations、sceneVersions、timeline、agent/workflow、points/quota、#743 creative context 與 #748–#750 packet/training 結構。

新增或抽出的 server read model 建議命名為 `ProjectCreativeWorkspaceProjection`（實作前以 CURRENT repo 命名慣例校正），它是查詢投影，不是第二資料庫。至少包含：

| 投影區塊 | 必要欄位 | UI 用途 |
| --- | --- | --- |
| `revision` | project/story/context revision、generatedAt | 防止舊回應蓋新畫面，顯示資料時間 |
| `worldReadiness` | required/ready/missing entities | 世界觀是否可解析，不與素材覆蓋率混算 |
| `visualCoverage` | 每角色/Look/場景/道具 reference coverage | 0 張視覺素材必須是 0，不可顯示高完成度 |
| `generationReadiness` | blocking/warning issues、provider/cost/approval | 主 CTA 是否可執行與為何被擋 |
| `consistencyHealth` | healthy/stale/needs_review/blocked + affected shot IDs | 只修受影響鏡頭 |
| `storyBindings` | confirmed/proposed/locked/unresolved | chips 狀態與需要確認數量 |
| `shotStates` | packet/current/candidates/stale/evaluation/approval | 分鏡卡、比較、Adopt 與局部重生 |
| `activeRuns` | generation/training/export phase、progress、retryable | reload 後恢復真實進度 |
| `dataReadiness` | parsing/OCR/AI-readable/failed/project-bound | 資料是否真的能被 AI 引用 |
| `rightsReadiness` | clear/needs_review/blocked/unknown | training、share、export gate |
| `nextActions` | capability key、target IDs、blocked reason、cost preview | 單一下一步與 Action Palette |

投影必須：

- 由 server 根據 actor capability 與 project state 過濾，viewer 不取得可寫 action。
- 使用同一套 pure projection/helper 供 Project UI、Assistant、MCP read 與 Delivery 使用。
- 對大量 Shots 使用 aggregate/batch query，禁止每張卡各打一串 N+1 查詢。
- 支援 reload、deep link、mobile sheet 與 reconnect；selection 可以是 view state，但 active target/run 必須 durable。
- 回傳穩定 finding/action codes；自然語言由共用 mapping 產生，避免每頁不同說法。

### 5.3 三種完成度必須分開

首屏不得再用一個百分比掩蓋不同問題：

1. **世界觀完整度**：角色、場景、道具、故事設定與必要欄位是否存在。
2. **視覺素材覆蓋率**：逐角色/Look/場景/道具是否有合格 reference；以 entity coverage 計算，不以檔案總數灌高。
3. **生成準備度**：binding、packet、provider、成本、核准、權利與必要輸入是否可執行。

一致性健康度另外顯示，不混入完成度：

- `已套用`：目前 Shot 與 project records/packet 一致。
- `X 鏡需更新`：資料改變造成 targeted stale。
- `X 項待確認`：binding proposal、低信心評估或 rights needs_review。
- `已阻擋`：缺必要場景/reference、權利 blocked、preflight fail 或 project state 禁止。

### 5.4 UI 狀態與資料動作必須一對一

| 使用者看到的狀態 | 資料庫／引擎真相 | 唯一主要動作 |
| --- | --- | --- |
| 尚未加入資料 | project-scoped readable source = 0 | 加入資料 |
| 資料解析中 | durable intake job running | 查看進度／取消 |
| 需要 OCR／解析失敗 | source status + retry reason | 修復或改用其他來源 |
| 有 X 項需要確認 | unresolved binding proposals | 逐項確認／鎖定 |
| 已準備生成 | preflight pass + cost/approval known | 生成畫面／影片 |
| 正在生成 | durable run + per-target phases | 查看進度／停止 |
| 部分完成 | persisted successes + retryable failures | 只重試失敗項 |
| X 鏡一致性過時 | dependency impact set | 檢視影響／只更新 X 鏡 |
| 有候選版本 | candidate exists、current unchanged | 比較並採用 |
| 可加強角色一致性 | dataset eligible + provider configured + paid authorization | 建立訓練候選 |
| 訓練完成待採用 | model version succeeded、not active | 比較／Promote |
| 可交付 | Delivery readiness 全部通過 | 預覽／匯出 |
| 交付被擋 | stale/missing/unapproved/rights finding | 修復列出的阻擋項 |

任何狀態都不得只有提示文字；必須有可達的 action，或明確說明誰有權限、缺少哪個外部依賴。

### 5.5 專案頁的簡單資訊架構

維持 #742 的單一 Story workspace 與唯一 reveal slot：

1. **首屏狀態列**：世界觀、視覺素材、生成準備、一致性四個短狀態；不顯示技術術語。
2. **單一主 CTA**：由 `nextActions` 與 capability/policy 決定，不由 component 自行判斷。
3. **Story chips**：角色、造型、場景、道具、素材、知識、分鏡、製作、交付；badge 直接來自 projection。
4. **Reveal slot**：顯示既有真實元件；切換 chip 取代同一 slot，手機用 sheet/drawer 深修。
5. **結果／問題優先**：生成後先顯示 current、candidates、affected shots 與可修動作，再展開 trace/model/packet。
6. **Assistant scope**：永遠顯示目前 project、scene/shot selection、budget policy；執行後以 read-back 更新同一畫面。

### 5.6 一致性變更的 UI 行為

以「修改角色 Look」為代表流程：

1. 使用者在既有 CharacterLook 卡確認新造型。
2. command 以 rev/CAS 更新 canonical Look，記錄 actor、reason、source references。
3. server 依 packet dependencies 計算 affected Shot IDs，不立即重生、不修改 current。
4. projection 回傳「6 鏡需更新」與精準 Shot 清單。
5. 首屏與分鏡 chips 顯示 badge；打開後只列 affected shots、impact reason 與預估成本。
6. 使用者選擇全部或部分 Shot 執行；每鏡先 freeze 新 packet、preflight、cost/approval，再生成 Candidate。
7. 成功與失敗分開保存；current 仍不變。
8. 使用者 compare/adopt 後，projection 重算 downstream video/timeline stale 狀態。
9. reload 後 badge、candidates、current、失敗重試與成本 receipt 必須相同。

場景、道具、reference、故事 binding、active adapter、rights decision 的變更都使用同一 impact → review → regenerate candidate → adopt 模式。

### 5.7 資料匯入到生成的可見生命週期

外部連接成功不等於 AI 可使用。UI 與資料庫必須共同呈現：

```text
已選來源
→ 已取得／隔離掃描
→ 解析中
→ 需要 OCR 或解析失敗（可恢復）
→ AI 可讀
→ 已連到專案
→ 已被哪個 entity/Shot 引用
→ 已凍結進哪個 packet／generation
```

- `data_files.text_content` 等既有欄位繼續作為 AI 讀取真相；project-scoped projection 只做關聯與狀態彙整。
- Prompt 只取與當前 Story/Shot 有關、已授權且 AI-readable 的片段；UI 可展開 citation/source。
- 刪除、替換或失效的來源要計算受影響 bindings/packets，不能只把卡片從畫面移除。

### 5.8 整合實作切片

為避免又變成大型 UI PR，將三層整合切成以下可驗證的小 PR：

- **UI-DB-C0：Projection contract** — pure types/helpers、aggregate query、capability-filtered `nextActions`；不改頁面布局。
- **UI-DB-C1：First-screen truth** — Story status bar、三種完成度、badge 與單一 CTA 全部讀 projection。
- **UI-DB-C2：Consistency impact loop** — Look/scene/prop/binding 變更 → affected shots → targeted action → Candidate/adopt/read-back。
- **UI-DB-C3：Durable runs** — generation/training/import/export 的 reload/resume/partial/retry 狀態接入同一 projection。
- **UI-DB-C4：Data and rights readiness** — AI-readable、citation、training eligibility、share/export blockers 接入 chips 與 Delivery。
- **UI-DB-C5：Mobile and accessibility closure** — 390/430 sheet、focus/scroll restore、44px、keyboard/ARIA、錯誤恢復。

依賴：FC-00 完成後才能進 UI-DB-C0；C0 → C1 → C2；C3/C4 可在 C2 後分開開 Draft，C5 最後收斂。不得直接在 #752 docs branch 實作 runtime。

### 5.9 成對驗收證據

每個 UI 行為都必須有對應 DB 證據：

- Client test：畫面正確顯示 server projection，不自己重算。
- PostgreSQL test：真實 records/transactions 產生正確 projection、impact set、candidate/current 與 durable run。
- Browser flow：使用者操作 → API/command → reload → 相同狀態。
- Mutation proof：移除 preflight、CAS、explicit adopt、project filter 或 projection finding 時至少一項會紅。
- Performance：大量 Shot 使用 aggregate query，記錄 query count、payload size 與 idle polling。

UI-DB 整合的完成標準不是「畫面做好」，而是：

> 畫面上的每個狀態都能追到資料庫；每個動作都能追到 command、transaction、event 與 receipt；重新整理後仍一致。

## 6. 完整能力閉環矩陣

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

## 7. 執行 PR 序列

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

## 8. Golden flows

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

## 9. 測試與證據

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

## 10. PR 治理與不衝突規則

1. 開始前讀 default、所有 applicable `AGENTS.md`、本文件、#726、#746 與 #748–#751 最終 diff/review。
2. 先 `git status -sb`、`git remote -v`、`git fetch --all --prune`；dirty worktree 使用獨立 worktree，不 stash/reset 使用者工作。
3. 一支 PR 一個主要架構邊界；跨邊界必須寫依賴、回退與不在範圍。
4. 不把 docs plan branch 直接長成 mega implementation branch。
5. 所有功能寫入都檢查 Web/tRPC、REST、MCP、workflow、agent、approval resume、schedule/background。
6. schema additive first；先 nullable/backfill/validate，再 constraint；不得在 request path 偷跑 migration。
7. 不 auto-merge、不 force-push、不以關閉 review thread 取代修正與測試。
8. 不在沒有使用者明確授權時呼叫付費 generation/training provider。

## 11. 明確非目標

- 不重寫整站或更換 React/Express/tRPC/Drizzle/PostgreSQL 架構。
- 不建立另一套 Agent framework、LangGraph/CrewAI runtime 或第二資料庫。
- 不把專案頁改成預設節點圖、無限畫布或完整 NLE。
- 不為了「所有功能」重做已通過的 #731–#745 導覽與 Story workspace。
- 不宣稱像素級一致性；沒有 reference input 的模型只能標示 prompt/reference policy 能力。
- 不宣稱素材百分之百不侵權，也不產生法院判決式結論。
- 不把未連接、未授權或不存在的外部 API/MCP 顯示成可用。

## 12. 全案完成定義

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

## 13. 給實作代理的最短指令

> 執行本 PR 的 Aios 腳本專案全分鏡一致性與全功能閉環總計畫。先完成 FC-00，從最新 default 建新的 integration branch，逐提交收斂 #748–#751，處理 #749 全部 unresolved review threads，並逐檔 reconciliation #726；不要盲合。FC-00 後以 SCRIPT-C0→C6 為產品主線，讓腳本中的人物、Look、場景、道具、畫風、聲音與 continuity 經同一 Project Consistency Graph、Shot Context Packet、reference mixing、evaluation、Candidate/Adopt 與 downstream lineage 貫穿所有分鏡、圖片、影片、聲音、Timeline 和交付；UI-DB-C0～C5 只負責把這份真相簡單呈現與操作。每支後續 PR 保持 Draft、不 auto-merge、不 force-push、不建立第二套真相、不呼叫未授權付費 provider，持續做到該階段 Exit gate，附真 PostgreSQL、browser、mobile 與 failure-injection 證據；環境或外部服務無法驗證時誠實標示 blocker。
