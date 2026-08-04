# BYOK Phase 2 實作計畫：個人 fal key 接生成管線

> 狀態：**待實作**（本 PR 僅計畫文件，給終端機／代理直接照做）  
> 基礎分支：`claude/healing-migration-ai-os-erewp2`  
> 相關已存在檔案：
> - `docs/product/byok-personal-ai-key-plan.md`（Phase 0 設計）
> - `server/services/userAiKeys.ts`（Phase 1 CRUD + `getDecryptedKey`）
> - `server/services/byokBilling.ts`（`resolveByokFalKey` / `byokFalOpts` helper）
> - `server/services/fal.ts`（已支援 `opts.apiKey`）
> - `shared/generationSourceMeta.ts`（已有 `usedUserKey?: boolean`）
> - `client/src/components/settings/PersonalAiKeyCard.tsx`（設定 UI）
> - `patches/byok-phase2-decideCost.patch`（decideCost 草稿 patch，**尚未套用**）

---

## 1. 問題（使用者痛點）

| 現象 | 根因 |
|------|------|
| 接了個人 fal.ai key 仍扣平台點數 | `generationCore.submitGenerationCore` 永遠 `reserveQuota`，未讀個人 key |
| 不知道有沒有用個人 key | 生成列沒有 `usedUserKey` 標記；UI 無徽章 |
| 「實際點數」與「花費點數」對不上 | `pointsActual` 完成時直接寫 `pointsEst`；帳本另算；BYOK 未接線更亂 |
| 開關「優先使用我的金鑰」無效 | `getDecryptedKey` 只在 helper 裡，生成路徑未呼叫 |

**一句話：Phase 1 能存／測／開關；Phase 2 生成接線沒做完。**

---

## 2. 目標（本計畫完成後）

1. 使用者在 `/integrations` 存好 fal key 且 **優先使用 = 開**、status=`active` 時：
   - 視覺生成（fal 模型）走**個人 key**
   - **不扣**平台點數（`reserveQuota` 略過）
   - `generations.params.__aiosSourceMeta.usedUserKey = true`
   - `pointsEst` 仍可顯示「若走平台會花多少」供參考；帳本淨扣 = 0
2. 關閉優先使用／移除 key／key 失效 → 自動回平台 `FAL_KEY` + 正常扣點
3. NIM 文字模型**永遠不走** fal 個人 key（維持現況）
4. `advanceGeneration` / `decideCost` 與 submit **同一把 key** 查 status／送出
5. 生成列表可見徽章：「個人金鑰・0 點」或「平台額度・N 點」

非目標（本 PR 不做）：
- 真實 fal 帳單寫入 `pointsActual`（可另開 ticket）
- 多供應商（Kling 等）
- 團隊共用 key
- 平台服務費

---

## 3. 既有 helper（直接用，勿重寫）

### `getDecryptedKey(userId, "fal")`（`userAiKeys.ts`）

- 無列／非 active／`preferUserKey=false`／解密失敗 → `null`
- 成功 → plaintext + 更新 `lastUsedAt`

### `resolveByokFalKey` / `byokFalOpts`（`byokBilling.ts`）

```ts
const { userFalKey, usedUserKey } = await resolveByokFalKey(userId, model, params?);
const opts = byokFalOpts(userFalKey, usedUserKey);
// falSubmit(endpoint, kind, input, opts)
// falStatus(endpoint, kind, requestId, opts)
```

注意：`resolveByokFalKey` 目前若 `params.meta.usedUserKey === true` 會把 `usedUserKey` 設 true，**即使 key 已沒有**。  
**實作時請改成：**

```ts
// 建議最終語意（請改 byokBilling.ts）
export async function resolveByokFalKey(userId, model, params?) {
  if (!model || isNimModel(model)) {
    return { userFalKey: null, usedUserKey: false };
  }
  const userFalKey = await getDecryptedKey(userId, "fal");
  // 已落庫的 job：以 meta.usedUserKey 為準，但仍需當下能解出 key 才能查 status
  const metaUsed = params != null && splitGenerationSourceMeta(params).meta.usedUserKey === true;
  if (metaUsed) {
    return { userFalKey, usedUserKey: true }; // key 可能 null → 呼叫端 fallback 平台或標失敗
  }
  return {
    userFalKey,
    usedUserKey: !!userFalKey,
  };
}
```

**查 status 規則：** 若 `usedUserKey && !userFalKey`（使用者中途刪 key）→ 仍可嘗試平台 key 查 status（同一 requestId 在 fal 佇列屬該帳號，跨帳號通常查不到）。較安全做法：

- submit 時有個人 key → 必須用個人 key 查
- key 已刪 → `advanceGeneration` 回 running 繼續等，或標記 failed「個人金鑰已移除，無法查詢進度」——**建議選後者**，並退點邏輯：因未扣平台點，退 0

---

## 4. 必改檔案與步驟

### 4.1 `server/services/generationCore.ts`（主路徑）

**A. `submitGenerationCore`**

在 `prepareGenerationRequest` 之後、插入 generation / `reserveQuota` 之前：

```ts
import { resolveByokFalKey, byokFalOpts } from "./byokBilling";

const { userFalKey, usedUserKey } = await resolveByokFalKey(input.userId, model);
```

1. `storeGenerationSourceMeta(falInput, { ..., usedUserKey: usedUserKey || undefined })`
2. 成本審核門檻（member + threshold）：
   - 若 `usedUserKey`：**略過門檻**（不扣點就不需組長核成本），直接走送出；**或**仍落 awaiting_approval 但文案改「個人金鑰・0 點」——**建議略過門檻**（產品更順）
3. `reserveQuota`：
   ```ts
   if (!billingBypassed() && !usedUserKey) {
     // 現有 reserveQuota 邏輯
   }
   ```
4. `falSubmit`：
   ```ts
   await falSubmit(endpointOf(model), model.kind, falInput, byokFalOpts(userFalKey, usedUserKey));
   ```
5. NIM 路徑不變（`isNimModel` 時 `usedUserKey` 必 false）

**B. `advanceGeneration`**

在呼叫 `falStatus` 前：

```ts
const { userFalKey, usedUserKey } = await resolveByokFalKey(gen.userId, model, gen.params);
if (usedUserKey && !userFalKey && !gen.requestId.startsWith("mock_") && !gen.requestId.startsWith("nim_")) {
  return await failStaleGenerationTx(gen.id, "個人 fal 金鑰已移除或失效，無法查詢進度", "個人金鑰失效");
  // 注意：failStale 依帳本淨額退點；未扣過則退 0 —— 正確
}
const result = ... await falStatus(endpoint, kind, gen.requestId, byokFalOpts(userFalKey, usedUserKey));
```

**C. `pointsActual`**

完成時：

```ts
pointsActual: usedUserKey ? 0 : gen.pointsEst,
```

（從 `gen.params` 讀 `usedUserKey`）

---

### 4.2 `server/routers/generation.ts` → `decideCost`

套用並微調 `patches/byok-phase2-decideCost.patch`：

1. `import { getDecryptedKey } from "../services/userAiKeys"`（或改用 `resolveByokFalKey`）
2. `import { isNimModel } from "../../shared/models"`
3. 核准扣點前：
   ```ts
   const { userFalKey, usedUserKey } = await resolveByokFalKey(gen.userId, model, gen.params);
   if (!billingBypassed() && !usedUserKey) { reserveQuota(...) }
   ```
4. `falSubmit(..., byokFalOpts(userFalKey, usedUserKey))`
5. 失敗退點：`if (!billingBypassed() && !usedUserKey) await refund(...)`
6. 系統訊息：個人路徑寫「個人金鑰・0 點」

**注意：** `generation.ts` 在 #395 已從 PLACEHOLDER 還原；patch 行號可能漂移，**不要盲目 `git apply`**，請對照邏輯手改。

---

### 4.3 其他 fal 呼叫點（本 phase 可選／建議一併查）

| 檔案 | 是否本 phase 必改 |
|------|-------------------|
| `generationCore` + `decideCost` | **必改** |
| `llmProvider.ts` / `agentPlannerProvider.ts` | 可選（agent 文字多走 NIM／平台） |
| `voiceTranscribe.ts` | 可選 |
| `databaseMedia.ts` | 可選 |

v1 承諾是「生成時可優先使用個人額度」→ **媒體生成主路徑必改**即可。

---

### 4.4 UI：生成列表徽章

找 `GenerationList` / 生成列元件（`client/src/...`）：

1. 從列的 `params` 用 `splitGenerationSourceMeta` 讀 `usedUserKey`（前端可複製小型 pure helper，或 API 回傳時附 `billingSource: "user" | "platform"`）
2. Badge：
   - `usedUserKey` → `個人金鑰・0 點`
   - 否則 → `平台・{pointsEst} 點`（完成後可顯示 `pointsActual`）
3. 預覽 `generation.preview` 可加：若當下 `getDecryptedKey` 會成功 → `estimatedPoints: 0` + `billingSource: "user"`（需 preview 路徑也 resolve；注意 preview 不該更新 lastUsedAt 太勤——可加 `getDecryptedKey` 的 `touchLastUsed?: boolean` 參數，preview 傳 false）

**建議最小 UI：** 列表徽章即可；preview 點數顯示可第二 commit。

---

### 4.5 `getDecryptedKey` 小改進（建議）

```ts
export async function getDecryptedKey(
  userId: string,
  provider: AiProvider,
  opts?: { touchLastUsed?: boolean }, // default true
): Promise<string | null>
```

preview 路徑 `touchLastUsed: false`，避免每次預覽都寫 DB。

---

## 5. 測試清單

### 單元／整合

1. `byokBilling`：NIM → 永不 usedUserKey；無 key → false；有 active+prefer → true
2. `submitGenerationCore` mock：usedUserKey 時不呼叫 `reserveQuota`（可用 spy）
3. `advanceGeneration`：params.usedUserKey + opts 傳入 falStatus
4. `decideCost`：個人路徑不扣不退

### 手動（部署後）

1. 設定頁存 fal key，勾優先使用，status=可用
2. 生成一張圖 → 平台點數**不變**；fal 後台用量增加
3. 列表徽章「個人金鑰・0 點」
4. 關掉優先使用 → 再生成 → 平台扣點；徽章「平台・N 點」
5. 待核路徑（若組員 + 高估點）：個人 key 時應直接送出或 0 點待核（依 4.1 決策）

### 回歸

- 無個人 key 的使用者：行為與現況完全一致
- E2E_MOCK 仍不扣點
- typecheck / 既有 generation、points 測試通過

---

## 6. 實作順序（終端機照做）

```
1. 改 byokBilling.ts（語意收斂，見 §3）
2. 改 generationCore.ts submit + advance + pointsActual
3. 改 generation.ts decideCost（對照 patch 手改）
4. （建議）getDecryptedKey touchLastUsed 選項
5. UI 徽章 GenerationList
6. 單元測試
7. typecheck + 相關 test
8. 開實作 PR（勿把本計畫文件當唯一變更合併上 prod 卻不改 code——本 PR 是 plan-only）
```

本 PR（`plan/byok-phase2-wire-generation`）**只含本文件**。  
實作請另開分支例如 `feat/byok-phase2-wire-generation`，以本文件為 checklist。

---

## 7. 驗收條件

- [ ] 有 active + preferUserKey 的 fal key 時，媒體生成不呼叫 `reserveQuota`
- [ ] 同一路徑 `falSubmit`/`falStatus` 帶個人 `apiKey`
- [ ] `params.__aiosSourceMeta.usedUserKey === true` 持久化
- [ ] 完成列 `pointsActual === 0`（個人路徑）
- [ ] 無 key／關閉優先 → 與改前行為一致
- [ ] 生成列表可見計費來源徽章
- [ ] 無 API／log 洩漏完整 key
- [ ] typecheck 與 generation/points 相關測試通過

---

## 8. 風險

| 風險 | 緩解 |
|------|------|
| 中途刪 key 無法查 fal status | advance 明確 failed，帳本退 0 |
| 漏改 decideCost 導致待核仍扣點 | 對照 patch + 測試 |
| 誤對 NIM 套用 fal key | `isNimModel` 早退 |
| 預覽狂更新 lastUsedAt | `touchLastUsed: false` |

---

## 9. 回滾

實作合併後若出事：revert 實作 PR；個人 key 資料保留無妨（只是又回到「存了但不用」）。
