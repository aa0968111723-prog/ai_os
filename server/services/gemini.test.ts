/**
 * Gemini native provider contracts.
 * Never reads or writes a real production key. Live calls are out of scope here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
const saveBufferMock = vi.hoisted(() => vi.fn());

vi.mock("./http", () => ({ proxyFetch: fetchMock }));
vi.mock("./storage", async () => {
  const actual = await vi.importActual<typeof import("./storage")>("./storage");
  return { ...actual, saveBuffer: saveBufferMock };
});

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GeminiUnavailableError,
  geminiApiKeyConfigured,
  geminiStatus,
  geminiSubmit,
  isGeminiModelId,
  extractGeminiRemoteMediaUrl,
  geminiOperationPath,
  parseStoredGeminiUrl,
  redactGeminiSecrets,
} from "./gemini";

const FAKE_KEY = "test-gemini-key-not-real";

describe("secret leakage guards", () => {
  it("client source never mentions GEMINI_API_KEY", () => {
    const clientDir = fileURLToPath(new URL("../../client", import.meta.url));
    expect(existsSync(clientDir)).toBe(true);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
          if (name === "node_modules" || name === "dist") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|js|mjs|css|html)$/.test(name)) continue;
        if (readFileSync(full, "utf8").includes("GEMINI_API_KEY")) hits.push(full);
      }
    };
    walk(clientDir);
    expect(hits).toEqual([]);
  });
});

describe("geminiApiKeyConfigured", () => {
  it("is true only when GEMINI_API_KEY is a non-empty string", () => {
    expect(geminiApiKeyConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(geminiApiKeyConfigured({ GEMINI_API_KEY: "   " } as NodeJS.ProcessEnv)).toBe(false);
    expect(geminiApiKeyConfigured({ GEMINI_API_KEY: FAKE_KEY } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("redactGeminiSecrets", () => {
  it("strips headers, query keys, env assignments, and AIza tokens", () => {
    const raw = [
      "x-goog-api-key: AIzaSyDummyTokenValue0000000000000",
      "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=AIzaSyDummyTokenValue0000000000000",
      "GEMINI_API_KEY=AIzaSyDummyTokenValue0000000000000",
      "plain AIzaSyDummyTokenValue0000000000000 leftover",
    ].join("\n");
    const redacted = redactGeminiSecrets(raw);
    expect(redacted).not.toMatch(/AIza/);
    expect(redacted).not.toContain(FAKE_KEY);
    expect(redacted).toContain("x-goog-api-key=[redacted]");
    expect(redacted).toContain("key=[redacted]");
    expect(redacted).toContain("GEMINI_API_KEY=[redacted]");
  });
});

describe("extractGeminiRemoteMediaUrl", () => {
  it("finds Veo generatedSamples video.uri", () => {
    expect(extractGeminiRemoteMediaUrl({
      done: true,
      response: {
        generateVideoResponse: {
          generatedSamples: [{ video: { uri: "https://example.com/clip.mp4", mimeType: "video/mp4" } }],
        },
      },
    })).toEqual({ url: "https://example.com/clip.mp4", mime: "video/mp4" });
  });
});

describe("geminiOperationPath", () => {
  it("keeps models/.../operations/... instead of nesting under /operations", () => {
    expect(geminiOperationPath("models/veo-3.1-fast-generate-preview/operations/abc")).toBe(
      "/v1beta/models/veo-3.1-fast-generate-preview/operations/abc",
    );
    expect(geminiOperationPath("operations/abc")).toBe("/v1beta/operations/abc");
    expect(geminiOperationPath("v1beta/operations/abc")).toBe("/v1beta/operations/abc");
  });
});

describe("parseStoredGeminiUrl / isGeminiModelId", () => {
  it("parses stored handles and rejects others", () => {
    expect(parseStoredGeminiUrl("stored:2026/08/abc.png|image/png|128")).toEqual({
      storagePath: "2026/08/abc.png",
      mime: "image/png",
      sizeBytes: 128,
    });
    expect(parseStoredGeminiUrl("https://cdn.example/x.png")).toBeNull();
  });

  it("recognises native Gemini catalog ids", () => {
    expect(isGeminiModelId("google/gemini#gemini-2.5-flash-image")).toBe(true);
    expect(isGeminiModelId("google/gemini#gemini-omni-flash")).toBe(true);
    expect(isGeminiModelId("gemini-2.5-flash-image")).toBe(true);
    expect(isGeminiModelId("fal-ai/nano-banana-2")).toBe(false);
    expect(isGeminiModelId("nvidia-nim#llama-3.1-70b")).toBe(false);
  });
});

describe("geminiSubmit / geminiStatus without a live key", () => {
  const prev = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  });

  it("throws BLOCKED_BY_EXTERNAL_DEPENDENCY when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(geminiSubmit("image", { prompt: "一盞燈" })).rejects.toMatchObject({
      name: "GeminiUnavailableError",
      code: "BLOCKED_BY_EXTERNAL_DEPENDENCY",
    });
    expect(GeminiUnavailableError).toBeTruthy();
  });

  it("unknown request ids fail closed without leaking secrets", () => {
    const result = geminiStatus("gemini_missing");
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toMatch(/AIza|GEMINI_API_KEY=/);
  });
});

describe("geminiSubmit mocked generateContent", () => {
  const prev = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = FAKE_KEY;
    fetchMock.mockReset();
    saveBufferMock.mockReset();
    saveBufferMock.mockResolvedValue({ storagePath: "2026/08/gemini-test.png", sizeBytes: 48 });
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  });

  it("sends the key as x-goog-api-key header only, persists via saveBuffer, never returns the key", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: "image/png",
                data: Buffer.from("fake-png-bytes-xxxxxxxxxxxxxxxxxxxx").toString("base64"),
              },
            }],
          },
        }],
      }),
    });

    const { requestId } = await geminiSubmit("image", { prompt: "極簡水彩燈" });
    expect(requestId.startsWith("gemini_")).toBe(true);

    const deadline = Date.now() + 2_000;
    let status = geminiStatus(requestId);
    while (status.status === "running" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      status = geminiStatus(requestId);
    }
    expect(status.status).toBe("done");
    if (status.status !== "done") throw new Error("expected done");
    expect(status.resultUrl).toBe("stored:2026/08/gemini-test.png|image/png|48");
    expect(JSON.stringify(status)).not.toContain(FAKE_KEY);

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers?: Record<string, string> }];
    expect(url).toContain("/v1beta/models/");
    expect(url).not.toMatch(/[?&]key=/);
    expect(url).not.toContain(FAKE_KEY);
    expect(init.headers?.["x-goog-api-key"]).toBe(FAKE_KEY);
    expect(saveBufferMock).toHaveBeenCalledTimes(1);
  });

  it("redacts provider error bodies before they become job errors", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => `API key AIzaSyDummyTokenValue0000000000000 rejected`,
    });
    const { requestId } = await geminiSubmit("image", { prompt: "燈" });
    const deadline = Date.now() + 2_000;
    let status = geminiStatus(requestId);
    while (status.status === "running" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      status = geminiStatus(requestId);
    }
    expect(status.status).toBe("failed");
    if (status.status !== "failed") throw new Error("expected failed");
    expect(status.error).not.toMatch(/AIza/);
    expect(status.error).not.toContain(FAKE_KEY);
  });
});
