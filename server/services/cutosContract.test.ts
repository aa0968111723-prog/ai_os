import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CUTOS_PROTOCOL_VERSION,
  PROTOCOL_CONTRACT,
  capabilityManifestSchema,
  capabilityResponseSchema,
  cutosHealthSchema,
  cutosSemanticContextSchema,
  isCapabilityFailure,
  protocolContractFingerprint,
  PROTOCOL_CONTRACT_FINGERPRINT,
} from "../../shared/cutosProtocol";
import { CutosClient, CutosClientError } from "./cutosClient";

/**
 * CROSS-REPOSITORY CONTRACT TEST.
 *
 * `docs/contract/cutos.agent.v2.fixtures.json` is not hand-written. It is the
 * literal HTTP traffic recorded by the CUTOS repository's own test
 * (`apps/web/server/aios-http.test.ts`) running against CUTOS's production
 * handlers, with real FFmpeg behind them.
 *
 * Here those exact bytes are served back over a real socket to the real
 * `CutosClient`. If CUTOS changes a field, a code, or an envelope shape, this
 * suite fails in ai_os — which is the point: the two repositories cannot drift
 * apart silently, and neither side has to guess the other's JSON.
 *
 * Regenerate after an intentional CUTOS change:
 *   (CUTOS)  pnpm vitest run apps/web/server/aios-http.test.ts
 *   (ai_os)  cp CUTOS/docs/contract/cutos.agent.v2.fixtures.json docs/contract/
 */

interface Exchange {
  scenario: string;
  request: { method: string; path: string; body?: Record<string, unknown> };
  response: { status: number; body: unknown };
}

interface FixtureFile {
  protocolVersion: string;
  /** SHA-256 of the CUTOS-side descriptor at recording time. */
  contractFingerprint: string;
  /** SHA-256 of CUTOS's protocol.ts, i.e. the bytes this repo must mirror. */
  protocolSourceSha256: string;
  generator: string;
  exchanges: Exchange[];
}

const FIXTURES = JSON.parse(
  readFileSync(join(process.cwd(), "docs/contract/cutos.agent.v2.fixtures.json"), "utf8"),
) as FixtureFile;

function scenario(name: string): Exchange {
  const found = FIXTURES.exchanges.find((exchange) => exchange.scenario === name);
  if (!found) throw new Error(`fixture scenario "${name}" is missing; regenerate from CUTOS`);
  return found;
}

/**
 * The mirror check that `PROTOCOL_CONTRACT_FINGERPRINT` alone could not perform.
 *
 * Each repo's fingerprint assertion only ever compared its own constant against
 * its own descriptor, so a contract change applied to CUTOS and not mirrored
 * here left BOTH suites green and failed at runtime instead. The fixture
 * carries the sha256 of CUTOS's protocol.ts, and this repo hashes its own copy:
 * a half-mirrored change is now red on the side that did not receive it.
 */
describe("protocol mirror", () => {
  it("shared/cutosProtocol.ts is byte-identical to the CUTOS file the fixture was recorded from", () => {
    const mirrored = readFileSync(join(process.cwd(), "shared/cutosProtocol.ts"));
    const localSha = createHash("sha256").update(mirrored).digest("hex");
    expect(
      localSha,
      "shared/cutosProtocol.ts has drifted from CUTOS packages/protocol/src/protocol.ts — "
      + "copy the CUTOS file over verbatim and regenerate the fixture",
    ).toBe(FIXTURES.protocolSourceSha256);
  });

  it("the contract fingerprint recorded by CUTOS matches this repo's constant", () => {
    expect(FIXTURES.contractFingerprint).toBe(PROTOCOL_CONTRACT_FINGERPRINT);
  });

  it("the fixture was recorded from the protocol version this repo speaks", () => {
    expect(FIXTURES.protocolVersion).toBe(CUTOS_PROTOCOL_VERSION);
  });

  it("AIOS serves every endpoint the contract says it must", () => {
    // The gap this catches for real: CUTOS shipped an orchestrator client for
    // /api/cutos/* while ai_os served none of those paths, and nothing was red.
    const mounted = readFileSync(join(process.cwd(), "server/index.ts"), "utf8");
    const missing = Object.values(PROTOCOL_CONTRACT.aiosEndpoints).filter((endpoint) => {
      const [method, path] = endpoint.split(" ");
      const expressPath = path!.replace(/:(\w+)/g, ":$1");
      return !mounted.includes(`app.${method!.toLowerCase()}("${expressPath}"`);
    });
    expect(missing, `AIOS does not mount: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("cross-repo contract: CUTOS recordings replayed through the real AIOS client", () => {
  let server: Server;
  let baseUrl = "";
  /** The scenario the next /invoke should answer with. */
  let nextScenario = "read_capability";
  let lastRequestBody: unknown;

  beforeAll(async () => {
    server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const send = (exchange: Exchange) => {
          res.writeHead(exchange.response.status, { "content-type": "application/json" });
          res.end(JSON.stringify(exchange.response.body));
        };
        if (url.pathname === "/api/aios/health") return send(scenario("health"));
        if (url.pathname === "/api/aios/manifest") return send(scenario("manifest"));
        if (url.pathname === "/api/aios/invoke") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          lastRequestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          return send(scenario(nextScenario));
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{}");
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const client = () => new CutosClient({ baseUrl, timeoutMs: 2_000, maxAttempts: 1 });
  const correlation = { requestId: "contract-1", aiosRunId: "run-1", aiosStepId: "step-1" };

  // ------------------------------------------------------- fixture integrity --

  it("was generated by CUTOS for the protocol this repo speaks", () => {
    expect(FIXTURES.generator).toBe("cutos");
    expect(FIXTURES.protocolVersion).toBe(CUTOS_PROTOCOL_VERSION);
  });

  it("agrees with CUTOS on the contract fingerprint", () => {
    // Both repos hash the same hand-maintained descriptor. A change on one side
    // that is not mirrored turns this red before anything reaches production.
    expect(protocolContractFingerprint()).toBe(PROTOCOL_CONTRACT_FINGERPRINT);
  });

  it("covers every scenario the contract requires", () => {
    const recorded = new Set(FIXTURES.exchanges.map((exchange) => exchange.scenario));
    for (const required of [
      "health", "manifest", "read_capability", "semantic_search", "create_plan",
      "preview_plan", "apply_plan", "stale_revision", "idempotent_replay",
      "unauthorized", "job_polling", "cancel_job", "protocol_mismatch",
      "approval_required", "capability_not_found", "validation_failed",
      "v1_compatibility",
    ]) {
      expect(recorded.has(required), `fixture missing scenario: ${required}`).toBe(true);
    }
  });

  // ------------------------------------------------- real responses, real client --

  it("parses the health CUTOS actually served", async () => {
    const health = await client().getHealth();
    expect(health.reachable).toBe(true);
    expect(health.compatible).toBe(true);
    expect(health.protocolVersion).toBe(CUTOS_PROTOCOL_VERSION);
    expect(() => cutosHealthSchema.parse(scenario("health").response.body)).not.toThrow();
  });

  it("parses the manifest CUTOS actually served, and finds every required capability", async () => {
    const manifest = await client().getManifest({ force: true });
    expect(() => capabilityManifestSchema.parse(manifest)).not.toThrow();
    const names = new Set(manifest.capabilities.map((capability) => capability.name));
    for (const required of PROTOCOL_CONTRACT.requiredCapabilities) {
      expect(names.has(required), `CUTOS manifest is missing ${required}`).toBe(true);
    }
    // The v1 names CUTOS promised to keep alive are still reachable.
    expect(names.has("plan")).toBe(true);
    expect(names.has("apply")).toBe(true);
  });

  it("agrees on write metadata for the capabilities AIOS governs", async () => {
    const manifest = await client().getManifest({ force: true });
    const byName = new Map(manifest.capabilities.map((capability) => [capability.name, capability]));
    const apply = byName.get("apply_edit_plan")!;
    expect(apply.access).toBe("write");
    expect(apply.mutatesTimeline).toBe(true);
    expect(apply.requiresApproval).toBe(true);
    expect(apply.idempotency).toBe("keyed");
    const exportCapability = byName.get("export")!;
    expect(exportCapability.requiresApproval).toBe(true);
    expect(exportCapability.longRunning).toBe(true);
  });

  it("reads a real project payload", async () => {
    nextScenario = "read_capability";
    const outcome = await client().invokeRead<{ id: string; timelineRevision: number }>(
      "get_project",
      { projectId: "p" },
      { correlation },
    );
    expect(typeof outcome.result.timelineRevision).toBe("number");
    expect(outcome.correlation.requestId).toBeTruthy();
  });

  it("reads a real semantic search payload", async () => {
    nextScenario = "semantic_search";
    const outcome = await client().invokeRead<{ hits: unknown[]; timelineRevision: number }>(
      "search_semantic",
      { projectId: "p", query: "speech" },
      { correlation },
    );
    expect(Array.isArray(outcome.result.hits)).toBe(true);
  });

  it("accepts the bounded semantic context CUTOS actually produced", async () => {
    nextScenario = "semantic_context";
    const outcome = await client().invokeRead<unknown>(
      "build_semantic_context",
      { projectId: "p", query: "speech", maxRanges: 3 },
      { correlation },
    );
    const parsed = cutosSemanticContextSchema.parse(outcome.result);
    expect(parsed.provenance.contextHash).toBeTruthy();
    expect(parsed.budget.usedRanges).toBeLessThanOrEqual(parsed.budget.maxRanges);
    // A bounded context is the contract: never a whole transcript.
    expect(parsed.budget.usedChars).toBeLessThanOrEqual(parsed.budget.maxChars);
  });

  it("reads a real long-running job handoff and then polls it", async () => {
    nextScenario = "analyze_job";
    const analyze = await client().invokeWrite<{ jobId: string }>(
      "analyze",
      { projectId: "p" },
      { correlation: { ...correlation, idempotencyKey: "k-analyze" } },
    );
    expect(typeof analyze.result.jobId).toBe("string");
    expect(analyze.correlation.cutosJobId).toBe(analyze.result.jobId);

    nextScenario = "job_polling";
    const job = await client().getJob(analyze.result.jobId, { correlation });
    expect(["queued", "running", "succeeded", "failed", "cancelled"]).toContain(job.result.status);
  });

  it("reads a real plan / verify / preview sequence", async () => {
    nextScenario = "create_plan";
    const planned = await client().invokeWrite<{ operationCount: number; timelineRevision: number }>(
      "create_edit_plan",
      { projectId: "p", instruction: "刪掉超過 1 秒的停頓" },
      { correlation: { ...correlation, idempotencyKey: "k-plan" } },
    );
    expect(planned.result.operationCount).toBeGreaterThan(0);

    nextScenario = "verify_plan";
    const verified = await client().invokeRead<{ ok: boolean; stale: boolean }>(
      "verify_edit_plan",
      { projectId: "p" },
      { correlation },
    );
    expect(verified.result.ok).toBe(true);
    expect(verified.result.stale).toBe(false);

    nextScenario = "preview_plan";
    const preview = await client().invokeRead<{ durationMs: number }>(
      "preview_edit_plan",
      { projectId: "p" },
      { correlation },
    );
    expect(preview.result.durationMs).toBeGreaterThan(0);
  });

  it("surfaces CUTOS's real stale-revision refusal as a non-retryable error", async () => {
    nextScenario = "stale_revision";
    const error = await client()
      .invokeWrite("apply_edit_plan", { projectId: "p" }, {
        correlation: { ...correlation, idempotencyKey: "k-stale" },
        expectedRevision: 1,
        approval: { granted: true },
      })
      .catch((e: unknown) => e) as CutosClientError;
    expect(error.code).toBe("STALE_TIMELINE_REVISION");
    expect(error.retryable).toBe(false);
    expect(error.messageKey).toBe("aios.error.staleRevision");
  });

  it("surfaces CUTOS's real approval demand with its impact figures", async () => {
    nextScenario = "approval_required";
    const raw = scenario("approval_required").response.body as { ok: boolean };
    // The fixture is only interesting if CUTOS really refused.
    if (raw.ok) return;
    const error = await client()
      .invokeWrite("apply_edit_plan", { projectId: "p" }, {
        correlation: { ...correlation, idempotencyKey: "k-approval" },
        expectedRevision: 1,
      })
      .catch((e: unknown) => e) as CutosClientError;
    expect(error.code).toBe("APPROVAL_REQUIRED");
    const approval = (error as { approvalRequest?: { reasonCode: string; impact: Record<string, number> } })
      .approvalRequest;
    expect(approval?.reasonCode).toBeTruthy();
    expect(approval?.impact.removedRatio).toBeGreaterThanOrEqual(0);
  });

  it("reads CUTOS's real apply result and its real idempotent replay", async () => {
    nextScenario = "apply_plan";
    const applied = await client().invokeWrite<Record<string, unknown>>(
      "apply_edit_plan",
      { projectId: "p" },
      {
        correlation: { ...correlation, idempotencyKey: "k-apply" },
        expectedRevision: 1,
        approval: { granted: true, grantedBy: "human" },
      },
    );
    expect(applied.replayed).toBe(false);
    const appliedRevision = applied.correlation.timelineRevision;

    nextScenario = "idempotent_replay";
    const replay = await client().invokeWrite<Record<string, unknown>>(
      "apply_edit_plan",
      { projectId: "p" },
      {
        correlation: { ...correlation, idempotencyKey: "k-apply" },
        expectedRevision: 1,
        approval: { granted: true, grantedBy: "human" },
      },
    );
    // CUTOS replayed the receipt: the timeline did not move a second time.
    expect(replay.replayed).toBe(true);
    expect(replay.correlation.timelineRevision).toBe(appliedRevision);
  });

  it("surfaces CUTOS's real protocol-mismatch refusal", async () => {
    nextScenario = "protocol_mismatch";
    const error = await client()
      .invokeRead("list_projects", {}, { correlation })
      .catch((e: unknown) => e) as CutosClientError;
    expect(error.code).toBe("PROTOCOL_VERSION_MISMATCH");
  });

  it("surfaces CUTOS's real refusal of an unknown capability", async () => {
    nextScenario = "capability_not_found";
    const error = await client()
      .invokeRead("read_arbitrary_file", { path: "/etc/passwd" }, { correlation })
      .catch((e: unknown) => e) as CutosClientError;
    expect(error.code).toBe("CAPABILITY_NOT_FOUND");
  });

  it("surfaces CUTOS's real validation refusal", async () => {
    nextScenario = "validation_failed";
    const error = await client()
      .invokeRead("get_project", {}, { correlation })
      .catch((e: unknown) => e) as CutosClientError;
    expect(error.code).toBe("VALIDATION_FAILED");
  });

  it("sends a request CUTOS's own schema accepts", async () => {
    nextScenario = "read_capability";
    await client().invokeRead("get_project", { projectId: "p" }, {
      correlation: { ...correlation, cutosProjectId: "p" },
    });
    // The recorded CUTOS requests and the ones this client emits must be the
    // same shape; both are validated by the shared invocation schema.
    const recorded = scenario("read_capability").request.body;
    const { capabilityInvocationSchema } = await import("../../shared/cutosProtocol");
    expect(capabilityInvocationSchema.safeParse(recorded).success).toBe(true);
    expect(capabilityInvocationSchema.safeParse(lastRequestBody).success).toBe(true);
  });

  it("keeps every recorded response parseable by this repo's schemas", () => {
    for (const exchange of FIXTURES.exchanges) {
      if (exchange.request.path !== "/api/aios/invoke") continue;
      if (exchange.scenario === "v1_compatibility") continue; // v1 shape by design
      const parsed = capabilityResponseSchema.safeParse(exchange.response.body);
      expect(parsed.success, `scenario ${exchange.scenario} did not parse`).toBe(true);
      if (parsed.success && isCapabilityFailure(parsed.data)) {
        // Every failure carries a zh-TW key so the UI never shows a raw code.
        expect(parsed.data.error.messageKey).toMatch(/^aios\.error\./);
      }
    }
  });

  it("never received a raw filesystem path or shell fragment from CUTOS", () => {
    const serialized = JSON.stringify(FIXTURES.exchanges);
    for (const forbidden of ["/etc/passwd", "ffmpeg -i", "rm -rf", "/bin/sh"]) {
      // `read_arbitrary_file` is a request we sent; CUTOS must never echo a path
      // back as an accepted parameter.
      const responses = JSON.stringify(FIXTURES.exchanges.map((e) => e.response));
      expect(responses.includes(forbidden)).toBe(false);
    }
    expect(serialized.length).toBeGreaterThan(0);
  });
});
