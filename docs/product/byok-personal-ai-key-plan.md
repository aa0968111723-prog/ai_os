# 規劃：個人 AI API Key（BYOK）支援

> 狀態：Draft（本 PR 僅設計文件）  
> 相關：`user_integrations` AES-256-GCM 模式、`fal.ts`、`generationCore`、點數系統、IntegrationsPage  
> 原則：Key 永不回傳前端、加密與 DB 分離、平台 Key 仍為預設、使用者可選擇使用自己的額度

## 1. 目標

1. 使用者可在「整合連接」頁貼上自己的 **fal.ai API Key**（後續可擴其他供應商）。
2. 生成時若使用者啟用個人 Key，則優先使用該 Key，費用直接由使用者自己的 fal 帳號負擔。
3. 平台 Key + 點數系統保持為預設路徑；雙模式並存。
4. 完整安全與稽核：加密存放、測試連線、審計、永不洩漏原文。

## 2. 非目標（v1）

- 不實作完整 OAuth「登入外部帳號」（fal / Kling / Runway 等主要提供 API Key，不適合帳號授權）。
- 不在第一期支援多供應商同時完整運作（v1 只做 fal）。
- 不支援團隊／專案共用 Key（先做個人）。
- 不改變既有平台點數定價與帳本結構（僅新增 keySource 標記）。

## 3. 現況

| 能力 | 狀態 |
|------|------|
| 平台 FAL_KEY | 全站唯一，硬編碼於 `falSubmit` / `falStatus` |
| 個人加密憑證 | 已有 `user_integrations` + AES-256-GCM（Google Drive / Notion / API） |
| 外部帳號 OAuth | 已有 `external_accounts`（Adobe） |
| 點數 | `reserveQuota` / `refund` 在 generationCore 與 routers 前/後呼叫 |
| 生成路徑 | 集中於 generationCore → falSubmit（另有 5 個次要 call site） |

**falSubmit 主要呼叫點（實作時皆需傳入 resolved key）：**
1. `generationCore.ts` — 主要生成路徑
2. `routers/generation.ts` — 審批／直接送出
3. `llmProvider.ts` — agent 文字（fal OpenRouter）
4. `agentPlannerProvider.ts` — planner
5. `voiceTranscribe.ts`
6. `databaseMedia.ts` — 媒體分類

## 4. 資料模型（推薦）

新建表 `user_ai_provider_keys`：

```ts
export const userAiProviderKeys = pgTable("user_ai_provider_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  provider: text("provider", { enum: ["fal"] }).notNull(), // 預留 kling | runway | openai
  /** AES-256-GCM 加密後的 API Key（iv:tag:cipher hex） */
  secretEnc: text("secret_enc").notNull(),
  /** 顯示用末四碼 */
  keyLast4: text("key_last4").notNull(),
  /** active = 可用；error = 驗證失敗或解密失敗；unverified = 尚未測試 */
  status: text("status", { enum: ["active", "error", "unverified"] }).notNull().default("unverified"),
  /** 使用者是否優先使用此 Key（true = 有 Key 就用，false = 僅備用） */
  preferUserKey: boolean("prefer_user_key").notNull().default(true),
  validatedAt: timestamp("validated_at"),
  lastUsedAt: timestamp("last_used_at"),
  lastError: text("last_error"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userProviderIdx: uniqueIndex("user_ai_provider_keys_user_provider_idx").on(t.userId, t.provider),
}));
```

加密金鑰：沿用 `INTEGRATION_TOKEN_SECRET` 種子（或 Volume 自動產生的 `.integration-key`），分域派生 `ai-provider-key:fal:`（與既有 integrations 密文互不可解）。**不需新增環境變數。**

## 5. 服務層

### 5.1 `server/services/userAiKeys.ts`

- `setKey(userId, provider, plaintextKey)` → 測試連線 → 加密 → upsert
- `getDecryptedKey(userId, provider)` → 僅內部使用
- `testConnection(plaintextKey | userId)` → 打 fal **輕量端點**（例如 models list 或已知便宜 probe，避免真的觸發計費生成）驗證
- `removeKey(userId, provider)`
- `listForUser(userId)` → 只回 last4 + status + preferUserKey（永不回原文）

### 5.2 fal.ts 變更

```ts
export async function falSubmit(
  endpoint: string,
  kind: OutputKind,
  input: Record<string, unknown>,
  opts?: { apiKey?: string }
): Promise<{ requestId: string }>
```

`falStatus` 同步接受 `opts?.apiKey`。未傳則 fallback `process.env.FAL_KEY`。

### 5.3 解析 helper

```ts
async function resolveFalApiKey(userId: string): Promise<{ key: string; source: "user" | "platform" }>
```

有 active + preferUserKey 的個人 Key → 回 user key；否則平台。個人 Key 失效時自動 fallback 平台 Key。

## 6. 生成與計費路徑

1. generationCore / 其他 call site 在 submit 前呼叫 `resolveFalApiKey`。
2. 若 `source === "user"`：
   - **v1 預設**：跳過 `reserveQuota`（或 reserve 0），不扣平台點數。
   - 在 generation job（建議新增可空欄位 `keySource` 或寫入既有 meta/json）與 cost_ledger 標記 `keySource: "user"`（或 `billingSource: "user_key"`），讓狀態輪詢與退點邏輯在重啟後仍一致。
   - 失敗時無需退點。
3. 若 `source === "platform"`：維持現有點數邏輯。
4. 預留設定開關（env 或 feature flag）：`BYOK_PLATFORM_SERVICE_FEE_POINTS`，未來可改收服務費。

## 7. UX

位置：`/integrations`（IntegrationsPage）新增卡片「個人 AI 金鑰」

- 未設定：說明文案 + 輸入框（password）+「測試並儲存」
- 已設定：顯示 `****xxxx`、狀態徽章、最後驗證時間、「優先使用我的 Key」開關、「移除」
- 個人 Key 失效時：自動 fallback 平台 Key，並在 UI 明確提示「個人 Key 已失效，已改用平台額度」
- 生成介面可顯示小徽章「使用個人 Key」或「使用平台額度」

## 8. 安全與稽核

| 項目 | 做法 |
|------|------|
| 存放 | AES-256-GCM，金鑰與 DB 分離 |
| 回傳 | 列表／API 只回 last4 + status，永不回原文或密文 |
| 測試連線 | 不寫入 log；失敗只回通用錯誤；使用輕量端點避免產生費用 |
| 審計 | `audit_log` 記錄 set / remove / test / use（無 secret） |
| 節流 | test / set 每使用者每分鐘限制 |
| 輪替 | 金鑰輪替後 status=error，引導重新貼 |

## 9. 實作階段

| Phase | 內容 | PR |
|-------|------|----|
| 0 | 本設計文件 | 本 PR |
| 1 | schema + migration + userAiKeys service + tRPC CRUD + testConnection | 後續 |
| 2 | falSubmit / falStatus 支援 override + resolveFalApiKey + generationCore 接線 + 計費雙模式 + job keySource | 後續 |
| 3 | IntegrationsPage UI + 生成徽章 | 後續 |
| 4 | 擴其他 provider（Kling 等） | 之後 |

## 10. 開放問題（需產品決定）

1. 用個人 Key 時是否完全免點數？（本計畫預設「是」）
2. 是否要收少量平台服務費？
3. 是否允許「僅備用、預設仍用平台」？（已預留 preferUserKey）
4. 個人 Key 失效時 UI 是否自動切回平台並提示？（本計畫預設「是」）
5. 未來是否要支援團隊共用 Key？

## 11. 風險與緩解

| 風險 | 緩解 |
|------|------|
| Key 外洩 | 加密 + 永不回傳 + 審計 |
| 使用者貼錯 Key | testConnection 強制驗證後才 active |
| 平台成本失控 | 預設仍走平台 Key；個人 Key 才免點 |
| 多 call site 漏改 | 集中 resolve helper + 單元測試覆蓋所有 falSubmit 呼叫 |
| 金鑰輪替後舊密文失效 | status=error + UI 引導重貼 |
| 重啟後退點邏輯不一致 | job 持久化 keySource |

## 12. 驗收條件（Phase 1+ 後）

- [ ] 使用者可儲存 / 測試 / 移除 fal Key，前端只見 last4
- [ ] 啟用後生成走個人 Key，不扣平台點數，job 有 keySource 標記
- [ ] 未啟用或 Key 失效時自動 fallback 平台 Key + 正常扣點，並有 UI 提示
- [ ] 無任何 API / log / bundle 洩漏完整 Key
- [ ] typecheck + 既有 generation / points 測試通過

## 13. 回滾

本 Phase 0 僅文件，無 runtime 影響。後續 phase 可 feature-flag 關閉或刪除個人 Key 記錄後即回平台模式。
