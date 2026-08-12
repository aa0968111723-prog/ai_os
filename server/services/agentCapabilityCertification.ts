import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { agentToolRegistry, practicalAutonomyRuntime } from "./agentToolRegistry";
import { AGENT_SKILLS, validateSkillContracts, type DurableStep, type TrustLabel } from "./practicalAutonomy";
import { currentDeploymentIdentity } from "./deploymentIdentity";

export const CAPABILITY_CERTIFICATION_STATES = [
  "DECLARED_ONLY", "MOCK_VERIFIED", "STAGING_VERIFIED", "EXTERNAL_LIVE_VERIFIED",
  "PRODUCTION_SMOKE_VERIFIED", "CERTIFIED", "DEGRADED",
  "BLOCKED_BY_EXTERNAL_DEPENDENCY", "BROKEN",
] as const;
export type CapabilityCertificationState = typeof CAPABILITY_CERTIFICATION_STATES[number];
export type CapabilityVerificationMode = "contract" | "mock" | "staging" | "external_live" | "production_smoke";
export interface CapabilityProof { declared: boolean; resolvable: boolean; reachable: boolean; executable: boolean; verifiable: boolean; useful: boolean; }

const LIVE_STATES = new Set<CapabilityCertificationState>(["STAGING_VERIFIED", "EXTERNAL_LIVE_VERIFIED", "PRODUCTION_SMOKE_VERIFIED", "CERTIFIED"]);
const PLANNER_BLOCKED_STATES = new Set<CapabilityCertificationState>(["DECLARED_ONLY", "MOCK_VERIFIED", "DEGRADED", "BLOCKED_BY_EXTERNAL_DEPENDENCY", "BROKEN"]);

export function buildCapabilityContractReport() {
  const danglingSkills = validateSkillContracts(agentToolRegistry);
  const requiredBySkills = AGENT_SKILLS.flatMap((skill) => skill.requiredCapabilities);
  const registry = agentToolRegistry.contractReport(requiredBySkills);
  return {
    ...registry,
    danglingSkills,
    ready: registry.ready && danglingSkills.length === 0,
    skills: AGENT_SKILLS.map((skill) => ({ ...skill, inputs: undefined, resolvable: skill.requiredCapabilities.every((id) => agentToolRegistry.has(id)) })),
  };
}

function safeEvidenceRef(raw: string): string {
  const trimmed = raw.trim().slice(0, 500);
  try {
    const url = new URL(trimmed);
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch {
    return trimmed.replace(/(token|key|secret|password)=[^\s&]+/gi, "$1=[REDACTED]");
  }
}

export function certificationStateForEvidence(mode: CapabilityVerificationMode, proof: CapabilityProof): CapabilityCertificationState {
  if (mode === "mock") return "MOCK_VERIFIED";
  const complete = Object.values(proof).every(Boolean);
  if (mode === "staging") return complete ? "STAGING_VERIFIED" : "DEGRADED";
  if (mode === "external_live") return complete ? "EXTERNAL_LIVE_VERIFIED" : "DEGRADED";
  if (mode === "production_smoke") return Object.values(proof).every(Boolean) ? "CERTIFIED" : "PRODUCTION_SMOKE_VERIFIED";
  return "DECLARED_ONLY";
}

export function effectiveVerificationMode(requested: CapabilityVerificationMode, env: NodeJS.ProcessEnv = process.env): CapabilityVerificationMode {
  if (requested === "contract" || requested === "mock") return requested;
  if (env.E2E_MOCK === "1") return "mock";
  const declaredEnvironment = env.AGENT_CERTIFICATION_ENV?.trim().toLowerCase();
  if (requested === "staging" && declaredEnvironment === "staging") return requested;
  if (requested === "external_live" && declaredEnvironment === "external_live" && env.ALLOW_EXTERNAL_LIVE_CERTIFICATION === "1") return requested;
  if (
    requested === "production_smoke"
    && env.NODE_ENV === "production"
    && (!declaredEnvironment || declaredEnvironment === "production")
  ) return requested;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Certification mode ${requested} does not match this deployment environment`,
  });
}

export async function getCapabilityHealthView() {
  const identity = currentDeploymentIdentity();
  const rows = await db.select().from(schema.agentCapabilityCertifications);
  const byId = new Map(rows.map((row) => [row.capabilityId, row]));
  const tools = agentToolRegistry.definitions().map((tool) => {
    const availability = tool.availability();
    const stored = byId.get(tool.id);
    let certificationState: CapabilityCertificationState = stored?.certificationState as CapabilityCertificationState ?? (availability.available ? "DECLARED_ONLY" : "BLOCKED_BY_EXTERNAL_DEPENDENCY");
    let blockerReason = stored?.blockerReason ?? availability.reason ?? null;
    if (stored?.registryHash && stored.registryHash !== identity.capabilityRegistryHash) {
      certificationState = "DEGRADED";
      blockerReason = "CAPABILITY_REGISTRY_DRIFT";
    }
    if (stored?.schemaVersion && stored.schemaVersion !== identity.schemaVersion) {
      certificationState = "DEGRADED";
      blockerReason = "CAPABILITY_SCHEMA_DRIFT";
    }
    // 部署漂移只有在「認證證據與當前部署都能提供 build SHA 且兩者不同」時才可證明。
    // 平台未注入 SHA（identity.sha 為 null）時認證會以 null 落庫，若因 !stored.deploymentSha
    // 降級會讓 SHA-less 部署永遠無法維持 LIVE state——code 層漂移已由 registryHash /
    // schemaVersion 兩個 drift 檢查覆蓋，此處僅比對真正可比的部署身分。
    if (stored && LIVE_STATES.has(certificationState) && identity.sha && stored.deploymentSha && stored.deploymentSha !== identity.sha) {
      certificationState = "DEGRADED";
      blockerReason = "CAPABILITY_DEPLOYMENT_DRIFT";
    }
    const configuredMaxAge = Number(process.env.AGENT_CERTIFICATION_MAX_AGE_MS ?? 7 * 24 * 60 * 60 * 1_000);
    const maxAgeMs = Number.isFinite(configuredMaxAge) ? Math.max(60_000, configuredMaxAge) : 7 * 24 * 60 * 60 * 1_000;
    if (stored?.lastVerifiedAt && LIVE_STATES.has(certificationState) && Date.now() - stored.lastVerifiedAt.getTime() > maxAgeMs) {
      certificationState = "DEGRADED";
      blockerReason = "CAPABILITY_EVIDENCE_STALE";
    }
    const proof: CapabilityProof = stored?.proof ?? { declared: true, resolvable: false, reachable: false, executable: false, verifiable: false, useful: false };
    return {
      capabilityId: tool.id,
      label: tool.label,
      domain: tool.category,
      executionMode: tool.access === "READ" ? "DIRECT_READ" : "DIRECT_EFFECT",
      handler: tool.handlerIdentity,
      declared: true,
      handlerResolved: typeof tool.handler === "function" && typeof tool.verify === "function",
      routerServiceReachable: proof.reachable,
      middlewareAuthEnforced: tool.requiredContext.includes("userId") && tool.requiredContext.includes("groupId") && tool.requiredContext.includes("projectId"),
      requiredContextSlotsResolvable: proof.resolvable,
      providerHealthy: availability.available,
      writeEffectPersisted: tool.access === "READ" ? null : proof.executable,
      readBackVerifierPassed: proof.verifiable,
      useful: proof.useful,
      retryIdempotencyTested: stored?.evidence.some((item) => item.type === "idempotency" || item.type === "fault_injection") ?? false,
      confirmationRiskTested: stored?.evidence.some((item) => item.type === "policy") ?? false,
      mobileFlowUsable: proof.useful,
      lastVerifiedAt: stored?.lastVerifiedAt?.toISOString() ?? null,
      successRate: stored?.successRate ?? null,
      p95Ms: stored?.p95Ms ?? null,
      certificationState,
      blockerReason,
      evidence: stored?.evidence ?? [],
      registryHash: identity.capabilityRegistryHash,
      verificationStage: tool.verificationStage ?? "VERIFIED",
      idempotencyContract: tool.idempotencyContract,
      required: tool.required !== false,
      plannerEligible: availability.available && !PLANNER_BLOCKED_STATES.has(certificationState),
    };
  });
  const required = tools.filter((tool) => tool.required);
  const contract = buildCapabilityContractReport();
  return {
    identity,
    contract,
    tools,
    summary: {
      declared: tools.length,
      liveVerified: tools.filter((tool) => LIVE_STATES.has(tool.certificationState)).length,
      dangling: contract.danglingHandlers.length + contract.danglingSkills.length,
      broken: tools.filter((tool) => tool.certificationState === "BROKEN").length,
      blocked: tools.filter((tool) => tool.certificationState === "BLOCKED_BY_EXTERNAL_DEPENDENCY").length,
      requiredReady: contract.ready && required.every((tool) => LIVE_STATES.has(tool.certificationState)),
    },
  };
}

export async function executeCapabilityCertification(input: {
  auth: AuthState;
  capabilityId: string;
  projectId: string;
  toolInput?: unknown;
  mode: CapabilityVerificationMode;
  resolutionObserved: boolean;
  usefulObserved: boolean;
  trustOrigin?: TrustLabel;
  evidence?: Array<{ type: string; ref: string }>;
}) {
  if (!input.auth.user.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Live capability certification requires a QA administrator" });
  const tool = agentToolRegistry.get(input.capabilityId);
  const toolInput = input.toolInput ?? {};
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  requireGroup(input.auth, project.groupId);
  const stepId = `certify-${tool.id}`;
  const step: DurableStep = { id: stepId, toolId: tool.id, input: toolInput, dependsOn: [], status: "pending", idempotencyKey: "pending", attemptCount: 0, reservedPoints: 0, actualPoints: 0 };
  const [run] = await db.insert(schema.agentRuns).values({
    projectId: project.id,
    groupId: project.groupId,
    userId: input.auth.user.id,
    goal: `Live certify ${tool.id}`,
    summary: `Live capability certification: ${tool.id}`,
    // Certification owns this run synchronously. Mark it user-controlled so
    // the normal background Agent runner cannot concurrently claim and mutate
    // the same JSON step while the certification runtime is executing it.
    status: "user_controlled",
    steps: [step],
    estPoints: Math.max(100, tool.cost.estimatePoints(tool.input.parse(toolInput))),
    planSummary: { revision: 1 } as any,
  }).returning();
  const started = Date.now();
  try {
    const result = await practicalAutonomyRuntime.executeStep(run!.id, stepId, {
      userId: input.auth.user.id,
      groupId: project.groupId,
      projectId: project.id,
      confirmed: true,
      inputTrust: input.trustOrigin ?? "USER_EXPLICIT",
      traceId: `capability-certification:${run!.id}`,
    });
    await db.update(schema.agentRuns).set({ status: "done", updatedAt: new Date() }).where(eq(schema.agentRuns.id, run!.id));
    const mode = effectiveVerificationMode(input.mode);
    const proof: CapabilityProof = { declared: true, resolvable: input.resolutionObserved, reachable: true, executable: true, verifiable: result.verified && !!result.receipt, useful: input.usefulObserved };
    const identity = currentDeploymentIdentity();
    const evidence = [
      { type: "execution_receipt", ref: `agent-tool-receipt:${result.receipt?.toolCallId ?? run!.id}`, observedAt: new Date().toISOString() },
      ...result.evidence.map((item) => ({ type: item.type, ref: safeEvidenceRef(item.ref), observedAt: item.verifiedAt })),
      ...(input.evidence ?? []).map((item) => ({ type: item.type.slice(0, 80), ref: safeEvidenceRef(item.ref), observedAt: new Date().toISOString() })),
    ].slice(0, 50);
    const certificationState = certificationStateForEvidence(mode, proof);
    const row = await db.insert(schema.agentCapabilityCertifications).values({
      capabilityId: tool.id, certificationState, verificationMode: mode, proof, evidence,
      successRate: 1, p95Ms: Date.now() - started, lastVerifiedAt: new Date(), updatedBy: input.auth.user.id,
      deploymentSha: identity.sha, schemaVersion: identity.schemaVersion, registryHash: identity.capabilityRegistryHash,
    }).onConflictDoUpdate({ target: schema.agentCapabilityCertifications.capabilityId, set: {
      certificationState, verificationMode: mode, proof, evidence,
      successRate: 1, p95Ms: Date.now() - started, blockerReason: null, lastVerifiedAt: new Date(), updatedBy: input.auth.user.id,
      deploymentSha: identity.sha, schemaVersion: identity.schemaVersion, registryHash: identity.capabilityRegistryHash, updatedAt: new Date(),
    }}).returning();
    return { runId: run!.id, result, certification: row[0] };
  } catch (error) {
    await db.update(schema.agentRuns).set({ status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(eq(schema.agentRuns.id, run!.id));
    throw error;
  }
}
