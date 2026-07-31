import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── 假造的磁碟：rel → 檔案大小；值為 null 代表「磁碟上沒這個檔」 ── */
const diskFiles = vi.hoisted(() => new Map<string, number | null>());
const statStored = vi.hoisted(() =>
  vi.fn(async (rel: string): Promise<{ sizeBytes: number; mtimeMs: number } | null> => {
    const size = diskFiles.get(rel);
    return typeof size === "number" ? { sizeBytes: size, mtimeMs: 1_700_000_000_000 } : null;
  }),
);

/* ── 假造的 DB：每張表一組列，select 依 __name 取用；update/insert 只記錄呼叫 ── */
const tableRows = vi.hoisted(
  () =>
    ({
      assets: [],
      dataFiles: [],
      dmAttachments: [],
      exportJobs: [],
      feedbackReports: [],
      storageAuditRuns: [],
    }) as Record<string, unknown[]>,
);
const updates = vi.hoisted(() => [] as { table: string; values: Record<string, unknown> }[]);
const inserts = vi.hoisted(() => [] as { table: string; values: Record<string, unknown> }[]);

vi.mock("../db", () => {
  const nameOf = (t: unknown): string =>
    t && typeof t === "object" && "__name" in t ? String((t as { __name: string }).__name) : "";
  const table = (name: string) => ({
    __name: name,
    id: "id",
    storagePath: "storagePath",
    screenshotPath: "screenshotPath",
    sizeBytes: "sizeBytes",
    bytesWritten: "bytesWritten",
    originUrl: "originUrl",
  });
  return {
    db: {
      select: () => ({
        from: (t: unknown) => {
          const name = nameOf(t);
          let take = Number.POSITIVE_INFINITY;
          let skip = 0;
          const builder = {
            where: () => builder,
            orderBy: () => builder,
            limit: (n: number) => {
              take = n;
              return builder;
            },
            offset: (n: number) => {
              skip = n;
              return builder;
            },
            then: (
              resolve: (rows: unknown[]) => unknown,
              reject: (err: unknown) => unknown,
            ) =>
              Promise.resolve((tableRows[name] ?? []).slice(skip, skip + take)).then(resolve, reject),
          };
          return builder;
        },
      }),
      update: (t: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            updates.push({ table: nameOf(t), values });
          },
        }),
      }),
      insert: (t: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          inserts.push({ table: nameOf(t), values });
        },
      }),
    },
    schema: {
      assets: table("assets"),
      dataFiles: table("dataFiles"),
      dmAttachments: table("dmAttachments"),
      exportJobs: table("exportJobs"),
      feedbackReports: table("feedbackReports"),
      storageAuditRuns: {
        ...table("storageAuditRuns"),
        finishedAt: "finishedAt",
        checked: "checked",
        missing: "missing",
        corrupt: "corrupt",
        recoveredQueued: "recoveredQueued",
      },
    },
  };
});

vi.mock("./storage", () => ({ statStored }));

import { lastAuditRun, reconcileAssets } from "./storageAudit";

/** 造一列素材（預設已落地、DB 記 100 位元組、沒有可重抓的外部來源） */
function assetRow(id: string, rel: string, opts: { sizeBytes?: number | null; originUrl?: string | null } = {}) {
  return {
    id,
    rel,
    sizeBytes: opts.sizeBytes === undefined ? 100 : opts.sizeBytes,
    originUrl: opts.originUrl ?? null,
  };
}

beforeEach(() => {
  diskFiles.clear();
  for (const key of Object.keys(tableRows)) tableRows[key] = [];
  updates.length = 0;
  inserts.length = 0;
  statStored.mockClear();
});

describe("reconcileAssets", () => {
  it("檔案都在且大小相符時，三個問題計數都是 0", async () => {
    tableRows.assets = [assetRow("a-1", "2026/07/a.png")];
    tableRows.dataFiles = [{ id: "f-1", rel: "2026/07/f.pdf", sizeBytes: 200 }];
    tableRows.dmAttachments = [{ id: "d-1", rel: "2026/07/d.jpg", sizeBytes: 300 }];
    tableRows.exportJobs = [{ id: "e-1", rel: "2026/07/e.zip", sizeBytes: 400 }];
    tableRows.feedbackReports = [{ id: "s-1", rel: "feedback/s.png", sizeBytes: null }];
    diskFiles.set("2026/07/a.png", 100);
    diskFiles.set("2026/07/f.pdf", 200);
    diskFiles.set("2026/07/d.jpg", 300);
    diskFiles.set("2026/07/e.zip", 400);
    diskFiles.set("feedback/s.png", 999); // 沒記大小的來源不比對大小

    const result = await reconcileAssets({ mode: "full", record: false });

    expect(result).toMatchObject({ checked: 5, missing: 0, corrupt: 0, recoveredQueued: 0 });
    expect(result.sample).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("磁碟上沒有檔案時計為 missing 並留下樣本", async () => {
    tableRows.assets = [assetRow("a-1", "2026/07/gone.png")];

    const result = await reconcileAssets({ mode: "full", record: false });

    expect(result.checked).toBe(1);
    expect(result.missing).toBe(1);
    expect(result.corrupt).toBe(0);
    expect(result.sample).toEqual([
      { entity: "asset", id: "a-1", rel: "2026/07/gone.png", reason: "missing" },
    ]);
  });

  it("素材缺檔且有 originUrl 時，降級回未落地並排進補抓佇列", async () => {
    tableRows.assets = [
      assetRow("a-1", "2026/07/gone.png", { originUrl: "https://cdn.fal.example/out.png" }),
    ];

    const result = await reconcileAssets({ mode: "full", record: false });

    expect(result.missing).toBe(1);
    expect(result.recoveredQueued).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("assets");
    expect(updates[0].values).toMatchObject({
      storagePath: null,
      url: "https://cdn.fal.example/out.png",
      landState: "pending",
      landAttempts: 0,
      landLastError: "file-missing: 對帳發現實體檔不存在",
      landClaimedAt: null,
    });
    expect(updates[0].values.landNextTryAt).toBeInstanceOf(Date);
  });

  it("缺檔但沒有 originUrl 的素材只記錄、不排補抓", async () => {
    tableRows.assets = [assetRow("a-1", "2026/07/gone.png", { originUrl: "   " })];

    const result = await reconcileAssets({ mode: "full", record: false });

    expect(result.missing).toBe(1);
    expect(result.recoveredQueued).toBe(0);
    expect(updates).toEqual([]);
  });

  it("其餘四個來源缺檔時只記錄，不會嘗試補抓", async () => {
    tableRows.dataFiles = [{ id: "f-1", rel: "2026/07/f.pdf", sizeBytes: 200 }];
    tableRows.dmAttachments = [{ id: "d-1", rel: "2026/07/d.jpg", sizeBytes: 300 }];
    tableRows.exportJobs = [{ id: "e-1", rel: "2026/07/e.zip", sizeBytes: 400 }];
    tableRows.feedbackReports = [{ id: "s-1", rel: "feedback/s.png", sizeBytes: null }];

    const result = await reconcileAssets({ mode: "full", record: false });

    expect(result.checked).toBe(4);
    expect(result.missing).toBe(4);
    expect(result.recoveredQueued).toBe(0);
    expect(updates).toEqual([]);
    expect(result.sample.map((s) => s.entity)).toEqual([
      "dbFile",
      "dmAttachment",
      "exportJob",
      "feedback",
    ]);
  });

  it("檔案在但大小與 DB 記錄不符時計為 corrupt", async () => {
    tableRows.assets = [assetRow("a-1", "2026/07/cut.mp4", { sizeBytes: 5000 })];
    diskFiles.set("2026/07/cut.mp4", 1234); // 寫到一半斷掉的截斷檔

    const result = await reconcileAssets({ mode: "full", record: false });

    expect(result.missing).toBe(0);
    expect(result.corrupt).toBe(1);
    expect(result.sample).toEqual([
      { entity: "asset", id: "a-1", rel: "2026/07/cut.mp4", reason: "size-mismatch" },
    ]);
    expect(updates).toEqual([]); // 截斷檔不自動重抓（尚有檔案，交由人工判讀）
  });

  it("DB 沒記大小（null 或 0）時不做大小比對", async () => {
    tableRows.assets = [
      assetRow("a-1", "2026/07/x.png", { sizeBytes: null }),
      assetRow("a-2", "2026/07/y.png", { sizeBytes: 0 }),
    ];
    diskFiles.set("2026/07/x.png", 4321);
    diskFiles.set("2026/07/y.png", 8765);

    const result = await reconcileAssets({ mode: "full", record: false });

    expect(result).toMatchObject({ checked: 2, missing: 0, corrupt: 0 });
  });

  it("樣本最多留 20 筆（計數仍為完整數量）", async () => {
    tableRows.assets = Array.from({ length: 25 }, (_, i) => assetRow(`a-${i}`, `2026/07/gone-${i}.png`));

    const result = await reconcileAssets({ mode: "full", record: false });

    expect(result.checked).toBe(25);
    expect(result.missing).toBe(25);
    expect(result.sample).toHaveLength(20);
  });

  it("sample 模式每個來源各抽 sampleSize/來源數 筆", async () => {
    tableRows.assets = Array.from({ length: 50 }, (_, i) => assetRow(`a-${i}`, `2026/07/a-${i}.png`));
    tableRows.dataFiles = Array.from({ length: 50 }, (_, i) => ({
      id: `f-${i}`,
      rel: `2026/07/f-${i}.pdf`,
      sizeBytes: 10,
    }));

    const result = await reconcileAssets({ mode: "sample", sampleSize: 30, record: false });

    // 五個來源 → 每源 6 筆；只有兩個來源有列，故共檢查 12 筆
    expect(result.checked).toBe(12);
    expect(statStored).toHaveBeenCalledTimes(12);
  });

  it("單筆 stat 失敗只跳過該筆，其餘繼續掃完", async () => {
    tableRows.assets = [
      assetRow("a-1", "2026/07/boom.png"),
      assetRow("a-2", "2026/07/ok.png"),
    ];
    diskFiles.set("2026/07/ok.png", 100);
    statStored.mockImplementationOnce(async () => {
      throw new Error("EIO");
    });

    const result = await reconcileAssets({ mode: "full", record: false });

    expect(result.checked).toBe(2);
    expect(result.missing).toBe(0);
    expect(result.corrupt).toBe(0);
  });

  it("record 未關閉時把結果寫進 storage_audit_runs", async () => {
    tableRows.assets = [assetRow("a-1", "2026/07/gone.png")];

    await reconcileAssets({ mode: "full" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("storageAuditRuns");
    expect(inserts[0].values).toMatchObject({
      mode: "full",
      checked: 1,
      missing: 1,
      corrupt: 0,
      recoveredQueued: 0,
    });
    expect(inserts[0].values.startedAt).toBeInstanceOf(Date);
    expect(inserts[0].values.finishedAt).toBeInstanceOf(Date);
    expect(inserts[0].values.sample).toHaveLength(1);
  });
});

describe("lastAuditRun", () => {
  it("沒有任何巡檢紀錄時回 null", async () => {
    expect(await lastAuditRun()).toBeNull();
  });

  it("回傳最新一筆已完成的巡檢結果", async () => {
    const finishedAt = new Date("2026-07-31T02:00:00Z");
    tableRows.storageAuditRuns = [
      { finishedAt, checked: 120, missing: 3, corrupt: 1, recoveredQueued: 2 },
    ];

    expect(await lastAuditRun()).toEqual({
      finishedAt,
      checked: 120,
      missing: 3,
      corrupt: 1,
      recoveredQueued: 2,
    });
  });
});
