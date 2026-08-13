import { describe, expect, it } from "vitest";
import {
  buildModelContractRow,
  buildModelContractSnapshot,
  diffModelContractSnapshots,
  modelContractFingerprint,
  modelCapabilities,
} from "./modelContract";
import { MODELS, getModel } from "./models";

describe("modelContract", () => {
  it("fingerprints are stable for same model", () => {
    const m = MODELS[0]!;
    expect(modelContractFingerprint(m)).toBe(modelContractFingerprint(m));
  });

  it("fingerprint changes when points change", () => {
    const m = MODELS[0]!;
    const a = modelContractFingerprint(m);
    const b = modelContractFingerprint({ ...m, points: m.points + 99 });
    expect(a).not.toBe(b);
  });

  it("capabilities expose tokenizer profile for known families", () => {
    const flux = getModel("fal-ai/flux/dev");
    expect(flux).toBeTruthy();
    const cap = modelCapabilities(flux!);
    expect(cap.tokenizer).toBe("t5");
    expect(cap.tokenMeasurable).toBe(true);
    expect(cap.textEncoderLimit).toBe(512);
  });

  it("needs models get needs_source health without live", () => {
    const m = MODELS.find((x) => x.needs === "image");
    expect(m).toBeTruthy();
    const row = buildModelContractRow(m!);
    expect(row.health).toBe("needs_source");
  });

  it("openapi 404 overrides to openapi_404", () => {
    const m = MODELS.find((x) => !x.needs && !x.id.startsWith("nvidia-nim") && !x.id.startsWith("google/gemini"))!;
    const row = buildModelContractRow(m, null, { status: "http_404" });
    expect(row.health).toBe("openapi_404");
  });

  it("native Gemini stays gemini_no_key and ignores fal OpenAPI 404", () => {
    const m = getModel("google/gemini#gemini-2.5-flash-image");
    expect(m).toBeTruthy();
    const row = buildModelContractRow(m!, { status: "success" }, { status: "http_404" });
    expect(row.health).toBe("gemini_no_key");
    expect(row.healthNote).toMatch(/GEMINI_API_KEY/);
    expect(row.healthNote).not.toMatch(/AIza/);
  });

  it("live success marks live_ok", () => {
    const m = MODELS.find((x) => !x.needs && !x.id.startsWith("nvidia-nim") && !x.id.startsWith("google/gemini"))!;
    const row = buildModelContractRow(m, { status: "success" }, { status: "ok" });
    expect(row.health).toBe("live_ok");
  });

  it("snapshot covers all MODELS and diff detects fingerprint change", () => {
    const snap1 = buildModelContractSnapshot({}, {}, { generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(snap1.modelCount).toBe(MODELS.length);
    const snap2 = buildModelContractSnapshot(
      { [MODELS[0]!.id]: { status: "success" } },
      {},
      { generatedAt: "2026-01-02T00:00:00.000Z" },
    );
    const d = diffModelContractSnapshots(snap1, snap2);
    expect(d.changes.some((c) => c.kind === "health" && c.id === MODELS[0]!.id)).toBe(true);
  });
});
