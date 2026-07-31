/**
 * 持久性偵測（assessStoragePersistence）單元測試：
 * 這是「假綠燈」事故的核心修正——舊版用 existsSync("/data") 判斷有沒有掛 Volume，
 * 但 Dockerfile 在映像層就 mkdir 了 /data，條件在容器內恆真。新版改用 device id
 * 比對真正的掛載點，這裡把四種 mode（declared / mountpoint / container-layer / unknown）
 * 與 mountinfo 後備、降級旗標副作用一一釘住，防止未來又退化回字串比對。
 *
 * 測法：statSync / readFileSync 用 vi.mock 假造、process.platform 用 defineProperty 蓋掉；
 * 每個案例都 vi.resetModules() 重新載入 storage.ts——因為判定結果會 memoize，
 * 共用模組實例的話第二個案例只會拿到第一個案例的快取。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statSyncMock = vi.hoisted(() => vi.fn());
const readFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    // 只蓋 deviceIdOf / mountInfoHasMount 會用到的兩支；其餘（existsSync、mkdirSync…）保持真實，
    // 避免影響 storage.ts 模組載入與其他相依套件。
    statSync: statSyncMock,
    readFileSync: readFileSyncMock,
  };
});

const REAL_PLATFORM = process.platform;
const ENV_KEYS = ["ASSET_DIR", "ASSET_PERSISTENT", "ASSET_STRICT"] as const;
const envBackup: Record<string, string | undefined> = {};

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

/** 重設環境後載入一份全新的 storage / storageHealth 模組（同一個 registry，共享降級狀態） */
async function loadStorage() {
  vi.resetModules();
  const storage = await import("./storage");
  const health = await import("./storageHealth");
  return { storage, health };
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    envBackup[k] = process.env[k];
    delete process.env[k];
  }
  // 固定 STORAGE_ROOT，讓 note 內容與 statSync 呼叫路徑可預期（statSync 已 mock，不會真的碰磁碟）
  process.env.ASSET_DIR = "/data";
  statSyncMock.mockReset();
  readFileSyncMock.mockReset();
});

afterEach(() => {
  setPlatform(REAL_PLATFORM);
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

describe("assessStoragePersistence", () => {
  it("declared：ASSET_PERSISTENT=1 人工背書 → persistent，且不需要碰磁碟", async () => {
    process.env.ASSET_PERSISTENT = "1";
    setPlatform("linux");
    const { storage, health } = await loadStorage();
    const result = storage.assessStoragePersistence();
    expect(result.mode).toBe("declared");
    expect(result.persistent).toBe(true);
    expect(result.root).toBe("/data");
    expect(statSyncMock).not.toHaveBeenCalled();
    expect(health.storageDegradeState().degraded).toBe(false);
  });

  it("mountpoint：Linux 上 STORAGE_ROOT 與 / 的 device id 不同 → 真的有掛 Volume", async () => {
    setPlatform("linux");
    statSyncMock.mockImplementation((p: string) => ({ dev: p === "/" ? 1 : 42 }));
    const { storage, health } = await loadStorage();
    const result = storage.assessStoragePersistence();
    expect(result.mode).toBe("mountpoint");
    expect(result.persistent).toBe(true);
    expect(health.storageDegradeState().degraded).toBe(false);
  });

  it("container-layer：device id 相同（目錄只是映像層資料夾）→ 不持久，note 含修法，並標記降級", async () => {
    setPlatform("linux");
    statSyncMock.mockImplementation(() => ({ dev: 1 })); // /data 與 / 同一顆 device＝沒掛 Volume
    const { storage, health } = await loadStorage();
    const result = storage.assessStoragePersistence();
    expect(result.mode).toBe("container-layer");
    expect(result.persistent).toBe(false);
    // note 必須是「照著做就能修好」的指引，不是只丟一句請掛 Volume
    expect(result.note).toContain("Zeabur");
    expect(result.note).toContain("/data");
    // 副作用：判定為不持久的當下就要標記降級——這正是舊版「偵測到了但沒人接手」的補洞
    const degrade = health.storageDegradeState();
    expect(degrade.degraded).toBe(true);
    expect(degrade.reason).toBe("not-persistent");
  });

  it("unknown：非 Linux 開發機（Windows/macOS）→ 不宣稱持久", async () => {
    setPlatform("win32");
    const { storage } = await loadStorage();
    const result = storage.assessStoragePersistence();
    expect(result.mode).toBe("unknown");
    expect(result.persistent).toBe(false);
    expect(statSyncMock).not.toHaveBeenCalled();
  });

  it("mountinfo 後備：device id 讀不到但 /proc/self/mountinfo 有掛載列 → 仍判 mountpoint", async () => {
    setPlatform("linux");
    statSyncMock.mockImplementation(() => {
      throw new Error("stat 被擋");
    });
    readFileSyncMock.mockReturnValue(
      [
        "22 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw",
        "36 22 8:16 / /data rw,relatime - ext4 /dev/sdb1 rw",
      ].join("\n"),
    );
    const { storage } = await loadStorage();
    const result = storage.assessStoragePersistence();
    expect(result.mode).toBe("mountpoint");
    expect(result.persistent).toBe(true);
  });

  it("device id 讀不到、mountinfo 也沒有掛載列 → unknown（當成可能會遺失處理）", async () => {
    setPlatform("linux");
    statSyncMock.mockImplementation(() => {
      throw new Error("stat 被擋");
    });
    readFileSyncMock.mockImplementation(() => {
      throw new Error("/proc 不可讀");
    });
    const { storage } = await loadStorage();
    const result = storage.assessStoragePersistence();
    expect(result.mode).toBe("unknown");
    expect(result.persistent).toBe(false);
    expect(result.note).toContain("Zeabur"); // unknown 一樣要給修法
  });

  it("memoize：同一模組實例第二次呼叫不再 stat（健康檢查可高頻呼叫）", async () => {
    setPlatform("linux");
    statSyncMock.mockImplementation((p: string) => ({ dev: p === "/" ? 1 : 42 }));
    const { storage } = await loadStorage();
    const first = storage.assessStoragePersistence();
    const callsAfterFirst = statSyncMock.mock.calls.length;
    const second = storage.assessStoragePersistence();
    expect(second).toEqual(first);
    expect(statSyncMock.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("storageWriteBlockReason（嚴格模式守門）", () => {
  it("ASSET_STRICT=1 且降級（container-layer）→ 回可直接顯示的中文拒收訊息", async () => {
    setPlatform("linux");
    process.env.ASSET_STRICT = "1";
    statSyncMock.mockImplementation(() => ({ dev: 1 }));
    const { storage, health } = await loadStorage();
    storage.assessStoragePersistence(); // 觸發降級標記
    const reason = health.storageWriteBlockReason();
    expect(reason).not.toBeNull();
    expect(reason).toContain("暫時停止接收新素材");
    expect(reason).toContain("管理員"); // 要講清楚下一步找誰、做什麼
  });

  it("未設 ASSET_STRICT → 即使降級也不擋（照常收檔）", async () => {
    setPlatform("linux");
    statSyncMock.mockImplementation(() => ({ dev: 1 }));
    const { storage, health } = await loadStorage();
    storage.assessStoragePersistence();
    expect(health.storageDegradeState().degraded).toBe(true);
    expect(health.storageWriteBlockReason()).toBeNull();
  });

  it("ASSET_STRICT=1 但儲存層健康 → 不擋", async () => {
    process.env.ASSET_STRICT = "1";
    setPlatform("linux");
    statSyncMock.mockImplementation((p: string) => ({ dev: p === "/" ? 1 : 42 }));
    const { storage, health } = await loadStorage();
    storage.assessStoragePersistence();
    expect(health.storageWriteBlockReason()).toBeNull();
  });
});
