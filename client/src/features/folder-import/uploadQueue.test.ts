import { describe, expect, it, vi } from "vitest";
import { indexFilesByRelativePath, runUploadQueue } from "./uploadQueue";

/**
 * 有界並行上傳佇列。
 *
 * 這支釘死的是「1,284 個檔案不會變成 1,284 次序列往返、也不會變成一次 1,284 條連線」，
 * 以及「一個檔案失敗不會讓其他 1,283 個一起停下來」。
 */

const noSleep = async () => {};

function tasks(count: number) {
  return Array.from({ length: count }, (_, index) => ({ key: `f${index}.jpg`, item: index }));
}

describe("runUploadQueue", () => {
  it("★ 並行數有上限——不會一次全部送出", async () => {
    let inflight = 0;
    let peak = 0;
    await runUploadQueue({
      tasks: tasks(20),
      concurrency: 4,
      sleep: noSleep,
      upload: async () => {
        inflight += 1;
        peak = Math.max(peak, inflight);
        await Promise.resolve();
        inflight -= 1;
      },
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("★ 也不是一檔一檔等——20 個檔案不會只有 1 條在跑", async () => {
    let peak = 0;
    let inflight = 0;
    await runUploadQueue({
      tasks: tasks(20),
      concurrency: 5,
      sleep: noSleep,
      upload: async () => {
        inflight += 1;
        peak = Math.max(peak, inflight);
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        inflight -= 1;
      },
    });
    expect(peak).toBeGreaterThan(1);
  });

  it("每個檔案都會被處理一次且只有一次", async () => {
    const seen: string[] = [];
    const results = await runUploadQueue({
      tasks: tasks(10),
      concurrency: 3,
      sleep: noSleep,
      upload: async (task) => { seen.push(task.key); },
    });
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
    expect(results.every((result) => result.status === "uploaded")).toBe(true);
  });

  it("★ 單檔失敗不擋其他檔——整批仍然跑完，失敗當資料回報", async () => {
    const results = await runUploadQueue({
      tasks: tasks(5),
      concurrency: 2,
      maxAttempts: 1,
      sleep: noSleep,
      upload: async (task) => { if (task.key === "f2.jpg") throw new Error("網路斷了"); },
    });
    expect(results).toHaveLength(5);
    const failed = results.filter((result) => result.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.key).toBe("f2.jpg");
    expect(failed[0]!.error).toBe("網路斷了");
  });

  it("會重試，但重試次數用完就交還失敗（不無限重試）", async () => {
    const attempts = new Map<string, number>();
    const results = await runUploadQueue({
      tasks: tasks(1),
      concurrency: 1,
      maxAttempts: 3,
      sleep: noSleep,
      upload: async (task) => {
        attempts.set(task.key, (attempts.get(task.key) ?? 0) + 1);
        throw new Error("暫時失敗");
      },
    });
    expect(attempts.get("f0.jpg")).toBe(3);
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.attempts).toBe(3);
  });

  it("暫時失敗後成功就算成功", async () => {
    let calls = 0;
    const results = await runUploadQueue({
      tasks: tasks(1),
      concurrency: 1,
      sleep: noSleep,
      upload: async () => { calls += 1; if (calls < 2) throw new Error("抖了一下"); },
    });
    expect(results[0]!.status).toBe("uploaded");
    expect(results[0]!.error).toBeNull();
  });

  it("★ 取消之後尚未開始的檔案不再送出——已送出的不回頭刪", async () => {
    const controller = new AbortController();
    const sent: string[] = [];
    const results = await runUploadQueue({
      tasks: tasks(10),
      concurrency: 1,
      sleep: noSleep,
      signal: controller.signal,
      upload: async (task) => {
        sent.push(task.key);
        if (sent.length === 3) controller.abort();
      },
    });
    expect(sent).toHaveLength(3);
    expect(results.filter((result) => result.status === "cancelled")).toHaveLength(7);
  });

  it("永遠不會 reject——單檔失敗是資料不是例外", async () => {
    await expect(runUploadQueue({
      tasks: tasks(3),
      concurrency: 2,
      maxAttempts: 1,
      sleep: noSleep,
      upload: async () => { throw new Error("全部失敗"); },
    })).resolves.toHaveLength(3);
  });

  it("逐檔回報進度（UI 才能顯示 827 / 1,284）", async () => {
    const onProgress = vi.fn();
    await runUploadQueue({
      tasks: tasks(4), concurrency: 2, sleep: noSleep, upload: async () => {}, onProgress,
    });
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress.mock.calls.at(-1)![0]).toMatchObject({ done: 4, total: 4 });
  });
});

describe("indexFilesByRelativePath", () => {
  it("用完整相對路徑索引——同名不同資料夾的檔案不會互相蓋掉", () => {
    const make = (name: string, path: string) => Object.assign(new File([""], name), { webkitRelativePath: path });
    const index = indexFilesByRelativePath([
      make("IMG001.jpg", "北藝專案/人物/IMG001.jpg"),
      make("IMG001.jpg", "北藝專案/活動/IMG001.jpg"),
    ]);
    expect(index.size).toBe(2);
    expect(index.has("北藝專案/人物/IMG001.jpg")).toBe(true);
    expect(index.has("北藝專案/活動/IMG001.jpg")).toBe(true);
  });
});
