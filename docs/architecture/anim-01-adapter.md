# ANIM-01 Production／Sequence／Shot adapter

> 狀態：Adapter landed（純函式投影，無 schema migration）  
> 日期：2026-07-28  
> 分支：`feat/td-core-policy-command-worker`  
> 上位：`ai-animation-production-remediation-plan.md` §3、§12 ANIM-01  
> 前序：`anim-00-baseline.md`

## 1. 目的

在**不破壞**現有 `projects` + `scenes` API、**不做** DB migration 的前提下，提供正式動畫領域形狀（Production／Sequence／Shot）的 pure adapter，供後續 Command／UI／匯出逐步收斂引用。

## 2. 本批交付

| 產物 | 路徑 | 說明 |
|---|---|---|
| Adapter 純函式 | `shared/animationDomain.ts` | 型別 + 映射 + bundle |
| 單元測試 | `shared/animationDomain.test.ts` | ANIM-01 命名套件 |
| 本報告 | `docs/architecture/anim-01-adapter.md` | 映射規則與 open items |

## 3. API 表面

| 函式 | 說明 |
|---|---|
| `projectToProduction(project, opts?)` | Project → Production |
| `defaultSequenceFor(production, opts?)` | 唯一預設 Sequence（adapter-only） |
| `defaultSequenceId(productionId)` | 穩定衍生 Sequence id |
| `sceneToShot(scene, opts)` | 單一 Scene → Shot |
| `scenesToShots(scenes, opts)` | 列表：軟刪過濾 + 排序 + 映射 |
| `buildProductionBundle(project, scenes, opts?)` | `{ production, sequences, shots }` |
| `findDurationInconsistencies(shots, frameRate?)` | duration 真相一致性檢查 |
| `normalizeProductionFormat` / `projectStatusToProductionState` / `sceneStatusToShotState` | 正規化 helpers |

型別：`Production`、`Sequence`、`Shot`、`ProductionBundle`、`ProjectRowLike`、`SceneRowLike` 及狀態／格式 union。

時間與軟刪：**委派** `shared/animationContracts`（`durationFromSec`、`listActiveOrderedScenes`、`isNotSoftDeleted`、`DEFAULT_FRAME_RATE` 等），不在 adapter 內重寫。

## 4. 映射規則

### 4.1 Production ← Project（1:1）

| Production | 來源 | 備註 |
|---|---|---|
| `id` | `project.id`（可 `opts.productionId` 覆寫） | **策略：無獨立表時 id === projectId** |
| `projectId` | `project.id` | 永遠指向來源專案 |
| `title` | `project.title` | |
| `format` | `project.format` | 僅 `16:9`／`9:16`／`1:1` 原樣；空→`16:9`；其他→`custom` |
| `frameRate` | 預設 `DEFAULT_FRAME_RATE` (30) | 可 opts 覆寫 |
| `state` | `project.status` | `archived`→`archived`；`paused`→`review`；其餘→`production` |
| `language` | `project.language`（若有） | 現況 projects 表未必有此欄；optional |

### 4.2 Sequence（adapter-only，無表）

- 每 Production **恰好一筆**預設 Sequence。
- `id` = `{productionId}:sequence:0`（確定性可重算）。
- `orderIndex` = 0。
- `title` 預設「主線」；bundle 可傳 `sequenceTitle`（例如專案名）。

### 4.3 Shot ← Scene

| Shot | 來源 |
|---|---|
| `id` | `scene.id` |
| `productionId` | 呼叫端／bundle 的 production.id |
| `sequenceId` | 預設 Sequence id |
| `orderIndex` | `scene.orderIndex` |
| `title` | `scene.title` |
| `durationFrames` / `durationSec` | `durationFromSec(scene.durationSec, frameRate)` |
| `narration` | `scene.voiceover` |
| `visualPrompt` | `scene.prompt` |
| `selectedVisualVersionId` | `scene.assetId` |
| `selectedNarrationVersionId` | `scene.narrationAssetId` |
| `state` | scene.status 粗映射（todo/review→draft；pending→review；approved→approved；needs_work→blocked） |
| `characterRefs` | `[]`（ANIM-02 角色聖經後再填） |

**軟刪**：`scenesToShots`／`buildProductionBundle` 預設經 `listActiveOrderedScenes` 排除 `deletedAt != null` 列。

## 5. 明確不做（本批）

- 不改 `server/routers/scenes.ts` 或 projects API。
- 不新增 productions／sequences／shots 表或 migration。
- 不改 UI、不改 exporter 讀取路徑（仍可用 scenes）。
- 不實作 Production／Shot 狀態機 Command 轉移驗證。

## 6. 仍 open

| 項目 | 說明 | 建議 |
|---|---|---|
| 獨立 Production 表與 revision | 已交付修改不覆蓋 | ANIM-01 後續／交付狀態機 |
| 多 Sequence（場次） | 現為單主線 | 產品確認後再 migration |
| Shot 正式狀態機 | 僅粗映射 scene.status | Command 層 |
| 選版 DB unique | selected 指標與 AssetVersion | ANIM-04 |
| scenes router 改讀 adapter | 可選 thin re-export | 後續小 refactor |
| 角色／風格 bible 掛 Shot | characterRefs 空陣列 | ~~ANIM-02~~ foundation 已落地（型別／stale／snapshot）；持久化仍 open → 見 `anim-02-continuity.md` |

## 7. 成功定義（本批）

- [x] `shared/animationDomain.ts` 純映射可被 shared／server 共用
- [x] vitest 覆蓋 1:1 Production、預設 Sequence、Scene→Shot、軟刪、duration 一致
- [x] 引用 `animationContracts`，無產品行為變更
- [x] 文件記錄 id 策略與 open items

## 8. 驗證

```bash
npx vitest run shared/animationContracts.test.ts shared/animationDomain.test.ts
```

## 9. 後續

1. 匯出／粗剪讀路徑可選改走 `buildProductionBundle`（仍不破 API）。
2. ~~ANIM-02 角色與風格聖經版本化（pure foundation）。~~ **已完成** → 見 `anim-02-continuity.md`（`shared/animationContinuity.ts`）。Shot.characterRefs 持久化／DB 版本表仍為後續。
3. 需要時再拆 Production 表；adapter 的 `id === projectId` 策略改為獨立 id + FK。
