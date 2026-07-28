# ADR-008：免費生成第一階段採用 Beam Serverless GPU

- 狀態：Accepted
- 日期：2026-07-28
- 適用範圍：Aios AI 動畫與圖像生成基礎設施

## 決策

Aios 第一階段的免費生成基礎設施採用以下組合：

```text
Zeabur
├─ Aios Web / API
├─ PostgreSQL
├─ 使用者、團隊、專案、分鏡與權限
├─ 免費額度與任務佇列
└─ CloudInferenceProvider
        └─ Beam Serverless GPU
              ├─ 圖像生成 Worker
              ├─ 短動畫生成 Worker
              ├─ 配音 Worker
              └─ 放大、補幀與其他後處理 Worker
```

備援順序：

1. Beam：免費與低成本自架開源模型的主要 Provider。
2. RunPod：Beam 容量、模型或部署方式不符合需求時的第二 Provider。
3. Fal：高品質、尖峰流量或本地工作流無法支援時的付費備援。

Zeabur 不承擔 GPU 推理；它只負責 Aios 應用、資料庫、權限、佇列、額度、結果與稽核。

## 為什麼選 Beam

- 支援 Serverless GPU 與 scale-to-zero，沒有人生成時不維持固定 GPU。
- 適合 Aios 初期流量不固定的情況。
- 可部署自訂 Python、Docker 與開源模型推理程式。
- 可先用低成本方式驗證免費圖片、配音與短動畫工作流。
- 未來仍可透過 Provider abstraction 切換到 RunPod、其他雲端 GPU 或自有叢集。

## 不可直接耦合 Beam

產品程式碼不得直接在 Router、頁面或工作流中呼叫 Beam API。所有雲端 GPU 都必須經過共用介面：

```ts
interface CloudInferenceProvider {
  submit(input: GenerationInput): Promise<{
    providerJobId: string;
  }>;
  status(providerJobId: string): Promise<JobStatus>;
  cancel(providerJobId: string): Promise<void>;
}
```

Beam adapter 只負責：

- 驗證與轉換 Provider 輸入。
- 提交 Beam 任務。
- 查詢、取消與接收完成結果。
- 將 Beam 錯誤轉換成 Aios 標準錯誤。
- 回傳 GPU 秒數、冷啟動時間與可取得的實際成本資料。

Aios 核心仍負責：

- 權限與租戶隔離。
- 專案狀態。
- 免費額度、團隊預算與點數。
- 成本核准。
- 任務冪等與重試政策。
- 角色與風格版本。
- 素材版本、現用版本與審核。
- 稽核、通知與成果保存。

## 第一版範圍

### 免費工作流

第一版優先支援：

1. 角色與場景概念圖。
2. 分鏡圖。
3. 圖片轉 3–5 秒短動畫預覽。
4. 中文旁白試聽。
5. 圖片放大與簡單後處理。

### 免費限制

限制必須由管理員設定，不寫死於程式：

- 每人每日圖片次數。
- 每人每日動畫次數。
- 免費動畫最大秒數與解析度。
- 每人同時任務數。
- 團隊與專案每日總上限。
- 免費佇列優先度。
- 免費成果保存期限。

預設建議：

```text
圖片：每日 5 次
短動畫：每日 1 次
動畫長度：3–5 秒
同時任務：每人 1 個
免費佇列：低優先度
成果保存：14–30 天
```

以上只是部署預設，不是產品不可修改的硬規則。

## 模型與工作流治理

Beam Worker 不接受使用者任意上傳或執行 ComfyUI workflow。Aios 只允許執行已登錄、已審核、已版本化的工作流。

每個模型或工作流至少記錄：

- Provider 與模型 ID。
- 模型版本、權重校驗值與授權。
- 工作流版本。
- 最低 VRAM。
- 支援的輸入與輸出格式。
- 最大解析度與秒數。
- 是否可用免費額度。
- 預估 GPU 秒數。
- 失敗重試與 timeout。

## 安全要求

- Beam API key 只能保存在伺服器端 Secret，不得進入前端 bundle、log 或資料庫明文。
- 完成回呼必須驗證簽章或使用伺服器端輪詢，不接受未驗證 webhook 更新任務。
- Worker 只能從受控物件儲存讀寫素材，不接受任意內網 URL。
- 輸入素材 URL 需要短效簽名。
- 輸出先進 quarantine／QC，通過後才設為可用素材。
- 任務必須綁定 user、team、group、project、generation 與 idempotency key。
- Provider timeout、取消與重試不得重複扣點或重複建立素材。

## 可觀察性與成本

每筆 Beam 任務至少記錄：

- queuedAt、startedAt、completedAt。
- coldStartMs。
- gpuRuntimeMs。
- modelLoadMs（若可取得）。
- input/output 大小。
- providerJobId。
- retryCount。
- providerReportedCost（若可取得）。
- estimatedCost、reservedCredits、settledCost。

管理頁應能查看：

- Beam 是否可用。
- 目前佇列長度。
- 最近成功率與 P50/P95 時間。
- 免費額度消耗。
- 每人、每團隊、每模型 GPU 時間。
- Beam 失敗後切換 RunPod 或 Fal 的次數。

## 失敗與備援策略

```text
Beam 正常
→ 使用 Beam

Beam 暫時不可用或超時
→ 保持 queued，依重試政策重試

Beam 長時間不可用，且任務允許付費備援
→ 使用 RunPod 或 Fal

免費任務未獲團隊或個人授權付費
→ 不自動切換 Fal，提示稍後重試
```

不能因 Beam 失敗而默默產生付費 API 帳單。

## 實作拆分

### GPU-00：Provider 契約與假 Worker

- 建立 `CloudInferenceProvider`。
- 建立 Beam adapter 介面與 mock implementation。
- 不連真實 GPU。
- 補 submit/status/cancel、timeout、idempotency 與錯誤映射測試。

### GPU-01：Beam 圖片生成 PoC

- 部署單一核准圖片工作流。
- Aios 提交任務、輪詢狀態並保存結果。
- 記錄 GPU runtime 與冷啟動。
- 僅管理員／測試團隊可使用。

### GPU-02：免費額度與佇列治理

- 每日免費額度。
- 每人與團隊併發限制。
- 免費／付費佇列優先度。
- 管理員可調整設定。

### GPU-03：短動畫與配音

- 圖片轉短動畫。
- 中文旁白試聽。
- 動畫秒數、解析度與 timeout 限制。
- 音畫素材版本與 QC。

### GPU-04：多 Provider 備援

- RunPod adapter。
- Fal adapter 納入相同 Provider Router。
- 明確的免費／付費備援授權。
- Provider health 與切換稽核。

## 驗收條件

- 沒有任何前端程式包含 Beam secret。
- Beam Worker 可以 scale-to-zero。
- 免費任務不會在未授權情況下切換付費 Provider。
- 同一 idempotency key 重試不會建立兩筆生成、兩份素材或重複扣點。
- Beam 中斷不會讓任務永久卡在 running。
- 每筆生成可追溯 actor、專案、模型、工作流、Provider、GPU 時間與成果版本。
- Provider 可以透過設定切換，不需要修改 Router、頁面或動畫領域邏輯。

## 後果

### 正面

- 初期不用購買或長時間租用固定 GPU。
- 可讓使用者得到有限免費圖片與短動畫生成。
- Aios 保有自己的生成工作流、模型與資料治理。
- 未來可替換 Provider，避免被單一平台綁死。

### 代價

- 大模型會有冷啟動延遲。
- 需要自行維護模型映像、工作流、依賴與安全更新。
- Serverless GPU 的可用 GPU 型號與容量可能變動。
- 動畫模型輸出速度仍可能很慢，必須有排隊與明確等待提示。
- 使用者免費不代表平台零成本，仍要設定預算警戒與硬上限。
