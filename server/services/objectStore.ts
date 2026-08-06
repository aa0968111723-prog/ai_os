/**
 * S3 相容物件儲存（MinIO／R2／AWS S3）用戶端——素材落地的第二種後端。
 *
 * 為什麼自己寫而不裝 SDK：
 * - 本專案的儲存需求只有 put／get／head／delete／copy／list 六件事，SigV4 簽章約 60 行就寫得完；
 *   相對地 `@aws-sdk/client-s3` 會把部署映像撐大數十 MB，而我們連 build 都在意大小。
 * - 直接用 node:http／node:https 才拿得到「串流上傳（大影片不進記憶體）」與「Range 直通」，
 *   這兩件事正是素材服務的主要流量形態。
 * - 一律走直連、不套 proxyFetch：MinIO 多半掛在部署平台的內網（如 minio.railway.internal），
 *   走出口代理反而連不上。
 *
 * ★ 本模組不 import 任何專案模組：storage.ts 引用它，它不反向引用 storage（避免循環相依）。
 */
import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { Readable } from "node:stream";

export interface ObjectStoreConfig {
  /** 例：http://minio.railway.internal:9000（不含 bucket） */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO 幾乎一定要 path-style（bucket 放路徑而非子網域） */
  forcePathStyle: boolean;
  /** 所有 key 的共同前綴（多環境共用同一 bucket 時用來隔離），空字串＝不加前綴 */
  prefix: string;
}

export interface ObjectStat {
  exists: boolean;
  size?: number;
  contentType?: string;
}

export interface ObjectBody {
  status: number;
  stream: Readable;
  size: number | null;
  contentType: string | null;
  /** 206 回應才有；直接轉發給瀏覽器 */
  contentRange: string | null;
  acceptRanges: string | null;
}

export class ObjectStoreError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ObjectStoreError";
    this.status = status;
  }
}

/** 物件不存在（404／NoSuchKey）——呼叫端要能與「真的壞掉」分開處理 */
export class ObjectNotFoundError extends ObjectStoreError {
  constructor(key: string) {
    super(`物件不存在：${key}`, 404);
    this.name = "ObjectNotFoundError";
  }
}

const SERVICE = "s3";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
/** 控制面請求（head／delete／copy／list）的逾時；GET/PUT 的 body 階段不套用 */
const CONTROL_TIMEOUT_MS = 30_000;
/** 建立連線與等待回應標頭的逾時（大檔的 body 傳輸時間不算在內） */
const RESPONSE_TIMEOUT_MS = 120_000;

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

/**
 * 從環境變數組出設定；缺任一必要項就回 null（＝停用物件儲存、沿用本機磁碟）。
 *
 * 同時吃 S3_* 與 MINIO_* 兩套命名：自架 MinIO 的人手上通常只有 MINIO_ROOT_USER／MINIO_ROOT_PASSWORD，
 * 逼他們改名成 S3_ACCESS_KEY_ID 只是徒增一次設定錯誤的機會。
 */
export function objectStoreConfig(env: NodeJS.ProcessEnv = process.env): ObjectStoreConfig | null {
  const endpointRaw = firstNonEmpty(env.S3_ENDPOINT, env.MINIO_ENDPOINT);
  const bucket = firstNonEmpty(env.S3_BUCKET, env.MINIO_BUCKET);
  const accessKeyId = firstNonEmpty(env.S3_ACCESS_KEY_ID, env.MINIO_ACCESS_KEY, env.MINIO_ROOT_USER);
  const secretAccessKey = firstNonEmpty(env.S3_SECRET_ACCESS_KEY, env.MINIO_SECRET_KEY, env.MINIO_ROOT_PASSWORD);
  if (!endpointRaw || !bucket || !accessKeyId || !secretAccessKey) return null;

  // 只給 host:port 時補 scheme：內網 MinIO 沒有 TLS 很常見，補 http 才連得上；
  // 對外網域請自行寫 https://，不要靠這裡猜。
  const endpoint = /^https?:\/\//i.test(endpointRaw) ? endpointRaw.replace(/\/+$/, "") : `http://${endpointRaw.replace(/\/+$/, "")}`;
  try {
    // 早驗一次：壞掉的 endpoint 要在開機自檢就爆，而不是等第一次上傳才炸在使用者面前
    new URL(endpoint);
  } catch {
    return null;
  }
  if (!/^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$/i.test(bucket)) return null;

  return {
    endpoint,
    bucket,
    region: firstNonEmpty(env.S3_REGION, env.MINIO_REGION) ?? "us-east-1",
    accessKeyId,
    secretAccessKey,
    forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE, true),
    prefix: (firstNonEmpty(env.S3_PREFIX, env.MINIO_PREFIX) ?? "").replace(/^\/+|\/+$/g, ""),
  };
}

let cachedConfig: ObjectStoreConfig | null | undefined;

/** 現行設定（快取；測試可用 resetObjectStoreConfigForTests 清掉） */
export function activeObjectStoreConfig(): ObjectStoreConfig | null {
  if (cachedConfig === undefined) cachedConfig = objectStoreConfig();
  return cachedConfig;
}

export function isObjectStoreEnabled(): boolean {
  return activeObjectStoreConfig() !== null;
}

export function resetObjectStoreConfigForTests(): void {
  cachedConfig = undefined;
}

/* ── SigV4 簽章 ───────────────────────────────────────────────────
 * 拆成純函式並匯出，因為簽章錯誤的症狀是「403 SignatureDoesNotMatch」——
 * 沒有單元測試的話只能靠對著真伺服器猜，那是最貴的除錯方式。
 * ─────────────────────────────────────────────────────────────── */

/** RFC 3986 逐字元編碼；encodeURIComponent 漏掉的 !'()* 也要編（AWS 規格要求） */
export function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      out += char;
    } else if (char === "/") {
      out += encodeSlash ? "%2F" : "/";
    } else {
      for (const byte of Buffer.from(char, "utf8")) out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** service 可覆寫：簽章邏輯本身與 S3 無關，測試用官方 SigV4 測試向量（service="service"）逐段對照 */
export function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string = SERVICE): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), "aws4_request");
}

export interface SignInput {
  method: string;
  /** 已編碼的 canonical URI（含前導 /） */
  canonicalUri: string;
  /** 已排序、已編碼的 query string（可為空字串） */
  canonicalQuery: string;
  headers: Record<string, string>;
  payloadHash: string;
  now: Date;
  config: Pick<ObjectStoreConfig, "region" | "accessKeyId" | "secretAccessKey">;
  /** 預設 s3；僅測試對照官方向量時會傳別的值 */
  service?: string;
}

/**
 * 產生 Authorization 標頭值。headers 必須已含 host、x-amz-content-sha256、x-amz-date。
 * 回傳值連同 canonicalRequest 一起吐出來，讓測試能對照 AWS 官方範例逐段驗。
 */
export function signRequest(input: SignInput): { authorization: string; canonicalRequest: string; stringToSign: string } {
  const { amzDate: stamp, dateStamp } = amzDate(input.now);
  const lowered = Object.entries(input.headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalHeaders = lowered.map(([name, value]) => `${name}:${value}\n`).join("");
  const signedHeaders = lowered.map(([name]) => name).join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.canonicalUri,
    input.canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const service = input.service ?? SERVICE;
  const scope = `${dateStamp}/${input.config.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");

  const signature = createHmac("sha256", signingKey(input.config.secretAccessKey, dateStamp, input.config.region, service))
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest,
    stringToSign,
  };
}

/* ── 物件 key 與 URL ────────────────────────────────────────────── */

/**
 * 相對路徑 → 物件 key。刻意沿用本機磁碟的相對路徑形狀（2026/08/uuid.png），
 * 這樣資料庫裡既有的 storage_path 不用改寫，兩種後端可以互換、也能逐步搬移。
 */
export function objectKeyFor(relPath: string, config: Pick<ObjectStoreConfig, "prefix">): string {
  const clean = relPath.replace(/^\/+/, "");
  // 與本機 absPathOf 相同的防跳脫語意：物件儲存沒有目錄概念，但 ../ 會讓 key 與 DB 記錄對不上，
  // 也可能撞到其他前綴（多環境共用 bucket 時等同越權讀取）。
  if (!clean || clean.split("/").some((seg) => seg === "." || seg === ".." || seg === "")) {
    throw new Error("非法儲存路徑");
  }
  return config.prefix ? `${config.prefix}/${clean}` : clean;
}

function endpointUrl(config: ObjectStoreConfig, key: string, query = ""): { url: URL; canonicalUri: string } {
  const base = new URL(config.endpoint);
  const encodedKey = uriEncode(key, false);
  const path = config.forcePathStyle
    ? `/${uriEncode(config.bucket, true)}/${encodedKey}`
    : `/${encodedKey}`;
  const url = new URL(`${base.origin}${path}${query ? `?${query}` : ""}`);
  if (!config.forcePathStyle) url.hostname = `${config.bucket}.${base.hostname}`;
  return { url, canonicalUri: path };
}

/* ── 低階請求 ──────────────────────────────────────────────────── */

interface RawRequest {
  method: string;
  key: string;
  query?: string;
  headers?: Record<string, string>;
  body?: Buffer | Readable;
  /** 已知長度時務必帶：S3／MinIO 的 PUT 需要 Content-Length，chunked 會被拒 */
  contentLength?: number;
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
}

function sendRequest(config: ObjectStoreConfig, req: RawRequest): Promise<RawResponse> {
  const { url, canonicalUri } = endpointUrl(config, req.key, req.query);
  const now = new Date();
  const { amzDate: stamp } = amzDate(now);

  // Buffer 才算得出真實雜湊；串流上傳一律 UNSIGNED-PAYLOAD（S3 與 MinIO 皆支援），
  // 否則得先把整支影片讀進記憶體算 sha256，正好是我們要避免的事。
  const payloadHash = Buffer.isBuffer(req.body)
    ? createHash("sha256").update(req.body).digest("hex")
    : req.body
      ? UNSIGNED_PAYLOAD
      : createHash("sha256").update("").digest("hex");

  const headers: Record<string, string> = {
    host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
    ...Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const length = Buffer.isBuffer(req.body) ? req.body.length : req.contentLength;
  if (length !== undefined) headers["content-length"] = String(length);

  const { authorization } = signRequest({
    method: req.method,
    canonicalUri,
    canonicalQuery: req.query ?? "",
    headers,
    payloadHash,
    now,
    config,
  });

  const transport = url.protocol === "https:" ? https : http;
  return new Promise<RawResponse>((resolve, reject) => {
    const clientReq = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: req.method,
        headers: { ...headers, authorization },
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res }),
    );
    // setTimeout 量的是「socket 閒置」而非總時長：大檔持續傳輸時不會誤觸發，
    // 真正掛死（連上但不吐位元組）才會被切斷。
    clientReq.setTimeout(req.timeoutMs ?? RESPONSE_TIMEOUT_MS, () => {
      clientReq.destroy(new ObjectStoreError(`物件儲存無回應（逾時 ${req.timeoutMs ?? RESPONSE_TIMEOUT_MS}ms）`, 504));
    });
    clientReq.on("error", reject);
    if (!req.body) {
      clientReq.end();
    } else if (Buffer.isBuffer(req.body)) {
      clientReq.end(req.body);
    } else {
      req.body.on("error", (err) => clientReq.destroy(err));
      req.body.pipe(clientReq);
    }
  });
}

async function drain(stream: http.IncomingMessage, limitBytes = 8 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk as Buffer);
    total += buf.length;
    if (total <= limitBytes) chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** S3 的錯誤是 XML；抓 <Message> 出來，讓 log 不用人工解 XML */
function extractS3Message(xml: string): string {
  return /<Message>([^<]*)<\/Message>/i.exec(xml)?.[1] ?? xml.slice(0, 300);
}

async function expectOk(res: RawResponse, key: string): Promise<RawResponse> {
  if (res.status >= 200 && res.status < 300) return res;
  const body = await drain(res.stream);
  if (res.status === 404) throw new ObjectNotFoundError(key);
  throw new ObjectStoreError(`物件儲存回應 ${res.status}：${extractS3Message(body)}`, res.status);
}

/* ── 對外 API ──────────────────────────────────────────────────── */

function requireConfig(): ObjectStoreConfig {
  const config = activeObjectStoreConfig();
  if (!config) throw new ObjectStoreError("物件儲存未設定（需 S3_ENDPOINT／S3_BUCKET／金鑰）", 500);
  return config;
}

export async function putObject(
  relPath: string,
  body: Buffer | Readable,
  contentType: string,
  contentLength?: number,
): Promise<void> {
  const config = requireConfig();
  const key = objectKeyFor(relPath, config);
  const res = await sendRequest(config, {
    method: "PUT",
    key,
    headers: { "content-type": contentType || "application/octet-stream" },
    body,
    contentLength,
  });
  await expectOk(res, key);
  res.stream.resume(); // 丟掉空 body，讓 socket 回到連線池
}

/**
 * 取物件內容。rangeHeader 直接轉發給後端（瀏覽器拖影片進度條會送 Range），
 * 後端回 206 時我們也原樣把 Content-Range 傳回去——這樣影音 seek 不用自己實作切片。
 */
export async function getObject(relPath: string, rangeHeader?: string): Promise<ObjectBody> {
  const config = requireConfig();
  const key = objectKeyFor(relPath, config);
  const res = await sendRequest(config, {
    method: "GET",
    key,
    headers: rangeHeader ? { range: rangeHeader } : {},
  });
  if (res.status === 404) {
    res.stream.resume();
    throw new ObjectNotFoundError(key);
  }
  if (res.status >= 300) {
    const body = await drain(res.stream);
    throw new ObjectStoreError(`物件儲存回應 ${res.status}：${extractS3Message(body)}`, res.status);
  }
  const size = Number(res.headers["content-length"]);
  return {
    status: res.status,
    stream: res.stream,
    size: Number.isFinite(size) ? size : null,
    contentType: (res.headers["content-type"] as string | undefined) ?? null,
    contentRange: (res.headers["content-range"] as string | undefined) ?? null,
    acceptRanges: (res.headers["accept-ranges"] as string | undefined) ?? "bytes",
  };
}

export async function headObject(relPath: string): Promise<ObjectStat> {
  const config = requireConfig();
  const key = objectKeyFor(relPath, config);
  const res = await sendRequest(config, { method: "HEAD", key, timeoutMs: CONTROL_TIMEOUT_MS });
  res.stream.resume();
  if (res.status === 404) return { exists: false };
  if (res.status >= 300) throw new ObjectStoreError(`物件儲存回應 ${res.status}`, res.status);
  const size = Number(res.headers["content-length"]);
  return {
    exists: true,
    size: Number.isFinite(size) ? size : undefined,
    contentType: (res.headers["content-type"] as string | undefined) ?? undefined,
  };
}

export async function deleteObject(relPath: string): Promise<void> {
  const config = requireConfig();
  const key = objectKeyFor(relPath, config);
  // S3 的 DELETE 對不存在的 key 也回 204——與本機 unlink 的「不存在不算錯」語意一致
  const res = await sendRequest(config, { method: "DELETE", key, timeoutMs: CONTROL_TIMEOUT_MS });
  res.stream.resume();
  if (res.status >= 300 && res.status !== 404) {
    throw new ObjectStoreError(`刪除物件失敗（${res.status}）`, res.status);
  }
}

/** 伺服器端複製（不經過本服務的記憶體／頻寬） */
export async function copyObject(fromRelPath: string, toRelPath: string): Promise<void> {
  const config = requireConfig();
  const from = objectKeyFor(fromRelPath, config);
  const to = objectKeyFor(toRelPath, config);
  const res = await sendRequest(config, {
    method: "PUT",
    key: to,
    headers: { "x-amz-copy-source": `/${config.bucket}/${uriEncode(from, false)}` },
    timeoutMs: CONTROL_TIMEOUT_MS,
  });
  const checked = await expectOk(res, from);
  // CopyObject 的坑：HTTP 200 之後才在 XML body 裡回 Error（連線中斷時 AWS 用這招回報）。
  // 只看狀態碼會把失敗當成功，於是資料庫記了一筆指向不存在物件的素材。
  const body = await drain(checked.stream);
  if (/<Error>/i.test(body)) throw new ObjectStoreError(`複製物件失敗：${extractS3Message(body)}`, 502);
}

/** 列出某前綴下的物件（清孤兒檔用）；自動翻頁，最多 maxKeys 筆 */
export async function listObjects(prefix: string, maxKeys = 1_000): Promise<Array<{ key: string; size: number; lastModified: string | null }>> {
  const config = requireConfig();
  const fullPrefix = config.prefix ? `${config.prefix}/${prefix.replace(/^\/+/, "")}` : prefix.replace(/^\/+/, "");
  const out: Array<{ key: string; size: number; lastModified: string | null }> = [];
  let token: string | undefined;

  do {
    const params = [
      "list-type=2",
      `max-keys=${Math.min(1_000, maxKeys - out.length)}`,
      `prefix=${uriEncode(fullPrefix, true)}`,
      ...(token ? [`continuation-token=${uriEncode(token, true)}`] : []),
    ].sort(); // canonical query 必須按 key 排序
    const res = await sendRequest(config, { method: "GET", key: "", query: params.join("&"), timeoutMs: CONTROL_TIMEOUT_MS });
    const ok = await expectOk(res, fullPrefix);
    const xml = await drain(ok.stream, 4 * 1024 * 1024);
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const entry = match[1];
      const key = /<Key>([^<]*)<\/Key>/.exec(entry)?.[1];
      if (!key) continue;
      out.push({
        key: config.prefix && key.startsWith(`${config.prefix}/`) ? key.slice(config.prefix.length + 1) : key,
        size: Number(/<Size>(\d+)<\/Size>/.exec(entry)?.[1] ?? 0),
        lastModified: /<LastModified>([^<]*)<\/LastModified>/.exec(entry)?.[1] ?? null,
      });
    }
    token = /<IsTruncated>true<\/IsTruncated>/i.test(xml)
      ? /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1]
      : undefined;
  } while (token && out.length < maxKeys);

  return out;
}

/**
 * 健康探針：寫入→讀回→刪除一個小物件。
 * 只看「bucket 存在」不夠——金鑰權限不足時 list 會過、put 才失敗，那正是上線後才炸的那種假綠燈。
 */
export async function probeObjectStore(): Promise<{ ok: true; note: string }> {
  const config = requireConfig();
  const key = `.probe/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const payload = Buffer.from("object-store-probe");
  await putObject(key, payload, "text/plain");
  try {
    const body = await getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of body.stream) chunks.push(Buffer.from(chunk as Buffer));
    if (!Buffer.concat(chunks).equals(payload)) throw new ObjectStoreError("讀回內容與寫入不符", 500);
  } finally {
    await deleteObject(key).catch(() => {});
  }
  return { ok: true, note: `${config.endpoint}/${config.bucket} 可寫讀` };
}
