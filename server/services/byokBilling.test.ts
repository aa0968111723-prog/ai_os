/**
 * BYOK Phase 2：resolveByokFalKey / byokFalOpts 契約。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GENERATION_SOURCE_META_KEY } from "../../shared/generationSourceMeta";
import type { ModelEntry } from "../../shared/models";

const getDecryptedKey = vi.fn();
vi.mock("./userAiKeys", () => ({
  getDecryptedKey: (...args: unknown[]) => getDecryptedKey(...args),
}));

import { byokFalOpts, resolveByokFalKey } from "./byokBilling";

const falModel = {
  id: "fal-ai/flux/schnell",
  label: "Flux",
  kind: "image",
  category: "text-to-image",
} as ModelEntry;

const nimModel = {
  id: "nvidia-nim#llama-3.1-70b",
  endpoint: "nvidia-nim",
  label: "Llama",
  kind: "text",
  category: "llm",
} as ModelEntry;

describe("resolveByokFalKey", () => {
  beforeEach(() => {
    getDecryptedKey.mockReset();
  });

  it("NIM never uses personal fal key", async () => {
    getDecryptedKey.mockResolvedValue("sk-user");
    const r = await resolveByokFalKey("u1", nimModel);
    expect(r).toEqual({ userFalKey: null, usedUserKey: false });
    expect(getDecryptedKey).not.toHaveBeenCalled();
  });

  it("no personal key → platform path", async () => {
    getDecryptedKey.mockResolvedValue(null);
    const r = await resolveByokFalKey("u1", falModel);
    expect(r).toEqual({ userFalKey: null, usedUserKey: false });
  });

  it("active personal key → usedUserKey on new submit", async () => {
    getDecryptedKey.mockResolvedValue("sk-user");
    const r = await resolveByokFalKey("u1", falModel);
    expect(r).toEqual({ userFalKey: "sk-user", usedUserKey: true });
  });

  it("in-flight job with meta.usedUserKey keeps flag even if key removed", async () => {
    getDecryptedKey.mockResolvedValue(null);
    const params = {
      prompt: "x",
      [GENERATION_SOURCE_META_KEY]: { usedUserKey: true },
    };
    const r = await resolveByokFalKey("u1", falModel, params);
    expect(r).toEqual({ userFalKey: null, usedUserKey: true });
  });
});

describe("byokFalOpts", () => {
  it("only returns apiKey when both used and key present", () => {
    expect(byokFalOpts(null, true)).toBeUndefined();
    expect(byokFalOpts("sk", false)).toBeUndefined();
    expect(byokFalOpts("sk", true)).toEqual({ apiKey: "sk" });
  });
});
