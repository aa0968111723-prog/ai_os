# ANIM-02 角色與風格聖經版本化（foundation）

> 狀態：Types + pure rules landed（**無** schema migration）  
> 日期：2026-07-28  
> 分支：`feat/td-core-policy-command-worker`  
> 上位：`ai-animation-production-remediation-plan.md` §3.3–3.4、§12 ANIM-02  
> 前序：`anim-01-adapter.md`

## 1. 目的

在**不新增** bible 版本表、**不改** characters／generation API 的前提下，落地角色／風格聖經的**領域型別**與**純規則**：過期偵測、引用可解析、生成時 continuity 快照、現況角色卡 → draft bible adapter。供後續 Command／生成 lineage／UI 過期提示引用，避免散落字串約定。

## 2. 本批交付

| 產物 | 路徑 | 說明 |
|---|---|---|
| Continuity 純函式 | `shared/animationContinuity.ts` | 型別 + stale／resolve／snapshot／adapter |
| 單元測試 | `shared/animationContinuity.test.ts` | ANIM-02 命名套件 |
| 本報告 | `docs/architecture/anim-02-continuity.md` | 型別已落地；DB 版本表 = 後續 PR |
| Domain 對齊 | `shared/animationDomain.ts` | `ShotCharacterRef` 改自 continuity 再匯出 |

## 3. API 表面

### 3.1 型別

| 型別 | 說明 |
|---|---|
| `ShotCharacterRef` | `{ characterId, characterBibleVersionId }` |
| `CharacterBibleVersion` | §3.4 角色聖經版本（含 optional `status`） |
| `StyleBibleVersion` | §3.4 風格聖經版本 |
| `GenerationContinuitySnapshot` | 生成時鎖定的 refs + 排序 version ids |
| `StaleContinuityRef` | 過期引用（character／style） |
| `CharacterRowLike` | 現況 `characters` 表最小投影 |
| `StyleDraftSourceLike` | 世界觀／色板等 draft 風格來源 |

### 3.2 純函式

| 函式 | 說明 |
|---|---|
| `isBibleVersionStale(shotRefs, currentVersionIds)` | 哪些 refs 落後於目前最新 version |
| `hasStaleContinuity(...)` | 是否有任一過期 |
| `assertCharacterRefsResolvable(refs, availableVersions)` | 生成前可解析性（不 throw） |
| `buildGenerationContinuitySnapshot({ characterRefs, styleBibleVersionId })` | 穩定快照（排序／去重） |
| `formatStaleContinuityHint(stale)` | 中文使用者提示 |
| `characterToDraftBibleVersion(character, opts?)` | 角色卡 → draft bible |
| `charactersToDraftBibleVersions(...)` | 批次 adapter |
| `styleDraftToBibleVersion(source, opts?)` | 風格 draft 來源 → draft style bible |
| `draftCharacterBibleVersionId` / `draftStyleBibleVersionId` | 確定性 draft id |
| `buildCharacterCurrentVersionMap(versions)` | 每角色最高 version → id |
| `buildShotCharacterRefsFromCharacters(characters)` | 角色卡 → ShotCharacterRef（draft id） |

## 4. 映射規則（Character → draft bible）

| CharacterBibleVersion | 來源 `characters` 列 |
|---|---|
| `id` | `{characterId}:bible:v{version}`（預設 v1） |
| `characterId` | `character.id` |
| `version` | 預設 1（opts 可覆寫） |
| `appearance` | `{ name, summary: appearance }` |
| `costume` | `{}`（尚未拆結構欄） |
| `personality` | `notes`（空則省略） |
| `referenceAssetIds` | `[referenceAssetId]` 或 `[]` |
| `status` | 無 `approvedAt` → `draft` |

**不寫入 DB**；id 可重算，待版本表落地後改為 uuid + FK。

## 5. 過期與快照語意

- **Stale**：鏡頭鎖定的 `characterBibleVersionId`／`styleBibleVersionId` 與「目前最新」不同。  
  無 current 條目（卡已刪）**不**標 stale；另用 `assertCharacterRefsResolvable` 擋生成。
- **Snapshot**：`characterRefs` 依 `characterId` 升序；`characterBibleVersionIds` 去重排序。相同 multiset → 相同 JSON，供 lineage／冪等指紋使用。
- **空 refs**：合法；stale 空、resolve ok、snapshot 為空陣列。

## 6. 明確不做（本批）

- 不新增 `character_bible_versions`／`style_bible_versions` 表或 migration。
- 不改 `characters` router、generation／scenes API、UI。
- 不改 `sceneToShot` 填入 `characterRefs`（仍 `[]`；掛載屬後續 Command／adapter 擴充）。
- 不實作核准 workflow 或版號自動遞增寫入。

## 7. 仍 open

| 項目 | 說明 | 建議 |
|---|---|---|
| DB 版本表 + migration | 真正 immutable bible 列 | 後續 ANIM-02 延續 PR |
| Shot.characterRefs 持久化 | scenes 尚無此欄 | 與 Command 一併 |
| 生成寫入 snapshot | AssetVersion.characterBibleVersionIds | ANIM-03／lineage |
| 角色改卡自動升版 | update 時 version++ | 版本表落地後 |
| UI 過期提示 | `formatStaleContinuityHint` | 粗剪／生成面板 |

## 8. 成功定義（本批）

- [x] `shared/animationContinuity.ts` 純規則可被 shared／server 共用
- [x] vitest 覆蓋 stale、snapshot 穩定、空 refs、adapter、resolve 錯誤碼
- [x] 無 migration／router／UI
- [x] 文件標明 DB 版本表為後續 PR

## 9. 驗證

```bash
npx vitest run shared/animationContinuity.test.ts shared/animationDomain.test.ts shared/animationContracts.test.ts
```

## 10. 後續

1. 版本表 migration + repository；draft id 策略遷移為真實 uuid。  
2. 生成 Command 寫入 `buildGenerationContinuitySnapshot` 結果。  
3. `sceneToShot`／bundle 可選掛入 characterRefs（來源 generation.characterIds + draft map）。  
4. UI 顯示 `formatStaleContinuityHint`。  
5. ANIM-03 生成 lineage 與成本／冪等銜接。
