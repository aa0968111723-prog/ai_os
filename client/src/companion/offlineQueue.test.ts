import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_QUEUED_COMMANDS,
  QUEUE_TTL_MS,
  clearQueue,
  dequeueCommand,
  enqueueCommand,
  listQueuedCommands,
  offlineAcknowledgement,
  subscribeQueue,
} from "./offlineQueue";

beforeEach(() => {
  localStorage.clear();
  clearQueue();
});

describe("離線佇列", () => {
  it("收下的東西叫「待送出」，不是「已完成」", () => {
    expect(offlineAcknowledgement(1)).toContain("先記住");
    expect(offlineAcknowledgement(1)).not.toContain("已完成");
    expect(offlineAcknowledgement(3)).toContain("還有 2 句");
  });

  it("排隊之後讀得回來", () => {
    enqueueCommand({ id: "a", text: "把失敗的重跑" });
    expect(listQueuedCommands().map((c) => c.text)).toEqual(["把失敗的重跑"]);
  });

  it("空字串不排隊", () => {
    enqueueCommand({ id: "a", text: "   " });
    expect(listQueuedCommands()).toHaveLength(0);
  });

  it("超過上限丟最舊的——離線半天不該累積四十句一次送出", () => {
    for (let i = 0; i < MAX_QUEUED_COMMANDS + 4; i++) {
      enqueueCommand({ id: `id-${i}`, text: `指令 ${i}` });
    }
    const items = listQueuedCommands();
    expect(items).toHaveLength(MAX_QUEUED_COMMANDS);
    expect(items[0].text).toBe("指令 4");
    expect(items[items.length - 1].text).toBe(`指令 ${MAX_QUEUED_COMMANDS + 3}`);
  });

  it("過期的不再送出——半天前的「重跑失敗的那些」很可能已經沒有意義", () => {
    const old = Date.now() - QUEUE_TTL_MS - 1000;
    enqueueCommand({ id: "old", text: "很久以前", queuedAt: old });
    enqueueCommand({ id: "new", text: "剛剛" });
    expect(listQueuedCommands().map((c) => c.id)).toEqual(["new"]);
  });

  it("送出成功後拿掉那一句", () => {
    enqueueCommand({ id: "a", text: "一" });
    enqueueCommand({ id: "b", text: "二" });
    expect(dequeueCommand("a").map((c) => c.id)).toEqual(["b"]);
  });

  it("壞掉的 localStorage 內容不會讓 App 炸掉", () => {
    localStorage.setItem("aios.companion.outbox", "{ not json");
    expect(listQueuedCommands()).toEqual([]);
    localStorage.setItem("aios.companion.outbox", JSON.stringify([{ nope: true }, 42]));
    expect(listQueuedCommands()).toEqual([]);
  });

  it("寫不進去（無痕）時不丟例外", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => enqueueCommand({ id: "a", text: "一" })).not.toThrow();
    spy.mockRestore();
  });

  it("訂閱者收得到變化（UI 的「還有幾句」才會動）", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeQueue(() => seen.push(listQueuedCommands().length));
    enqueueCommand({ id: "a", text: "一" });
    enqueueCommand({ id: "b", text: "二" });
    unsubscribe();
    enqueueCommand({ id: "c", text: "三" });
    expect(seen).toEqual([1, 2]);
  });
});
