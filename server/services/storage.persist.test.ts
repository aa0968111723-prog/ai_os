/**
 * 素材持久化大量測試（上線前守門）：
 * - 寫入後能讀回、內容與位元組數不變
 * - 大量並發寫入不會互相覆蓋或遺失
 * - 軟刪除（不刪 Volume 檔）後檔案仍在；永久刪除才清檔
 * - 路徑跳脫被擋、copy 生命週期獨立、簽名網址可驗
 *
 * 用獨立 ASSET_DIR 暫存目錄隔離，不碰本機 .data／正式 Volume。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

let assetDir: string;
let storage: typeof import("./storage");

async function fileExists(abs: string): Promise<boolean> {
  try {
    await access(abs, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  assetDir = await mkdtemp(path.join(tmpdir(), "aios-storage-persist-"));
  process.env.ASSET_DIR = assetDir;
  process.env.ASSET_SIGN_SECRET = "test-asset-sign-secret-for-persist-suite-v1";
  // 避免 APP_URL 影響簽名 URL 斷言；測試內只比 sig 可驗
  process.env.APP_URL = "http://localhost:3000";
  vi.resetModules();
  storage = await import("./storage");
  storage.ensureStorageDirs();
});

afterAll(async () => {
  if (assetDir) await rm(assetDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});

describe("storage 持久化：寫入／讀回", () => {
  it("saveBuffer 後檔案在 ASSET_DIR、內容完整、sizeBytes 正確", async () => {
    const payload = Buffer.from("persist-probe-內容-αβγ-🖼️");
    const saved = await storage.saveBuffer(payload, "text/plain");
    expect(saved.sizeBytes).toBe(payload.length);
    expect(saved.storagePath).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.txt$/);

    const abs = storage.absPathOf(saved.storagePath);
    expect(abs.startsWith(path.resolve(assetDir, "assets"))).toBe(true);
    const disk = await readFile(abs);
    expect(disk.equals(payload)).toBe(true);
  });

  it("PNG／MP4／PDF 副檔名與 MIME 對應正確", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(16, 2)]);
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(24, 3)]);

    const a = await storage.saveBuffer(png, "image/png");
    const b = await storage.saveBuffer(pdf, "application/pdf");
    const c = await storage.saveBuffer(mp4, "video/mp4");

    expect(a.storagePath.endsWith(".png")).toBe(true);
    expect(b.storagePath.endsWith(".pdf")).toBe(true);
    expect(c.storagePath.endsWith(".mp4")).toBe(true);
    expect((await readFile(storage.absPathOf(a.storagePath))).equals(png)).toBe(true);
    expect((await readFile(storage.absPathOf(b.storagePath))).equals(pdf)).toBe(true);
    expect((await readFile(storage.absPathOf(c.storagePath))).equals(mp4)).toBe(true);
  });

  it("模擬程序重啟：同一 ASSET_DIR 下相對路徑仍能解析到同一檔", async () => {
    const payload = Buffer.from("survives-restart-marker");
    const { storagePath } = await storage.saveBuffer(payload, "text/plain");

    // 重新載入模組（模擬重啟）但仍指向同一 ASSET_DIR
    vi.resetModules();
    const reloaded = await import("./storage");
    const abs = reloaded.absPathOf(storagePath);
    expect(await fileExists(abs)).toBe(true);
    expect((await readFile(abs)).equals(payload)).toBe(true);
    // 後續測試繼續用原 storage 參照（同一 ASSET_DIR 常數）
    storage = reloaded;
  });
});

describe("storage 持久化：大量寫入不會遺失", () => {
  it("並行寫入 200 個檔案，全部可讀回且內容唯一", async () => {
    const N = 200;
    const jobs = Array.from({ length: N }, (_, i) => {
      const body = Buffer.from(`bulk-${i}-` + "x".repeat((i % 17) + 1));
      return storage.saveBuffer(body, "text/plain").then((saved) => ({ i, body, saved }));
    });
    const results = await Promise.all(jobs);

    const paths = new Set(results.map((r) => r.saved.storagePath));
    expect(paths.size).toBe(N); // 路徑不碰撞

    for (const r of results) {
      const disk = await readFile(storage.absPathOf(r.saved.storagePath));
      expect(disk.equals(r.body)).toBe(true);
      expect(r.saved.sizeBytes).toBe(r.body.length);
    }
  }, 15_000);

  it("寫入後刪除一半，剩下一半仍完整可讀", async () => {
    const N = 80;
    const saved = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        storage.saveBuffer(Buffer.from(`half-life-${i}`), "text/plain"),
      ),
    );

    // 偶數刪、奇數留（模擬 purge 部分素材）
    await Promise.all(
      saved.filter((_, i) => i % 2 === 0).map((s) => storage.removeStoredFile(s.storagePath)),
    );

    for (let i = 0; i < N; i++) {
      const abs = storage.absPathOf(saved[i].storagePath);
      if (i % 2 === 0) {
        expect(await fileExists(abs)).toBe(false);
      } else {
        expect(await fileExists(abs)).toBe(true);
        expect(await readFile(abs, "utf8")).toBe(`half-life-${i}`);
      }
    }
  }, 15_000);
});

describe("storage 持久化：軟刪除 vs 永久刪除語意", () => {
  it("軟刪除不呼叫 removeStoredFile → Volume 檔仍在（還原可救）", async () => {
    const payload = Buffer.from("soft-delete-keep-file");
    const { storagePath } = await storage.saveBuffer(payload, "text/plain");
    // 應用層 deleteAsset 只設 deletedAt，不碰檔案——此處驗證檔仍在
    expect(await fileExists(storage.absPathOf(storagePath))).toBe(true);
    expect((await readFile(storage.absPathOf(storagePath))).equals(payload)).toBe(true);
  });

  it("永久刪除 removeStoredFile 後檔案消失、再次刪不丟錯", async () => {
    const { storagePath } = await storage.saveBuffer(Buffer.from("purge-me"), "text/plain");
    await storage.removeStoredFile(storagePath);
    expect(await fileExists(storage.absPathOf(storagePath))).toBe(false);
    // 冪等：再刪一次不應 throw
    await expect(storage.removeStoredFile(storagePath)).resolves.toBeUndefined();
  });
});

describe("storage 持久化：adopt／copy／路徑安全", () => {
  it("adoptTmpFile 把暫存檔移到正式位置（原路徑消失、新路徑可讀）", async () => {
    storage.ensureStorageDirs();
    const tmpPath = path.join(storage.tmpDir(), `adopt-${Date.now()}.bin`);
    const payload = Buffer.from("adopted-from-multer-tmp");
    await writeFile(tmpPath, payload);

    const { storagePath, sizeBytes } = await storage.adoptTmpFile(tmpPath, "application/pdf");
    expect(sizeBytes).toBe(payload.length);
    expect(storagePath.endsWith(".pdf")).toBe(true);
    expect(await fileExists(tmpPath)).toBe(false); // rename 走掉
    expect((await readFile(storage.absPathOf(storagePath))).equals(payload)).toBe(true);
  });

  it("copyStoredFile 實體複製：刪原檔不影響副本", async () => {
    const payload = Buffer.from("independent-lifecycle");
    const orig = await storage.saveBuffer(payload, "image/png");
    const copy = await storage.copyStoredFile(orig.storagePath, "image/png");

    expect(copy.storagePath).not.toBe(orig.storagePath);
    expect(copy.sizeBytes).toBe(payload.length);

    await storage.removeStoredFile(orig.storagePath);
    expect(await fileExists(storage.absPathOf(orig.storagePath))).toBe(false);
    expect((await readFile(storage.absPathOf(copy.storagePath))).equals(payload)).toBe(true);
  });

  it("absPathOf 擋路徑跳脫（..／絕對路徑兄弟目錄）", () => {
    expect(() => storage.absPathOf("../etc/passwd")).toThrow(/非法儲存路徑/);
    expect(() => storage.absPathOf("../../secret")).toThrow(/非法儲存路徑/);
    // 合法相對路徑不 throw
    expect(() => storage.absPathOf("2026/08/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png")).not.toThrow();
  });

  it("isFeedbackShotPath 只認 feedback/uuid.ext", () => {
    expect(storage.isFeedbackShotPath("feedback/11111111-2222-3333-4444-555555555555.png")).toBe(true);
    expect(storage.isFeedbackShotPath("2026/08/11111111-2222-3333-4444-555555555555.png")).toBe(false);
    expect(storage.isFeedbackShotPath("feedback/not-a-uuid.png")).toBe(false);
    expect(storage.isFeedbackShotPath("feedback/11111111-2222-3333-4444-555555555555.exe")).toBe(false);
  });
});

describe("storage 持久化：簽名網址／磁碟守門／kind", () => {
  it("signAssetUrl + verifyAssetSig 成對可驗；過期／竄改失敗", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const url = storage.signAssetUrl(id, 3600);
    const u = new URL(url);
    expect(u.pathname).toBe(`/api/assets/${id}/file`);
    const exp = u.searchParams.get("exp")!;
    const sig = u.searchParams.get("sig")!;
    expect(storage.verifyAssetSig(id, exp, sig)).toBe(true);
    expect(storage.verifyAssetSig(id, exp, "0".repeat(sig.length))).toBe(false);
    expect(storage.verifyAssetSig(id, String(Number(exp) - 10_000), sig)).toBe(false); // 過期
    expect(storage.verifyAssetSig("00000000-0000-0000-0000-000000000000", exp, sig)).toBe(false);
  });

  it("publicBaseUrl：APP_URL 未設時退 PUBLIC_DOMAIN（不落入 localhost 陷阱）", async () => {
    const prevApp = process.env.APP_URL;
    const prevPub = process.env.PUBLIC_DOMAIN;
    delete process.env.APP_URL;
    process.env.PUBLIC_DOMAIN = "example.zeabur.app";
    vi.resetModules();
    const reloaded = await import("./storage");
    expect(reloaded.publicBaseUrl()).toBe("https://example.zeabur.app");
    const id = "11111111-2222-3333-4444-555555555555";
    expect(reloaded.signAssetUrl(id, 60)).toMatch(/^https:\/\/example\.zeabur\.app\/api\/assets\//);
    process.env.APP_URL = prevApp;
    if (prevPub === undefined) delete process.env.PUBLIC_DOMAIN;
    else process.env.PUBLIC_DOMAIN = prevPub;
    // 還原測試模組
    vi.resetModules();
    storage = await import("./storage");
  });

  it("MAX_AI_RESULT_BYTES 預設高於上傳 MAX_FILE_BYTES（長片可落地）", () => {
    expect(storage.MAX_AI_RESULT_BYTES).toBeGreaterThanOrEqual(storage.MAX_FILE_BYTES);
  });

  it("dbfile 簽名與 asset 簽名不可互換", () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const assetUrl = storage.signAssetUrl(id, 3600);
    const dbUrl = storage.signDbFileUrl(id, 3600);
    const a = new URL(assetUrl);
    const d = new URL(dbUrl);
    // asset sig 不能當 dbfile 用、反之亦然
    expect(storage.verifyDbFileSig(id, a.searchParams.get("exp")!, a.searchParams.get("sig")!)).toBe(false);
    expect(storage.verifyAssetSig(id, d.searchParams.get("exp")!, d.searchParams.get("sig")!)).toBe(false);
    expect(storage.verifyDbFileSig(id, d.searchParams.get("exp")!, d.searchParams.get("sig")!)).toBe(true);
  });

  it("checkDiskSpace：超過 ASSET_MAX_MB 拒收", async () => {
    // MAX_FILE_BYTES 來自模組載入時 ASSET_MAX_MB；預設 200MB
    const tooBig = storage.MAX_FILE_BYTES + 1;
    const msg = await storage.checkDiskSpace(tooBig);
    expect(msg).toMatch(/檔案太大/);
  });

  it("checkDiskSpace：正常大小不因過大而拒", async () => {
    const msg = await storage.checkDiskSpace(1024);
    // 空間充足時應為 null；若測試環境 free 真的極低才會回空間不足
    if (msg !== null) expect(msg).toMatch(/儲存空間不足/);
    else expect(msg).toBeNull();
  });

  it("kindFromMime 與 shouldForceAttachment", () => {
    expect(storage.kindFromMime("image/png")).toBe("image");
    expect(storage.kindFromMime("video/mp4")).toBe("video");
    expect(storage.kindFromMime("audio/mpeg")).toBe("audio");
    expect(storage.kindFromMime("application/pdf")).toBe("doc");
    expect(storage.shouldForceAttachment("application/pdf")).toBe(true);
    expect(storage.shouldForceAttachment("image/svg+xml")).toBe(true); // XSS 防護
    expect(storage.shouldForceAttachment("image/png")).toBe(false);
    expect(storage.shouldForceAttachment("video/mp4")).toBe(false);
  });
});

describe("storage 持久化：內容指紋穩定（上線前抽樣可比對）", () => {
  it("同一 buffer 寫入後 sha256 與原檔一致（備份完整性對照用）", async () => {
    const payload = Buffer.alloc(64 * 1024, 0x5a);
    payload.write("fingerprint-head", 0);
    const expected = createHash("sha256").update(payload).digest("hex");
    const { storagePath } = await storage.saveBuffer(payload, "application/octet-stream");
    const disk = await readFile(storage.absPathOf(storagePath));
    const actual = createHash("sha256").update(disk).digest("hex");
    expect(actual).toBe(expected);
  });

  it("連續 50 次寫入不同內容，sha256 全部互異且可讀回", async () => {
    const digests = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const payload = Buffer.from(`digest-round-${i}-${Math.random()}`);
      const { storagePath } = await storage.saveBuffer(payload, "text/plain");
      const h = createHash("sha256").update(await readFile(storage.absPathOf(storagePath))).digest("hex");
      digests.add(h);
    }
    expect(digests.size).toBe(50);
  }, 15_000);
});

describe("storage 持久化：feedback 截圖路徑", () => {
  it("adoptFeedbackShot 落在 feedback/ 且 isFeedbackShotPath 通過", async () => {
    storage.ensureStorageDirs();
    const tmpPath = path.join(storage.tmpDir(), `fb-${Date.now()}.png`);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
    await writeFile(tmpPath, png);
    const { storagePath, sizeBytes } = await storage.adoptFeedbackShot(tmpPath, "image/png");
    expect(sizeBytes).toBe(png.length);
    expect(storage.isFeedbackShotPath(storagePath)).toBe(true);
    expect(storagePath.startsWith("feedback/")).toBe(true);
    expect((await readFile(storage.absPathOf(storagePath))).equals(png)).toBe(true);
  });
});
