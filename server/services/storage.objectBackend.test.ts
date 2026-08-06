/**
 * 儲存層的後端切換測試：設了物件儲存環境變數之後，寫入／查詢／刪除是不是真的走物件儲存，
 * 而且相對路徑（storage_path）與本機後端完全相同——這是「切換後端不用改資料庫」的前提，
 * 一旦走鐘，站上所有舊素材會在切換當下集體變成 404。
 */
import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetObjectStoreConfigForTests } from "./objectStore";
import {
  assessStoragePersistence,
  checkDiskSpace,
  openStoredObject,
  removeStoredFile,
  saveBuffer,
  statStored,
  storageBackend,
  storageBackendNote,
} from "./storage";

const stored = new Map<string, Buffer>();

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const key = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname.replace(/^\/bucket\/?/, ""));
    if (req.method === "PUT") {
      stored.set(key, Buffer.concat(chunks));
      res.writeHead(200).end();
    } else if (req.method === "DELETE") {
      stored.delete(key);
      res.writeHead(204).end();
    } else {
      const found = stored.get(key);
      if (!found) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(found.length) });
      res.end(req.method === "HEAD" ? undefined : found);
    }
  });
});

function enableObjectStore(port: number): void {
  process.env.S3_ENDPOINT = `http://127.0.0.1:${port}`;
  process.env.S3_BUCKET = "bucket";
  process.env.S3_ACCESS_KEY_ID = "AKID";
  process.env.S3_SECRET_ACCESS_KEY = "SECRET";
  resetObjectStoreConfigForTests();
}

function disableObjectStore(): void {
  for (const key of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) delete process.env[key];
  resetObjectStoreConfigForTests();
}

let port = 0;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  disableObjectStore();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  stored.clear();
  disableObjectStore();
});

describe("後端選擇", () => {
  it("沒設物件儲存就是本機磁碟（預設行為不變）", () => {
    expect(storageBackend()).toBe("local");
  });

  it("設了就切到物件儲存", () => {
    enableObjectStore(port);
    expect(storageBackend()).toBe("object");
    expect(storageBackendNote()).toContain("bucket");
  });

  it("後端說明不含金鑰（會顯示在自檢頁上）", () => {
    enableObjectStore(port);
    expect(storageBackendNote()).not.toContain("SECRET");
    expect(storageBackendNote()).not.toContain("AKID");
  });
});

describe("物件儲存後端的讀寫刪", () => {
  it("saveBuffer 寫進物件儲存，且相對路徑仍是 YYYY/MM/uuid.ext", async () => {
    enableObjectStore(port);
    const saved = await saveBuffer(Buffer.from("hello"), "image/png");
    expect(saved.storagePath).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(saved.sizeBytes).toBe(5);
    expect(stored.get(saved.storagePath)?.toString()).toBe("hello");
  });

  it("statStored 查得到大小", async () => {
    enableObjectStore(port);
    const saved = await saveBuffer(Buffer.from("12345678"), "text/plain");
    expect(await statStored(saved.storagePath)).toEqual({ exists: true, size: 8 });
  });

  it("statStored 對不存在的物件回 exists:false（不拋錯，對帳不會整批中斷）", async () => {
    enableObjectStore(port);
    expect(await statStored("2026/08/00000000-0000-0000-0000-000000000000.png")).toEqual({ exists: false });
  });

  it("removeStoredFile 刪得掉", async () => {
    enableObjectStore(port);
    const saved = await saveBuffer(Buffer.from("x"), "text/plain");
    await removeStoredFile(saved.storagePath);
    expect(stored.has(saved.storagePath)).toBe(false);
  });

  it("openStoredObject 讀得回內容；不存在回 null（呼叫端轉 404）", async () => {
    enableObjectStore(port);
    const saved = await saveBuffer(Buffer.from("bytes"), "text/plain");
    const body = await openStoredObject(saved.storagePath);
    expect(body).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of body!.stream) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).toString()).toBe("bytes");
    expect(await openStoredObject("2026/08/00000000-0000-0000-0000-000000000000.png")).toBeNull();
  });
});

describe("持久性判定與磁碟守門", () => {
  it("物件儲存模式一律視為持久，且不再對本機路徑示警", () => {
    enableObjectStore(port);
    const assessment = assessStoragePersistence();
    expect(assessment.mode).toBe("object-store");
    expect(assessment.persistent).toBe(true);
    expect(assessment.note).toContain("物件儲存");
  });

  it("物件儲存模式不做本機剩餘空間檢查，但仍守單檔上限", async () => {
    enableObjectStore(port);
    expect(await checkDiskSpace(1024)).toBeNull();
    expect(await checkDiskSpace(500 * 1024 * 1024 * 1024)).toContain("檔案太大");
  });
});
