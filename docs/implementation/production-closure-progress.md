# Production Consistency Closure — 進度帳本

Task source: PR #760（`docs/plans/AIOS_PRODUCTION_CONSISTENCY_CLOSURE_MASTER_PLAN.md`）
Baseline: FC-00 已完成（#762 merged）——default 自此真正包含 #756–#759 全部能力。

## FC-00 — Stack landing reconciliation（已完成，#762）

- [x] 核對：#757–#759 的 stacked squash 逐層慢一拍，B/C/D 內容未達 default
- [x] 以原 PR-D head（45192def，唯一完整 ref）merge 進 default 候選分支
- [x] 內容完整性：vs 45192def 僅差 #755 docs；衝突 5 檔全為 squash 假衝突（default 側＝子集）
- [x] 驗證：typecheck 0 錯；server 3005 passed；client 1875 passed；三 gates PASS；CI 全綠
- [x] #762 merged into default

## Closure PR-A — Execution rights + Style/Voice/Sound runtime

Branch: `agent/closure-pr-a`（base＝最新 default，含 #761–#766）

- [x] §3 P0 — approval resume execution-rights revalidation
  - `server/services/executionRights.ts`：packet canon 依賴收集＋此刻重驗
    （canon 存在／未封存／generationAllowed／reuseScope／版本未封存／專案狀態機／送出者組資格）
  - `generation.decideCost`：CAS 認領後、扣點前重驗；失效→failed＋error 全文＋
    structured blockers＋trace event，不扣點不呼叫 provider
  - `generationCommand` packet 重用路徑（batch／agent resume）：同一重驗，失效擋下
  - `generation.retry` 重新凍結 packet（rights 自然重驗）——原行為已正確，不動
- [x] §4 P0 — Style Canon 真 runtime 消費
  - `canon.createProjectCanon`／`addProjectCanonVersion`（style／voice／sound_world；
    無本地卡，pin 直讀；名稱冪等；並行 race 冪等）
  - packet build：pinned style canon → `worldStyle`（取代 worldview 即時值＝single truth）
    ＋`negativeConstraints` 附加 canon 負向語彙＋style-role references（rights-ready 才進）
    ＋`styleCanon` 條件欄位（歷史指紋穩定）
  - generationCore：有 packet 時 worldview styles/taboos 以凍結值為準（真的流進 provider prompt）
  - scene package：`style`＝pinned canon styles ?? worldview
- [x] §5 P0 — Voice Canon durable identity
  - descriptor：{provider, modelId, voiceId, language, role: character|narration, characterId}
  - `shared/voiceRouting.ts`：voice 參數真實支援表（kokoro／qwen×2／vibevoice×2／
    elevenlabs-dialogue）＋`applyVoiceIdentity`＋`routeSpeechVoice`（單說話者→角色聲線；
    其他→旁白預設＋unrouted 誠實回報；不假裝多聲道）
  - `scenes.generateVoiceover`：聲線 canon 決定 voice（模型未明示時連 modelId 一起帶）；
    generationCore 套參數；不支援模型→`voice_identity_unsupported` warning（不假裝）
  - packet：characterSlots 掛 voice 欄位＋`narrationVoice` 條件欄位；meta.voice 落 lineage
- [x] §6 P0 — Sound World
  - scene package `soundWorld` 凍結 canon identity（canonId／version／music；條件欄位）
  - `scenes.generateAmbience`：prompt＝世界聲音語彙＋鏡描述；meta.soundWorld 落 lineage
- [x] §8（本 PR 份）targeted stale：packet／scene package 依賴圖新增 `canon:<id>` 鍵；
  `applyCanonUpgrade`／`canonUpgradeImpact` 支援 project canon（無本地卡）升級——
  只 stale 真依賴鏡，不全專案 stale
- [x] §12A（本 PR 份）single truth：`resolveProjectCanonDefaults` 唯一解析器，
  packet build／scene package build／generateVoiceover／generateAmbience 四個消費點共用

### 已知 bounded 限制（誠實）

- Style LoRA（style canon 的訓練 adapter）runtime 套用未實作：目前 style canon 無
  adapter 建立路徑（訓練掛版要求 characterId 對應），不假接。識別 adapter 行為不變。
- 多說話者對白的逐句多聲道 TTS 未實作：單一 TTS 呼叫誠實降級為旁白預設＋unrouted 清單。
- Voice canon 綁定以角色「名稱」對應 speech speaker（speech 序列只有顯示名）；
  改名後未重綁的 speaker 會落 unrouted（不猜）。

### 驗證（rebase 到含 #761–#766 的 default 後）

（結果補記於 PR）

## Closure PR-B — Full media lineage + targeted downstream stale（#768）

- [x] §7 meta.sourceAssetId＋asset_revisions 正式血緣列（完成時寫入，冪等）
- [x] §7 creativeContext.shotLineage：單鏡四軌血緣＋canon deps＋findings
- [x] §8 推導式 artifact staleness（video_parent_superseded／voice_version_drift／
      voice_identity_missing／sound_world_drift）——不落盤，無第二真相
- [x] workspace projection artifactFindings＋deliveryBlockers 兩類新阻擋
- [x] 全專案 6 個批次查詢，無 per-shot N+1（#755 邊界）

## Closure PR-C — Prop continuity + routing + Settings/repair UX

- [x] §9 resolvePropTransfers：唯一匹配才 resolved（歧義＝unresolved 不猜）；
      deriveShotEndState 套 resolved transfer（heldProp 移轉／放手）；
      unresolved 進 scorecard「需確認」（修復＝更新道具卡主人，既有 props.update 真相）
- [x] §10 routeMultiCharacterModel 純路由政策：能力誠實（無模型能鎖多人＝不假裝）、
      建議不 silent 換模型、staged composition 標建議；決策落 generation trace
- [x] §11 buildConsistencyScorecard：10 維度×6 狀態×真 affectedShotIds＋人話 reason；
      server projection 唯一計算點（不平均成假百分比）
- [x] §12 修復流：StoryScorecardRepair（第一層人話＋修復 N 鏡→重生成→Candidate→Adopt）
- [x] §12A Settings 四大區：基本資料（封面）／作品設定（風格＋定裝＋知識素材，
      深連結全保留）／團隊與權限（ProjectMembersCard 復用）／進階（回收桶）；
      無新頂層創作 CTA；contract 測試全綠

### 已知 bounded 限制（誠實）

- staged composition 是「建議策略」非自動執行（不自動呼叫多次付費生成）
- 道具轉手接收者以「角色名稱在句中唯一匹配」解析；同名／代詞＝unresolved
- 基本資料區沒有改名（projects router 無 rename 端點——沿現狀，不為 UI 造後端）

## Closure PR-D — PG/browser/golden acceptance hardening（未開始）

## Paid provider

None called.
