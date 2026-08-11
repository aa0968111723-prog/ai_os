import { beforeEach, describe, expect, it } from "vitest";
import { MockBrowserProvider, resetMockBrowserSessions } from "./mockBrowserProvider";

describe("MockBrowserProvider", () => {
  beforeEach(() => {
    resetMockBrowserSessions();
  });

  it("creates session and navigates only to safe https URLs", async () => {
    const p = new MockBrowserProvider();
    const handle = await p.createSession({
      projectId: "p",
      groupId: "g",
      userId: "u",
      runtimeKind: "browser",
      startUrl: "https://example.com/a",
    });
    expect(handle.provider).toBe("mock_browser");

    const ok = await p.navigate({
      providerSessionRef: handle.providerSessionRef,
      url: "https://example.com/b",
    });
    expect(ok.ok).toBe(true);
    expect(ok.observation?.url).toContain("example.com");

    const blocked = await p.navigate({
      providerSessionRef: handle.providerSessionRef,
      url: "https://169.254.169.254/latest",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.errorCode).toBe("COMPUTER_NAVIGATION_BLOCKED");
  });

  it("does not log sensitive type content in summary", async () => {
    const p = new MockBrowserProvider();
    const handle = await p.createSession({
      projectId: "p", groupId: "g", userId: "u", runtimeKind: "browser",
    });
    const r = await p.act({
      providerSessionRef: handle.providerSessionRef,
      action: { kind: "type", selector: "#password", text: "s3cret!", sensitive: true },
    });
    expect(r.ok).toBe(true);
    expect(r.summary.toLowerCase()).not.toContain("s3cret");
  });

  it("terminates session", async () => {
    const p = new MockBrowserProvider();
    const handle = await p.createSession({
      projectId: "p", groupId: "g", userId: "u", runtimeKind: "browser",
    });
    await p.terminateSession(handle.providerSessionRef);
    const after = await p.navigate({
      providerSessionRef: handle.providerSessionRef,
      url: "https://example.com",
    });
    expect(after.ok).toBe(false);
  });
});
