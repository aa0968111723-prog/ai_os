/**
 * 模型註冊表 — 「沒有模型支撐的選項不出現」原則的單一來源。
 * MVP 只接 Fal.ai（定案）；無點數限制（定案：不設虛擬點數）。
 */
export type ModelKind = "image" | "video";

export interface ModelEntry {
  id: string; // fal model id（queue.fal.run 路徑）
  label: string;
  kind: ModelKind;
  /** 每次生成扣點（1 點 ≈ NT$1 參考值；額度上限由管理員在系統內調整） */
  points: number;
  input: (prompt: string, format: ProjectFormat) => Record<string, unknown>;
}

export type ProjectFormat = "16:9" | "9:16" | "1:1";

export const MODELS: ModelEntry[] = [
  {
    id: "fal-ai/flux/schnell",
    label: "圖像 · Flux 快速版",
    kind: "image",
    points: 1,
    input: (prompt, format) => ({ prompt, image_size: format === "9:16" ? "portrait_16_9" : format === "1:1" ? "square_hd" : "landscape_16_9" }),
  },
  {
    id: "fal-ai/flux/dev",
    label: "圖像 · Flux 精緻版",
    kind: "image",
    points: 2,
    input: (prompt, format) => ({ prompt, image_size: format === "9:16" ? "portrait_16_9" : format === "1:1" ? "square_hd" : "landscape_16_9" }),
  },
  {
    id: "fal-ai/wan/v2.2-a14b/text-to-video",
    label: "影片 5 秒 · Wan（推薦・省點）",
    kind: "video",
    points: 8,
    input: (prompt, format) => ({ prompt, aspect_ratio: format }),
  },
  {
    id: "fal-ai/kling-video/v2.1/standard/text-to-video",
    label: "影片 5 秒 · Kling（畫質優）",
    kind: "video",
    points: 12,
    input: (prompt, format) => ({ prompt, aspect_ratio: format, duration: "5" }),
  },
];

export function getModel(id: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === id);
}

/** 平台 → 格式自動帶入（夥伴不用懂比例） */
export const PLATFORMS = [
  { id: "youtube", label: "YouTube（橫式）", format: "16:9" as ProjectFormat },
  { id: "shorts", label: "Shorts / Reels（直式）", format: "9:16" as ProjectFormat },
  { id: "social", label: "社群貼文（方形）", format: "1:1" as ProjectFormat },
];

export const PROJECT_KINDS = [
  { id: "witness", label: "見證故事" },
  { id: "teaching", label: "開示剪輯" },
  { id: "short", label: "短影音" },
  { id: "promo", label: "活動宣傳" },
  { id: "recap", label: "活動回顧" },
] as const;
