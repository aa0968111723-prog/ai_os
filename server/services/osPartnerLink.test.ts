import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadOsPartnerSnapshot,
  osPartnerHandshake,
  osPartnerReadyNote,
  readSentinelReportFile,
} from "./osPartnerLink";

describe("readSentinelReportFile", () => {
  it("缺檔或壞 JSON 回 null，不假裝通過", async () => {
    expect(await readSentinelReportFile("/tmp/aios-sentinel-missing-report.json")).toBeNull();
    const dir = await mkdtemp(path.join(tmpdir(), "aios-sentinel-"));
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, "{not-json", "utf8");
    expect(await readSentinelReportFile(bad)).toBeNull();
  });

  it("讀得到完整報告才抽出摘要", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aios-sentinel-"));
    const file = path.join(dir, "report.json");
    await writeFile(
      file,
      JSON.stringify({
        target: "https://example.test/aios",
        surfaces: ["web", "desktop"],
        summary: { completed: 4, skipped: 0, errored: 0, worst: "low", findings: { low: 1 } },
      }),
      "utf8",
    );
    expect(await readSentinelReportFile(file)).toMatchObject({
      target: "https://example.test/aios",
      worst: "low",
      findings: { low: 1 },
    });
  });
});

describe("loadOsPartnerSnapshot", () => {
  it("握手不洩本機路徑與目標網址", async () => {
    const handshake = await osPartnerHandshake({
      AIOS_B_REPO: "/var/secret/Aios_b",
      AIOS_DEEPIN_TARGET: "https://secret.deepin.local",
    });
    const blob = JSON.stringify(handshake);
    expect(blob).not.toContain("/var/secret");
    expect(blob).not.toContain("secret.deepin.local");
    expect(handshake.sister.linked).toBe(true);
  });

  it("觀察欄預設不擋就緒", async () => {
    const note = await osPartnerReadyNote({});
    expect(note.ok).toBe(true);
    expect(note.note).toContain("未設定");
  });

  it("報告檔掛上後進 snapshot.report", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aios-sentinel-"));
    const file = path.join(dir, "report.json");
    await writeFile(
      file,
      JSON.stringify({
        target: "https://example.test",
        surfaces: ["web"],
        summary: { completed: 1, skipped: 0, errored: 0, worst: null, findings: {} },
      }),
      "utf8",
    );
    const snap = await loadOsPartnerSnapshot({
      AIOS_SENTINEL_REPORT: file,
      AIOS_CUTOS_TARGET: "https://cutos.example",
    });
    expect(snap.aiosB.reportConfigured).toBe(true);
    expect(snap.report?.target).toBe("https://example.test");
    expect(snap.partners.find((p) => p.id === "cutos")?.state).toBe("linked");
  });
});
