import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxyFetchMock = vi.hoisted(() => vi.fn());

vi.mock("./http", () => ({
  proxyFetch: proxyFetchMock,
}));

import {
  FAL_BILLING_CACHE_TTL_MS,
  getFalAccountBalance,
  resetFalBillingCacheForTests,
} from "./falBilling";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getFalAccountBalance", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetFalBillingCacheForTests();
    proxyFetchMock.mockReset();
    delete process.env.FAL_ADMIN_KEY;
    delete process.env.FAL_KEY;
  });

  afterEach(() => {
    process.env.FAL_ADMIN_KEY = envBackup.FAL_ADMIN_KEY;
    process.env.FAL_KEY = envBackup.FAL_KEY;
    if (envBackup.FAL_ADMIN_KEY === undefined) delete process.env.FAL_ADMIN_KEY;
    if (envBackup.FAL_KEY === undefined) delete process.env.FAL_KEY;
    resetFalBillingCacheForTests();
  });

  it("未設定 key → not_configured，不打網路", async () => {
    const result = await getFalAccountBalance();
    expect(result).toEqual({
      ok: false,
      code: "not_configured",
      message: expect.stringContaining("FAL_ADMIN_KEY"),
    });
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });

  it("成功：回傳 username / balance / currency，且 Authorization 用 Key 前綴", async () => {
    process.env.FAL_ADMIN_KEY = "admin-secret-key";
    proxyFetchMock.mockResolvedValueOnce(
      jsonResponse({
        username: "my-team",
        credits: { current_balance: 24.5, currency: "USD" },
      }),
    );

    const result = await getFalAccountBalance();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.username).toBe("my-team");
    expect(result.balance).toBe(24.5);
    expect(result.currency).toBe("USD");
    expect(result.cached).toBe(false);
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = proxyFetchMock.mock.calls[0] as [string, RequestInit & { timeoutMs?: number }];
    expect(url).toBe("https://api.fal.ai/v1/account/billing?expand=credits");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Key admin-secret-key");
    // 絕不把 secret 塞進回傳
    expect(JSON.stringify(result)).not.toContain("admin-secret-key");
  });

  it("優先使用 FAL_ADMIN_KEY，否則退回 FAL_KEY", async () => {
    process.env.FAL_KEY = "regular-key";
    proxyFetchMock.mockResolvedValueOnce(
      jsonResponse({ username: "u", credits: { current_balance: 1, currency: "USD" } }),
    );
    await getFalAccountBalance();
    expect((proxyFetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Key regular-key",
    );

    resetFalBillingCacheForTests();
    process.env.FAL_ADMIN_KEY = "admin-key";
    proxyFetchMock.mockResolvedValueOnce(
      jsonResponse({ username: "u", credits: { current_balance: 2, currency: "USD" } }),
    );
    await getFalAccountBalance();
    expect((proxyFetchMock.mock.calls[1][1] as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Key admin-key",
    );
  });

  it("403 → forbidden（提示需 Admin Key）", async () => {
    process.env.FAL_KEY = "no-admin-scope";
    proxyFetchMock.mockResolvedValueOnce(jsonResponse({ detail: "authorization_error" }, 403));

    const result = await getFalAccountBalance();
    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: expect.stringMatching(/Admin|admin|權限/i),
    });
    expect(JSON.stringify(result)).not.toContain("no-admin-scope");
  });

  it("401 也歸類 forbidden", async () => {
    process.env.FAL_ADMIN_KEY = "bad";
    proxyFetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const result = await getFalAccountBalance();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("forbidden");
  });

  it("5xx / 網路錯誤 → upstream_error", async () => {
    process.env.FAL_ADMIN_KEY = "admin";
    proxyFetchMock.mockResolvedValueOnce(new Response("boom", { status: 502 }));
    const r1 = await getFalAccountBalance();
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.code).toBe("upstream_error");
    expect(r1.message).toMatch(/502|暫時|失敗/);

    resetFalBillingCacheForTests();
    proxyFetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const r2 = await getFalAccountBalance();
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe("upstream_error");
    // 使用者訊息不含內部錯誤字串
    expect(r2.message).not.toContain("ECONNRESET");
  });

  it("TTL 內重複請求走快取，不重打上游", async () => {
    process.env.FAL_ADMIN_KEY = "admin";
    // 每次回傳新 Response：同一實例的 body 只能讀一次
    proxyFetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ username: "team", credits: { current_balance: 10, currency: "USD" } })),
    );

    const a = await getFalAccountBalance();
    const b = await getFalAccountBalance();
    expect(a.ok && !a.cached).toBe(true);
    expect(b.ok && b.cached).toBe(true);
    if (a.ok && b.ok) {
      expect(b.balance).toBe(a.balance);
      expect(b.fetchedAt).toBe(a.fetchedAt);
    }
    expect(proxyFetchMock).toHaveBeenCalledTimes(1);

    // force 略過快取
    const c = await getFalAccountBalance({ force: true });
    expect(c.ok && !c.cached).toBe(true);
    expect(proxyFetchMock).toHaveBeenCalledTimes(2);
  });

  it("快取過期後會重新請求", async () => {
    process.env.FAL_ADMIN_KEY = "admin";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    proxyFetchMock
      .mockResolvedValueOnce(jsonResponse({ username: "t", credits: { current_balance: 1, currency: "USD" } }))
      .mockResolvedValueOnce(jsonResponse({ username: "t", credits: { current_balance: 2, currency: "USD" } }));

    const first = await getFalAccountBalance();
    expect(first.ok && first.balance).toBe(1);

    vi.advanceTimersByTime(FAL_BILLING_CACHE_TTL_MS + 1);
    const second = await getFalAccountBalance();
    expect(second.ok && second.balance).toBe(2);
    expect(second.ok && second.cached).toBe(false);
    expect(proxyFetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
