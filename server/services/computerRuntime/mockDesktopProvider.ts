/**
 * In-process mock Virtual Desktop (PR-6D).
 * No E2B/vendor SDK — provider-agnostic surface for tests and flag-gated demos.
 */
import { randomUUID } from "node:crypto";
import type {
  ComputerRuntimeProvider,
  ComputerSessionHandle,
  CreateComputerSessionInput,
  DesktopAction,
  DesktopRuntimeDriver,
  DesktopScreenshot,
  LiveViewDescriptor,
  ObservedResult,
} from "../../../shared/computerRuntime";
import { clampDesktopCoord, validateDesktopAction } from "../../../shared/computerRuntime";
import { redactSensitiveActionText } from "../../../shared/computerRuntimePolicy";

interface MockDesktop {
  id: string;
  app: string;
  width: number;
  height: number;
  /** last click for summary */
  lastPointer: { x: number; y: number } | null;
  terminated: boolean;
  screenshotCount: number;
}

const desktops = new Map<string, MockDesktop>();

/** 1×1 PNG data URL — never log full image in agent events */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function resetMockDesktopSessions(): void {
  desktops.clear();
}

const ALLOWED_APPS = new Set([
  "desktop",
  "files",
  "browser",
  "image_editor",
  "video_editor",
  "terminal_viewer", // view-only mock label — not a shell
]);

export class MockDesktopProvider implements ComputerRuntimeProvider, DesktopRuntimeDriver {
  readonly providerKey = "mock_desktop";
  readonly runtimeKind = "desktop" as const;

  async createSession(input: CreateComputerSessionInput): Promise<ComputerSessionHandle> {
    const id = `desk-${randomUUID()}`;
    const appRaw = (input.startApp ?? "desktop").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
    const app = ALLOWED_APPS.has(appRaw) ? appRaw : "desktop";
    desktops.set(id, {
      id,
      app,
      width: 1280,
      height: 720,
      lastPointer: null,
      terminated: false,
      screenshotCount: 0,
    });
    return {
      sessionId: id,
      provider: this.providerKey,
      providerSessionRef: id,
      runtimeKind: "desktop",
      status: "ready",
    };
  }

  async getSession(providerSessionRef: string) {
    const d = desktops.get(providerSessionRef);
    if (!d || d.terminated) return { status: "terminated", currentUrl: null };
    return { status: "ready", currentUrl: `desktop://${d.app}` };
  }

  async terminateSession(providerSessionRef: string): Promise<void> {
    const d = desktops.get(providerSessionRef);
    if (d) d.terminated = true;
    desktops.delete(providerSessionRef);
  }

  async getLiveView(providerSessionRef: string, mode: "watch" | "control"): Promise<LiveViewDescriptor> {
    const d = desktops.get(providerSessionRef);
    if (!d || d.terminated) throw new Error("desktop session terminated");
    return {
      sessionId: providerSessionRef,
      embedUrl: `/api/computer-runtime/live/${encodeURIComponent(providerSessionRef)}?mode=${mode}&kind=desktop`,
      mode,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async screenshot(input: { providerSessionRef: string }): Promise<DesktopScreenshot> {
    const d = desktops.get(input.providerSessionRef);
    if (!d || d.terminated) throw new Error("desktop session terminated");
    d.screenshotCount += 1;
    return {
      imageRef: TINY_PNG,
      width: d.width,
      height: d.height,
      capturedAt: new Date().toISOString(),
      summary: `Mock desktop「${d.app}」${d.width}×${d.height}`
        + (d.lastPointer ? ` · pointer≈(${d.lastPointer.x},${d.lastPointer.y})` : ""),
    };
  }

  async act(input: { providerSessionRef: string; action: DesktopAction }): Promise<ObservedResult> {
    const d = desktops.get(input.providerSessionRef);
    if (!d || d.terminated) {
      return { ok: false, summary: "desktop session ended", errorCode: "COMPUTER_SESSION_DISCONNECTED" };
    }
    const v = validateDesktopAction(input.action);
    if (!v.ok) {
      return { ok: false, summary: v.message, errorCode: "COMPUTER_ACTION_REJECTED" };
    }

    if (input.action.kind === "screenshot") {
      const shot = await this.screenshot({ providerSessionRef: input.providerSessionRef });
      return {
        ok: true,
        summary: shot.summary,
        observation: {
          url: `desktop://${d.app}`,
          title: d.app,
          summary: shot.summary,
          readyState: "complete",
        },
      };
    }

    if (input.action.kind === "click") {
      const x = clampDesktopCoord(input.action.x);
      const y = clampDesktopCoord(input.action.y);
      d.lastPointer = { x, y };
      return {
        ok: true,
        summary: `desktop click (${x},${y}) ${input.action.button ?? "left"}`,
        observation: {
          url: `desktop://${d.app}`,
          title: d.app,
          summary: `clicked at normalized (${x},${y})`,
        },
      };
    }

    if (input.action.kind === "type") {
      const red = redactSensitiveActionText(input.action.text, input.action.sensitive);
      return {
        ok: true,
        summary: input.action.sensitive
          ? "typed sensitive input (content not logged)"
          : `typed ${red.safeTarget.slice(0, 40)}`,
        observation: { url: `desktop://${d.app}`, title: d.app, summary: "text entered" },
      };
    }

    if (input.action.kind === "key") {
      return {
        ok: true,
        summary: `key ${input.action.key}`,
        observation: { url: `desktop://${d.app}`, title: d.app, summary: `key ${input.action.key}` },
      };
    }

    if (input.action.kind === "scroll") {
      return {
        ok: true,
        summary: `scroll dy=${input.action.dy} at (${clampDesktopCoord(input.action.x)},${clampDesktopCoord(input.action.y)})`,
        observation: { url: `desktop://${d.app}`, title: d.app, summary: "scrolled" },
      };
    }

    if (input.action.kind === "drag") {
      return {
        ok: true,
        summary: `drag (${input.action.x1},${input.action.y1})→(${input.action.x2},${input.action.y2})`,
        observation: { url: `desktop://${d.app}`, title: d.app, summary: "dragged" },
      };
    }

    if (input.action.kind === "wait") {
      return {
        ok: true,
        summary: `waited ${input.action.ms}ms`,
        observation: { url: `desktop://${d.app}`, title: d.app, summary: "waited" },
      };
    }

    return { ok: false, summary: "unknown desktop action", errorCode: "COMPUTER_ACTION_REJECTED" };
  }
}

export const mockDesktopProvider = new MockDesktopProvider();
