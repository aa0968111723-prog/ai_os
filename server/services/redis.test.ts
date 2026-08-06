/**
 * Redis 用戶端的協定層測試。
 *
 * RESP 解析的難點不是「解析一則完整回覆」，而是「TCP 把回覆切在任意位置」——
 * 半包／黏包處理錯了，症狀是偶發的回覆錯位（A 命令拿到 B 命令的答案），
 * 幾乎不可能靠人工重現，所以這裡逐一釘死。
 */
import { describe, expect, it } from "vitest";
import { RespParser, encodeCommand, redisConfig } from "./redis";

describe("redisConfig", () => {
  it("未設 REDIS_URL 就停用（單實例部署本來就不需要 Redis）", () => {
    expect(redisConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(redisConfig({ REDIS_URL: "  " } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("解析標準連線字串", () => {
    const config = redisConfig({ REDIS_URL: "redis://user:pass@cache.internal:6380/3" } as NodeJS.ProcessEnv);
    expect(config).toMatchObject({
      host: "cache.internal",
      port: 6380,
      username: "user",
      password: "pass",
      db: 3,
      tls: false,
    });
  });

  it("只帶密碼的形式（平台常見的 redis://:pass@host）", () => {
    const config = redisConfig({ REDIS_URL: "redis://:secret@host" } as NodeJS.ProcessEnv);
    expect(config?.username).toBeUndefined();
    expect(config?.password).toBe("secret");
    expect(config?.port).toBe(6379);
  });

  it("rediss:// 走 TLS", () => {
    expect(redisConfig({ REDIS_URL: "rediss://host:6379" } as NodeJS.ProcessEnv)?.tls).toBe(true);
  });

  it("百分號編碼的密碼要解回原值（平台自動產生的密碼常含特殊字元）", () => {
    const config = redisConfig({ REDIS_URL: "redis://:p%40ss%2Fword@host" } as NodeJS.ProcessEnv);
    expect(config?.password).toBe("p@ss/word");
  });

  it("壞掉的 URL 與非 redis 協定一律停用，而不是拋錯把開機弄掛", () => {
    expect(redisConfig({ REDIS_URL: "not a url" } as NodeJS.ProcessEnv)).toBeNull();
    expect(redisConfig({ REDIS_URL: "http://host:6379" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("超出範圍的 db 收斂成 0（避免 SELECT 失敗讓整條連線握手失敗）", () => {
    expect(redisConfig({ REDIS_URL: "redis://host/99" } as NodeJS.ProcessEnv)?.db).toBe(0);
    expect(redisConfig({ REDIS_URL: "redis://host/-1" } as NodeJS.ProcessEnv)?.db).toBe(0);
  });

  it("REDIS_PREFIX 去掉尾端冒號（否則會產生 aidos::cache:x）", () => {
    expect(redisConfig({ REDIS_URL: "redis://h", REDIS_PREFIX: "stage:" } as NodeJS.ProcessEnv)?.prefix).toBe("stage");
  });
});

describe("encodeCommand", () => {
  it("編成 RESP2 陣列", () => {
    expect(encodeCommand(["GET", "key"]).toString()).toBe("*2\r\n$3\r\nGET\r\n$3\r\nkey\r\n");
  });

  it("數字轉字串", () => {
    expect(encodeCommand(["EXPIRE", "k", 60]).toString()).toBe("*3\r\n$6\r\nEXPIRE\r\n$1\r\nk\r\n$2\r\n60\r\n");
  });

  it("長度以 byte 計而非字元數（中文值算錯長度會讓整條連線協定不同步）", () => {
    const encoded = encodeCommand(["SET", "k", "中"]).toString();
    expect(encoded).toContain("$3\r\n中\r\n");
  });

  it("含 CRLF 的值不需跳脫：bulk string 靠長度前綴界定，二進位安全", () => {
    const value = "a\r\nb";
    const encoded = encodeCommand(["SET", "k", value]).toString();
    expect(encoded).toContain(`$4\r\n${value}\r\n`);
  });
});

describe("RespParser", () => {
  const parseAll = (chunks: string[]): unknown[] => {
    const parser = new RespParser();
    const out: unknown[] = [];
    for (const chunk of chunks) {
      parser.push(Buffer.from(chunk, "utf8"));
      for (;;) {
        const next = parser.next();
        if (!next) break;
        out.push(next.value);
      }
    }
    return out;
  };

  it("simple string / integer / bulk string / null", () => {
    expect(parseAll(["+OK\r\n"])).toEqual(["OK"]);
    expect(parseAll([":42\r\n"])).toEqual([42]);
    expect(parseAll(["$5\r\nhello\r\n"])).toEqual(["hello"]);
    expect(parseAll(["$-1\r\n"])).toEqual([null]);
  });

  it("錯誤回覆解成 { error }（呼叫端才分得出「沒有值」與「Redis 說不行」）", () => {
    expect(parseAll(["-ERR unknown command\r\n"])).toEqual([{ error: "ERR unknown command" }]);
  });

  it("陣列與巢狀陣列", () => {
    expect(parseAll(["*2\r\n$3\r\nfoo\r\n:7\r\n"])).toEqual([["foo", 7]]);
    expect(parseAll(["*1\r\n*2\r\n+a\r\n+b\r\n"])).toEqual([[["a", "b"]]]);
    expect(parseAll(["*0\r\n"])).toEqual([[]]);
  });

  it("半包：資料還不完整時不吐值，補齊後才吐（TCP 會切在任意位置）", () => {
    const parser = new RespParser();
    parser.push(Buffer.from("$5\r\nhel", "utf8"));
    expect(parser.next()).toBeUndefined();
    parser.push(Buffer.from("lo\r\n", "utf8"));
    expect(parser.next()).toEqual({ value: "hello" });
  });

  it("逐 byte 餵入也要解得出來（最壞情況的切法）", () => {
    const parser = new RespParser();
    const payload = "*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n";
    let value: unknown;
    for (const byte of Buffer.from(payload, "utf8")) {
      parser.push(Buffer.from([byte]));
      const next = parser.next();
      if (next) value = next.value;
    }
    expect(value).toEqual(["foo", "bar"]);
  });

  it("黏包：一次送進兩則回覆要依序吐出（回覆錯位就是這裡沒做對）", () => {
    expect(parseAll(["+OK\r\n:1\r\n"])).toEqual(["OK", 1]);
  });

  it("bulk string 內含 CRLF 不會被誤判成結尾", () => {
    expect(parseAll(["$4\r\na\r\nb\r\n"])).toEqual(["a\r\nb"]);
  });

  it("pub/sub 推播就是一般的三元陣列（呼叫端據此攔截）", () => {
    expect(parseAll(["*3\r\n$7\r\nmessage\r\n$5\r\nrt:p1\r\n$2\r\nhi\r\n"])).toEqual([["message", "rt:p1", "hi"]]);
  });

  it("未知型別直接拋錯——協定不同步時唯一安全的處置是丟掉整條連線", () => {
    const parser = new RespParser();
    parser.push(Buffer.from("%1\r\n", "utf8"));
    expect(() => parser.next()).toThrow(/未知的 RESP 型別/);
  });
});
