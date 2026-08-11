/**
 * In-process mock Browser Runtime (PR-6A foundation / tests / flag-on without Playwright).
 * Simulates navigate/inspect/act with no network and no vendor SDK.
 */
import { randomUUID } from "node:crypto";
import type {
  BrowserAction,
  BrowserObservation,
  BrowserRuntimeDriver,
  ComputerRuntimeProvider,
  ComputerSessionHandle,
  CreateComputerSessionInput,
  LiveViewDescriptor,
  ObservedResult,
} from "../../../shared/computerRuntime";
import { validateComputerNavigationUrl } from "../../../shared/computerRuntimePolicy";

interface MockSession {
  id: string;
  url: string;
  title: string;
  terminated: boolean;
}

const sessions = new Map<string, MockSession>();

export function resetMockBrowserSessions(): void {
  sessions.clear();
}

export class MockBrowserProvider implements ComputerRuntimeProvider, BrowserRuntimeDriver {
  readonly providerKey = "mock_browser";
  readonly runtimeKind = "browser" as const;

  async createSession(input: CreateComputerSessionInput): Promise<ComputerSessionHandle> {
    const id = `mock-${randomUUID()}`;
    let url = "about:blank";
    let title = "New Session";
    if (input.startUrl) {
      const check = validateComputerNavigationUrl(input.startUrl);
      if (!check.ok || !check.sanitizedUrl) {
        throw new Error(check.message ?? "unsafe start url");
      }
      url = check.sanitizedUrl;
      title = new URL(url).hostname;
    }
    sessions.set(id, { id, url, title, terminated: false });
    return {
      sessionId: id,
      provider: this.providerKey,
      providerSessionRef: id,
      runtimeKind: "browser",
      status: "ready",
    };
  }

  async getSession(providerSessionRef: string) {
    const s = sessions.get(providerSessionRef);
    if (!s || s.terminated) return { status: "terminated", currentUrl: null };
    return { status: "ready", currentUrl: s.url };
  }

  async terminateSession(providerSessionRef: string): Promise<void> {
    const s = sessions.get(providerSessionRef);
    if (s) s.terminated = true;
    sessions.delete(providerSessionRef);
  }

  async getLiveView(providerSessionRef: string, mode: "watch" | "control"): Promise<LiveViewDescriptor> {
    const s = sessions.get(providerSessionRef);
    if (!s || s.terminated) throw new Error("session terminated");
    // Embed path is brokered by AI OS — not a raw provider secret
    return {
      sessionId: providerSessionRef,
      embedUrl: `/api/computer-runtime/live/${encodeURIComponent(providerSessionRef)}?mode=${mode}`,
      mode,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async navigate(input: { providerSessionRef: string; url: string }): Promise<ObservedResult> {
    const s = sessions.get(input.providerSessionRef);
    if (!s || s.terminated) {
      return { ok: false, summary: "session ended", errorCode: "COMPUTER_SESSION_DISCONNECTED" };
    }
    const check = validateComputerNavigationUrl(input.url);
    if (!check.ok || !check.sanitizedUrl) {
      return {
        ok: false,
        summary: check.message ?? "blocked",
        errorCode: check.code ?? "COMPUTER_UNSAFE_DESTINATION",
      };
    }
    s.url = check.sanitizedUrl;
    s.title = new URL(s.url).hostname;
    return {
      ok: true,
      summary: `navigated to ${s.title}`,
      observation: this.observe(s),
    };
  }

  async inspect(input: { providerSessionRef: string }): Promise<BrowserObservation> {
    const s = sessions.get(input.providerSessionRef);
    if (!s || s.terminated) {
      return { url: "about:blank", title: "", summary: "session ended" };
    }
    return this.observe(s);
  }

  async act(input: { providerSessionRef: string; action: BrowserAction }): Promise<ObservedResult> {
    if (input.action.kind === "navigate") {
      return this.navigate({ providerSessionRef: input.providerSessionRef, url: input.action.url });
    }
    if (input.action.kind === "inspect") {
      const obs = await this.inspect({ providerSessionRef: input.providerSessionRef });
      return { ok: true, summary: obs.summary, observation: obs };
    }
    const s = sessions.get(input.providerSessionRef);
    if (!s || s.terminated) {
      return { ok: false, summary: "session ended", errorCode: "COMPUTER_SESSION_DISCONNECTED" };
    }
    if (input.action.kind === "wait") {
      return { ok: true, summary: `waited ${input.action.ms}ms`, observation: this.observe(s) };
    }
    if (input.action.kind === "type" && input.action.sensitive) {
      return {
        ok: true,
        summary: "typed sensitive input (content not logged)",
        observation: this.observe(s),
      };
    }
    // Mock DOM act success without real browser
    return {
      ok: true,
      summary: `mock ${input.action.kind}`,
      observation: this.observe(s),
    };
  }

  private observe(s: MockSession): BrowserObservation {
    return {
      url: s.url,
      title: s.title,
      summary: `Mock browser at ${s.title}`,
      readyState: "complete",
    };
  }
}

export const mockBrowserProvider = new MockBrowserProvider();
