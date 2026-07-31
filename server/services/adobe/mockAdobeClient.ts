/**
 * Adobe Mock Client（#224 PR3）：不出網、記憶體內的 Adobe 影像服務模擬。
 *
 * 存在目的不是「假裝有做事」，而是讓整條資料流（連結 → 選素材 → 送工作 → 輪詢 → 拿結果）
 * 在還沒有 Adobe 憑證時就能被前端與代理真正跑過一遍：
 * - 工作是非同步的（送出後 queued → running → succeeded），逼呼叫端老實寫輪詢，不會等到切 real 才發現卡住；
 * - 結果資產的尺寸依實際操作推導（裁切、縮放會改變寬高），UI 的「前後對照」才不是死圖；
 * - 資產 id 亂填會被拒絕，錯誤處理路徑同樣測得到。
 *
 * 狀態存在單一容器的記憶體（全站慣例，與 rate limit 快取同一心智模型）：重啟後工作消失，
 * 這在 mock 模式是可接受的——真正的工作狀態在 real 模式由 Adobe 端保存。
 */
import { randomUUID } from "node:crypto";
import type { AdobePhotoEditRequest, AdobeTimeline } from "../../../shared/adobe";
import { describePhotoEdit, timelineDurationSec } from "../../../shared/adobe";
import type { AdobeAsset, AdobeCapabilities, AdobeClient, AdobeJob } from "./types";

/** 模擬工作耗時：送出後多久算完成（輪詢兩三次就會看到結果，不拖慢前端測試） */
export const MOCK_JOB_DURATION_MS = 1_500;
/** 記憶體內保留的工作數上限（防長跑實例慢慢長胖） */
const MAX_TRACKED_JOBS = 500;

/** 模擬素材庫：兩張圖 ＋ 兩段影片，涵蓋修圖與剪輯兩條路徑 */
export const MOCK_ASSETS: AdobeAsset[] = [
  { id: "mock-photo-001", name: "法會主視覺.jpg", mime: "image/jpeg", width: 4032, height: 3024, modifiedAt: "2026-07-01T02:00:00.000Z" },
  { id: "mock-photo-002", name: "講師特寫.png", mime: "image/png", width: 2400, height: 1600, modifiedAt: "2026-07-03T09:30:00.000Z" },
  { id: "mock-clip-001", name: "開場空拍.mp4", mime: "video/mp4", width: 3840, height: 2160, durationSec: 12.5, modifiedAt: "2026-07-05T11:00:00.000Z" },
  { id: "mock-clip-002", name: "訪談段落.mp4", mime: "video/mp4", width: 1920, height: 1080, durationSec: 48, modifiedAt: "2026-07-06T04:20:00.000Z" },
];

interface TrackedJob extends AdobeJob {
  finishAt: number;
}

/** 純函式（可測）：依操作序列推導成品尺寸——裁切與縮放會改變寬高，其餘操作不動 */
export function deriveOutputSize(
  source: { width?: number; height?: number },
  request: AdobePhotoEditRequest,
): { width?: number; height?: number } {
  let width = source.width;
  let height = source.height;
  for (const operation of request.operations) {
    if (operation.op === "crop") {
      width = operation.width;
      height = operation.height;
    } else if (operation.op === "resize") {
      width = operation.width;
      height = operation.height;
    }
  }
  return { width, height };
}

export class MockAdobeClient implements AdobeClient {
  readonly mode = "mock" as const;
  readonly capabilities: AdobeCapabilities = { photoEdit: true, timelineRender: true, assetBrowse: true };

  private readonly jobs = new Map<string, TrackedJob>();
  private readonly assets: AdobeAsset[];
  private readonly now: () => number;

  constructor(options: { now?: () => number; assets?: AdobeAsset[] } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.assets = options.assets ?? MOCK_ASSETS;
  }

  async listAssets(_accessToken: string, input: { query?: string; limit: number }): Promise<AdobeAsset[]> {
    const query = (input.query ?? "").trim().toLowerCase();
    return this.assets
      .filter((asset) => !query || asset.name.toLowerCase().includes(query) || asset.id.includes(query))
      .slice(0, input.limit);
  }

  async editPhoto(_accessToken: string, request: AdobePhotoEditRequest): Promise<AdobeJob> {
    const source = this.requireAsset(request.assetId);
    if (!source.mime.startsWith("image/")) throw new Error(`「${source.name}」不是圖片，無法送修圖`);
    const size = deriveOutputSize(source, request);
    const suffix = request.outputFormat === "jpeg" ? "jpg" : request.outputFormat;
    return this.enqueue("photo", {
      id: `mock-photo-out-${randomUUID().slice(0, 8)}`,
      name: request.outputName ?? `${stripExtension(source.name)}-已編輯.${suffix}`,
      mime: `image/${request.outputFormat}`,
      ...size,
      modifiedAt: new Date(this.now()).toISOString(),
    }, describePhotoEdit(request));
  }

  async renderTimeline(_accessToken: string, timeline: AdobeTimeline): Promise<AdobeJob> {
    for (const clip of timeline.clips) this.requireAsset(clip.assetId);
    return this.enqueue("timeline", {
      id: `mock-render-${randomUUID().slice(0, 8)}`,
      name: `${timeline.name}.mp4`,
      mime: "video/mp4",
      width: timeline.width,
      height: timeline.height,
      durationSec: timelineDurationSec(timeline),
      modifiedAt: new Date(this.now()).toISOString(),
    }, `${timeline.clips.length} 個片段・${timelineDurationSec(timeline).toFixed(1)} 秒`);
  }

  async getJob(_accessToken: string, jobId: string): Promise<AdobeJob> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("找不到這個 Adobe 工作（模擬工作在伺服器重啟後不保留）");
    return this.settle(job);
  }

  private requireAsset(assetId: string): AdobeAsset {
    const asset = this.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error(`找不到 Adobe 素材：${assetId}`);
    return asset;
  }

  private enqueue(kind: AdobeJob["kind"], resultAsset: AdobeAsset, detail: string): AdobeJob {
    const startedAt = this.now();
    const job: TrackedJob = {
      id: `mock-job-${randomUUID()}`,
      kind,
      status: "queued",
      progress: 0,
      resultAsset,
      error: undefined,
      createdAt: new Date(startedAt).toISOString(),
      updatedAt: new Date(startedAt).toISOString(),
      finishAt: startedAt + MOCK_JOB_DURATION_MS,
    };
    // detail 只進伺服器 log，讓 mock 模式下也看得出「AI 到底想做什麼編輯」
    console.log(`[adobe:mock] ${kind} 工作 ${job.id}：${detail}`);
    if (this.jobs.size >= MAX_TRACKED_JOBS) {
      const oldest = this.jobs.keys().next().value;
      if (oldest) this.jobs.delete(oldest);
    }
    this.jobs.set(job.id, job);
    return this.settle(job);
  }

  /** 依經過時間推進狀態：查詢時才結算，不需要背景計時器 */
  private settle(job: TrackedJob): AdobeJob {
    const now = this.now();
    const elapsed = now - Date.parse(job.createdAt);
    if (now >= job.finishAt) {
      job.status = "succeeded";
      job.progress = 100;
    } else if (elapsed > 0) {
      job.status = "running";
      job.progress = Math.min(95, Math.round((elapsed / MOCK_JOB_DURATION_MS) * 100));
    } else {
      job.status = "queued";
      job.progress = 0;
    }
    job.updatedAt = new Date(now).toISOString();
    const { finishAt: _finishAt, ...view } = job;
    return { ...view, resultAsset: job.status === "succeeded" ? job.resultAsset : undefined };
  }
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
