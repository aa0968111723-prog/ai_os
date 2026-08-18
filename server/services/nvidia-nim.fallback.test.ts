/**
 * 高階模型降級路徑：劇本解析走旗艦模型（405B），但旗艦模型不是保證存在的
 * ——帳號沒開通、供應商下架檔位、正好塞車都會失敗。這時候整個解析失敗
 * 比「用日常主力模型解析」糟得多：使用者要的是把劇本變成分鏡，不是特定一顆模型。
 *
 * 反過來，金鑰無效／點數用完換模型也救不了，硬降級只是白燒一次呼叫並延後錯誤訊息。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("./http", () => ({ proxyFetch: fetchMock }));

process.env.NVIDIA_NIM_API_KEY = "test-key";
const { nimCompleteWithFallback, NimServiceError, NIM_DEFAULT_MODEL } = await import("./nvidia-nim");

const FLAGSHIP = "meta/llama-3.1-405b-instruct";

function ok(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { role: "assistant", content } }] }),
  } as unknown as Response;
}

function fail(status: number): Response {
  return { ok: false, status, text: async () => "boom" } as unknown as Response;
}

/** 每次呼叫用了哪顆模型（降級與否唯一可信的證據） */
function modelsUsed(): string[] {
  return fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).model);
}

describe("nimCompleteWithFallback", () => {
  beforeEach(() => fetchMock.mockReset());

  it("旗艦模型可用時就用它，不多打一次", async () => {
    fetchMock.mockResolvedValue(ok("{\"ok\":1}"));
    const r = await nimCompleteWithFallback("prompt", { model: FLAGSHIP });
    expect(r).toMatchObject({ output: "{\"ok\":1}", model: FLAGSHIP, downgraded: false });
    expect(modelsUsed()).toEqual([FLAGSHIP]);
  });

  it("旗艦模型不存在（404）→ 降級到日常主力，解析照樣完成", async () => {
    fetchMock.mockResolvedValueOnce(fail(404)).mockResolvedValue(ok("fallback-output"));
    const r = await nimCompleteWithFallback("prompt", { model: FLAGSHIP });
    expect(r).toMatchObject({ output: "fallback-output", model: NIM_DEFAULT_MODEL, downgraded: true });
    expect(modelsUsed()).toEqual([FLAGSHIP, NIM_DEFAULT_MODEL]);
  });

  it("金鑰無效／點數用完（401）不降級——換模型救不了，錯誤要直接讓管理員看到", async () => {
    fetchMock.mockResolvedValue(fail(401));
    await expect(nimCompleteWithFallback("prompt", { model: FLAGSHIP })).rejects.toBeInstanceOf(NimServiceError);
    expect(modelsUsed()).toEqual([FLAGSHIP]);
  });

  it("流量達上限（429）同樣不降級：那是帳號層級的限制，不是這顆模型的問題", async () => {
    fetchMock.mockResolvedValue(fail(429));
    await expect(nimCompleteWithFallback("prompt", { model: FLAGSHIP })).rejects.toBeInstanceOf(NimServiceError);
    expect(modelsUsed()).toEqual([FLAGSHIP]);
  });

  it("旗艦模型逾時 → 降級到日常 70B，短稿仍能解析", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: { timeoutMs?: number }) =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new DOMException("timed out", "TimeoutError")), init?.timeoutMs ?? 0);
        }),
    );
    fetchMock.mockResolvedValueOnce(ok("70b-parse"));
    const r = await nimCompleteWithFallback("prompt", { model: FLAGSHIP, timeoutMs: 1_200 });
    expect(r).toMatchObject({ output: "70b-parse", model: NIM_DEFAULT_MODEL, downgraded: true });
    expect(modelsUsed()).toEqual([FLAGSHIP, NIM_DEFAULT_MODEL]);
  });

  it("降級目標就是自己時不無限繞（同一顆失敗就是失敗）", async () => {
    fetchMock.mockResolvedValue(fail(404));
    await expect(
      nimCompleteWithFallback("prompt", { model: NIM_DEFAULT_MODEL }),
    ).rejects.toThrow(/404/);
    expect(modelsUsed()).toEqual([NIM_DEFAULT_MODEL]);
  });
});
