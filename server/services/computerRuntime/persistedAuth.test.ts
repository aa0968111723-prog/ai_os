import { describe, expect, it, beforeEach } from "vitest";
import {
  encryptAuthContextBlob,
  decryptAuthContextBlob,
} from "./persistedAuth";
import { mockBrowserProvider, resetMockBrowserSessions } from "./mockBrowserProvider";
import { normalizeAuthServiceHost } from "../../../shared/computerRuntime";

describe("persisted auth crypto", () => {
  it("round-trips opaque blobs without exposing plaintext structure in ciphertext", () => {
    process.env.INTEGRATION_TOKEN_SECRET =
      process.env.INTEGRATION_TOKEN_SECRET ?? "test-integration-secret-key-32chars-min!!";
    const plain = JSON.stringify({
      v: 1,
      provider: "mock_browser",
      serviceHost: "example.com",
      jarId: "jar-test-1",
    });
    const enc = encryptAuthContextBlob(plain);
    expect(enc).not.toContain("example.com");
    expect(enc).not.toContain("jar-test");
    expect(enc.split(":")).toHaveLength(3);
    expect(decryptAuthContextBlob(enc)).toBe(plain);
  });
});

describe("mock browser auth export / attach", () => {
  beforeEach(() => {
    resetMockBrowserSessions();
  });

  it("exports opaque context and reuses on create", async () => {
    const created = await mockBrowserProvider.createSession({
      projectId: "p",
      groupId: "g",
      userId: "u",
      runtimeKind: "browser",
      startUrl: "https://example.com/login",
    });
    const opaque = await mockBrowserProvider.exportAuthContext({
      providerSessionRef: created.providerSessionRef,
      serviceHost: "example.com",
    });
    const parsed = JSON.parse(opaque) as { serviceHost: string; jarId: string };
    expect(parsed.serviceHost).toBe("example.com");
    expect(parsed.jarId).toMatch(/^jar-/);
    expect(mockBrowserProvider.isHostAuthed(created.providerSessionRef, "example.com")).toBe(true);

    const reused = await mockBrowserProvider.createSession({
      projectId: "p",
      groupId: "g",
      userId: "u",
      runtimeKind: "browser",
      startUrl: "https://example.com/app",
      providerAuthContext: opaque,
    });
    expect(mockBrowserProvider.isHostAuthed(reused.providerSessionRef, "example.com")).toBe(true);
    const obs = await mockBrowserProvider.inspect({ providerSessionRef: reused.providerSessionRef });
    expect(obs.summary).toMatch(/logged in/);
  });

  it("normalize host aligns with export scope", () => {
    expect(normalizeAuthServiceHost("https://app.example.com/x")).toBe("app.example.com");
  });
});
