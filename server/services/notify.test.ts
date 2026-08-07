/**
 * notify() 的契約測試。
 *
 * 這幾條斷言就是「收件匣」這張表存在的理由，任何一條鬆掉都會讓「提醒不遺失」的承諾退回原狀：
 *
 * 1. **先落列、再推播**——推播只影響「多快知道」，不影響「會不會知道」。
 * 2. **逐人推**——pushToUsers 的 attempted 是訂閱列數不是人數，用彙總值回寫會把沒裝置的人
 *    記成已送達，於是「從來沒送達」又一次看不見。
 * 3. **no_device 與 error 分得開**——前者是這個人沒連裝置，後者是系統壞了，處置完全不同。
 * 4. **同一個 event_key 只落一列**——重試、雙寫、補通知都不該在鈴鐺上長出第二筆。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type PushResult = { attempted: number; delivered: number; error?: true };

const pushToUsers = vi.hoisted(() => vi.fn<(ids: string[], payload: unknown) => Promise<PushResult>>());
/** 依 userId 決定推播結果——逐人推的斷言全靠它分辨呼叫端有沒有一次塞一批 */
const pushResultByUser = vi.hoisted(() => new Map<string, PushResult>());
/** 落列紀錄（每次 insert 的 values）與唯一鍵去重模擬 */
const inserted = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const seenEventKeys = vi.hoisted(() => new Set<string>());
/** push_state 回寫紀錄：id → state */
const pushStates = vi.hoisted(() => new Map<string, string>());
/** 事件順序：確認 insert 真的排在 push 之前 */
const order = vi.hoisted(() => [] as string[]);

vi.mock("./webPush", () => ({ pushToUsers }));

vi.mock("../db", () => {
  const db = {
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            order.push("insert");
            const kept: Array<{ id: string; userId: string }> = [];
            for (const r of rows) {
              const key = `${r.userId}::${r.eventKey}`;
              if (seenEventKeys.has(key)) continue; // 唯一鍵 (user_id, event_key)
              seenEventKeys.add(key);
              inserted.push(r);
              kept.push({ id: `n-${inserted.length}`, userId: String(r.userId) });
            }
            return kept;
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: { pushState?: string }) => ({
        where: async (id: string) => {
          if (patch.pushState) pushStates.set(id, patch.pushState);
        },
      }),
    }),
    select: () => ({ from: () => ({ where: async () => [{ n: 0 }] }) }),
  };
  return { db, schema: { notifications: { id: "id", userId: "userId", readAt: "readAt" } } };
});

// eq() 在測試裡只需要把 id 傳給假的 where()，不必真的組 SQL
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (_col: unknown, val: unknown) => val,
}));

const { notify } = await import("./notify");

const base = {
  groupId: "group-1",
  kind: "mention" as const,
  title: "阿明提及你",
  body: "這一鏡的鐘聲太大聲",
  url: "/p/proj-1?focus=messages&mid=m1",
};

/** 讓所有 fire-and-forget 的推播回寫跑完 */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  pushToUsers.mockReset();
  pushResultByUser.clear();
  inserted.length = 0;
  seenEventKeys.clear();
  pushStates.clear();
  order.length = 0;
  pushToUsers.mockImplementation(async (ids) => {
    order.push(`push:${ids.join(",")}`);
    return pushResultByUser.get(ids[0]!) ?? { attempted: 1, delivered: 1 };
  });
});

describe("notify：先落列再推播", () => {
  it("insert 排在 push 之前——推播整條掛掉也不影響收件匣", async () => {
    await notify({ ...base, userIds: ["u1"], eventKey: "mention:m1:posted" });
    expect(order[0]).toBe("insert");
    expect(order[1]).toBe("push:u1");
  });

  it("推播整個拋例外時通知仍在，且主流程不拋", async () => {
    pushToUsers.mockRejectedValue(new Error("推送服務掛了"));
    await expect(notify({ ...base, userIds: ["u1"], eventKey: "mention:m1:posted" })).resolves.toBeUndefined();
    await flush();
    expect(inserted).toHaveLength(1);
  });

  it("落列失敗不拋——通知是附加訊號，不該讓送出留言整個失敗", async () => {
    const { db } = await import("../db");
    const spy = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("DB 掛了");
    });
    await expect(notify({ ...base, userIds: ["u1"], eventKey: "mention:m1:posted" })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("notify：逐人推，不用彙總值回寫", () => {
  it("三個收件人＝三次呼叫，每次只帶一個 userId", async () => {
    await notify({ ...base, userIds: ["u1", "u2", "u3"], eventKey: "mention:m1:posted" });
    await flush();
    expect(pushToUsers).toHaveBeenCalledTimes(3);
    for (const call of pushToUsers.mock.calls) expect(call[0]).toHaveLength(1);
  });

  it("只有一人有裝置時，另外兩人不得被記成 delivered", async () => {
    // 這正是「attempted 是訂閱列數不是人數」會造成的誤判：一次推三人會回 {attempted:1, delivered:1}，
    // 拿它回寫三列就等於宣稱三個人都收到了
    pushResultByUser.set("u1", { attempted: 1, delivered: 1 });
    pushResultByUser.set("u2", { attempted: 0, delivered: 0 });
    pushResultByUser.set("u3", { attempted: 0, delivered: 0 });
    await notify({ ...base, userIds: ["u1", "u2", "u3"], eventKey: "mention:m1:posted" });
    await flush();
    expect(pushStates.get("n-1")).toBe("delivered");
    expect(pushStates.get("n-2")).toBe("no_device");
    expect(pushStates.get("n-3")).toBe("no_device");
  });
});

describe("notify：push_state 分得出沒裝置與系統故障", () => {
  it.each([
    ["有裝置且送達", { attempted: 1, delivered: 1 }, "delivered"],
    ["沒有任何裝置", { attempted: 0, delivered: 0 }, "no_device"],
    ["有裝置但全失敗", { attempted: 2, delivered: 0 }, "failed"],
    // error 旗標存在的唯一理由：沒有它時系統故障與「沒有裝置」都是 {0,0}，
    // 收件匣會把整批故障記成 no_device，而那正好是最需要看得出來的一種失敗
    ["系統故障（DB／VAPID 取不到）", { attempted: 0, delivered: 0, error: true as const }, "error"],
  ])("%s → %s", async (_label, result, expected) => {
    pushResultByUser.set("u1", result);
    await notify({ ...base, userIds: ["u1"], eventKey: "mention:m1:posted" });
    await flush();
    expect(pushStates.get("n-1")).toBe(expected);
  });
});

describe("notify：冪等", () => {
  it("同一個 event_key 呼叫兩次只落一列", async () => {
    await notify({ ...base, userIds: ["u1"], eventKey: "mention:m1:posted" });
    await notify({ ...base, userIds: ["u1"], eventKey: "mention:m1:posted" });
    await flush();
    expect(inserted).toHaveLength(1);
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("帶階段的 event_key 不會互相吃掉（語音留言逐字稿回填要補得了通知）", async () => {
    await notify({ ...base, userIds: ["u1"], eventKey: "mention:m1:posted" });
    await notify({ ...base, userIds: ["u1"], eventKey: "mention:m1:transcribed" });
    await flush();
    expect(inserted).toHaveLength(2);
  });

  it("同一則但不同收件人各落一列（唯一鍵是 user_id + event_key）", async () => {
    await notify({ ...base, userIds: ["u1", "u2"], eventKey: "mention:m1:posted" });
    await flush();
    expect(inserted).toHaveLength(2);
  });

  it("收件人去重、去空值——呼叫端不必先過濾", async () => {
    await notify({ ...base, userIds: ["u1", "u1", ""], eventKey: "mention:m1:posted" });
    await flush();
    expect(inserted).toHaveLength(1);
  });

  it("收件人全空就整個不做（不打 DB、不推播）", async () => {
    await notify({ ...base, userIds: [], eventKey: "mention:m1:posted" });
    expect(inserted).toHaveLength(0);
    expect(pushToUsers).not.toHaveBeenCalled();
  });
});
