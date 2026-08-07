/**
 * 白板 → PNG。用途只有一個：把手稿變成專案素材，綁到分鏡的畫面上。
 *
 * 刻意**不含**底下的參考圖：白板上的參考圖是拿來描的（分鏡現用畫面），
 * 把它一起烘進去等於把舊畫面又存了一份，之後誰也分不清哪張是手稿。
 * 匯出的永遠是「白紙＋你畫的線」。
 */

import { renderBoard, renderPaper } from "./boardRender";
import type { BoardDoc } from "./boardDoc";

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * 依長邊上限把白板畫成 PNG。`maxEdge` 由 studioLayout 給——
 * 手機輕量版用比較小的值（記憶體與上傳頻寬都吃緊）。
 */
export async function exportBoardPng(doc: BoardDoc, maxEdge: number): Promise<ExportResult | null> {
  const longest = Math.max(doc.w, doc.h);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(doc.w * scale));
  const height = Math.max(1, Math.round(doc.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const view = { scale, offsetX: 0, offsetY: 0 };
  renderPaper(ctx, doc, view);
  renderBoard(ctx, doc, view);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
  if (!blob) return null;
  return { blob, width, height };
}

/** 檔名：進到素材庫之後要一眼看出是哪一鏡的手稿 */
export function boardFileName(shotLabel: string | null): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const base = shotLabel ? `手稿-${shotLabel}` : "手稿";
  return `${base}-${stamp}.png`.replace(/[\\/:*?"<>|]/g, "-");
}
