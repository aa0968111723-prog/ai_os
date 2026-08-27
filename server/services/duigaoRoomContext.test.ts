import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { answerDuigaoRoomContext, duigaoContextSchema, duigaoPrompt, scrubDuigaoValue, verifyDuigaoSignature } from "./duigaoRoomContext";

const secret = "duigao-test-secret-that-is-not-a-client-key";
const input = duigaoContextSchema.parse({
  query: "禪學社出現在哪？",
  context: [{ sourceId: "asset-video", assetId: "asset-video", title: "招生影片第二剪", assetType: "video", isCurrent: true, archived: false, topics: ["招生"], keywords: ["禪學社"], segments: [{ id: "seg-1", startSeconds: 42, endSeconds: 55, summary: "禪學社與活動介紹", transcript: "", topics: ["禪學社"], detectedText: "" }] }],
  sources: [{ sourceId: "asset-video", assetId: "asset-video", title: "招生影片第二剪", assetType: "video" }],
  relations: [],
});

describe("duigao room context adapter", () => {
  it("verifies the exact HMAC contract and rejects stale/missing signatures", () => {
    const body = JSON.stringify({ query: "x", context: [], sources: [], relations: [] });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(verifyDuigaoSignature(body, timestamp, `sha256=${signature}`, secret)).toBe(true);
    expect(verifyDuigaoSignature(body, timestamp, "sha256=" + "0".repeat(64), secret)).toBe(false);
    expect(verifyDuigaoSignature(body, String(Number(timestamp) - 301), `sha256=${signature}`, secret)).toBe(false);
  });

  it("does not normalize signed JSON before verification", () => {
    const body = '{"query":"x", "context":[], "sources":[], "relations":[]}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(verifyDuigaoSignature(body, timestamp, `sha256=${signature}`, secret)).toBe(true);
    expect(verifyDuigaoSignature(JSON.stringify(JSON.parse(body)), timestamp, `sha256=${signature}`, secret)).toBe(false);
  });

  it("builds a bounded data-only prompt without secret-shaped keys", () => {
    const prompt = duigaoPrompt(input);
    expect(prompt).toContain("asset-video");
    expect(prompt).toContain("42");
    expect(prompt.toLowerCase()).not.toContain("storage_path");
    expect(prompt.toLowerCase()).not.toContain("invite");
    expect(scrubDuigaoValue({ storage_path: "private/path", title: "ok" })).toEqual({ title: "ok" });
  });

  it("keeps whiteboard graph evidence in the context contract", () => {
    const whiteboard = duigaoContextSchema.parse({
      query: "整理白板",
      context: [{ sourceId: "board-1", assetId: "board-1", title: "擺攤流程", assetType: "whiteboard", isCurrent: true, archived: false, topics: ["招生"], keywords: [], structuredData: { nodes: [{ id: "node-1", content: "招生" }], edges: [] } }],
      sources: [{ sourceId: "board-1", assetId: "board-1", title: "擺攤流程" }],
      relations: [],
    });
    expect(duigaoPrompt(whiteboard)).toContain("node-1");
  });

  it("keeps only citations that exist in the supplied source registry", async () => {
    const answer = await answerDuigaoRoomContext(input, async () => ({
      provider: "nvidia-nim",
      model: "test-nim",
      text: JSON.stringify({ answer: "主要在 00:42–00:55。", citations: [{ sourceId: "asset-video", locator: { kind: "video-segment", startSeconds: 42, endSeconds: 55 } }, { sourceId: "unknown" }] }),
    }));
    expect(answer.provider).toBe("ai_os");
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0].sourceId).toBe("asset-video");
  });

  it("uses NIM mode for the integration completion", async () => {
    let mode = "";
    await answerDuigaoRoomContext(input, async (params) => {
      mode = params.mode;
      return { provider: "nvidia-nim", model: "test-nim", text: JSON.stringify({ answer: "有證據。" }) };
    });
    expect(mode).toBe("nim");
  });
});
