/**
 * 裝置綁定登入的真實 PostgreSQL 整合測試。
 *
 * 純函式部分在 deviceTrust.test.ts；這裡驗證只有真的打到資料庫才會浮現的行為：
 * 挑戰兌換的一次性與綁定、撤銷裝置要連帶刪 session、跨帳號不可冒用裝置憑證。
 *
 * 執行：RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/services/deviceTrust.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// 寄信一律攔掉：整合測試不對外送信，也不需要真的 Resend 金鑰。
// isEmailConfigured 回 true 讓 enforce 模式得以生效（否則會自動降級成 monitor）。
vi.mock("./email", () => ({
  isEmailConfigured: () => true,
  sendEmail: vi.fn(async () => ({ status: "sent" as const, detail: "test" })),
}));

const { db, schema } = await import("../db");
const {
  consumeLoginDeviceChallenge,
  lookupDevice,
  requestLoginDeviceChallenge,
  revokeDevice,
  trustDevice,
  listUserDevices,
} = await import("./deviceTrust");
const { createSession, sha256 } = await import("./auth");

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const ctxChrome = { userAgent: UA_CHROME, hint: { screen: "1920x1080", tz: "Asia/Taipei" } };
const ctxIphone = { userAgent: UA_IPHONE, hint: { screen: "390x844", tz: "Asia/Taipei" } };

/**
 * 從挑戰列的 code_hash 反推 6 位數明碼。
 * 只有 90 萬種組合，本地掃完不到一秒——這正是設計文件 §3.2 說的
 * 「驗證碼雜湊擋不住離線暴力，真正的防線是 10 分鐘 TTL＋5 次嘗試上限＋限流」。
 * 這裡把該性質當成測試工具用。
 */
async function recoverCode(challengeId: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  // 與 deviceTrust 內部 hashCode 同一組 salt 前綴
  const hash = (code: string) => createHash("sha256").update(`aios-device-login:${code}`).digest("hex");
  const [row] = await db
    .select({ codeHash: schema.deviceChallenges.codeHash })
    .from(schema.deviceChallenges)
    .where(eq(schema.deviceChallenges.id, challengeId));
  for (let n = 100000; n <= 999999; n += 1) {
    const candidate = String(n);
    if (hash(candidate) === row.codeHash) return candidate;
  }
  throw new Error("找不到對應明碼");
}

describe.skipIf(!RUN_PG).sequential("裝置綁定登入（真實 PostgreSQL）", () => {
  const userIds: string[] = [];

  async function makeUser(): Promise<{ id: string; email: string }> {
    const email = `dt-${randomUUID()}@example.test`;
    const [row] = await db
      .insert(schema.users)
      .values({ name: "測試夥伴", email, passwordHash: "x" })
      .returning({ id: schema.users.id });
    userIds.push(row.id);
    return { id: row.id, email };
  }

  afterAll(async () => {
    if (!userIds.length) return;
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
    await db.delete(schema.userDevices).where(inArray(schema.userDevices.userId, userIds));
    await db.delete(schema.deviceChallenges).where(inArray(schema.deviceChallenges.userId, userIds));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  });

  beforeEach(() => vi.clearAllMocks());

  it("陌生裝置查無信任；信任後同一憑證即命中", async () => {
    const user = await makeUser();
    expect(await lookupDevice(user.id, undefined, ctxChrome)).toEqual({ known: false });

    const device = await trustDevice(user.id, ctxChrome);
    const hit = await lookupDevice(user.id, device.token, ctxChrome);
    expect(hit).toMatchObject({ known: true, deviceId: device.deviceId, label: "Windows · Chrome" });
  });

  // 裝置憑證是綁「人＋裝置」的：偷到別人的 cookie 也不能拿來登入自己以外的帳號
  it("別人的裝置憑證對自己的帳號無效", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const aliceDevice = await trustDevice(alice.id, ctxChrome);
    expect(await lookupDevice(bob.id, aliceDevice.token, ctxChrome)).toEqual({ known: false });
  });

  it("指紋漂移仍算已信任，只是標記出來（不封鎖）", async () => {
    const user = await makeUser();
    const device = await trustDevice(user.id, ctxChrome);
    // 同一張裝置憑證、但特徵換了（例：換了外接螢幕）
    const drifted = await lookupDevice(user.id, device.token, {
      userAgent: UA_CHROME,
      hint: { screen: "1280x720", tz: "Asia/Taipei" },
    });
    expect(drifted).toMatchObject({ known: true, fingerprintChanged: true });
  });

  it("完成信箱驗證即可兌換，且同一組碼不能用第二次", async () => {
    const user = await makeUser();
    const challenge = await requestLoginDeviceChallenge(user, ctxChrome);
    const code = await recoverCode(challenge.challengeId);

    const consumed = await consumeLoginDeviceChallenge({
      userId: user.id,
      challengeId: challenge.challengeId,
      code,
      ctx: ctxChrome,
    });
    expect(consumed.deviceLabel).toBe("Windows · Chrome");

    // 重放：撿到票根與碼的人不能再換一次
    await expect(
      consumeLoginDeviceChallenge({ userId: user.id, challengeId: challenge.challengeId, code, ctx: ctxChrome }),
    ).rejects.toThrow(/無效或已使用/);
  });

  // 防「攻擊者在自己機器觸發挑戰、騙受害者唸出信裡的碼、於攻擊者機器兌換」
  it("必須在發起挑戰的那台裝置上兌換", async () => {
    const user = await makeUser();
    const challenge = await requestLoginDeviceChallenge(user, ctxChrome);
    const code = await recoverCode(challenge.challengeId);

    await expect(
      consumeLoginDeviceChallenge({ userId: user.id, challengeId: challenge.challengeId, code, ctx: ctxIphone }),
    ).rejects.toThrow(/剛才要求登入的那台裝置/);
  });

  it("驗證碼錯誤會累計次數並在用完後拒絕", async () => {
    const user = await makeUser();
    const challenge = await requestLoginDeviceChallenge(user, ctxChrome);
    const real = await recoverCode(challenge.challengeId);
    const wrong = real === "111111" ? "222222" : "111111";

    for (let i = 0; i < 5; i += 1) {
      await expect(
        consumeLoginDeviceChallenge({ userId: user.id, challengeId: challenge.challengeId, code: wrong, ctx: ctxChrome }),
      ).rejects.toThrow(/驗證碼不正確/);
    }
    // 次數用完後，連正確的碼也不再接受——必須重新登入取得新挑戰
    await expect(
      consumeLoginDeviceChallenge({ userId: user.id, challengeId: challenge.challengeId, code: real, ctx: ctxChrome }),
    ).rejects.toThrow(/次數太多/);
  });

  it("別人的挑戰不能拿來兌換自己的帳號", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const challenge = await requestLoginDeviceChallenge(alice, ctxChrome);
    const code = await recoverCode(challenge.challengeId);

    await expect(
      consumeLoginDeviceChallenge({ userId: bob.id, challengeId: challenge.challengeId, code, ctx: ctxChrome }),
    ).rejects.toThrow(/無效或已使用/);
  });

  // 信任是永久制，移除是唯一解除途徑——若不連帶刪 session，
  // 移除只影響「下次登入」，那台現在還開著的照樣能用，等於沒有真的踢掉
  it("移除裝置會連帶刪除該裝置的 session，且不影響其他裝置", async () => {
    const user = await makeUser();
    const phone = await trustDevice(user.id, ctxIphone);
    const laptop = await trustDevice(user.id, ctxChrome);
    await createSession(user.id, { deviceId: phone.deviceId });
    await createSession(user.id, { deviceId: laptop.deviceId });

    const result = await revokeDevice(user.id, phone.deviceId, laptop.token);
    expect(result).toBe("revoked");

    const remaining = await db
      .select({ deviceId: schema.sessions.deviceId })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id));
    expect(remaining).toEqual([{ deviceId: laptop.deviceId }]);

    // 撤銷後那張裝置憑證即失效，下次登入要重新驗證
    expect(await lookupDevice(user.id, phone.token, ctxIphone)).toEqual({ known: false });
  });

  it("移除自己正在用的那台會回報 revoked_current（呼叫端據此清 cookie）", async () => {
    const user = await makeUser();
    const device = await trustDevice(user.id, ctxChrome);
    expect(await revokeDevice(user.id, device.deviceId, device.token)).toBe("revoked_current");
  });

  it("不能移除別人的裝置", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const aliceDevice = await trustDevice(alice.id, ctxChrome);
    expect(await revokeDevice(bob.id, aliceDevice.deviceId, undefined)).toBe("not_found");
  });

  it("裝置清單標出本裝置，且不外洩任何雜湊值", async () => {
    const user = await makeUser();
    const phone = await trustDevice(user.id, ctxIphone);
    const laptop = await trustDevice(user.id, ctxChrome);

    const list = await listUserDevices(user.id, laptop.token);
    expect(list).toHaveLength(2);
    expect(list.find((d) => d.id === laptop.deviceId)?.isCurrent).toBe(true);
    expect(list.find((d) => d.id === phone.deviceId)?.isCurrent).toBe(false);
    for (const item of list) {
      expect(Object.keys(item).sort()).toEqual([
        "details", "id", "isCurrent", "label", "lastSeenAt", "trustedAt",
      ]);
      // 白名單之外還要明擋雜湊類欄位：新增欄位時若不慎把 tokenHash／ipHash／
      // fingerprintHash 一起 select 出來，這裡會立刻紅燈
      expect(JSON.stringify(item)).not.toMatch(/[0-9a-f]{64}/);
    }
  });

  it("裝置細節有落庫，供使用者辨認是哪一台", async () => {
    const user = await makeUser();
    const device = await trustDevice(user.id, {
      userAgent: UA_CHROME,
      hint: {
        screen: "2560x1440",
        cores: 16,
        arch: "x86",
        bitness: "64",
        memoryGb: 8,
        detailOsVersion: "15.0.0",
        detailGpu: "NVIDIA GeForce RTX 4070",
      },
    });
    const [row] = await listUserDevices(user.id, device.token);
    expect(row.details).toMatchObject({
      os: "Windows 11",
      cpu: "X86 · 64 位元 · 16 核心",
      memoryGb: 8,
      gpu: "NVIDIA GeForce RTX 4070",
    });
  });

  it("已移除的裝置不出現在清單", async () => {
    const user = await makeUser();
    const device = await trustDevice(user.id, ctxChrome);
    await revokeDevice(user.id, device.deviceId, undefined);
    expect(await listUserDevices(user.id, undefined)).toEqual([]);
  });

  it("DB 只存裝置憑證的 SHA-256，不存原文", async () => {
    const user = await makeUser();
    const device = await trustDevice(user.id, ctxChrome);
    const [row] = await db
      .select({ tokenHash: schema.userDevices.tokenHash })
      .from(schema.userDevices)
      .where(eq(schema.userDevices.id, device.deviceId));
    expect(row.tokenHash).toBe(sha256(device.token));
    expect(row.tokenHash).not.toBe(device.token);
  });
});
