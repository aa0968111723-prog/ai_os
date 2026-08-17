/**
 * Output-truth evaluation.
 *
 * Production uses an explicitly configured real Gemini multimodal adapter.
 * Tests may inject deterministic fixtures, but the production selector never
 * falls back to a fake success. Provider unavailable => visual not checked.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { loadCreativeContextProject } from "./storyEntityBinding";
import { splitGenerationSourceMeta } from "../../shared/generationSourceMeta";
import {
  ANIMATION_EVALUATION_DIMENSIONS,
  animationEvidenceFingerprint,
  mergeVisualEvaluation,
  parseVisualEvaluatorPayload,
  structuralAnimationEvaluation,
  type AnimationConsistencyEvaluation,
  type AnimationEvaluationEvidence,
  type EvaluationDimensionResult,
} from "../../shared/animationEvaluation";
import { proxyFetch } from "./http";
import { readStoredFile } from "./storage";
import { findDerivedEndFrameAssetId } from "./derivedFrames";

const STRUCTURAL_VERSION = "animation-structural.v1";
const GEMINI_EVALUATOR_VERSION = "animation-gemini-visual.v1";
const GEMINI_MODEL = process.env.GEMINI_EVALUATOR_MODEL?.trim() || "gemini-2.5-flash";
const GEMINI_HOST = (process.env.GEMINI_API_HOST?.trim() || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
const MAX_EVALUATION_IMAGES = 6;

export interface VisualEvidenceImage {
  assetId: string;
  role: string;
  mime: string;
  base64: string;
}

export interface VisualEvaluatorInput {
  evidence: AnimationEvaluationEvidence;
  packetSummary: {
    prompt: string | null;
    action: string | null;
    worldStyle: string[];
    negativeConstraints: string[];
    expectedCharacterIds: string[];
    expectedLookIds: string[];
    expectedSceneIds: string[];
    expectedPropIds: string[];
    expectedStart: unknown;
    expectedEnd: unknown;
  };
  images: VisualEvidenceImage[];
}

export interface VisualEvaluatorAdapter {
  provider: string;
  model: string;
  version: string;
  configured(): boolean;
  evaluate(input: VisualEvaluatorInput): Promise<Pick<AnimationConsistencyEvaluation, "dimensions" | "findings">>;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Evaluator 沒有回傳 JSON");
  return JSON.parse(fenced.slice(start, end + 1));
}

function geminiText(payload: unknown): string {
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates ?? [];
  return candidates.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("\n");
}

export class GeminiVisualEvaluator implements VisualEvaluatorAdapter {
  provider = "gemini";
  model = GEMINI_MODEL;
  version = GEMINI_EVALUATOR_VERSION;

  configured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
  }

  async evaluate(input: VisualEvaluatorInput): Promise<Pick<AnimationConsistencyEvaluation, "dimensions" | "findings">> {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new Error("GEMINI_API_KEY 未設定");
    if (!input.images.length) throw new Error("沒有可供視覺檢查的候選影格");
    const instruction = [
      "You are a visual continuity reviewer. Return JSON only.",
      "Never infer certainty when evidence is absent. Use insufficient_evidence.",
      "Compare candidate against exact frozen intent and labeled reference images.",
      "Dimensions: semantic, identity, look, scene, prop, style, temporal, physics.",
      "Each dimension: {status: consistent|finding|insufficient_evidence, confidence: high|medium|low|insufficient_evidence, summary, evidenceSourceIds[]}.",
      "Findings: [{code,dimension,severity: warning|blocker|unresolved,confidence,reason,evidenceSourceIds,characterIds?,propIds?,sceneIds?,repairHint?}].",
      "Do not claim physical correctness; only report visible, traceable mismatches.",
      JSON.stringify(input.packetSummary),
      `Evidence labels: ${input.images.map((image) => `${image.assetId}=${image.role}`).join(", ")}`,
    ].join("\n");
    const parts: Array<Record<string, unknown>> = [{ text: instruction }];
    for (const image of input.images.slice(0, MAX_EVALUATION_IMAGES)) {
      parts.push({ text: `asset:${image.assetId}; role:${image.role}` });
      parts.push({ inlineData: { mimeType: image.mime, data: image.base64 } });
    }
    const res = await proxyFetch(
      `${GEMINI_HOST}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
        timeoutMs: 90_000,
      },
    );
    if (!res.ok) throw new Error(`Gemini visual evaluator HTTP ${res.status}`);
    const body = await res.json();
    return parseVisualEvaluatorPayload(extractJson(geminiText(body)));
  }
}

async function loadImage(asset: typeof schema.assets.$inferSelect, role: string): Promise<VisualEvidenceImage | null> {
  if (asset.kind !== "image") return null;
  let bytes: Buffer;
  let mime = asset.mime || "image/png";
  if (asset.storagePath) {
    bytes = await readStoredFile(asset.storagePath);
  } else {
    const res = await proxyFetch(asset.url, { timeoutMs: 30_000 });
    if (!res.ok) return null;
    mime = (res.headers.get("content-type") ?? mime).split(";")[0]!.trim();
    bytes = Buffer.from(await res.arrayBuffer());
  }
  if (bytes.length < 32) return null;
  return { assetId: asset.id, role, mime, base64: bytes.toString("base64") };
}

export async function evaluateGenerationConsistency(input: {
  auth: AuthState;
  generationId: string;
  runVisualCheck: boolean;
  adapter?: VisualEvaluatorAdapter;
}): Promise<{ evaluation: AnimationConsistencyEvaluation; reused: boolean; providerAvailable: boolean }> {
  const [generation] = await db.select().from(schema.generations)
    .where(eq(schema.generations.id, input.generationId));
  if (!generation || !generation.sceneId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到綁定分鏡的生成候選" });
  }
  await loadCreativeContextProject(input.auth, generation.projectId, false);
  if (generation.status !== "done") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "候選尚未完成，不能檢查" });
  }
  const meta = splitGenerationSourceMeta(generation.params).meta;
  if (!meta.shotContextPacketId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "候選沒有凍結 Shot Packet，無法對歷史意圖檢查" });
  }
  const [packetRow] = await db.select().from(schema.shotContextPackets).where(and(
    eq(schema.shotContextPackets.id, meta.shotContextPacketId),
    eq(schema.shotContextPackets.projectId, generation.projectId),
  ));
  if (!packetRow) throw new TRPCError({ code: "NOT_FOUND", message: "找不到候選使用的 Shot Packet" });

  const [candidate] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.projectId, generation.projectId),
    isNull(schema.assets.deletedAt),
    sql`${schema.assets.meta}->>'generationId' = ${generation.id}`,
  ));
  if (!candidate) throw new TRPCError({ code: "NOT_FOUND", message: "找不到候選素材" });

  let candidateVisualAssetId = candidate.id;
  if (candidate.kind === "video") {
    candidateVisualAssetId = await findDerivedEndFrameAssetId({
      projectId: generation.projectId,
      parentAssetId: candidate.id,
    }) ?? "";
  }
  const referenceAssetIds = [...new Set((packetRow.packet.references ?? []).map((row) => row.assetId))];
  const previousFrameAssetId = packetRow.packet.references?.find((row) =>
    row.role === "continuity_previous_frame" || row.role === "continuity_previous_end_frame")?.assetId ?? null;
  const adapter = input.adapter ?? new GeminiVisualEvaluator();
  const evaluatorVersion = input.runVisualCheck && adapter.configured()
    ? adapter.version
    : STRUCTURAL_VERSION;
  const evidence: AnimationEvaluationEvidence = {
    generationId: generation.id,
    shotId: generation.sceneId,
    packetId: packetRow.id,
    packetFingerprint: packetRow.fingerprint,
    candidateAssetId: candidate.id,
    referenceAssetIds,
    previousFrameAssetId,
    evaluatorVersion,
  };
  const fingerprint = animationEvidenceFingerprint(evidence);
  const [existing] = await db.select().from(schema.generationConsistencyEvaluations).where(and(
    eq(schema.generationConsistencyEvaluations.generationId, generation.id),
    eq(schema.generationConsistencyEvaluations.evaluatorVersion, evaluatorVersion),
    eq(schema.generationConsistencyEvaluations.evidenceFingerprint, fingerprint),
  ));
  if (existing) {
    return {
      evaluation: existing.result,
      reused: true,
      providerAvailable: existing.result.visualCheckStatus === "completed",
    };
  }

  let evaluation = structuralAnimationEvaluation({
    generationId: generation.id,
    shotId: generation.sceneId,
    packet: packetRow.packet,
    candidate: {
      characterIds: generation.characterIds,
      scenePresetIds: generation.scenePresetIds,
      propIds: generation.propIds,
    },
    evidenceFingerprint: fingerprint,
    evaluatorVersion,
  });
  const providerAvailable = input.runVisualCheck && adapter.configured() && Boolean(candidateVisualAssetId);
  let provider = "structural";
  let model: string | null = null;
  if (providerAvailable) {
    const ids = [...new Set([candidateVisualAssetId, ...referenceAssetIds, previousFrameAssetId].filter((id): id is string => Boolean(id)))]
      .slice(0, MAX_EVALUATION_IMAGES);
    const assets = ids.length
      ? await db.select().from(schema.assets).where(and(
        inArray(schema.assets.id, ids),
        eq(schema.assets.projectId, generation.projectId),
        isNull(schema.assets.deletedAt),
      ))
      : [];
    const byId = new Map(assets.map((row) => [row.id, row]));
    const images = (await Promise.all(ids.map(async (id) => {
      const asset = byId.get(id);
      if (!asset) return null;
      const role = id === candidateVisualAssetId
        ? "candidate"
        : id === previousFrameAssetId
          ? "previous_adopted_frame"
          : packetRow.packet.references?.find((row) => row.assetId === id)?.role ?? "reference";
      return loadImage(asset, role);
    }))).filter((row): row is VisualEvidenceImage => Boolean(row));
    try {
      const visual = await adapter.evaluate({
        evidence,
        packetSummary: {
          prompt: packetRow.packet.visual.prompt,
          action: packetRow.packet.visual.action,
          worldStyle: packetRow.packet.worldStyle,
          negativeConstraints: packetRow.packet.negativeConstraints,
          expectedCharacterIds: packetRow.packet.characters.map((row) => row.id),
          expectedLookIds: packetRow.packet.looks.map((row) => row.id),
          expectedSceneIds: packetRow.packet.presets.map((row) => row.id),
          expectedPropIds: packetRow.packet.props.map((row) => row.id),
          expectedStart: packetRow.packet.continuity.currentStart ?? null,
          expectedEnd: packetRow.packet.continuity.currentEnd ?? null,
        },
        images,
      });
      evaluation = mergeVisualEvaluation(evaluation, visual);
      provider = adapter.provider;
      model = adapter.model;
    } catch (error) {
      evaluation = {
        ...evaluation,
        visualCheckStatus: "failed",
        recommendation: evaluation.findings.length ? evaluation.recommendation : "review",
        dimensions: Object.fromEntries(
          ANIMATION_EVALUATION_DIMENSIONS.map((name) => {
            const current: EvaluationDimensionResult = evaluation.dimensions[name];
            return [name, current.status === "finding" ? current : {
              status: "not_checked",
              confidence: "insufficient_evidence",
              summary: `視覺檢查失敗：${error instanceof Error ? error.message : "provider error"}`,
              evidenceSourceIds: [],
            }];
          }),
        ) as AnimationConsistencyEvaluation["dimensions"],
      };
    }
  }

  await db.insert(schema.generationConsistencyEvaluations).values({
    projectId: generation.projectId,
    groupId: generation.groupId,
    shotId: generation.sceneId,
    generationId: generation.id,
    candidateAssetId: candidate.id,
    packetId: packetRow.id,
    evaluatorProvider: provider,
    evaluatorModel: model,
    evaluatorVersion,
    evidenceFingerprint: fingerprint,
    result: evaluation,
    createdBy: input.auth.user.id,
  }).onConflictDoNothing();
  return { evaluation, reused: false, providerAvailable };
}

export async function listShotConsistencyEvaluations(input: {
  auth: AuthState;
  projectId: string;
  shotId?: string;
}) {
  await loadCreativeContextProject(input.auth, input.projectId, false);
  return db.select().from(schema.generationConsistencyEvaluations).where(and(
    eq(schema.generationConsistencyEvaluations.projectId, input.projectId),
    ...(input.shotId ? [eq(schema.generationConsistencyEvaluations.shotId, input.shotId)] : []),
  ));
}

