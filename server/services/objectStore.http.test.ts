/**
 * 物件儲存用戶端 ↔ 假 S3 伺服器的整合測試（loopback，不碰外網）。
 *
 * 單元測試驗得了簽章，驗不到「請求真的長成那樣嗎」：Content-Length 有沒有帶、
 * Range 有沒有轉發、404 有沒有變成 ObjectNotFoundError、CopyObject 那個
 * 「HTTP 200 但 body 裡是 Error」的陷阱有沒有接住。這些都只有真的送一次 HTTP 才驗得出來。
 */
import http from "node:http";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ObjectNotFoundError,
  ObjectStoreError,
  copyObject,
  deleteObject,
  getObject,
  headObject,
  listObjects,
  putObject,
  resetObjectStoreConfigForTests,
} from "./objectStore";

interface Received {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

const stored = new Map<string, { body: Buffer; contentType: string }>();
let received: Received[] = [];
/** 測試可覆寫的回應（模擬錯誤情境） */
let override: ((req: Received, res: http.ServerResponse) => boolean) | null = null;

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const entry: Received = {
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers,
      body: Buffer.concat(chunks),
    };
    received.push(entry);
    if (override?.(entry, res)) return;

    const url = new URL(entry.url, "http://local");
    // path-style：/bucket/key…
    const key = decodeURIComponent(url.pathname.replace(/^\/test-bucket\/?/, ""));

    if (entry.method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const contents = [...stored.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => `<Contents><Key>${k}</Key><Size>${stored.get(k)!.body.length}</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>`)
        .join("");
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0"?><ListBucketResult>${contents}<IsTruncated>false</IsTruncated></ListBucketResult>`);
      return;
    }

    if (entry.method === "PUT" && entry.headers["x-amz-copy-source"]) {
      const source = decodeURIComponent(String(entry.headers["x-amz-copy-source"])).replace(/^\/test-bucket\//, "");
      const found = stored.get(source);
      if (!found) {
        res.writeHead(404).end("<Error><Message>NoSuchKey</Message></Error>");
        return;
      }
      stored.set(key, { ...found });
      res.writeHead(200, { "content-type": "application/xml" });
      res.end("<CopyObjectResult><ETag>\"x\"</ETag></CopyObjectResult>");
      return;
    }

    if (entry.method === "PUT") {
      stored.set(key, { body: entry.body, contentType: String(entry.headers["content-type"] ?? "") });
      res.writeHead(200).end();
      return;
    }

    if (entry.method === "HEAD" || entry.method === "GET") {
      const found = stored.get(key);
      if (!found) {
        res.writeHead(404, { "content-type": "application/xml" });
        res.end(entry.method === "HEAD" ? undefined : "<Error><Message>NoSuchKey</Message></Error>");
        return;
      }
      const range = /^bytes=(\d+)-(\d*)$/.exec(String(entry.headers.range ?? ""));
      if (range && entry.method === "GET") {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : found.body.length - 1;
        const slice = found.body.subarray(start, end + 1);
        res.writeHead(206, {
          "content-type": found.contentType,
          "content-length": String(slice.length),
          "content-range": `bytes ${start}-${end}/${found.body.length}`,
        });
        res.end(slice);
        return;
      }
      res.writeHead(200, { "content-type": found.contentType, "content-length": String(found.body.length) });
      res.end(entry.method === "HEAD" ? undefined : found.body);
      return;
    }

    if (entry.method === "DELETE") {
      stored.delete(key);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(405).end();
  });
});

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.S3_ENDPOINT = `http://127.0.0.1:${port}`;
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_ACCESS_KEY_ID = "AKID";
  process.env.S3_SECRET_ACCESS_KEY = "SECRET";
  resetObjectStoreConfigForTests();
});

afterAll(async () => {
  for (const key of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PREFIX"]) {
    delete process.env[key];
  }
  resetObjectStoreConfigForTests();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  stored.clear();
  received = [];
  override = null;
});

describe("putObject / getObject", () => {
  it("Buffer 上傳後讀得回一模一樣的內容", async () => {
    const payload = Buffer.from("hello 中文 🎬");
    await putObject("2026/08/a.png", payload, "image/png");
    const body = await getObject("2026/08/a.png");
    expect(await readAll(body.stream)).toEqual(payload);
    expect(body.contentType).toBe("image/png");
  });

  it("每個請求都帶簽章與 SigV4 必要標頭", async () => {
    await putObject("k.txt", Buffer.from("x"), "text/plain");
    const put = received.find((r) => r.method === "PUT")!;
    expect(put.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//);
    expect(put.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
    expect(put.headers["x-amz-content-sha256"]).toBeTruthy();
  });

  it("Buffer 上傳會帶真實的 payload 雜湊（不是 UNSIGNED-PAYLOAD）", async () => {
    await putObject("k.txt", Buffer.from("x"), "text/plain");
    expect(received[0].headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("串流上傳帶 Content-Length 與 UNSIGNED-PAYLOAD（大檔不先讀進記憶體算雜湊）", async () => {
    const payload = Buffer.from("streamed body");
    await putObject("big.mp4", Readable.from([payload]), "video/mp4", payload.length);
    const put = received.find((r) => r.method === "PUT")!;
    expect(put.headers["content-length"]).toBe(String(payload.length));
    expect(put.headers["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
    expect(stored.get("big.mp4")!.body).toEqual(payload);
  });

  it("Range 原樣轉發，206 與 Content-Range 原樣傳回（影音拖進度條）", async () => {
    await putObject("v.mp4", Buffer.from("0123456789"), "video/mp4");
    const body = await getObject("v.mp4", "bytes=2-5");
    expect(body.status).toBe(206);
    expect(body.contentRange).toBe("bytes 2-5/10");
    expect((await readAll(body.stream)).toString()).toBe("2345");
  });

  it("含中文與空白的 key 也能存取（編碼與簽章一致）", async () => {
    await putObject("2026/08/我的 影片.mp4", Buffer.from("v"), "video/mp4");
    expect((await readAll((await getObject("2026/08/我的 影片.mp4")).stream)).toString()).toBe("v");
  });

  it("S3_PREFIX 生效：實際 key 帶前綴，但呼叫端仍用原本的相對路徑", async () => {
    process.env.S3_PREFIX = "stage";
    resetObjectStoreConfigForTests();
    try {
      await putObject("2026/08/p.png", Buffer.from("p"), "image/png");
      expect([...stored.keys()]).toEqual(["stage/2026/08/p.png"]);
      expect((await readAll((await getObject("2026/08/p.png")).stream)).toString()).toBe("p");
    } finally {
      delete process.env.S3_PREFIX;
      resetObjectStoreConfigForTests();
    }
  });

  it("讀不存在的物件拋 ObjectNotFoundError（呼叫端才分得出 404 與真故障）", async () => {
    await expect(getObject("nope.png")).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("後端 5xx 拋 ObjectStoreError 並帶回 S3 的 Message", async () => {
    override = (_req, res) => {
      res.writeHead(500, { "content-type": "application/xml" });
      res.end("<Error><Message>InternalError</Message></Error>");
      return true;
    };
    await expect(putObject("x.png", Buffer.from("x"), "image/png")).rejects.toThrow(/InternalError/);
    await expect(putObject("x.png", Buffer.from("x"), "image/png")).rejects.toBeInstanceOf(ObjectStoreError);
  });
});

describe("headObject", () => {
  it("存在時回大小與型別", async () => {
    await putObject("a.txt", Buffer.from("12345"), "text/plain");
    expect(await headObject("a.txt")).toMatchObject({ exists: true, size: 5, contentType: "text/plain" });
  });

  it("不存在回 exists:false 而不是拋錯（對帳時不該因一列髒資料整批中斷）", async () => {
    expect(await headObject("gone.txt")).toEqual({ exists: false });
  });
});

describe("deleteObject", () => {
  it("刪得掉", async () => {
    await putObject("a.txt", Buffer.from("x"), "text/plain");
    await deleteObject("a.txt");
    expect(stored.has("a.txt")).toBe(false);
  });

  it("刪不存在的物件不算錯（與本機 unlink 的語意一致）", async () => {
    override = (_req, res) => {
      res.writeHead(404).end();
      return true;
    };
    await expect(deleteObject("gone.txt")).resolves.toBeUndefined();
  });
});

describe("copyObject", () => {
  it("伺服器端複製", async () => {
    await putObject("src.png", Buffer.from("data"), "image/png");
    await copyObject("src.png", "dst.png");
    expect(stored.get("dst.png")!.body.toString()).toBe("data");
  });

  it("HTTP 200 但 body 是 Error 時仍視為失敗——只看狀態碼會把失敗當成功，資料庫就會記下指向空物件的素材", async () => {
    override = (req, res) => {
      if (!req.headers["x-amz-copy-source"]) return false;
      res.writeHead(200, { "content-type": "application/xml" });
      res.end("<Error><Message>連線中斷</Message></Error>");
      return true;
    };
    await expect(copyObject("a.png", "b.png")).rejects.toThrow(/連線中斷/);
  });
});

describe("listObjects", () => {
  it("列出指定前綴的物件", async () => {
    await putObject("feedback/a.png", Buffer.from("a"), "image/png");
    await putObject("feedback/b.png", Buffer.from("bb"), "image/png");
    await putObject("2026/08/c.png", Buffer.from("c"), "image/png");
    const items = await listObjects("feedback/");
    expect(items.map((i) => i.key).sort()).toEqual(["feedback/a.png", "feedback/b.png"]);
    expect(items.find((i) => i.key === "feedback/b.png")?.size).toBe(2);
  });

  it("有 S3_PREFIX 時回傳的 key 已剝掉前綴（與資料庫的 storage_path 對得上）", async () => {
    process.env.S3_PREFIX = "stage";
    resetObjectStoreConfigForTests();
    try {
      await putObject("feedback/a.png", Buffer.from("a"), "image/png");
      expect((await listObjects("feedback/")).map((i) => i.key)).toEqual(["feedback/a.png"]);
    } finally {
      delete process.env.S3_PREFIX;
      resetObjectStoreConfigForTests();
    }
  });
});
