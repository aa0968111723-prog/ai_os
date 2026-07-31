/**
 * Adobe 服務層型別（#224 PR3）：Client 介面 ＋ 資產／工作形狀。
 *
 * 介面刻意只長成「送工作 → 查工作」的非同步樣子，因為 Adobe 的影像服務本來就是這個形狀
 * （提交回一組工作網址，之後輪詢狀態）。mock 與 real 兩個實作都滿足同一介面，
 * 上層（router／代理步驟）永遠不需要知道現在是哪一種模式。
 */
import type {
  AdobeJobStatus,
  AdobeMode,
  AdobePhotoEditRequest,
  AdobeTimeline,
} from "../../../shared/adobe";

export interface AdobeAsset {
  id: string;
  name: string;
  mime: string;
  width?: number;
  height?: number;
  durationSec?: number;
  /** 預覽網址（短效）；mock 模式為 data: 佔位圖，不對外連線 */
  previewUrl?: string;
  modifiedAt?: string;
}

export interface AdobeJob {
  id: string;
  kind: "photo" | "timeline";
  status: AdobeJobStatus;
  /** 0–100；real 模式的 Adobe 只回階段狀態，沒有細部進度時以 0/50/100 表示 */
  progress: number;
  /** 成功後產生的資產（存回使用者自己的 Adobe 帳號） */
  resultAsset?: AdobeAsset;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** 目前模式支援的能力：real 模式尚未接上的部分會誠實回 false，UI 才不會給出做不到的按鈕 */
export interface AdobeCapabilities {
  photoEdit: boolean;
  timelineRender: boolean;
  assetBrowse: boolean;
}

/** 呼叫端可辨識的「這個模式不支援」錯誤——與「真的失敗了」分開，UI 顯示不同引導 */
export class AdobeUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdobeUnsupportedError";
  }
}

/** Adobe 端明確拒絕授權（401/403）——上層據此把連結標記 error 並引導重新連結 */
export class AdobeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdobeAuthError";
  }
}

export interface AdobeClient {
  readonly mode: AdobeMode;
  readonly capabilities: AdobeCapabilities;
  /** 列出使用者 Adobe 帳號內可用的素材（只回中繼資料，不抓內容） */
  listAssets(accessToken: string, input: { query?: string; limit: number }): Promise<AdobeAsset[]>;
  /** 送出修圖工作（不等完成） */
  editPhoto(accessToken: string, request: AdobePhotoEditRequest): Promise<AdobeJob>;
  /** 送出時間軸算圖工作（不等完成） */
  renderTimeline(accessToken: string, timeline: AdobeTimeline): Promise<AdobeJob>;
  /** 查工作狀態（輪詢） */
  getJob(accessToken: string, jobId: string): Promise<AdobeJob>;
}
