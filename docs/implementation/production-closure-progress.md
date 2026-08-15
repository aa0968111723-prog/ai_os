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

## Closure PR-B — Full media lineage + targeted downstream stale（未開始）
## Closure PR-C — Prop continuity + routing + Settings/repair UX（未開始）
## Closure PR-D — PG/browser/golden acceptance hardening（未開始）

## Paid provider

None called.
