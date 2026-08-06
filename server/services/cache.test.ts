/**
 * 共用快取層（記憶體退路）的行為測試。
 *
 * 這裡刻意不接真 Redis：本檔驗的是「沒有 Redis 時也必須完全正確」，
 * 因為那既是本機開發與單實例部署的常態，也是 Redis 掛掉時的降級路徑。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheDelete, cacheGet, cacheSet, cached, memoryCacheSize, resetCacheForTests } from "./cache";

afterEach(() => {
  resetCacheForTests();
  vi.useRealTimers();
});

describe("cacheGet / cacheSet", () => {
  it("沒寫過就回 null", async () => {
    expect(await cacheGet("missing")).toBeNull();
  });

  it("寫了就讀得到，且值是深複製過的（JSON 往返）", async () => {
    const value = { rate: 31.2, nested: { a: 1 } };
    await cacheSet("fx", value, 60_000);
    const hit = await cacheGet<typeof value>("fx");
    expect(hit).toEqual(value);
    expect(hit).not.toBe(value); // 拿到的不是同一個物件參照——呼叫端改了不會污染快取
  });

  it("到期後回 null", async () => {
    vi.useFakeTimers();
    await cacheSet("k", "v", 1_000);
    vi.advanceTimersByTime(999);
    expect(await cacheGet("k")).toBe("v");
    vi.advanceTimersByTime(2);
    expect(await cacheGet("k")).toBeNull();
  });

  it("過期項讀取時就被清掉，不會一直佔著記憶體", async () => {
    vi.useFakeTimers();
    await cacheSet("k", "v", 1_000);
    vi.advanceTimersByTime(1_001);
    await cacheGet("k");
    expect(memoryCacheSize()).toBe(0);
  });

  it("false / 0 / 空字串這些 falsy 值也要存得住", async () => {
    await cacheSet("zero", 0, 60_000);
    await cacheSet("empty", "", 60_000);
    await cacheSet("no", false, 60_000);
    expect(await cacheGet("zero")).toBe(0);
    expect(await cacheGet("empty")).toBe("");
    expect(await cacheGet("no")).toBe(false);
  });

  it("不可序列化的值靜默略過（快取本來就可有可無，不該讓呼叫端爆掉）", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(cacheSet("bad", circular, 60_000)).resolves.toBeUndefined();
    expect(await cacheGet("bad")).toBeNull();
  });

  it("cacheDelete 清得掉", async () => {
    await cacheSet("k", "v", 60_000);
    await cacheDelete("k");
    expect(await cacheGet("k")).toBeNull();
  });
});

describe("cached", () => {
  it("第一次算、第二次直接命中", async () => {
    const compute = vi.fn(async () => ({ n: 1 }));
    expect(await cached("k", 60_000, compute)).toEqual({ n: 1 });
    expect(await cached("k", 60_000, compute)).toEqual({ n: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("到期後重算", async () => {
    vi.useFakeTimers();
    let n = 0;
    const compute = async () => ({ n: ++n });
    expect(await cached("k", 1_000, compute)).toEqual({ n: 1 });
    vi.advanceTimersByTime(1_001);
    expect(await cached("k", 1_000, compute)).toEqual({ n: 2 });
  });
});
