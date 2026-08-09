/**
 * A2/T3 迴歸測試：NIM 呼叫的「總時限不變式」。
 * 舊版 timeoutMs 是「每次重試各吃一個」，3 次 attempt × 60s 讓單次 ask 最壞卡到 180s——
 * 長上下文（A2）與工具動作（T3）逾時都栽在這裡：使用者等 60–100s 沒回應、trace 停在 prepared。
 *
 * 這裡鎖住兩件事：
 *  1. 慢回應（每次 attempt 都超過總時限才回應）→ 在 timeoutMs 內以 NimServiceError 逾時收束，
 *     只發 1 次請求、不重試把等待時間翻三倍；
 *  2. 快速暫時性失敗（瞬時網路錯誤）仍會重試——總時限鎖的是「總時間」不是「重試次數」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("./http", () => ({ proxyFetch: fetchMock }));

process.env.NVIDIA_NIM_API_KEY = "test-key";
const { chatCompletion, NimServiceError } = await import("./nvidia-nim");

function ok(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { role: "assistant", content } }] }),
  } as unknown as Response;
}

describe("chatCompletion 總時限（A2/T3 迴歸）", () => {
  beforeEach(() => fetchMock.mockReset());

  it("慢回應：整段呼叫以總時限收束，單次 attempt 逾時即 NimServiceError、不重試翻倍", async () => {
    // 模擬真 NIM「每次都超過總時限才回應」：mock proxyFetch 尊重傳入的 timeoutMs、
    // 時間到才以 TimeoutError 拒絕（與 http.proxyFetch 的 AbortSignal.timeout 行為一致）。
    fetchMock.mockImplementation(
      (_url: string, init: { timeoutMs?: number }) =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new DOMException("timed out", "TimeoutError")), init?.timeoutMs ?? 0);
        }),
    );
    const timeoutMs = 2000;
    const started = Date.now();
    await expect(
      chatCompletion({ messages: [{ role: "user", content: "hi" }], timeoutMs }),
    ).rejects.toMatchObject({ name: "NimServiceError", message: expect.stringContaining("逾時") });

    // 只發出 1 次 HTTP 請求：舊版 3 次 attempt 各吃完整 timeout 的「3×timeout」行為已不存在
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 總耗時被總時限綁住（留 1.5s 餘裕給 Math.max(1_000, …) 地板），遠小於舊版 3×timeout
    expect(Date.now() - started).toBeLessThan(timeoutMs + 1500);
  });

  it("快速暫時性失敗仍會重試：總時限鎖的是總時間，不是重試次數", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("fetch failed")) // attempt 1：瞬時網路錯誤
      .mockRejectedValueOnce(new Error("fetch failed")) // attempt 2：瞬時網路錯誤
      .mockResolvedValueOnce(ok("retried-ok")); // attempt 3：成功
    const r = await chatCompletion({ messages: [{ role: "user", content: "hi" }], timeoutMs: 60_000 });
    expect(r.choices[0].message.content).toBe("retried-ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("金鑰/上限（NimServiceError）原樣拋出，不被當成慢回應重寫成逾時", async () => {
    const quota = new NimServiceError("AI 文字服務流量達上限");
    fetchMock.mockRejectedValue(quota);
    await expect(
      chatCompletion({ messages: [{ role: "user", content: "hi" }], timeoutMs: 2000 }),
    ).rejects.toBe(quota);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
