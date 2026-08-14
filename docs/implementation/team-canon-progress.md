# Team Canon → Canon-to-Shot — progress

Task source: PR #754（`docs/plans/AIOS_TEAM_CANON_TO_SHOT_MASTER_PLAN.md`）
Base: `claude/healing-migration-ai-os-erewp2` @ `26bc101a`（#754 merge、含 #752/#753）

## PR stack

| Stage | Branch | 內容 |
|---|---|---|
| PR-A | `agent/team-canon-pr-a` | Team Canon foundation（本支） |
| PR-B | `agent/team-canon-pr-b` | Canon-to-Shot composition（stacked on A） |
| PR-C | `agent/team-canon-pr-c` | Invisible Complexity Project UX（stacked on B） |
| PR-D | `agent/team-canon-pr-d` | Hardening（stacked on C） |

## PR-A — Team Canon foundation

### Baseline reconciliation（default 上就紅、非本分支造成）

- [x] `npm run typecheck` 4 錯（`consistencyTraining.ts` submit/poll 推斷回傳型別、
      nullable `characterId` 進 `eq()`）——已修
- [x] `migrationState.test.ts` 寫死計數漏了 0071–0073（default 上 311≠289 紅）——
      連同 0074 一併補上（逐支確認全部為 guarded additive DDL）
- 既知 Windows 基線（不動）：`gemini.test.ts` 路徑斷言、`deviceTrust.pg.test.ts` ×2 分隔符

### 落地內容

- [x] Migration `0074_team_canon`：`canon_entries`／`canon_versions`／
      `canon_version_events`／`project_canon_pins`（全 additive、無 FK、denormalized group_id，
      journal＋migrationRevisions 已釘）
- [x] `shared/teamCanon.ts`：kinds／版本 payload 契約／canonical material／pinState／
      promote 守門／descriptor 映射（純函式，client 可共用）
- [x] `server/services/teamCanon.ts`：
      - createCanonFromEntity（冪等；confirmRights=false → reuseScope=private）
      - insertCanonVersion（唯一寫入路徑；fingerprint 冪等；**沒有任何 payload UPDATE 路徑**）
      - pin（reference not copy；本地 handle 落地供既有 runtime；private 擋跨專案；
        造型 Canon 需先 pin 所屬角色）
      - promote／rollback／archive／setRights（組長以上＋events 歷史）
      - canonUpgradeImpact／applyCanonUpgrade（依 #753 packet 依賴圖 targeted stale）
      - createCanonVersionFromTraining（只接受 succeeded job；trainingAllowed 守門；
        版本進 Candidate，production 指標不動）
- [x] `server/routers/canon.ts`（薄殼）＋ appRouter 註冊＋ auditWording 11 條 mutation 文案
      ＋分類表 `canon` 前綴
- [x] 測試：`shared/teamCanon.test.ts`（8）＋`server/services/teamCanon.pg.test.ts`
      （RUN_PG_INTEGRATION 閘門、8 情境：升 Canon／不可變／promote ACL／跨專案 pin／
      targeted stale／rights 擋跨專案／訓練 Candidate／rollback+archive 守門）

### 設計要點（避免第二套真相）

- Production 指標只存在 `canon_entries.production_version_id` 一處；版本列只有
  `archived` 旗標，不重複記「哪版是 production」。
- Pin 落地的本地卡是 **runtime handle**（讓 #742/#753 的綁定、packet、生成路徑零改動），
  canonical 內容在 Canon version payload；升級同步是明確動作並走 rev+1，
  UPDATE_AVAILABLE 由 pin 版本 vs production 版本推導，不另存狀態欄。
- 升級影響（affected shots）直接用 `packetDependencies`／`staleShotIdsForEntityChange`
  （#753），不另做一套依賴計算。

### PR-B 整合點（本支刻意不做）

- packet compiler 尚未讀 canon pin（provider.activeAdapter／canonVersion 標記在 PR-B 接）
- 跨專案 reference asset 在 `buildShotContextPacketPayload` 的 assets 查詢
  以 projectId 過濾會查不到（references 陣列仍在）——PR-B reference mixer 一併處理
- prop 的 ownerKind/ownerId 跨專案映射（owner 也要先 pin）——PR-B Character/Prop slots 處理
- style／voice／sound_world Canon 無本地卡，等 PR-B 由 packet 直接消費

## PR-B — Canon-to-Shot composition

### 落地內容

- [x] Migration `0075_scene_packages_continuity`：`scene_packages`／`scene_package_heads`／
      `shot_continuity_states`（全 additive、insert-only／head 模式）
- [x] `shared/scenePackage.ts`＋`server/services/scenePackages.ts`：場景脈絡凍結
      （地點卡＋Scene Canon pin＋environment＋活動角色/造型/道具＋style＋soundWorld＋
      cameraLanguage＋entryContinuity）；`generateStoryboard` 先凍 package 再凍 shot packet
- [x] `shared/characterSlots.ts`：slot 結構＋歸屬驗證（duplicate_look_binding／
      look_without_character／wrong_prop_owner）；packet.characterSlots
- [x] `shared/providerCapabilities.ts`：capability matrix 由 model.input 實際輸出推導
      （probe image_urls／reference_image_urls／loras），multiCharacterIdentity 誠實 false
- [x] `shared/referenceMixer.ts`：role/priority 排序＋能力截斷＋降級明碼；
      `generationCore.prepareGenerationRequest` 在 packet 存在時套用（含
      reference_image_urls 欄位支援與 Canon adapter loras 套用）
- [x] `shared/scriptChanges.ts`：授權改變解析（保守）＋轉場推導＋
      `classifyCostumeChange`＋`deriveShotEndState`
- [x] `consistencyAdopt.adoptGenerationCurrent`：Adopt 時抽 end-state →
      `shot_continuity_states`（upsert）；packet build 讀前一鏡 end-state 繼承 currentStart
- [x] `consistencyEval`：preflight 增 wrong_prop_owner；eval 增 continuity_costume_break
      （UNINTENTIONAL_DRIFT vs SCRIPT_AUTHORIZED_CHANGE）
- [x] Video lineage（§13）：generationCommand 對 image-to-video＋綁分鏡強制
      「current 畫面或明確 parent」；沒有 current → BAD_REQUEST
- [x] packet provider 標記：supportsIdentityRef（能力）＋activeAdapter
      （pinned Canon production 版本的 adapterRef，generationAllowed 才算）

### 指紋相容性

- 新欄位（scenePackage／characterSlots／scriptAuthorizedChanges／previousEnd）
  條件性進 canonical material：舊 payload 素材 bit-for-bit 不變（shotContextPacket.test 鎖住）。
- 有角色的鏡在下次 refresh 會出現一次性 stale 波（packet 真的長出 slots）——
  semantic upgrade，屬預期。

### 已知限制（誠實）

- deriveShotEndState 的道具轉手不改 heldProp（無法可靠對到目標角色，留白）
- style／voice／sound_world Canon 尚未進 packet 消費（PR-C/PR-D 也不做假接線，
  等真的有 style adapter 模型再接）
- mixer 只在「模型 payload 已有參考欄位」時重排（與既有 duck-typing 同一保守原則）

## PR-D — Hardening

### 落地內容

- [x] `teamCanonPipeline.pg.test.ts`：Scene Package → Shot packet 繼承 →
      double-Adopt 冪等 → 濕度 end-state 流進下一鏡 previousEnd →
      duplicate training callback 冪等 → targeted stale（真 PostgreSQL）
- [x] 並行 race 補強：createCanonFromEntity／pinCanonToProject 撞 unique
      改冪等回傳；pin 的本地 handle 與 pin 同交易（不留孤兒卡）
- [x] Identity adapter 真接線修正：改在 needs gate **前**把 pinned Canon adapter
      填進 LoRA 模型來源槽（原實作是 gate 後死碼；使用者自帶 LoRA 不覆蓋）
- [x] `scripts/e2e-ui/team-canon-evidence.mjs`：1280/1440/390/430 證據＋
      首載 tRPC 請求量測＋明確升級 → targeted stale 驗證
- [x] 多代理對抗式稽核（find→verify）——確認缺陷修復記錄見下

### 對抗式稽核（find→verify）結果

5 維度 finders → 25 findings → 逐一 adversarial verify → **21 confirmed → 全數修復**
（ACL：private 撤回不生效／訓練掛版繞過 viewer ACL；Integrity：applyUpgrade 非交易、
版本號 race、promote/rollback 無鎖、rollback 繞 promote 守門；Pipeline：wrong_prop_owner
誤擋道具鏡、costume break 誤擋刻意換裝、i2v 不驗素材 kind、adapter 宣稱不實、mix 高報；
UX：錯誤訊息殘留、證據腳本兩處假證據來源）——詳見 PR-D commits。

### 驗證結果（本機，2026-08-15）

| Check | 結果 |
|---|---|
| typecheck | PASS |
| server vitest 全套 | 3005 passed／1 failed＝既知 Windows 基線（gemini 路徑斷言） |
| client vitest 全套 | 1875 passed（一次負載下 flaky 1 例，重跑全綠） |
| check:ui-primitives／boundaries／hooks | PASS |
| migrations 0000→0076（真 PostgreSQL 16.9） | APPLIED、drift none |
| teamCanon.pg.test.ts（8 情境） | PASS |
| teamCanonPipeline.pg.test.ts（6 情境） | PASS |
| 瀏覽器證據 1280/1440/390/430 | `docs/evidence/team-canon/`（UPDATE_AVAILABLE chip 四視口可見） |
| 明確升級 → targeted stale | stale=[依賴鏡] 與預期完全一致（results.json） |
| 首載 tRPC 量測 | 34 procedures；唯一 >2 重複＝auth.me×4（standalone link 既有模式，非本 stack 新增） |

### 已知限制（誠實）

- 核准後 resume（decideCost）沿用送出當下的 params：若期間 Canon 的
  generationAllowed 被撤回，已凍結的 adapter 仍會用於那一筆已核准的生成
  （撤回對「新送出」立即生效）。修法需要在 decideCost 重驗 packet——留待後續。
- Docker Desktop 在本機壞損（inference/secrets socket 殭屍 handle 慢性病），
  pg 證據改用免安裝 PostgreSQL 16.9（port 5433）取得，與 CI 的 PG 行為一致。

## Tests（PR-A 當下）

| Check | Class |
|---|---|
| typecheck | PASS（修復後） |
| shared/teamCanon.test.ts（8） | PASS |
| migrationState + auditWording + teamCanon（58） | PASS |
| server 全套 vitest | PASS（僅既知 Windows 基線 3 檔 4 例） |
| teamCanon.pg.test.ts（真 PostgreSQL） | 待本機 Docker PG 起來後跑（結果補記於下） |

## Paid provider

None called.
