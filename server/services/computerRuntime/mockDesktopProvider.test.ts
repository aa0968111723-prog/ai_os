import { beforeEach, describe, expect, it } from "vitest";
import { MockDesktopProvider, resetMockDesktopSessions } from "./mockDesktopProvider";

describe("MockDesktopProvider", () => {
  beforeEach(() => {
    resetMockDesktopSessions();
  });

  it("creates desktop session and screenshots without network", async () => {
    const p = new MockDesktopProvider();
    const h = await p.createSession({
      projectId: "p", groupId: "g", userId: "u", runtimeKind: "desktop", startApp: "files",
    });
    const shot = await p.screenshot({ providerSessionRef: h.providerSessionRef });
    expect(shot.width).toBe(1280);
    expect(shot.summary).toContain("files");
  });

  it("rejects out-of-range coordinates", async () => {
    const p = new MockDesktopProvider();
    const h = await p.createSession({
      projectId: "p", groupId: "g", userId: "u", runtimeKind: "desktop",
    });
    const bad = await p.act({
      providerSessionRef: h.providerSessionRef,
      action: { kind: "click", x: 5000, y: 10 },
    });
    expect(bad.ok).toBe(false);
  });

  it("redacts sensitive type", async () => {
    const p = new MockDesktopProvider();
    const h = await p.createSession({
      projectId: "p", groupId: "g", userId: "u", runtimeKind: "desktop",
    });
    const r = await p.act({
      providerSessionRef: h.providerSessionRef,
      action: { kind: "type", text: "s3cret", sensitive: true },
    });
    expect(r.summary.toLowerCase()).not.toContain("s3cret");
  });
});
