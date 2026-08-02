import { beforeEach, describe, expect, it, vi } from "vitest";

const { proxyFetch } = vi.hoisted(() => ({ proxyFetch: vi.fn() }));
vi.mock("./http", () => ({ proxyFetch }));

import { getUsdToTwd, resetFxRateCacheForTests, usdBalanceToPointsCap } from "./fxRate";

describe("Fal USD/TWD live conversion", () => {
  beforeEach(() => {
    proxyFetch.mockReset();
    resetFxRateCacheForTests();
  });

  it("reads TWD from the keyless USD exchange-rate endpoint and caches it", async () => {
    proxyFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: "success", base_code: "USD", rates: { TWD: 32.7184 } }),
    });

    await expect(getUsdToTwd()).resolves.toMatchObject({ rate: 32.718, source: "live", cached: false });
    await expect(getUsdToTwd()).resolves.toMatchObject({ rate: 32.718, source: "live", cached: true });
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(proxyFetch).toHaveBeenCalledWith(
      "https://open.er-api.com/v6/latest/USD",
      expect.objectContaining({ timeoutMs: 8_000 }),
    );
  });

  it("falls back safely when the upstream payload is invalid", async () => {
    proxyFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: "success", base_code: "EUR", rates: { TWD: 999 } }),
    });

    await expect(getUsdToTwd()).resolves.toMatchObject({ rate: 31, source: "fallback" });
  });

  it("uses the same rate for the Fal balance point ceiling", () => {
    expect(usdBalanceToPointsCap(10.25, 32.718)).toBe(335);
  });
});
