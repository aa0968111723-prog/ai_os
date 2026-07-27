import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createBootState } from "./boot";
import {
  createShutdownCoordinator,
  drainHttpServer,
} from "./shutdown";

describe("shutdown coordinator", () => {
  it("begins exactly once and runs each cleanup handler once", async () => {
    const errors: unknown[] = [];
    const coordinator = createShutdownCoordinator((error) => errors.push(error));
    let calls = 0;
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });

    coordinator.register(() => {
      calls += 1;
      return cleanup;
    });
    expect(coordinator.begin()).toBe(true);
    expect(coordinator.begin()).toBe(false);
    expect(calls).toBe(1);
    expect(coordinator.trackedTaskCount()).toBe(1);

    release();
    await coordinator.waitForTrackedTasks();
    expect(coordinator.trackedTaskCount()).toBe(0);
    expect(errors).toEqual([]);
  });

  it("drains tasks added while an earlier snapshot is settling", async () => {
    const coordinator = createShutdownCoordinator();
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    void coordinator.track(first);
    const waiting = coordinator.waitForTrackedTasks();

    void coordinator.track(second);
    releaseFirst();
    await Promise.resolve();
    expect(coordinator.trackedTaskCount()).toBe(1);
    releaseSecond();
    await waiting;
    expect(coordinator.trackedTaskCount()).toBe(0);
  });

  it("executes handlers registered after draining immediately", () => {
    const coordinator = createShutdownCoordinator();
    expect(coordinator.begin()).toBe(true);
    let calls = 0;
    coordinator.register(() => {
      calls += 1;
    });
    expect(calls).toBe(1);
  });
});

describe("HTTP drain", () => {
  it("stops acceptance, closes idle sockets and waits for HTTP plus background work", async () => {
    let closeCallback!: (error?: Error) => void;
    let releaseTask!: () => void;
    const task = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        closeCallback = callback;
        return server;
      }),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    };

    const draining = drainHttpServer(server, () => task, 1_000);
    expect(server.close).toHaveBeenCalledOnce();
    expect(server.closeIdleConnections).toHaveBeenCalledOnce();

    closeCallback();
    releaseTask();
    const result = await draining;
    expect(result.forced).toBe(false);
    expect(result.error).toBeUndefined();
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });

  it("force-closes HTTP connections at the absolute deadline", async () => {
    vi.useFakeTimers();
    try {
      const server = {
        close: vi.fn(() => server),
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(),
      };
      const never = () => new Promise<void>(() => {});
      const draining = drainHttpServer(server, never, 25_000);

      await vi.advanceTimersByTimeAsync(25_000);
      const result = await draining;
      expect(result).toMatchObject({ forced: true, elapsedMs: 25_000 });
      expect(server.closeAllConnections).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("boot readiness", () => {
  it("cannot become ready again after draining starts", () => {
    const state = createBootState();
    expect(state.isReady()).toBe(false);
    state.markReady();
    expect(state.isReady()).toBe(true);
    state.markDraining();
    expect(state.isReady()).toBe(false);
    state.markReady();
    expect(state.isReady()).toBe(false);
  });
});

describe("production shutdown wiring", () => {
  it("wires both signals in readiness-first order and declares the container stop signal", async () => {
    const [indexSource, dockerfile] = await Promise.all([
      readFile(new URL("../index.ts", import.meta.url), "utf8"),
      readFile(new URL("../../Dockerfile", import.meta.url), "utf8"),
    ]);
    const handler = indexSource.slice(indexSource.indexOf("const handleShutdownSignal"));
    expect(handler.indexOf("markBootDraining()")).toBeGreaterThanOrEqual(0);
    expect(handler.indexOf("beginShutdown()")).toBeGreaterThan(handler.indexOf("markBootDraining()"));
    expect(handler.indexOf("drainHttpServer(")).toBeGreaterThan(handler.indexOf("beginShutdown()"));
    expect(indexSource).toContain('process.on("SIGTERM", handleShutdownSignal)');
    expect(indexSource).toContain('process.on("SIGINT", handleShutdownSignal)');
    expect(dockerfile).toMatch(/^STOPSIGNAL SIGTERM$/m);
  });

  it("gates every durable-work runner against new pickup while draining", async () => {
    const sources = await Promise.all(
      ["workflowRunner.ts", "generationRunner.ts", "agentRunner.ts", "exportRunner.ts"].map((name) =>
        readFile(new URL(name, import.meta.url), "utf8"),
      ),
    );
    for (const source of sources) {
      expect(source).toContain("isShuttingDown");
      expect(source).toContain("onShutdown");
      expect(source).toContain("trackBackgroundTask");
      expect(source).toMatch(/if \(started \|\| isShuttingDown\(\)\) return;/);
    }
  });
});
