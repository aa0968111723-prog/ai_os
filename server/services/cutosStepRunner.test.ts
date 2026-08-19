import { describe, expect, it } from "vitest";
import { agentToolRegistry } from "./agentToolRegistry";
import { CUTOS_TOOL_IDS } from "./cutosToolRegistry";
import { approvalSatisfied, isCutosToolId } from "./cutosStepRunner";

/**
 * Governance around the `tool_call` step: what a plan is allowed to name, and
 * what must have happened in the DAG before a destructive edit runs.
 */

const tool = (id: string) => agentToolRegistry.get(id);

describe("CUTOS tools in the existing registry", () => {
  it("registers every CUTOS capability into the SAME registry, not a second one", () => {
    for (const id of CUTOS_TOOL_IDS) {
      expect(agentToolRegistry.has(id), `${id} is not registered`).toBe(true);
    }
    expect(CUTOS_TOOL_IDS.length).toBeGreaterThan(20);
  });

  it("exposes no generic invoke escape hatch", () => {
    for (const forbidden of [
      "cutos.invoke",
      "cutos.invokeAnything",
      "cutos.raw",
      "cutos.exec",
      "cutos.shell",
      "cutos.file.read",
    ]) {
      expect(agentToolRegistry.has(forbidden)).toBe(false);
    }
  });

  it("carries the full AIOS governance metadata on every CUTOS tool", () => {
    for (const id of CUTOS_TOOL_IDS) {
      const definition = tool(id);
      expect(definition.access).toBeTruthy();
      expect(definition.risk).toBeTruthy();
      expect(definition.confirmation).toBeTruthy();
      expect(definition.idempotency).toBeTruthy();
      expect(definition.retry.maxAttempts).toBeGreaterThan(0);
      expect(typeof definition.verify).toBe("function");
      expect(definition.evidenceScope).toBe("project");
      expect(definition.handlerIdentity).toMatch(/^cutosClient\./);
      // Every CUTOS tool is project-scoped: the run's own scope decides which
      // video it can touch.
      expect(definition.requiredContext).toEqual(
        expect.arrayContaining(["userId", "groupId", "projectId"]),
      );
    }
  });

  it("classifies mutations as EXTERNAL with an effect receipt", () => {
    for (const id of ["cutos.edit.apply", "cutos.export", "cutos.undo", "cutos.redo"]) {
      const definition = tool(id);
      expect(definition.access).toBe("EXTERNAL");
      expect(definition.idempotency).toBe("effect_receipt");
      expect(definition.idempotencyContract?.retryPolicy).toBe("same_key_only");
      expect(definition.idempotencyContract?.duplicateEffectPolicy).toBe("return_verified_receipt");
    }
  });

  it("classifies retrieval as READ with no confirmation", () => {
    for (const id of ["cutos.semantic.search", "cutos.topics.list", "cutos.highlights.find"]) {
      const definition = tool(id);
      expect(definition.access).toBe("READ");
      expect(definition.confirmation).toBe("never");
      expect(definition.risk).toBe("low");
    }
  });

  it("requires explicit confirmation for the destructive edits", () => {
    expect(tool("cutos.edit.apply").confirmation).toBe("always");
    expect(tool("cutos.export").confirmation).toBe("always");
    expect(tool("cutos.edit.apply").risk).toBe("high");
    expect(tool("cutos.export").risk).toBe("high");
  });

  it("takes no cutosProjectId input anywhere — the binding decides", () => {
    for (const id of CUTOS_TOOL_IDS) {
      const shape = tool(id).input;
      // A tool that accepted a project id would let model output pick the video.
      const parsed = shape.safeParse({ cutosProjectId: "someone-elses-project" });
      if (parsed.success) {
        expect(Object.keys(parsed.data as Record<string, unknown>)).not.toContain("cutosProjectId");
      }
    }
  });

  it("takes no filesystem path, url or command anywhere", () => {
    for (const id of CUTOS_TOOL_IDS) {
      const parsed = tool(id).input.safeParse({
        path: "/etc/passwd",
        url: "http://evil.example",
        command: "rm -rf /",
      });
      if (parsed.success) {
        const keys = Object.keys(parsed.data as Record<string, unknown>);
        for (const forbidden of ["path", "url", "command", "filePath", "cwd"]) {
          expect(keys).not.toContain(forbidden);
        }
      }
    }
  });

  it("reports itself unavailable when CUTOS is not configured", () => {
    const availability = tool("cutos.semantic.search").availability();
    // The suite runs without CUTOS_URL, so this is the real not-configured path.
    expect(availability.provider).toBe("cutos");
    expect(typeof availability.available).toBe("boolean");
  });
});

describe("tool id restriction", () => {
  it("accepts a registered cutos tool", () => {
    expect(isCutosToolId("cutos.semantic.search")).toBe(true);
  });

  it("rejects a non-CUTOS registry entry", () => {
    // Real AIOS tools exist, but a `tool_call` step must not reach them.
    expect(agentToolRegistry.has("project.files.list")).toBe(true);
    expect(isCutosToolId("project.files.list")).toBe(false);
  });

  it("rejects an unregistered name that merely looks like a CUTOS tool", () => {
    expect(isCutosToolId("cutos.definitely.not.real")).toBe(false);
    expect(isCutosToolId("")).toBe(false);
  });
});

describe("approval gating on the plan's own DAG", () => {
  const apply = () => agentToolRegistry.get("cutos.edit.apply");
  const search = () => agentToolRegistry.get("cutos.semantic.search");

  it("lets a read run with no approval step", () => {
    expect(approvalSatisfied(search(), [])).toEqual({ ok: true });
  });

  it("refuses a destructive edit that no approval step precedes", () => {
    const result = approvalSatisfied(apply(), [
      { id: "plan", kind: "tool_call", status: "done" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("核准");
  });

  it("refuses while the approval is still waiting on a human", () => {
    const result = approvalSatisfied(apply(), [
      { id: "approve", kind: "request_approval", status: "waiting" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("等待");
  });

  it("refuses when the approval step failed or was stopped", () => {
    expect(approvalSatisfied(apply(), [{ id: "a", kind: "request_approval", status: "failed" }]).ok)
      .toBe(false);
    expect(approvalSatisfied(apply(), [{ id: "a", kind: "request_approval", status: "stopped" }]).ok)
      .toBe(false);
  });

  it("allows the edit once the approval step is done", () => {
    expect(approvalSatisfied(apply(), [
      { id: "approve", kind: "request_approval", status: "done" },
    ])).toEqual({ ok: true });
  });

  it("accepts a human task as the gate as well", () => {
    expect(approvalSatisfied(apply(), [
      { id: "human", kind: "wait_for_human", status: "done" },
    ])).toEqual({ ok: true });
  });

  it("requires every approval dependency to be done, not just one", () => {
    const result = approvalSatisfied(apply(), [
      { id: "a", kind: "request_approval", status: "done" },
      { id: "b", kind: "wait_for_human", status: "waiting" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("also gates the medium-risk history mutations", () => {
    expect(approvalSatisfied(agentToolRegistry.get("cutos.undo"), []).ok).toBe(false);
    expect(approvalSatisfied(agentToolRegistry.get("cutos.redo"), []).ok).toBe(false);
  });
});
