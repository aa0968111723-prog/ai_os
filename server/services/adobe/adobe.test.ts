/**
 * Adobe 整合的純函式與 mock 行為測試（#224 PR1–PR3）：不碰 DB、不出網。
 * 覆蓋重點是「安全邊界」與「模式切換」——state 簽章、token 到期判定、
 * mock 工作生命週期，以及 real client 拒絕做它其實沒接上的事。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// 加密與簽章金鑰種子：先設好再匯入，測試絕不落地寫 .integration-key
beforeAll(() => {
  process.env.INTEGRATION_TOKEN_SECRET = "test-only-integration-secret-000000000000000000000000";
});
process.env.INTEGRATION_TOKEN_SECRET = "test-only-integration-secret-000000000000000000000000";

const { MockAdobeClient, deriveOutputSize, MOCK_JOB_DURATION_MS } = await import("./mockAdobeClient");
const { RealAdobeClient, decodeJobId, encodeJobId, mapJobStatus } = await import("./adobeClient");
const { AdobeUnsupportedError } = await import("./types");
const {
  MOCK_AUTH_CODE,
  adobeMode,
  buildAdobeAuthUrl,
  exchangeAdobeCode,
  isAdobeConfigured,
  parseTokenResponse,
  signAdobeState,
  signAdobeStateAt,
  verifyAdobeState,
} = await import("./oauth");
const {
  TOKEN_REFRESH_MARGIN_MS,
  decryptAdobeToken,
  encryptAdobeToken,
  isAccessTokenUsable,
} = await import("./tokenService");
const { adobePhotoEditRequestSchema, adobeTimelineSchema } = await import("../../../shared/adobe");

const USER = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  delete process.env.ADOBE_MODE;
  delete process.env.ADOBE_CLIENT_ID;
  delete process.env.ADOBE_CLIENT_SECRET;
  delete process.env.ADOBE_REDIRECT_URI;
  delete process.env.APP_URL;
});

describe("模式解析", () => {
  it("預設 mock：沒設環境變數的環境不可能誤打 Adobe", () => {
    expect(adobeMode()).toBe("mock");
    expect(isAdobeConfigured()).toBe(true);
  });

  it("real 模式必須有站方憑證才算設定完成", () => {
    process.env.ADOBE_MODE = "real";
    expect(adobeMode()).toBe("real");
    expect(isAdobeConfigured()).toBe(false);
    process.env.ADOBE_CLIENT_ID = "cid";
    process.env.ADOBE_CLIENT_SECRET = "secret";
    expect(isAdobeConfigured()).toBe(true);
  });
});

describe("OAuth state", () => {
  it("簽發的 state 驗得回同一位使用者", () => {
    expect(verifyAdobeState(signAdobeState(USER))).toEqual({ userId: USER });
  });

  it("竄改 payload 或簽章一律失效", () => {
    const state = signAdobeState(USER);
    const [payload, sig] = state.split(".");
    expect(verifyAdobeState(`${payload}.${"0".repeat(sig.length)}`)).toBeNull();
    expect(verifyAdobeState(`${Buffer.from("other|9999999999999").toString("base64url")}.${sig}`)).toBeNull();
    expect(verifyAdobeState("not-a-state")).toBeNull();
  });

  it("過期的 state 即使簽章正確也不收", () => {
    expect(verifyAdobeState(signAdobeStateAt(USER, Date.now() - 1))).toBeNull();
  });

  it("與其他整合的 state 不通用（分域金鑰）", async () => {
    const { signIntegrationState } = await import("../integrations");
    expect(verifyAdobeState(signIntegrationState(USER))).toBeNull();
  });
});

describe("授權入口", () => {
  it("mock 模式導回自家 callback，不出網", () => {
    const url = buildAdobeAuthUrl(USER);
    expect(url.startsWith("/api/integrations/adobe/callback?")).toBe(true);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("code")).toBe(MOCK_AUTH_CODE);
    expect(verifyAdobeState(params.get("state") ?? "")).toEqual({ userId: USER });
  });

  it("real 模式導去 Adobe IMS，帶 redirect_uri 與授權範圍", () => {
    process.env.ADOBE_MODE = "real";
    process.env.ADOBE_CLIENT_ID = "cid";
    process.env.ADOBE_REDIRECT_URI = "https://example.test/api/integrations/adobe/callback";
    const url = new URL(buildAdobeAuthUrl(USER));
    expect(url.origin).toBe("https://ims-na1.adobelogin.com");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.test/api/integrations/adobe/callback");
    expect(url.searchParams.get("scope")).toContain("firefly_api");
  });
});

describe("token 交換", () => {
  it("mock 模式發模擬憑證（帶 mock 前綴，不可能被誤當真憑證）", async () => {
    const { tokens, profile } = await exchangeAdobeCode(MOCK_AUTH_CODE, USER);
    expect(tokens.accessToken.startsWith("mock-adobe-access-")).toBe(true);
    expect(tokens.refreshToken?.startsWith("mock-adobe-refresh-")).toBe(true);
    expect(profile.accountId).toContain(USER);
  });

  it("mock 模式拒絕不正確的授權碼", async () => {
    await expect(exchangeAdobeCode("bogus", USER)).rejects.toThrow("模擬授權碼");
  });

  it("IMS 回應缺 access token 視為失敗（不讓半套憑證落庫）", () => {
    expect(() => parseTokenResponse({ refresh_token: "r", expires_in: 3600 })).toThrow("access token");
    expect(parseTokenResponse({ access_token: "a", expires_in: 60 })).toEqual({
      accessToken: "a",
      refreshToken: undefined,
      expiresInSec: 60,
      scope: undefined,
    });
  });
});

describe("token 保管", () => {
  it("加解密可還原，且密文每次都不同（隨機 IV）", () => {
    const a = encryptAdobeToken("secret-token");
    const b = encryptAdobeToken("secret-token");
    expect(a).not.toBe(b);
    expect(decryptAdobeToken(a)).toBe("secret-token");
  });

  it("密文被竄改就解不開（GCM 認證標籤）", () => {
    const enc = encryptAdobeToken("secret-token");
    const [iv, tag, data] = enc.split(":");
    expect(() => decryptAdobeToken(`${iv}:${tag}:${data.replace(/.$/, (c) => (c === "0" ? "1" : "0"))}`)).toThrow();
    expect(() => decryptAdobeToken("bad-format")).toThrow("格式不正確");
  });

  it("到期前 5 分鐘就視為不可用（避免臨界點打到 401）", () => {
    const now = Date.now();
    expect(isAccessTokenUsable({ accessTokenEnc: "x", expiresAt: new Date(now + TOKEN_REFRESH_MARGIN_MS + 1_000) }, now)).toBe(true);
    expect(isAccessTokenUsable({ accessTokenEnc: "x", expiresAt: new Date(now + TOKEN_REFRESH_MARGIN_MS - 1_000) }, now)).toBe(false);
    expect(isAccessTokenUsable({ accessTokenEnc: null, expiresAt: new Date(now + 3_600_000) }, now)).toBe(false);
    expect(isAccessTokenUsable({ accessTokenEnc: "x", expiresAt: null }, now)).toBe(false);
  });
});

describe("Mock client", () => {
  let clock = 1_000_000;
  let client: InstanceType<typeof MockAdobeClient>;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    clock = 1_000_000;
    client = new MockAdobeClient({ now: () => clock });
  });

  afterEach(() => vi.restoreAllMocks());

  it("列素材支援關鍵字與筆數上限", async () => {
    expect(await client.listAssets("t", { limit: 2 })).toHaveLength(2);
    const found = await client.listAssets("t", { query: "訪談", limit: 30 });
    expect(found.map((a) => a.id)).toEqual(["mock-clip-002"]);
  });

  it("修圖工作走 queued → running → succeeded，完成才給結果資產", async () => {
    const request = adobePhotoEditRequestSchema.parse({
      assetId: "mock-photo-001",
      operations: [{ op: "remove_background" }, { op: "resize", width: 1080, height: 1080 }],
    });
    const job = await client.editPhoto("t", request);
    expect(job.status).toBe("queued");
    expect(job.resultAsset).toBeUndefined();

    clock += MOCK_JOB_DURATION_MS / 2;
    const running = await client.getJob("t", job.id);
    expect(running.status).toBe("running");
    expect(running.progress).toBeGreaterThan(0);

    clock += MOCK_JOB_DURATION_MS;
    const done = await client.getJob("t", job.id);
    expect(done.status).toBe("succeeded");
    expect(done.progress).toBe(100);
    expect(done.resultAsset?.width).toBe(1080);
    expect(done.resultAsset?.mime).toBe("image/png");
  });

  it("素材不存在或型別不符會被擋下（錯誤路徑同樣測得到）", async () => {
    const request = adobePhotoEditRequestSchema.parse({ assetId: "nope", operations: [{ op: "auto_tone" }] });
    await expect(client.editPhoto("t", request)).rejects.toThrow("找不到 Adobe 素材");
    const onVideo = adobePhotoEditRequestSchema.parse({ assetId: "mock-clip-001", operations: [{ op: "auto_tone" }] });
    await expect(client.editPhoto("t", onVideo)).rejects.toThrow("不是圖片");
    await expect(client.getJob("t", "mock-job-unknown")).rejects.toThrow("找不到這個 Adobe 工作");
  });

  it("時間軸算圖的成品長度與畫布尺寸來自時間軸本身", async () => {
    const timeline = adobeTimelineSchema.parse({
      name: "開場",
      width: 1280,
      height: 720,
      clips: [
        { assetId: "mock-clip-001", startSec: 0, durationSec: 5 },
        { assetId: "mock-clip-002", startSec: 5, durationSec: 3 },
      ],
    });
    const job = await client.renderTimeline("t", timeline);
    clock += MOCK_JOB_DURATION_MS;
    const done = await client.getJob("t", job.id);
    expect(done.kind).toBe("timeline");
    expect(done.resultAsset?.durationSec).toBe(8);
    expect(done.resultAsset?.width).toBe(1280);
  });

  it("成品尺寸推導：裁切與縮放會改變寬高，其餘操作不動", () => {
    const source = { width: 4000, height: 3000 };
    const parse = (operations: unknown[]) => adobePhotoEditRequestSchema.parse({ assetId: "mock-photo-001", operations });
    expect(deriveOutputSize(source, parse([{ op: "auto_tone" }]))).toEqual(source);
    expect(deriveOutputSize(source, parse([{ op: "crop", x: 0, y: 0, width: 100, height: 200 }]))).toEqual({ width: 100, height: 200 });
    expect(deriveOutputSize(source, parse([
      { op: "crop", x: 0, y: 0, width: 100, height: 200 },
      { op: "resize", width: 50, height: 50 },
    ]))).toEqual({ width: 50, height: 50 });
  });
});

describe("Real client 的誠實邊界", () => {
  const client = new RealAdobeClient();

  it("尚未接上的能力回報 false，而不是讓人按了才失敗", () => {
    expect(client.capabilities).toEqual({ photoEdit: true, timelineRender: false, assetBrowse: false });
  });

  it("素材瀏覽與時間軸算圖回明確的「尚未支援」", async () => {
    await expect(client.listAssets()).rejects.toBeInstanceOf(AdobeUnsupportedError);
    const timeline = adobeTimelineSchema.parse({ name: "t", clips: [{ assetId: "a", startSec: 0, durationSec: 1 }] });
    await expect(client.renderTimeline("t", timeline)).rejects.toBeInstanceOf(AdobeUnsupportedError);
  });

  it("未接上的修圖操作不會被硬送出去（猜錯會動到使用者自己的雲端資產）", async () => {
    const request = adobePhotoEditRequestSchema.parse({
      assetId: "a",
      operations: [{ op: "crop", x: 0, y: 0, width: 10, height: 10 }],
    });
    await expect(client.editPhoto("t", request)).rejects.toBeInstanceOf(AdobeUnsupportedError);
  });

  it("工作 id 與狀態網址可逆，格式錯誤即拒絕", () => {
    const href = "https://image.adobe.io/status/abc-123";
    expect(decodeJobId(encodeJobId(href))).toBe(href);
    expect(() => decodeJobId("mock-job-1")).toThrow("格式不正確");
    expect(() => decodeJobId(`real:${Buffer.from("http://evil.test").toString("base64url")}`)).toThrow("格式不正確");
  });

  it("Adobe 的狀態字彙對應到本系統四態", () => {
    expect(mapJobStatus("succeeded")).toBe("succeeded");
    expect(mapJobStatus("success")).toBe("succeeded");
    expect(mapJobStatus("failed")).toBe("failed");
    expect(mapJobStatus("running")).toBe("running");
    expect(mapJobStatus("pending")).toBe("queued");
    expect(mapJobStatus("whatever")).toBe("queued");
  });
});
