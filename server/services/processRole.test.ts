import { describe, expect, it } from "vitest";
import { readProcessRole, shouldRunHttp, shouldRunWorkers } from "./processRole";

describe("processRole", () => {
  it("parses case-insensitively", () => {
    expect(readProcessRole({ PROCESS_ROLE: "WEB" } as NodeJS.ProcessEnv)).toBe("web");
    expect(readProcessRole({ PROCESS_ROLE: " Worker " } as NodeJS.ProcessEnv)).toBe("worker");
  });

  it("single-value roles are mutually exclusive for HTTP vs workers", () => {
    expect(shouldRunHttp("web") && shouldRunWorkers("web")).toBe(false);
    expect(shouldRunHttp("worker") && shouldRunWorkers("worker")).toBe(false);
    expect(shouldRunHttp("all") && shouldRunWorkers("all")).toBe(true);
  });
});
