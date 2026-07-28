# 真實供應商 Smoke 測試

> 目的：補足 mock E2E 無法發現的外部 API 契約、認證、Queue、下載與實際成品問題。此測試必須低成本、可控、可停用，不得成為無上限花費來源。

## 執行時機

- 每日排程一次，使用低成本模型。
- 正式發布前手動執行。
- Fal.ai 模型目錄或 provider adapter 變更後執行。
- Provider 大規模事故恢復後執行。

不建議每次 commit 都執行，以免成本、速率限制與供應商短暫波動阻擋一般開發。

## 執行環境

- 使用專用 smoke API key，不與正式高額度 key 共用。
- 帳號設定每日／每月費用上限。
- 測試資產與輸出使用獨立 group／project。
- 所有產生的成品設定短期清理政策。
- CI secret 只提供給 protected environment，fork PR 不可取得。

## 最小測試旅程

### 1. 認證與模型契約

- 呼叫一個最低成本、穩定的文字或圖片模型。
- 驗證 provider 接受目前 registry 定義的參數。
- 驗證回應包含預期 request／queue identifier。

### 2. Queue 與輪詢

- submit 成功。
- poll 狀態可由 queued／running 進入 terminal state。
- timeout 有上限。
- 遇到 provider 429／5xx 不會無限重試。

### 3. 成品下載

- 成品 URL 可下載。
- HTTP 狀態、MIME、檔案大小合理。
- 空檔、HTML 錯誤頁或不支援 MIME 視為失敗。
- 下載後經現有 storage service 持久化。

### 4. 系統狀態與成本

- generation 狀態進入 succeeded。
- asset 記錄可由授權使用者讀取。
- 點數預扣與結算符合設定。
- 若 provider 失敗，退款路徑只執行一次。

## 建議初始範圍

第一階段只跑：

- 低成本圖片 × 1
- 小尺寸／最短輸出
- 固定 prompt，不包含私密資料

穩定後再增加：

- 音訊或文字 × 1
- 低成本短影片，改為每週而非每日
- reference image input
- webhook／queue callback

## 成本護欄

- 每次 workflow 最多一個付費生成。
- 單次估計成本超過設定門檻即拒絕。
- 每日測試總點數／金額設硬上限。
- 同一排程執行使用 idempotency key。
- 失敗不得自動重跑超過一次。
- 手動重跑需要明確觸發，不由無限 retry job 執行。

## 安全與隱私

Smoke prompt 不得包含：

- 使用者私訊
- 真實個資
- 未公開文件
- token／cookie／API key
- 正式專案的敏感世界觀或素材

Artifact 與 log 不得保存 provider URL 中可能包含的敏感 query token；必要時先遮罩。

## GitHub Actions 建議

建立獨立 workflow，例如 `.github/workflows/provider-smoke.yml`：

- `workflow_dispatch`
- `schedule`
- protected environment：`provider-smoke`
- concurrency：同時間最多一個
- timeout：10～15 分鐘
- 失敗上傳遮罩後的 summary／server log
- 不上傳生成原始內容，除非確認無敏感資料

## 結果分級

- PASS：submit、poll、download、persist、settlement 全部成功。
- PROVIDER_DEGRADED：provider 429／5xx／timeout，應告警但不直接判定程式回歸。
- CONTRACT_BROKEN：參數錯誤、模型不存在、response schema 改變。
- INTERNAL_FAILURE：storage、DB、點數或狀態機失敗。
- COST_GUARD_TRIGGERED：測試因成本護欄被拒絕；需檢查模型定價或測試設定。

## 驗收清單

- [ ] 專用低額度 provider key。
- [ ] protected environment 與手動核准策略。
- [ ] 每次最多一個付費生成。
- [ ] timeout、retry、concurrency 與 idempotency 已限制。
- [ ] 驗證 submit／poll／download／persist／settlement。
- [ ] provider failure 與 internal failure 可區分。
- [ ] 失敗有告警與可追蹤 artifact。
- [ ] log 已遮罩 secret 與 signed URL。
- [ ] 產生的測試資產有自動清理政策。
