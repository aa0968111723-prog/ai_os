/**
 * 上傳檔案簽名嗅探（QA-021）單元測試：
 * sniffMime 認得常見二進位簽名；resolveUploadMime 對「宣稱與內容不符」的檔案
 * 依內容校正（.jpg 內容其實是 WebP）或拒絕（宣稱圖片但簽名辨識不出）。
 */
import { describe, expect, it } from "vitest";
import { resolveUploadMime, sniffMime } from "./storage";

const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);

const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(8)]);
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(8)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(8)]);
const ZIP = pad([0x50, 0x4b, 0x03, 0x04]);
const TEXT = Buffer.from("這是一段純文字內容，沒有二進位簽名。");

describe("sniffMime", () => {
  it("認得 JPEG/PNG/WebP/WAV/MP4(ftyp)/PDF/ZIP", () => {
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(WEBP)).toBe("image/webp");
    expect(sniffMime(WAV)).toBe("audio/wav");
    expect(sniffMime(MP4)).toBe("video/mp4");
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(ZIP)).toBe("application/zip");
  });

  it("文字內容與過短的緩衝回 null", () => {
    expect(sniffMime(TEXT)).toBeNull();
    expect(sniffMime(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe("resolveUploadMime", () => {
  it("宣稱與內容一致：沿用宣稱", () => {
    expect(resolveUploadMime("image/jpeg", JPEG)).toEqual({ mime: "image/jpeg", corrected: false });
    expect(resolveUploadMime("application/pdf", PDF)).toEqual({ mime: "application/pdf", corrected: false });
  });

  it("QA-021 主案例：宣稱 image/jpeg、內容是 WebP → 依內容校正為 image/webp", () => {
    expect(resolveUploadMime("image/jpeg", WEBP)).toEqual({ mime: "image/webp", corrected: true });
  });

  it("容器家族相容：docx 宣稱配 PK 簽名、mov/m4a 宣稱配 ftyp 簽名不誤判", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(resolveUploadMime(docx, ZIP)).toEqual({ mime: docx, corrected: false });
    expect(resolveUploadMime("video/quicktime", MP4)).toEqual({ mime: "video/quicktime", corrected: false });
    expect(resolveUploadMime("audio/mp4", MP4)).toEqual({ mime: "audio/mp4", corrected: false });
  });

  it("宣稱圖片但辨識不出簽名 → 拒絕（回 null）", () => {
    expect(resolveUploadMime("image/png", TEXT)).toBeNull();
  });

  it("文字類（無簽名）沿用宣稱", () => {
    expect(resolveUploadMime("text/markdown", TEXT)).toEqual({ mime: "text/markdown", corrected: false });
  });
});
