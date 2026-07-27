export type ShutdownHandler = () => void | Promise<void>;

export interface ShutdownCoordinator {
  begin(): boolean;
  isShuttingDown(): boolean;
  register(handler: ShutdownHandler): () => void;
  track<T>(task: Promise<T>): Promise<T>;
  waitForTrackedTasks(): Promise<void>;
  trackedTaskCount(): number;
}

/**
 * Process-independent shutdown state. Keeping the coordinator constructible
 * makes the lifecycle semantics testable without sending signals to Vitest.
 */
export function createShutdownCoordinator(
  onHandlerError: (error: unknown) => void = (error) => {
    console.error("[shutdown] cleanup handler failed:", error instanceof Error ? error.message : error);
  },
): ShutdownCoordinator {
  let draining = false;
  const handlers = new Set<ShutdownHandler>();
  const tasks = new Set<Promise<unknown>>();

  const track = <T>(task: Promise<T>): Promise<T> => {
    let tracked!: Promise<T>;
    tracked = Promise.resolve(task).finally(() => {
      tasks.delete(tracked);
    });
    tasks.add(tracked);
    return tracked;
  };

  const runHandler = (handler: ShutdownHandler): void => {
    try {
      const result = handler();
      if (result && typeof result.then === "function") {
        void track(Promise.resolve(result).catch(onHandlerError));
      }
    } catch (error) {
      onHandlerError(error);
    }
  };

  return {
    begin(): boolean {
      if (draining) return false;
      draining = true;
      const snapshot = [...handlers];
      handlers.clear();
      for (const handler of snapshot) runHandler(handler);
      return true;
    },

    isShuttingDown(): boolean {
      return draining;
    },

    register(handler: ShutdownHandler): () => void {
      if (draining) {
        runHandler(handler);
        return () => {};
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    track,

    async waitForTrackedTasks(): Promise<void> {
      // A shutdown handler may enqueue another tracked cleanup while an earlier
      // snapshot is settling, so drain until the set is genuinely empty.
      while (tasks.size > 0) {
        await Promise.allSettled([...tasks]);
      }
    },

    trackedTaskCount(): number {
      return tasks.size;
    },
  };
}

const processCoordinator = createShutdownCoordinator();

export function beginShutdown(): boolean {
  return processCoordinator.begin();
}

export function isShuttingDown(): boolean {
  return processCoordinator.isShuttingDown();
}

export function onShutdown(handler: ShutdownHandler): () => void {
  return processCoordinator.register(handler);
}

export function trackBackgroundTask<T>(task: Promise<T>): Promise<T> {
  return processCoordinator.track(task);
}

export function waitForBackgroundTasks(): Promise<void> {
  return processCoordinator.waitForTrackedTasks();
}

export function backgroundTaskCount(): number {
  return processCoordinator.trackedTaskCount();
}

export interface DrainResult {
  forced: boolean;
  elapsedMs: number;
  error?: Error;
}

interface DrainableServer {
  close(callback: (error?: Error) => void): unknown;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
}

/**
 * Stop accepting HTTP connections and wait for both HTTP work and registered
 * background work. The deadline is an absolute bound; callers should exit the
 * process after a forced result because an arbitrary side effect may still be
 * stuck in a third-party client.
 */
export async function drainHttpServer(
  server: DrainableServer,
  waitForTasks: () => Promise<void> = waitForBackgroundTasks,
  deadlineMs = 25_000,
): Promise<DrainResult> {
  const startedAt = Date.now();
  let closeError: Error | undefined;

  const serverClosed = new Promise<void>((resolve) => {
    try {
      server.close((error) => {
        closeError = error;
        resolve();
      });
      // Node 22 normally closes idle keep-alive sockets as part of close(), but
      // invoke this explicitly for clarity and compatibility with older hosts.
      server.closeIdleConnections?.();
    } catch (error) {
      closeError = error instanceof Error ? error : new Error(String(error));
      resolve();
    }
  });

  let deadlineTimer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"forced">((resolve) => {
    deadlineTimer = setTimeout(() => resolve("forced"), Math.max(1, deadlineMs));
  });
  const graceful = Promise.all([serverClosed, waitForTasks()]).then(() => "drained" as const);
  const outcome = await Promise.race([graceful, deadline]);

  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (outcome === "forced") {
    try {
      server.closeAllConnections?.();
    } catch (error) {
      closeError ??= error instanceof Error ? error : new Error(String(error));
    }
  }

  return {
    forced: outcome === "forced",
    elapsedMs: Date.now() - startedAt,
    ...(closeError ? { error: closeError } : {}),
  };
}
