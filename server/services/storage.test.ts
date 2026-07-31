/**
 * 上傳檔案簽名嗅探（QA-021）單元測試：
 * sniffMime 認得常見二進位簽名；resolveUploadMime 對「宣稱與內容不符」的檔案
 * 依內容校正（.jpg 內容其實是 WebP）或拒絕（宣稱圖片但簽名辨識不出）。
 *
 * persistRemote 結構化失敗分類測試（素材遺失防護）：
 * 補抓佇列靠 reason/retryable 決定「排下一輪」或「直接退場」，分類錯了就是
 * 死列佔滿佇列或活列被誤殺——這裡把 HTTP 狀態、大小上限、逾時的對照表整個釘住。
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// persistRemote 的網路層以 mock 取代（單元測試不打真網路）；
// 本檔其餘案例（sniffMime/resolveUploadMime）是純函式，不經過 proxyFetch，不受影響。
const proxyFetchMock = vi.hoisted(() => vi.fn());
vi.mock("./http", () => ({ proxyFetch: proxyFetchMock }));

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

  it("ISO-BMFF 依 major brand 細分：HEIC/AVIF 是圖片、QT 是影片、M4A 是音訊（修 R2-STOR-01）", () => {
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(8)]);
    const heif = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypmif1"), Buffer.alloc(8)]);
    const avif = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypavif"), Buffer.alloc(8)]);
    const qt = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypqt  "), Buffer.alloc(8)]);
    const m4a = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A "), Buffer.alloc(8)]);
    expect(sniffMime(heic)).toBe("image/heic");
    expect(sniffMime(heif)).toBe("image/heic");
    expect(sniffMime(avif)).toBe("image/avif");
    expect(sniffMime(qt)).toBe("video/quicktime");
    expect(sniffMime(m4a)).toBe("audio/mp4");
    expect(sniffMime(MP4)).toBe("video/mp4"); // isom 仍是影片
  });

  it("BMP/TIFF 簽名認得（白名單有列，過去嗅探不出被誤 415）（修 R2-STOR-01）", () => {
    const bmp = Buffer.concat([Buffer.from([0x42, 0x4d]), Buffer.alloc(14)]);
    const tiffLE = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(12)]);
    const tiffBE = Buffer.concat([Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), Buffer.alloc(12)]);
    expect(sniffMime(bmp)).toBe("image/bmp");
    expect(sniffMime(tiffLE)).toBe("image/tiff");
    expect(sniffMime(tiffBE)).toBe("image/tiff");
  });

  it("iPhone HEIC 照片：宣稱 image/heic＋ftypheic 內容 → 沿用宣稱、不誤校正成 video/mp4（修 R2-STOR-01）", () => {
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(8)]);
    expect(resolveUploadMime("image/heic", heic)).toEqual({ mime: "image/heic", corrected: false });
    // SVG：XML 文字無簽名，宣稱 image/svg+xml 應放行（強制下載）
    expect(resolveUploadMime("image/svg+xml", TEXT)).toEqual({ mime: "image/svg+xml", corrected: false });
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

/* ── persistRemote：失敗分類對照表與成功落地 ─────────────────────────────── */

/** 假造串流 body：records reader，讓「串流超限要 cancel」的案例能驗證中止行為 */
function streamBody(chunks: Uint8Array[]) {
  let i = 0;
  const reader = {
    read: vi.fn(async () =>
      i < chunks.length ? { done: false as const, value: chunks[i++] } : { done: true as const, value: undefined },
    ),
    cancel: vi.fn(async () => {}),
  };
  return { getReader: () => reader, cancel: vi.fn(async () => {}), reader };
}

function fakeResponse(opts: { status?: number; headers?: Record<string, string>; body?: unknown }) {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(opts.headers ?? {}),
    body: opts.body ?? null,
  };
}

describe("persistRemote", () => {
  // 需要一份「ASSET_DIR 指向臨時目錄、單檔上限縮成 1MB」的 storage 模組——
  // 兩個值都在模組載入當下讀 env，所以得 resetModules 後動態 import 一份新的。
  // 檔頭靜態 import 那份維持預設 env，不受影響。
  let storage: typeof import("./storage");
  let tmpRoot: string;
  const envBackup: Record<string, string | undefined> = {};
  const MAX = 1024 * 1024; // 與 ASSET_MAX_MB=1 對應

  beforeAll(async () => {
    for (const k of ["ASSET_DIR", "ASSET_MAX_MB"]) envBackup[k] = process.env[k];
    tmpRoot = mkdtempSync(path.join(tmpdir(), "aios-storage-test-"));
    process.env.ASSET_DIR = tmpRoot;
    process.env.ASSET_MAX_MB = "1"; // 串流超限案例才不必真的灌 200MB
    vi.resetModules();
    storage = await import("./storage");
  });

  afterAll(() => {
    for (const k of ["ASSET_DIR", "ASSET_MAX_MB"]) {
      if (envBackup[k] === undefined) delete process.env[k];
      else process.env[k] = envBackup[k];
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    proxyFetchMock.mockReset();
  });

  it("HTTP 404/410（來源已消失）→ gone、不可重試——死列必須退場，不能佔補抓名額", async () => {
    for (const status of [404, 410]) {
      proxyFetchMock.mockResolvedValueOnce(fakeResponse({ status }));
      const result = await storage.persistRemote("https://cdn.example/gone.png");
      expect(result).toMatchObject({ ok: false, reason: "gone", retryable: false });
      if (!result.ok) expect(result.detail).toContain("已不存在");
    }
  });

  it("其他非 2xx（如 503）→ http、可重試", async () => {
    proxyFetchMock.mockResolvedValueOnce(fakeResponse({ status: 503 }));
    const result = await storage.persistRemote("https://cdn.example/flaky.png");
    expect(result).toMatchObject({ ok: false, reason: "http", retryable: true });
  });

  it("Content-Length 超過單檔上限 → too-large、不可重試，並取消 body", async () => {
    const body = streamBody([]);
    proxyFetchMock.mockResolvedValueOnce(
      fakeResponse({
        headers: { "content-type": "image/png", "content-length": String(MAX + 1) },
        body,
      }),
    );
    const result = await storage.persistRemote("https://cdn.example/huge.png");
    expect(result).toMatchObject({ ok: false, reason: "too-large", retryable: false });
    expect(body.cancel).toHaveBeenCalled(); // 不下載也要把連線收掉
  });

  it("串流累計超過上限（來源沒報／謊報 Content-Length）→ too-large，且 reader.cancel 有被呼叫", async () => {
    // 兩塊 600KB：第二塊讀完累計 1.17MB > 1MB 上限，必須當場中止而不是吞完整包才量
    const chunk = new Uint8Array(600 * 1024);
    const body = streamBody([chunk, chunk, chunk]);
    proxyFetchMock.mockResolvedValueOnce(
      fakeResponse({ headers: { "content-type": "video/mp4" }, body }),
    );
    const result = await storage.persistRemote("https://cdn.example/liar.mp4");
    expect(result).toMatchObject({ ok: false, reason: "too-large", retryable: false });
    expect(body.reader.cancel).toHaveBeenCalled(); // 超限當下就取消串流，不繼續吃資料
    expect(body.reader.read).toHaveBeenCalledTimes(2); // 第三塊根本不該被讀
  });

  it("逾時（TimeoutError）→ timeout、可重試", async () => {
    proxyFetchMock.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
    );
    const result = await storage.persistRemote("https://cdn.example/slow.png");
    expect(result).toMatchObject({ ok: false, reason: "timeout", retryable: true });
    if (!result.ok) expect(result.detail).toContain("逾時");
  });

  it("連線層錯誤（非逾時）→ io、可重試", async () => {
    proxyFetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const result = await storage.persistRemote("https://cdn.example/reset.png");
    expect(result).toMatchObject({ ok: false, reason: "io", retryable: true });
  });

  it("成功：落地為原子發佈檔，sha256／sizeBytes／mime 正確，statStored 找得到", async () => {
    // 內容刻意跨兩塊串流：驗證 sha256 是「邊下載邊算」而不是對半截資料算的
    const part1 = Buffer.from("素材遺失防護-第一段-".repeat(1000));
    const part2 = Buffer.from("第二段-".repeat(500));
    const data = Buffer.concat([part1, part2]);
    const body = streamBody([new Uint8Array(part1), new Uint8Array(part2)]);
    proxyFetchMock.mockResolvedValueOnce(
      fakeResponse({
        headers: { "content-type": "image/png", "content-length": String(data.length) },
        body,
      }),
    );
    const result = await storage.persistRemote("https://cdn.example/ok.png");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.mime).toBe("image/png");
    expect(result.sizeBytes).toBe(data.length);
    expect(result.sha256).toBe(createHash("sha256").update(data).digest("hex"));
    // 相對路徑維持 yyyy/mm/uuid.ext 慣例（DB 記這個）
    expect(result.storagePath).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    // 檔案真的在磁碟上、大小一致——這正是對帳模組之後要問的問題
    const stored = await storage.statStored(result.storagePath);
    expect(stored).not.toBeNull();
    expect(stored?.sizeBytes).toBe(data.length);
  });
});
