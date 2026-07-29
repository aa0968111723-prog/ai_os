/**
 * WB-06: static contract — ProjectPage is page assembly only.
 * Single AI entry is CreationWorkbench; no parallel full-page AI cards.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ProjectPage.tsx"),
  "utf8",
);

describe("ProjectPage workbench contract (WB-06)", () => {
  it("mounts CreationWorkbench and does not import parallel AI shells", () => {
    expect(src).toMatch(/from ["'].*creation-workbench\/CreationWorkbench["']/);
    expect(src).toMatch(/<CreationWorkbench\b/);

    const forbidden = [
      /from ["'][^"']*AiHub["']/,
      /from ["'][^"']*WorkflowCard["']/,
      /from ["'][^"']*PromptLibrary["']/,
      /from ["'][^"']*GenerationList["']/,
      /from ["'][^"']*ModelPicker["']/,
      /<AiHub\b/,
      /<WorkflowCard\b/,
      /<PromptLibrary\b/,
      /<GenerationList\b/,
    ];
    for (const re of forbidden) {
      expect(src, `must not match ${re}`).not.toMatch(re);
    }
  });

  it("TocNav uses shared three-stage defaults (single jump to #stage-create)", () => {
    expect(src).toMatch(/DEFAULT_ITEMS as TOC_DEFAULT_ITEMS/);
    expect(src).toMatch(/id="stage-create"/);
    expect(src).toMatch(/同一工作台切換/);
    // Mode anchors must not be extra StageHead sections on the page
    expect(src).not.toMatch(/StageHead[^]*id="sec-studio"/);
    expect(src).not.toMatch(/id="stage-assets"/);
    expect(src).not.toMatch(/id="stage-review"/);
  });
});
