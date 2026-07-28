/**
 * CloudInferenceProvider 契約型別（ADR-008 / GPU-00）。
 * Provider-agnostic：Router／工作流不得直接耦合 Beam／RunPod SDK。
 */

/** 輸出型態（與 shared/models OutputKind 對齊，此處避免循環依賴） */
export type CloudOutputKind = "image" | "video" | "audio" | "text";

/** 任務生命週期狀態 */
export type CloudJobPhase = "queued" | "running" | "done" | "failed" | "cancelled";

/**
 * 送入雲端 GPU 的生成請求（Aios 已完成權限／額度／idempotency 後才呼叫 Provider）。
 * Adapter 只負責轉換與提交，不負責扣點或租戶隔離。
 */
export interface GenerationInput {
  /** Aios 已登錄工作流／模型 ID（非任意 Beam endpoint） */
  modelId: string;
  /** 輸出型態（mock 用來塑造假結果） */
  kind?: CloudOutputKind;
  prompt?: string;
  /** Provider 無關參數（解析度、秒數、seed 等） */
  params?: Record<string, unknown>;
  /** 來源素材 URL（真實 adapter 應為短效簽名 URL） */
  sourceUrls?: string[];
  /** 提交冪等鍵：同 key 重送回同一 providerJobId */
  idempotencyKey?: string;
  /** 稽核綁定（對 Provider 不透明；真實 adapter 可帶進 metadata） */
  meta?: {
    userId?: string;
    teamId?: string;
    projectId?: string;
    generationId?: string;
  };
}

/**
 * 輪詢狀態回傳。
 * 完成時可附 result*；metrics 供成本／可觀察性結算（coldStart、GPU 秒數、實際成本）。
 */
export interface JobStatus {
  status: CloudJobPhase;
  resultUrl?: string;
  resultText?: string;
  error?: string;
  /** ISO-8601 */
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  /** 冷啟動毫秒（若可取得） */
  coldStartMs?: number;
  /** GPU 執行秒數（若可取得） */
  gpuSeconds?: number;
  /** Provider 回報的實際成本 USD（若可取得） */
  actualCostUsd?: number;
}

export type CloudInferenceProviderName = "beam_mock" | "none";
