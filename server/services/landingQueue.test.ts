/**
 * 落地補抓佇列狀態機測試（sweepUnlandedAssets）：
 * 佇列的核心承諾是「死列會退場、活列有名額、併發不重複落地」。
 * 這裡 mock 掉 ../db 與 ./storage 的 persistRemote，逐一驗證退場矩陣：
 * gone→failed、too-large→skipped、可重試→指數退避、次數達上限→failed＋推播、
 * 條件式 update 落空→清掉自己下載的孤兒檔、mock 佔位素材→skipped 出隊。
 * 任何一格判錯都會回到舊病灶：死列佔滿 LIMIT 名額，真正救得回來的成品永遠輪不到補抓。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ── 假造的 storage：persistRemote 由各測試自行指定回傳；removeStoredFile 只記錄呼叫 ── */
const persistRemote = vi.hoisted(() => vi.fn());
const removeStoredFile = vi.hoisted(() => vi.fn(async () => {}));

/* ── 假造的推播與錯誤觀測 ── */
const pushToUsers = vi.hoisted(() => vi.fn(async () => ({ attempted: 1, delivered: 1 })));
const recordError = vi.hoisted(() => vi.fn());

/* ── 假造的 DB ──
 * execute：回「本輪認領到的素材列」（sweepUnlandedAssets 的 CTE 認領查詢）。
 * update：把 set 的值記進 updates 供斷言；.returning() 回 updateReturning（條件式 update 的勝負）。
 * select：只用在 resolveLandOwner 查生成發起人。 */
const claimQueue = vi.hoisted(() => [] as unknown[]);
const updates = vi.hoisted(() => [] as { table: string; values: Record<string, unknown> }[]);
const updateReturning = vi.hoisted(() => ({ rows: [{ id: "won" }] as unknown[] }));
const generationRows = vi.hoisted(() => [] as unknown[]);

vi.mock("../db", () => {
  const nameOf = (t: unknown): string =>
    t && typeof t === "object" && "__name" in t ? String((t as { __name: string }).__name) : "";
  const table = (name: string, cols: string[]) => ({
    __name: name,
    ...Object.fromEntries(cols.map((c) => [c, c])),
  });
  return {
    db: {
      execute: vi.fn(async () => ({ rows: claimQueue.splice(0) })),
      update: (t: unknown) => ({
        set: (values: Record<string, unknown>) => {
          const entry = { table: nameOf(t), values };
          return {
            where: () => ({
              // 條件式 update（commitLandedAsset）走 .returning()；其餘直接 await
              returning: async () => {
                updates.push(entry);
                return updateReturning.rows.slice();
              },
              then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
                updates.push(entry);
                return Promise.resolve(undefined).then(resolve, reject);
              },
            }),
          };
        },
      }),
      select: () => ({
        from: (t: unknown) => ({
          where: async () => (nameOf(t) === "generations" ? generationRows.slice() : []),
        }),
      }),
    },
    schema: {
      assets: table("assets", [
        "id", "storagePath", "mime", "sizeBytes", "sha256", "url", "originUrl",
        "landState", "landAttempts", "landLastError", "landLastTriedAt", "landNextTryAt", "landClaimedAt",
        "isAiGenerated", "deletedAt", "createdAt", "meta", "projectId", "groupId", "title", "uploadedBy",
      ]),
      generations: table("generations", ["id", "userId", "resultUrl", "updatedAt", "status"]),
    },
  };
});

vi.mock("./storage", () => ({
  persistRemote,
  removeStoredFile,
  signAssetUrl: vi.fn(() => "https://signed.example/x"),
}));
vi.mock("./webPush", () => ({
  pushToUsers,
  groupLeaderIds: vi.fn(async () => []),
}));
vi.mock("./errlog", () => ({ recordError }));

import { sweepUnlandedAssets } from "./generationCore";

/** 造一列「本輪被認領到」的素材（欄位名對齊認領 SQL 的 returning 別名） */
function claimedAsset(opts: Partial<{
  id: string;
  projectId: string;
  title: string;
  url: string;
  originUrl: string | null;
  meta: unknown;
  landAttempts: number;
  uploadedBy: string | null;
  createdAt: Date;
}> = {}) {
  return {
    id: "asset-1",
    projectId: "proj-1",
    title: "晨光禪堂",
    url: "https://cdn.fal.example/out.png",
    originUrl: "https://cdn.fal.example/out.png",
    meta: { generationId: "gen-1" },
    landAttempts: 0,
    uploadedBy: null,
    createdAt: new Date(), // 剛生成：不觸發 24 小時年齡退場
    ...opts,
  };
}

/** 取對 assets 表的更新（略過 generations 的 resultUrl 回填） */
const assetUpdates = () => updates.filter((u) => u.table === "assets");

beforeEach(() => {
  claimQueue.length = 0;
  updates.length = 0;
  generationRows.length = 0;
  generationRows.push({ userId: "user-1" });
  updateReturning.rows = [{ id: "won" }];
  persistRemote.mockReset();
  removeStoredFile.mockClear();
  pushToUsers.mockClear();
  recordError.mockClear();
});

afterEach(() => {
  delete process.env.ASSET_LAND_MAX_ATTEMPTS;
});

describe("sweepUnlandedAssets：永久失敗退場", () => {
  it("reason=gone（來源 404/410）→ 立刻標 failed、清空 landNextTryAt，不再重試", async () => {
    claimQueue.push(claimedAsset());
    persistRemote.mockResolvedValue({ ok: false, reason: "gone", retryable: false, detail: "來源檔案已不存在（HTTP 404）" });

    const landed = await sweepUnlandedAssets();

    expect(landed).toBe(0);
    const ups = assetUpdates();
    expect(ups).toHaveLength(1);
    expect(ups[0].values).toMatchObject({
      landState: "failed",
      landAttempts: 1,
      landLastError: "來源檔案已不存在（HTTP 404）",
      landNextTryAt: null,
      landClaimedAt: null,
    });
    expect(recordError).toHaveBeenCalledWith("asset:land-failed", expect.stringContaining("asset-1"));
  });

  it("reason=too-large → 標 skipped（結構性限制，調高上限前重試無意義），推播請管理員調 ASSET_MAX_MB", async () => {
    claimQueue.push(claimedAsset());
    persistRemote.mockResolvedValue({ ok: false, reason: "too-large", retryable: false, detail: "成品超過單檔上限" });

    await sweepUnlandedAssets();

    const ups = assetUpdates();
    expect(ups).toHaveLength(1);
    expect(ups[0].values).toMatchObject({ landState: "skipped", landNextTryAt: null });
    expect(pushToUsers).toHaveBeenCalledTimes(1);
    const [ids, payload] = pushToUsers.mock.calls[0] as unknown as [string[], { body: string }];
    expect(ids).toEqual(["user-1"]);
    expect(payload.body).toContain("ASSET_MAX_MB");
    expect(payload.body).toContain("請立刻自行下載一份");
  });

  it("attempts 達上限 → failed 且推播通知擁有者「沒有永久備份，請立刻下載」", async () => {
    // 預設上限 8：這次是第 8 次嘗試（先前已試 7 次）→ 即使 retryable 也退場
    claimQueue.push(claimedAsset({ landAttempts: 7 }));
    persistRemote.mockResolvedValue({ ok: false, reason: "timeout", retryable: true, detail: "抓取成品逾時" });

    await sweepUnlandedAssets();

    const ups = assetUpdates();
    expect(ups).toHaveLength(1);
    expect(ups[0].values).toMatchObject({ landState: "failed", landAttempts: 8, landNextTryAt: null });
    expect(pushToUsers).toHaveBeenCalledTimes(1);
    const [ids, payload] = pushToUsers.mock.calls[0] as unknown as [string[], { body: string }];
    expect(ids).toEqual(["user-1"]); // meta.generationId → 生成發起人
    expect(payload.body).toContain("沒有永久備份");
    expect(payload.body).toContain("請立刻自行下載一份");
  });
});

describe("sweepUnlandedAssets：可重試失敗走指數退避", () => {
  it("retryable 失敗 → 維持 pending（不改 landState）、attempts+1、退避時間隨次數遞增", async () => {
    persistRemote.mockResolvedValue({ ok: false, reason: "http", retryable: true, detail: "抓取成品失敗（HTTP 503）" });

    // 第一次失敗（先前 0 次）→ 退避 2^1 = 2 分鐘
    claimQueue.push(claimedAsset({ landAttempts: 0 }));
    await sweepUnlandedAssets();
    // 第二次失敗（先前 1 次）→ 退避 2^2 = 4 分鐘
    claimQueue.push(claimedAsset({ landAttempts: 1 }));
    await sweepUnlandedAssets();

    const ups = assetUpdates();
    expect(ups).toHaveLength(2);
    for (const u of ups) {
      expect(u.values.landState).toBeUndefined(); // 沒動狀態＝仍是 pending，佇列會再排
      expect(u.values.landClaimedAt).toBeNull(); // 釋放認領
      expect(u.values.landNextTryAt).toBeInstanceOf(Date);
    }
    const backoffOf = (u: { values: Record<string, unknown> }) =>
      (u.values.landNextTryAt as Date).getTime() - (u.values.landLastTriedAt as Date).getTime();
    expect(backoffOf(ups[0])).toBe(2 * 60_000);
    expect(backoffOf(ups[1])).toBe(4 * 60_000);
    expect(backoffOf(ups[1])).toBeGreaterThan(backoffOf(ups[0]));
    expect(ups[0].values.landAttempts).toBe(1);
    expect(ups[1].values.landAttempts).toBe(2);
    expect(pushToUsers).not.toHaveBeenCalled(); // 還沒放棄，不打擾使用者
  });
});

describe("sweepUnlandedAssets：落地成功與併發防護", () => {
  it("成功落地：條件式 update 命中 → 寫回本地網址並回填生成 resultUrl", async () => {
    claimQueue.push(claimedAsset());
    persistRemote.mockResolvedValue({ ok: true, storagePath: "2026/08/a.png", mime: "image/png", sizeBytes: 123, sha256: "abc" });

    const landed = await sweepUnlandedAssets();

    expect(landed).toBe(1);
    const ups = assetUpdates();
    expect(ups).toHaveLength(1);
    expect(ups[0].values).toMatchObject({
      storagePath: "2026/08/a.png",
      mime: "image/png",
      sizeBytes: 123,
      sha256: "abc",
      url: "/api/assets/asset-1/file",
      landState: "landed",
      landClaimedAt: null,
      landLastError: null,
    });
    // 關鍵：originUrl 不在 set 清單內——落地成功也不抹除唯一的補救來源
    expect("originUrl" in ups[0].values).toBe(false);
    const genUps = updates.filter((u) => u.table === "generations");
    expect(genUps).toHaveLength(1);
    expect(genUps[0].values).toMatchObject({ resultUrl: "/api/assets/asset-1/file" });
    expect(removeStoredFile).not.toHaveBeenCalled();
  });

  it("條件式 update 影響 0 列（另一輪已先落地）→ 刪掉自己剛下載的孤兒檔", async () => {
    claimQueue.push(claimedAsset());
    persistRemote.mockResolvedValue({ ok: true, storagePath: "2026/08/dup.png", mime: "image/png", sizeBytes: 123, sha256: "abc" });
    updateReturning.rows = []; // storage_path 已非空：條件式 update 落空

    const landed = await sweepUnlandedAssets();

    expect(landed).toBe(0);
    expect(removeStoredFile).toHaveBeenCalledWith("2026/08/dup.png");
    // 輸的那邊不能再去改生成的 resultUrl（贏家已寫過正確值）
    expect(updates.filter((u) => u.table === "generations")).toHaveLength(0);
  });
});

describe("sweepUnlandedAssets：mock 佔位素材出隊", () => {
  it("/api/mock-asset/* 佔位網址 → 直接標 skipped，不嘗試抓取、不再佔佇列名額", async () => {
    claimQueue.push(claimedAsset({ url: "/api/mock-asset/image", originUrl: null }));

    const landed = await sweepUnlandedAssets();

    expect(landed).toBe(0);
    expect(persistRemote).not.toHaveBeenCalled();
    const ups = assetUpdates();
    expect(ups).toHaveLength(1);
    expect(ups[0].values).toMatchObject({ landState: "skipped", landNextTryAt: null, landClaimedAt: null });
    expect(pushToUsers).not.toHaveBeenCalled(); // 假素材不值得吵醒任何人
  });

  it("originUrl 是 mock 佔位時同樣出隊（來源優先看 originUrl）", async () => {
    claimQueue.push(claimedAsset({ originUrl: "https://old.zeabur.app/api/mock-asset/video" }));

    await sweepUnlandedAssets();

    expect(persistRemote).not.toHaveBeenCalled();
    expect(assetUpdates()[0].values).toMatchObject({ landState: "skipped" });
  });
});
