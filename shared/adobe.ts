/**
 * Adobe 帳號連結 ＋ 深度修圖／剪輯：前後端共用契約（#224 PR1–PR3）。
 *
 * 為什麼契約放 shared：連結狀態卡、修圖面板與代理步驟都要用同一組操作名稱與限制，
 * 前後端各寫一份必然漂移（既有 options/plan 契約的教訓）。這裡只放「形狀與純函式」，
 * 不含任何 Adobe 憑證或網路呼叫——client bundle 引它是安全的。
 *
 * 設計前提（見 docs/product/adobe-account-linking-pr-roadmap.md）：
 * - 先做骨架與 mock 模式；Adobe Developer Console 憑證之後再申請，切 ADOBE_MODE=real 即可。
 * - 一律「使用者自己連自己的 Adobe 帳號」，AI 在該帳號的授權範圍內動作，不共用站方帳號。
 */
import { z } from "zod";

/** mock＝本機模擬（無憑證亦可跑完整流程）；real＝真的打 Adobe API */
export const ADOBE_MODES = ["mock", "real"] as const;
export type AdobeMode = (typeof ADOBE_MODES)[number];

/**
 * 申請 Adobe 憑證時要勾的授權範圍。openid/AdobeID 取得身分（顯示連結的是哪個帳號），
 * firefly_api/ff_apis 才是實際呼叫影像服務的權限；正式申請通過的 product profile
 * 若與此不同，改這一處即可（授權網址與狀態卡都讀這裡）。
 */
export const ADOBE_SCOPES = ["openid", "AdobeID", "firefly_api", "ff_apis"] as const;
export const ADOBE_SCOPE_PARAM = ADOBE_SCOPES.join(",");

/* ────────────────────────── 修圖操作 ────────────────────────── */

/** 單次請求的操作上限：一張圖串太多步驟既難預期結果，失敗也難歸因 */
export const MAX_PHOTO_OPERATIONS = 8;

/**
 * 修圖操作集合。刻意只收「語意明確、可在 UI 一句話說清楚」的操作——
 * 任意 PSD 腳本那種自由度留給 PR7（本機 Photoshop 控制），不從雲端 API 開後門。
 */
export const adobePhotoOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("remove_background") }),
  z.object({ op: z.literal("auto_tone") }),
  z.object({
    op: z.literal("crop"),
    x: z.number().int().min(0).max(100_000),
    y: z.number().int().min(0).max(100_000),
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
  }),
  z.object({
    op: z.literal("resize"),
    width: z.number().int().min(1).max(20_000),
    height: z.number().int().min(1).max(20_000),
    fit: z.enum(["cover", "contain", "stretch"]).default("cover"),
  }),
  z.object({
    op: z.literal("adjust"),
    brightness: z.number().int().min(-100).max(100).optional(),
    contrast: z.number().int().min(-100).max(100).optional(),
    saturation: z.number().int().min(-100).max(100).optional(),
    temperature: z.number().int().min(-100).max(100).optional(),
  }),
]);
export type AdobePhotoOperation = z.infer<typeof adobePhotoOperationSchema>;

export const adobePhotoEditRequestSchema = z.object({
  /** 使用者 Adobe 帳號內的資產 id（mock 模式為 mock 資產 id） */
  assetId: z.string().trim().min(1).max(200),
  operations: z.array(adobePhotoOperationSchema).min(1).max(MAX_PHOTO_OPERATIONS),
  outputFormat: z.enum(["png", "jpeg", "webp"]).default("png"),
  /** 存回 Adobe 時的檔名（省略則沿用來源檔名加尾綴） */
  outputName: z.string().trim().min(1).max(160).optional(),
});
export type AdobePhotoEditRequest = z.infer<typeof adobePhotoEditRequestSchema>;

/** 給 UI／審批說明／審計用的一句話描述（中文，不含技術細節） */
export function describePhotoOperation(operation: AdobePhotoOperation): string {
  switch (operation.op) {
    case "remove_background":
      return "去背";
    case "auto_tone":
      return "自動調色";
    case "crop":
      return `裁切（${operation.width}×${operation.height}）`;
    case "resize":
      return `縮放至 ${operation.width}×${operation.height}`;
    case "adjust": {
      const parts: string[] = [];
      if (operation.brightness != null) parts.push(`亮度 ${operation.brightness > 0 ? "+" : ""}${operation.brightness}`);
      if (operation.contrast != null) parts.push(`對比 ${operation.contrast > 0 ? "+" : ""}${operation.contrast}`);
      if (operation.saturation != null) parts.push(`飽和 ${operation.saturation > 0 ? "+" : ""}${operation.saturation}`);
      if (operation.temperature != null) parts.push(`色溫 ${operation.temperature > 0 ? "+" : ""}${operation.temperature}`);
      return parts.length ? `影像微調（${parts.join("、")}）` : "影像微調";
    }
  }
}

export function describePhotoEdit(request: AdobePhotoEditRequest): string {
  return request.operations.map(describePhotoOperation).join(" → ");
}

/* ────────────────────────── 剪輯時間軸 ────────────────────────── */

/** 單條時間軸的片段上限：超過此量的專案應該走既有交付管線分段輸出 */
export const MAX_TIMELINE_CLIPS = 200;

export const adobeTimelineClipSchema = z.object({
  assetId: z.string().trim().min(1).max(200),
  /** 在成品時間軸上的起點（秒） */
  startSec: z.number().min(0).max(86_400),
  /** 使用長度（秒） */
  durationSec: z.number().min(0.04).max(86_400),
  /** 從素材的第幾秒開始取（預設 0） */
  inSec: z.number().min(0).max(86_400).default(0),
  transition: z.enum(["none", "cross_dissolve", "dip_to_black"]).default("none"),
  /** 音量增益（dB），-60 視為靜音 */
  gainDb: z.number().min(-60).max(12).default(0),
});
export type AdobeTimelineClip = z.infer<typeof adobeTimelineClipSchema>;

export const adobeTimelineSchema = z.object({
  name: z.string().trim().min(1).max(120),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).default(30),
  width: z.number().int().min(16).max(8_192).default(1920),
  height: z.number().int().min(16).max(8_192).default(1080),
  clips: z.array(adobeTimelineClipSchema).min(1).max(MAX_TIMELINE_CLIPS),
}).superRefine((timeline, ctx) => {
  // 重疊片段在單軌時間軸沒有明確語意（誰蓋誰？），與其讓 Adobe 或剪輯軟體各自解讀，這裡直接擋下
  const sorted = [...timeline.clips].sort((a, b) => a.startSec - b.startSec);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (current.startSec + 1e-6 < previous.startSec + previous.durationSec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clips"],
        message: `片段在 ${current.startSec.toFixed(2)} 秒重疊——單軌時間軸不可重疊`,
      });
      break;
    }
  }
});
export type AdobeTimeline = z.infer<typeof adobeTimelineSchema>;

/** 成品長度（秒）＝最後一個片段的結束時刻；空軌回 0 */
export function timelineDurationSec(timeline: Pick<AdobeTimeline, "clips">): number {
  return timeline.clips.reduce((max, clip) => Math.max(max, clip.startSec + clip.durationSec), 0);
}

/** 影格對齊：時間軸秒數換算成影格（交付給 FCPXML／Premiere XML 時需要整數影格） */
export function toFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/* ────────────────────────── 工作（非同步任務） ────────────────────────── */

export const ADOBE_JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type AdobeJobStatus = (typeof ADOBE_JOB_STATUSES)[number];

export function isTerminalJobStatus(status: AdobeJobStatus): boolean {
  return status === "succeeded" || status === "failed";
}

/** 連結狀態卡（router.adobe.status 的回傳形狀）——前端據此決定顯示「連結／重新連結／已連結」 */
export interface AdobeConnectionView {
  mode: AdobeMode;
  /** real 模式下站方是否已設好 client id/secret；mock 恆為 true */
  configured: boolean;
  connected: boolean;
  email: string | null;
  status: "active" | "error" | null;
  lastError: string | null;
  scopes: readonly string[];
  /** 目前模式實際支援的能力（mock 全開；real 依已接上的 Adobe API 而定） */
  capabilities: { photoEdit: boolean; timelineRender: boolean; assetBrowse: boolean };
  connectedAt: string | null;
  lastUsedAt: string | null;
}
