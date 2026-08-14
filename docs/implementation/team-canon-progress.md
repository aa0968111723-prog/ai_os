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
