import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { buildProjectIntelligence } from "./projectIntelligence";
import { loadAuthState } from "./auth";
import { listProjectFiles, readProjectFile, searchProjectFiles } from "./agentProjectFiles";
import { PracticalAutonomyRuntime, ToolRegistry, type ToolContext, type ToolResult } from "./practicalAutonomy";
import { AgentRunLedger } from "./agentRunLedger";

async function authFor(context: ToolContext) {
  const auth = await loadAuthState(context.userId);
  const [project] = await db.select({ groupId: schema.projects.groupId }).from(schema.projects).where(eq(schema.projects.id, context.projectId));
  if (!auth || project?.groupId !== context.groupId || !auth.groups.some((membership) => membership.groupId === context.groupId)) throw new Error("FORBIDDEN");
  return auth;
}
const available = () => ({ available: true });
const readPolicy = { maxAttempts: 3, baseDelayMs: 250, allowProviderFallback: false };
const verifiedRead = (result: ToolResult) => result.verified;
const citationEvidence = (citations: Array<{ fileId: string }>) => citations.map((citation) => ({ type: "citation" as const, ref: `project-file:${citation.fileId}`, verifiedAt: new Date().toISOString(), trust: "EXTERNAL_UNTRUSTED" as const, provenance: "project-bound-import" }));

export const agentToolRegistry = new ToolRegistry()
  .register({ id: "project.files.list", label: "List project files", category: "project", access: "READ", input: z.object({}), output: z.array(z.unknown()), requiredContext: ["userId", "groupId", "projectId"], risk: "low", confirmation: "never", idempotency: "keyed", cost: { paid: false, estimatePoints: () => 0 }, retry: readPolicy, verify: verifiedRead, verificationStage: "VERIFIED", verificationMethod: "authoritative_project_binding_read_back", evidenceScope: "project", availability: available, handlerIdentity: "agentProjectFiles.listProjectFiles", handler: async (_input, context) => { const value = await listProjectFiles(await authFor(context), context.projectId); return { value, evidence: citationEvidence(value.map((item) => item.citation)), actualPoints: 0, verified: true }; } })
  .register({ id: "project.files.read", label: "Read project file", category: "project", access: "READ", input: z.object({ fileId: z.string().uuid(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(24_000).optional() }), output: z.unknown(), requiredContext: ["userId", "groupId", "projectId"], risk: "low", confirmation: "never", idempotency: "keyed", cost: { paid: false, estimatePoints: () => 0 }, retry: readPolicy, verify: verifiedRead, verificationStage: "VERIFIED", verificationMethod: "authoritative_project_binding_read_back", evidenceScope: "project", availability: available, handlerIdentity: "agentProjectFiles.readProjectFile", handler: async (input, context) => { const value = await readProjectFile(await authFor(context), context.projectId, input.fileId, input.offset, input.limit); return { value, evidence: citationEvidence([value.citation]), actualPoints: 0, verified: true }; } })
  .register({ id: "project.files.search", label: "Search project files", category: "project", access: "READ", input: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(30).optional() }), output: z.array(z.unknown()), requiredContext: ["userId", "groupId", "projectId"], risk: "low", confirmation: "never", idempotency: "keyed", cost: { paid: false, estimatePoints: () => 0 }, retry: readPolicy, verify: verifiedRead, verificationStage: "VERIFIED", verificationMethod: "authoritative_project_binding_read_back", evidenceScope: "project", availability: available, handlerIdentity: "agentProjectFiles.searchProjectFiles", handler: async (input, context) => { const value = await searchProjectFiles(await authFor(context), context.projectId, input.query, input.limit); return { value, evidence: citationEvidence(value.map((item) => item.citation)), actualPoints: 0, verified: true }; } })
  .register({ id: "project.health", label: "Project health and delivery gaps", category: "creator", access: "READ", input: z.object({}), output: z.unknown(), requiredContext: ["userId", "groupId", "projectId"], risk: "low", confirmation: "never", idempotency: "keyed", cost: { paid: false, estimatePoints: () => 0 }, retry: readPolicy, verify: verifiedRead, verificationStage: "VERIFIED", verificationMethod: "authoritative_project_state_read_back", evidenceScope: "project", availability: available, handlerIdentity: "projectIntelligence.buildProjectIntelligence", handler: async (_input, context) => { await authFor(context); const value = await buildProjectIntelligence(context.projectId); return { value, evidence: [{ type: "citation", ref: `project-health:${context.projectId}`, verifiedAt: new Date().toISOString(), trust: "VERIFIED_INTERNAL" }], actualPoints: 0, verified: true }; } });

export const practicalAutonomyRuntime = new PracticalAutonomyRuntime(agentToolRegistry, new AgentRunLedger());
