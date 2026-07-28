import { describe, expect, it } from "vitest";
import { readProcessRole, shouldRunHttp, shouldRunWorkers } from "./processRole";
import type { ProcessRole } from "./processRole";

describe("processRole", () => {
  it("defaults to all when unset or empty", () => {
    expect(readProcessRole({})).toBe("all");
    expect(readProcessRole({ PROCESS_ROLE: "" } as NodeJS.ProcessEnv)).toBe("all");
    expect(readProcessRole({ PROCESS_ROLE: "   " } as NodeJS.ProcessEnv)).toBe("all");
  });

  it("parses case-insensitively and trims", () => {
    expect(readProcessRole({ PROCESS_ROLE: "WEB" } as NodeJS.ProcessEnv)).toBe("web");
    expect(readProcessRole({ PROCESS_ROLE: " Worker " } as NodeJS.ProcessEnv)).toBe("worker");
    expect(readProcessRole({ PROCESS_ROLE: "All" } as NodeJS.ProcessEnv)).toBe("all");
  });

  it("unknown falls back to all", () => {
    expect(readProcessRole({ PROCESS_ROLE: "banana" } as NodeJS.ProcessEnv)).toBe("all");
    expect(readProcessRole({ PROCESS_ROLE: "web,worker" } as NodeJS.ProcessEnv)).toBe("all");
  });

  it("web/worker/all matrix: HTTP vs workers", () => {
    const matrix: Record<ProcessRole, { http: boolean; workers: boolean }> = {
      web: { http: true, workers: false },
      worker: { http: false, workers: true },
      all: { http: true, workers: true },
    };
    for (const [role, expected] of Object.entries(matrix) as [ProcessRole, { http: boolean; workers: boolean }][]) {
      expect(shouldRunHttp(role)).toBe(expected.http);
      expect(shouldRunWorkers(role)).toBe(expected.workers);
      // 單一角色不得同時兼兩者，除非 all
      if (role !== "all") {
        expect(shouldRunHttp(role) && shouldRunWorkers(role)).toBe(false);
      } else {
        expect(shouldRunHttp(role) && shouldRunWorkers(role)).toBe(true);
      }
    }
  });
});
