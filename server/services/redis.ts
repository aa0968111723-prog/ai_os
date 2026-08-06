/**
 * Redis 用戶端（RESP2，零相依）——跨實例共用狀態的傳輸層。
 *
 * 為什麼自己寫而不裝 ioredis：本專案只用到 GET/SET/DEL/EXPIRE/PING/PUBLISH/SUBSCRIBE
 * 這幾個命令，RESP2 的編碼與解析加起來不到 200 行；相對地多一個相依就多一條供應鏈與升級負擔。
 *
 * 設計原則——**Redis 掛掉不能拖垮本站**：
 * - 所有命令失敗都回 null／false 而不是拋例外，呼叫端一律要有本機退路（快取回落記憶體、
 *   即時協作回落單機廣播）。Redis 在本專案是「加速與跨實例協調」，不是資料的真實來源。
 * - 未設 REDIS_URL 時整個模組保持關閉，不建任何連線（本機開發、單實例部署零負擔）。
 *
 * ★ 本模組不 import 任何專案模組（比照 errlog.ts／storageHealth.ts）：任何地方引用都不會循環相依。
 */
import net from "node:net";
import tls from "node:tls";

export interface RedisConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls: boolean;
  /** 所有 key 的共同前綴（多環境共用同一台 Redis 時隔離用） */
  prefix: string;
}

/** 命令逾時：Redis 是熱路徑上的加速器，慢過這個門檻不如直接放棄走本機退路 */
const COMMAND_TIMEOUT_MS = 2_000;
/** 重連退避：連續失敗時逐步拉長，避免 Redis 全掛時打爆 event loop 與 log */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;
/** 單一回覆的大小上限：防惡意／異常的巨大回覆把記憶體吃光 */
const MAX_REPLY_BYTES = 8 * 1024 * 1024;

export type RedisValue = string | null;

/* ── 設定解析 ─────────────────────────────────────────────────── */

/**
 * REDIS_URL → 設定。支援 redis:// 與 rediss://（TLS）。
 * 沒設或格式不對回 null（＝停用，不是錯誤；單實例部署本來就不需要 Redis）。
 */
export function redisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfig | null {
  const raw = env.REDIS_URL?.trim() || env.REDIS_PRIVATE_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.warn("[redis] REDIS_URL 格式不正確——已停用 Redis，改用單機模式");
    return null;
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    console.warn(`[redis] 不支援的協定 ${url.protocol}——已停用 Redis`);
    return null;
  }
  const dbFromPath = url.pathname.replace(/^\//, "");
  const db = Number(env.REDIS_DB ?? dbFromPath ?? 0);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    // 有些平台的連線字串只帶密碼（redis://:pass@host）——此時 username 是空字串，要當作沒有
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isInteger(db) && db >= 0 && db <= 15 ? db : 0,
    tls: url.protocol === "rediss:",
    prefix: (env.REDIS_PREFIX ?? "aidos").replace(/:+$/, ""),
  };
}

/* ── RESP2 編碼／解析（純函式，可單測） ──────────────────────── */

/** 命令 → RESP2 陣列。二進位安全：一律走 bulk string，不做跳脫 */
export function encodeCommand(args: Array<string | number | Buffer>): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const buf = Buffer.isBuffer(arg) ? arg : Buffer.from(String(arg), "utf8");
    parts.push(Buffer.from(`$${buf.length}\r\n`), buf, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

export type RespReply = string | number | null | RespReply[] | { error: string };

/**
 * 增量解析器：TCP 會把回覆切在任意位置，必須能「吃半包、留著等下一包」。
 * parse 回 null 代表資料還不完整（保留 buffer，等更多位元組）。
 */
export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_REPLY_BYTES) {
      this.buffer = Buffer.alloc(0);
      throw new Error("Redis 回覆超過大小上限");
    }
  }

  /** 取出下一筆完整回覆；不完整回 undefined（注意：null 是合法的回覆值，兩者不可混用） */
  next(): { value: RespReply } | undefined {
    const parsed = this.parseAt(0);
    if (!parsed) return undefined;
    this.buffer = this.buffer.subarray(parsed.consumed);
    return { value: parsed.value };
  }

  private lineEnd(start: number): number {
    return this.buffer.indexOf("\r\n", start, "utf8");
  }

  private parseAt(offset: number): { value: RespReply; consumed: number } | undefined {
    if (offset >= this.buffer.length) return undefined;
    const type = String.fromCharCode(this.buffer[offset]);
    const end = this.lineEnd(offset + 1);
    if (end === -1) return undefined;
    const line = this.buffer.subarray(offset + 1, end).toString("utf8");

    if (type === "+") return { value: line, consumed: end + 2 };
    if (type === "-") return { value: { error: line }, consumed: end + 2 };
    if (type === ":") return { value: Number(line), consumed: end + 2 };
    if (type === "$") {
      const length = Number(line);
      if (length === -1) return { value: null, consumed: end + 2 };
      const start = end + 2;
      if (this.buffer.length < start + length + 2) return undefined;
      return { value: this.buffer.subarray(start, start + length).toString("utf8"), consumed: start + length + 2 };
    }
    if (type === "*") {
      const count = Number(line);
      if (count === -1) return { value: null, consumed: end + 2 };
      const items: RespReply[] = [];
      let cursor = end + 2;
      for (let i = 0; i < count; i++) {
        const item = this.parseAt(cursor);
        if (!item) return undefined;
        items.push(item.value);
        cursor = item.consumed;
      }
      return { value: items, consumed: cursor };
    }
    // 未知型別（RESP3 的 %,#,~…）：本用戶端一律以 RESP2 連線，出現即代表協定不同步，直接報錯重連
    throw new Error(`未知的 RESP 型別：${type}`);
  }
}

/* ── 連線 ─────────────────────────────────────────────────────── */

type Pending = {
  resolve: (value: RespReply) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type RedisMessageHandler = (channel: string, payload: string) => void;

class RedisConnection {
  private socket: net.Socket | null = null;
  private parser = new RespParser();
  private pending: Pending[] = [];
  private connecting: Promise<void> | null = null;
  private failures = 0;
  private closed = false;
  private lastErrorLoggedAt = 0;

  constructor(
    private readonly config: RedisConfig,
    /** 訂閱模式：收到 pub/sub 推播時呼叫（非訂閱連線傳 undefined） */
    private readonly onMessage?: RedisMessageHandler,
  ) {}

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  private logError(message: string): void {
    // Redis 全掛時每個請求都會失敗——限流 log，否則 30 秒內就淹掉整份部署 log
    const now = Date.now();
    if (now - this.lastErrorLoggedAt < 30_000) return;
    this.lastErrorLoggedAt = now;
    console.warn(`[redis] ${message}（已改用本機退路；後續同類訊息 30 秒內不再重複）`);
  }

  private failAllPending(error: Error): void {
    const pending = this.pending;
    this.pending = [];
    for (const p of pending) {
      clearTimeout(p.timer);
      p.reject(error);
    }
  }

  private handleData(chunk: Buffer): void {
    try {
      this.parser.push(chunk);
      for (;;) {
        const next = this.parser.next();
        if (!next) break;
        const value = next.value;
        // pub/sub 推播不是任何命令的回覆——先攔下來，否則會錯位吃掉別人的回覆
        if (this.onMessage && Array.isArray(value) && value[0] === "message" && typeof value[1] === "string") {
          this.onMessage(value[1], typeof value[2] === "string" ? value[2] : "");
          continue;
        }
        const waiter = this.pending.shift();
        if (!waiter) continue;
        clearTimeout(waiter.timer);
        if (value && typeof value === "object" && !Array.isArray(value) && "error" in value) {
          waiter.reject(new Error(value.error));
        } else {
          waiter.resolve(value);
        }
      }
    } catch (err) {
      // 協定不同步：唯一安全的做法是丟掉整條連線重來
      this.dropSocket(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private dropSocket(error: Error): void {
    const socket = this.socket;
    this.socket = null;
    this.parser = new RespParser();
    this.failAllPending(error);
    socket?.removeAllListeners();
    socket?.destroy();
  }

  private async connect(): Promise<void> {
    if (this.closed) throw new Error("Redis 用戶端已關閉");
    if (this.connected) return;
    if (this.connecting) return this.connecting;

    // 退避：連續失敗時延後重試。第一次失敗後 0.5 秒，之後倍增到最多 30 秒。
    const backoff = this.failures === 0 ? 0 : Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (this.failures - 1));

    this.connecting = (async () => {
      if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
      const socket = await new Promise<net.Socket>((resolve, reject) => {
        const options = { host: this.config.host, port: this.config.port };
        const s: net.Socket = this.config.tls
          ? tls.connect({ ...options, servername: this.config.host })
          : net.connect(options);
        s.setTimeout(COMMAND_TIMEOUT_MS * 3);
        s.once(this.config.tls ? "secureConnect" : "connect", () => resolve(s));
        // 連線階段失敗一定要 destroy：否則每次重試都留下一條半開的 socket，
        // Redis 長時間不通時會把 fd 用光（比 Redis 本身掛掉更難查）。
        s.once("error", (err) => {
          s.destroy();
          reject(err);
        });
        s.once("timeout", () => {
          s.destroy();
          reject(new Error("Redis 連線逾時"));
        });
      });

      socket.removeAllListeners("error");
      socket.removeAllListeners("timeout");
      socket.setNoDelay(true);
      socket.setTimeout(0); // 連上之後不再對閒置連線設限（訂閱連線可能很久沒有訊息）
      socket.on("data", (chunk) => this.handleData(chunk));
      socket.on("error", (err) => {
        this.logError(`連線錯誤：${err.message}`);
        this.dropSocket(err);
      });
      socket.on("close", () => this.dropSocket(new Error("Redis 連線已關閉")));
      this.socket = socket;

      // 握手：AUTH → SELECT。任一步失敗代表設定錯，重連也不會好——照樣丟掉連線，
      // 但錯誤訊息要留在 log 裡讓管理員看得到（密碼錯與網路不通的處置完全不同）。
      try {
        if (this.config.password) {
          const args = this.config.username
            ? ["AUTH", this.config.username, this.config.password]
            : ["AUTH", this.config.password];
          await this.rawCommand(args);
        }
        if (this.config.db > 0) await this.rawCommand(["SELECT", String(this.config.db)]);
      } catch (err) {
        this.dropSocket(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
      this.failures = 0;
    })();

    try {
      await this.connecting;
    } catch (err) {
      this.failures = Math.min(this.failures + 1, 16);
      throw err;
    } finally {
      this.connecting = null;
    }
  }

  /** 已連線時直接送出（握手期間用；不觸發重連遞迴） */
  private rawCommand(args: Array<string | number | Buffer>): Promise<RespReply> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error("Redis 尚未連線"));
    return new Promise<RespReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        // 逾時的命令若留在佇列裡，之後回來的回覆會與後續命令錯位——直接丟連線最安全
        this.dropSocket(new Error(`Redis 命令逾時（${args[0]}）`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.push({ resolve, reject, timer });
      socket.write(encodeCommand(args), (err) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  async command(args: Array<string | number | Buffer>): Promise<RespReply> {
    await this.connect();
    return this.rawCommand(args);
  }

  close(): void {
    this.closed = true;
    this.dropSocket(new Error("Redis 用戶端關閉中"));
  }
}

/* ── 模組層單例 ───────────────────────────────────────────────── */

let config: RedisConfig | null | undefined;
let commandConn: RedisConnection | null = null;
let subscriberConn: RedisConnection | null = null;
const subscriptions = new Map<string, Set<RedisMessageHandler>>();

function activeConfig(): RedisConfig | null {
  if (config === undefined) config = redisConfig();
  return config;
}

export function isRedisEnabled(): boolean {
  return activeConfig() !== null;
}

export function redisKey(key: string): string {
  const cfg = activeConfig();
  return cfg?.prefix ? `${cfg.prefix}:${key}` : key;
}

export function resetRedisForTests(): void {
  commandConn?.close();
  subscriberConn?.close();
  commandConn = null;
  subscriberConn = null;
  subscriptions.clear();
  config = undefined;
}

function connection(): RedisConnection | null {
  const cfg = activeConfig();
  if (!cfg) return null;
  if (!commandConn) commandConn = new RedisConnection(cfg);
  return commandConn;
}

/**
 * 執行命令；任何失敗（未設定、連不上、逾時）都回 null。
 * 呼叫端必須把 null 當成「這次沒有 Redis」而非「值不存在」——需要區分時看個別 wrapper 的說明。
 */
export async function redisCommand(args: Array<string | number | Buffer>): Promise<RespReply | null> {
  const conn = connection();
  if (!conn) return null;
  try {
    return await conn.command(args);
  } catch {
    return null;
  }
}

/** GET：回 null 代表「沒有值」或「Redis 不可用」——兩者對快取而言處置相同（重算） */
export async function redisGet(key: string): Promise<RedisValue> {
  const reply = await redisCommand(["GET", redisKey(key)]);
  return typeof reply === "string" ? reply : null;
}

/** SET（可帶 TTL）。回 true 代表確定寫入成功 */
export async function redisSet(key: string, value: string, ttlMs?: number): Promise<boolean> {
  const args: Array<string | number> = ["SET", redisKey(key), value];
  if (ttlMs && ttlMs > 0) args.push("PX", Math.floor(ttlMs));
  return (await redisCommand(args)) === "OK";
}

export async function redisDel(key: string): Promise<boolean> {
  const reply = await redisCommand(["DEL", redisKey(key)]);
  return typeof reply === "number" && reply > 0;
}

/** SET NX：分散式互斥的基本件（回 true＝這個實例搶到） */
export async function redisSetNx(key: string, value: string, ttlMs: number): Promise<boolean> {
  return (await redisCommand(["SET", redisKey(key), value, "NX", "PX", Math.floor(ttlMs)])) === "OK";
}

export async function redisPublish(channel: string, payload: string): Promise<boolean> {
  const reply = await redisCommand(["PUBLISH", redisKey(channel), payload]);
  return typeof reply === "number";
}

/**
 * 訂閱頻道。訂閱連線與命令連線分開——RESP2 的連線一旦進入 subscribe 模式就只能收推播，
 * 不能再跑一般命令（這是 Redis 的協定限制，不是我們的設計選擇）。
 * 回傳解除訂閱函式。
 */
export async function redisSubscribe(channel: string, handler: RedisMessageHandler): Promise<() => void> {
  const cfg = activeConfig();
  if (!cfg) return () => {};
  const full = redisKey(channel);

  if (!subscriberConn) {
    subscriberConn = new RedisConnection(cfg, (incoming, payload) => {
      for (const h of subscriptions.get(incoming) ?? []) {
        try {
          h(incoming, payload);
        } catch (err) {
          console.warn("[redis] 訂閱處理器拋出例外：", err instanceof Error ? err.message : err);
        }
      }
    });
  }

  let handlers = subscriptions.get(full);
  if (!handlers) {
    handlers = new Set();
    subscriptions.set(full, handlers);
  }
  handlers.add(handler);

  try {
    await subscriberConn.command(["SUBSCRIBE", full]);
  } catch {
    // 訂閱失敗不拋：呼叫端（即時協作）本來就有單機退路，跨實例同步暫時失效而已
    console.warn(`[redis] 訂閱 ${full} 失敗——跨實例同步暫停，單機廣播不受影響`);
  }

  return () => {
    const set = subscriptions.get(full);
    set?.delete(handler);
    if (set && set.size === 0) {
      subscriptions.delete(full);
      void subscriberConn?.command(["UNSUBSCRIBE", full]).catch(() => {});
    }
  };
}

/** 健康探針：PING 回 PONG 才算通 */
export async function redisPing(): Promise<boolean> {
  return (await redisCommand(["PING"])) === "PONG";
}

export interface RedisStatus {
  enabled: boolean;
  connected: boolean;
  note: string;
}

export async function redisStatus(): Promise<RedisStatus> {
  const cfg = activeConfig();
  if (!cfg) return { enabled: false, connected: false, note: "未設定（單機模式：快取走行程記憶體、即時協作僅同一實例內同步）" };
  const ok = await redisPing();
  return {
    enabled: true,
    connected: ok,
    note: ok
      ? `已連線 ${cfg.host}:${cfg.port}（db ${cfg.db}）`
      : `連不上 ${cfg.host}:${cfg.port}——已自動退回單機模式，請檢查 REDIS_URL 與網路`,
  };
}

/** 優雅關機時收線，避免 socket 卡住行程退出 */
export function closeRedis(): void {
  commandConn?.close();
  subscriberConn?.close();
  commandConn = null;
  subscriberConn = null;
  subscriptions.clear();
}
