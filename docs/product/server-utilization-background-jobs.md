# 提升現有 Zeabur 伺服器使用率（背景維護 + Runner 可觀測性）

> 適用：Tencent Seoul **2 vCPU / 8 GB** 控制面（無 GPU）。  
> 推理依 [ADR-008](../adr/008-beam-serverless-gpu-for-free-generation.md) 外送；本機只做有意義的 CPU 工作。

## 為什麼「低使用率」是正常的

- 閒時 CPU ~9–15%：`agentRunner`（4s）／`generationRunner`（6s）等輕量 DB poll。
- 有工作時可到 ~50%+：生成推進、代理步驟、匯出打包。
- **不要**為了曲線漂亮而 busy-loop 或本機大模型（8G 會 OOM、API 會卡）。

## 目標

| 指標 | 目標 |
|------|------|
| 常態 CPU | 20–40%（有佇列時） |
| 尖峰 CPU | < 70% |
| 記憶體 | 背景額外尖峰 ≤ +1.5 GB |
| 原則 | **有佇列才忙**；可 env 關閉；過載閘門 |

## 本變更內容

### 1. Runner 可觀測性（`server/services/runnerMetrics.ts`）

- 各 runner tick 回報：`started`、`lastTickAt`、`inflight`、`queueDepth`、`lastWork`、`lastSkippedReason`
- 進程資源：`rssMb`、`heapUsedMb`、`load1`、`freememMb`
- **`GET /api/ready`** 附加 `runners` + `resources`（**不參與 503 判定**）
- **`admin.runnerStatus`**（tRPC，需團隊管理權限）

### 2. 素材維護執行器（`assetMaintenanceRunner`，每 15s）

| 工作 | 說明 | env |
|------|------|-----|
| 落地補抓 | 強化未落地 AI 素材抓回 Volume | `BG_LAND_BATCH`（預設 30） |
| sha256 補算 | 串流雜湊，不整檔進記憶體 | `BG_HASH_BATCH`（預設 5） |
| 縮圖補產 | image → 360px JPEG（需 `sharp`） | `BG_THUMB_BATCH`（預設 3） |

開關：

```bash
BG_ASSET_MAINT=1          # 預設開；設 0/false/off 關閉
BG_LAND_BATCH=30
BG_HASH_BATCH=5
BG_THUMB_BATCH=3
```

縮圖：

- 寫入 `assets/thumbs/<assetId>.jpg`（Volume）
- `meta.thumbPath` / `meta.thumbWidth`；失敗或過大寫 `meta.thumbSkip`
- 讀取：`GET /api/assets/:id/file?variant=thumb`（無縮圖則回原檔）

**`sharp` 未安裝時縮圖步驟靜默跳過**（落地與 hash 仍跑）。正式映像建議：

```bash
npm i sharp
```

### 3. 過載閘門

`shouldSkipHeavyBackgroundWork()`：

- RSS ≥ 6GB 或 freemem < 400MB → 本輪只量測佇列、不做重活
- load1 > 0.9 × CPU 核數 → 同上

## 部署後怎麼看

1. 開 `GET /api/ready` → 看 `runners[].queueDepth` / `lastWork` / `resources`
2. 管理端 tRPC：`admin.runnerStatus`
3. Zeabur 監控：有素材 backlog 時 CPU 應比閒時高；無 backlog 時維持輕 tick

## 明確不做

- 本機 Diffusers / Comfy / 大 LLM
- 把所有 tick 壓到 1s
- 固定 100% 空轉
