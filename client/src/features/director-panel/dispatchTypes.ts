/**
 * AI 導演面板（dispatch plan）的前端型別契約。
 *
 * 來源：設計文件「AI 代理強化架構設計 — 多步驟自主創作導演」§3/§4/§6/§8。
 * 後端 dispatch router（M1–M6）尚未落地，這裡先用**前端本地**型別鏡映 §8 API 合約，
 * 讓 M7 靜態 UI 骨架與測試不依賴 `trpc.dispatch.*`；M8 串接時由 real adapter 回填。
 */

/** 子任務類型（§3.1 dispatchSubtaskSchema.type） */
export type DispatchSubtaskType = "image" | "video" | "audio" | "llm" | "note" | "wait_human";

/** 子任務執行期狀態（§4.2） */
export type DispatchSubtaskStatus = "pending" | "running" | "done" | "failed" | "retrying" | "stopped";

/** 計畫層狀態（§4.2） */
export type DispatchPlanStatus = "proposed" | "running" | "done" | "failed" | "cancelled";

export interface DispatchSubtaskParams {
  modelId?: string;
  /** video/audio */
  durationSec?: number;
  /** image/video */
  aspectRatio?: string;
  characterIds?: string[];
  scenePresetIds?: string[];
  propIds?: string[];
  voiceover?: string;
  /** 產出落點：note / asset / both */
  destination?: "note" | "asset" | "both";
}

/** 拆解草稿中的子任務（§3.1） */
export interface DispatchSubtask {
  id: string;
  type: DispatchSubtaskType;
  prompt: string;
  /** 依賴的子任務 id；空 = 可立即執行 */
  dependsOn?: string[];
  params?: DispatchSubtaskParams;
}

/** LLM 拆解回傳的完整草稿（§3.1） */
export interface DispatchPlanDraft {
  title: string;
  goal: string;
  summary: {
    rationale?: string;
    successCriteria: string[];
    risks?: string[];
  };
  subtasks: DispatchSubtask[];
}

/** 單步子任務成本（§6.1） */
export interface CostPerSubtask {
  id: string;
  type: string;
  model: string;
  estPoints: number;
  breakdown: string;
}

/** 整份創作計畫的成本估算（§6.1） */
export interface CostEstimate {
  totalPoints: number;
  perSubtask: CostPerSubtask[];
  /** 人話總結，如「4 張圖 × 15pt + 1 支影片 × 120pt」 */
  breakdown: string;
  currency: "points";
}

/** 產出引用（generation id / note id / asset id） */
export interface DispatchOutputRef {
  type: string;
  id: string;
  label: string;
}

/** 執行期子任務（§4.1 / §8.4） */
export interface DispatchSubtaskRuntime extends DispatchSubtask {
  status: DispatchSubtaskStatus;
  retryCount: number;
  outputRefs?: DispatchOutputRef[];
  error?: string;
}

/** 分層進度摘要（§5.2 progressLog） */
export interface DispatchProgressEntry {
  subtaskId: string;
  summary: string;
  outputRef?: DispatchOutputRef;
  at: string;
}

/** §8.4 dispatchPlan.status 回傳 */
export interface DispatchPlanStatusPayload {
  planId: string;
  status: DispatchPlanStatus;
  subtasks: DispatchSubtaskRuntime[];
  progressLog: DispatchProgressEntry[];
  costEstimate: CostEstimate;
  doneCount: number;
  totalCount: number;
}

/** §8.1 dispatchPlan.preview 回傳 */
export interface DispatchPreviewResult {
  draft: DispatchPlanDraft;
  costEstimate: CostEstimate;
  /** 拆解用的模型 */
  provider: string;
  traceSessionId?: string;
}

/**
 * DirectorPanel 依賴的 API 介面（鏡映 §8 六個端點）。
 *
 * M7 骨架預設用 `demoDirectorApi`（示範資料）；M8 後端 router 落地後，
 * 以 tRPC adapter 實作同一介面替換即可，UI 不動。
 */
export interface DispatchDirectorApi {
  planPreview(input: {
    projectId: string;
    goal: string;
    decomposeMode?: "auto" | "nim" | "fal_balanced" | "fal_quality";
  }): Promise<DispatchPreviewResult>;
  planCreate(input: {
    projectId: string;
    goal: string;
    draft: DispatchPlanDraft;
  }): Promise<{ planId: string; costEstimate: CostEstimate; status: "proposed" }>;
  planApprove(input: { planId: string }): Promise<{ planId: string; status: "running" }>;
  planStatus(input: { planId: string }): Promise<DispatchPlanStatusPayload>;
  planStop(input: { planId: string }): Promise<{ planId: string; status: "cancelled" }>;
  planRetry(input: { planId: string }): Promise<{ planId: string; status: "running" }>;
}

/** 子任務型別 → 中文名（面板顯示用） */
export const DISPATCH_TYPE_LABEL: Record<DispatchSubtaskType, string> = {
  image: "出圖",
  video: "出片",
  audio: "配音",
  llm: "文字",
  note: "筆記",
  wait_human: "等人工",
};

/** 子任務型別 → Lucide 圖示名（IconName） */
export const DISPATCH_TYPE_ICON = {
  image: "Image",
  video: "Film",
  audio: "Mic",
  llm: "Sparkles",
  note: "FileText",
  wait_human: "Clock",
} as const;
