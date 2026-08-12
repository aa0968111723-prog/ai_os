import { getModel } from "../../shared/models";
import { falStatus, falSubmit } from "./fal";
import { proxyFetch } from "./http";
import { nimComplete, NIM_DEFAULT_MODEL } from "./nvidia-nim";
import { extractJsonObject } from "./assistantCore";
import {
  LocalIntelligenceProvider,
  type IntelligenceAnalysis,
  type IntelligenceAnalysisInput,
  type IntelligenceAnalysisProvider,
  type IntelligenceExtraction,
  type IntelligenceExtractionStage,
} from "./intelligenceCore";

const DEFAULT_VISION_MODEL = "fal-ai/any-llm/vision#gemini-2.5-flash";
const DEFAULT_TRANSCRIPTION_MODEL = "fal-ai/whisper";
const PROVIDER_TIMEOUT_MS = 120_000;
const POLL_MS = 2_000;

export interface IntelligenceProviderConfig {
  externalEnabled: boolean;
  mode: "auto" | "local" | "fal" | "nim";
  falConfigured: boolean;
  nimConfigured: boolean;
  visionModel: string;
  transcriptionModel: string;
  textModel: string;
  faceEndpointConfigured: boolean;
  videoEndpointConfigured: boolean;
}

export function intelligenceProviderConfig(env: NodeJS.ProcessEnv = process.env): IntelligenceProviderConfig {
  const rawMode = env.INTELLIGENCE_ANALYSIS_PROVIDER?.trim().toLowerCase();
  const mode = rawMode === "fal" || rawMode === "nim" || rawMode === "local" ? rawMode : "auto";
  return {
    externalEnabled: env.INTELLIGENCE_EXTERNAL_ANALYSIS_ENABLED === "1",
    mode,
    falConfigured: Boolean(env.FAL_KEY?.trim()),
    nimConfigured: Boolean(env.NVIDIA_NIM_API_KEY?.trim()),
    visionModel: env.INTELLIGENCE_VISION_MODEL_ID?.trim() || DEFAULT_VISION_MODEL,
    transcriptionModel: env.INTELLIGENCE_TRANSCRIPTION_MODEL_ID?.trim() || DEFAULT_TRANSCRIPTION_MODEL,
    textModel: env.INTELLIGENCE_TEXT_MODEL_ID?.trim() || NIM_DEFAULT_MODEL,
    faceEndpointConfigured: Boolean(env.INTELLIGENCE_FACE_PROVIDER_URL?.trim()),
    videoEndpointConfigured: Boolean(env.INTELLIGENCE_VIDEO_PROVIDER_URL?.trim()),
  };
}

function clampConfidence(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item && !/^(?:person|identity|celebrity|real[-_ ]?name):/i.test(item)))].slice(0, 40);
}

const IDENTITY_METADATA_KEY = /^(?:identity|person_?name|real_?name|celebrity|recognized_?person|known_?person)$/i;

function sanitizeProviderMetadata(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return {};
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (IDENTITY_METADATA_KEY.test(key)) continue;
    if (typeof item === "string") output[key] = item.slice(0, 2_000);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) output[key] = item;
    else if (Array.isArray(item)) output[key] = item.slice(0, 100).filter((entry) => ["string", "number", "boolean"].includes(typeof entry));
    else if (item && typeof item === "object") output[key] = sanitizeProviderMetadata(item, depth + 1);
  }
  return output;
}

function jsonObject(raw: string): Record<string, unknown> | null {
  const parsed = extractJsonObject(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

export function parseProviderAnalysis(
  raw: string | Record<string, unknown>,
  fallback: IntelligenceAnalysis,
  modelVersion: string,
): IntelligenceAnalysis {
  const value = typeof raw === "string" ? jsonObject(raw) : raw;
  if (!value) throw new Error("Intelligence provider did not return valid JSON");
  const category = typeof value.category === "string" && value.category.trim() ? value.category.trim().slice(0, 100) : fallback.category;
  const summary = typeof value.summary === "string" && value.summary.trim() ? value.summary.trim().slice(0, 500) : fallback.summary;
  const description = typeof value.description === "string" && value.description.trim()
    ? value.description.trim().slice(0, 2_000) : summary;
  const tags = stringArray(value.tags);
  const extractedMetadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
    ? sanitizeProviderMetadata(value.metadata) : undefined;
  return {
    ...fallback,
    category,
    summary,
    description,
    tags: tags.length ? tags : fallback.tags,
    categoryConfidence: clampConfidence(value.categoryConfidence, fallback.categoryConfidence),
    tagConfidence: clampConfidence(value.tagConfidence, fallback.tagConfidence),
    language: typeof value.language === "string" ? value.language.slice(0, 32) : fallback.language,
    rationale: typeof value.rationale === "string" ? value.rationale.slice(0, 1_000) : "Configured provider content analysis",
    extractedMetadata,
    modelVersion,
  };
}

function analysisPrompt(input: IntelligenceAnalysisInput): string {
  const content = (input.text ?? "").slice(0, 20_000);
  return [
    "You are the Aios Intelligence Library classifier. Return one JSON object only.",
    "Never guess a real person's identity. Describe anonymous people only by visible role or appearance.",
    "Use multidimensional facet tags such as weather:rain, location:tamsui, scene:school, action:holding-umbrella, emotion:calm, shot:wide, usage:storyboard-reference.",
    "Required fields: category, summary, description, tags, categoryConfidence, tagConfidence, language, rationale, metadata.",
    `Asset type: ${input.canonicalType}; MIME: ${input.mime ?? "unknown"}; title: ${input.title}`,
    content ? `Extracted content:\n${content}` : "Analyze the supplied media content.",
  ].join("\n");
}

interface ProviderDependencies {
  submit: typeof falSubmit;
  status: typeof falStatus;
  completeText: typeof nimComplete;
  fetch: typeof proxyFetch;
}

const defaultDependencies: ProviderDependencies = {
  submit: falSubmit,
  status: falStatus,
  completeText: nimComplete,
  fetch: proxyFetch,
};

export class ConfiguredIntelligenceProvider implements IntelligenceAnalysisProvider {
  readonly modelVersion: string;
  private readonly local = new LocalIntelligenceProvider();

  constructor(
    private readonly config = intelligenceProviderConfig(),
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly dependencies: ProviderDependencies = defaultDependencies,
  ) {
    this.modelVersion = [config.visionModel, config.transcriptionModel, config.textModel].join("+");
  }

  async analyze(input: IntelligenceAnalysisInput): Promise<IntelligenceAnalysis> {
    const fallback = await this.local.analyze(input);
    const cached = input.metadata?.providerAnalysis;
    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      return parseProviderAnalysis(cached as Record<string, unknown>, fallback, this.modelVersion);
    }
    if (!this.config.externalEnabled || this.config.mode === "local") return fallback;
    if ((this.config.mode === "auto" || this.config.mode === "nim") && this.config.nimConfigured) {
      const raw = await this.dependencies.completeText(analysisPrompt(input), {
        model: this.config.textModel,
        temperature: 0.1,
        maxTokens: 1_500,
        timeoutMs: PROVIDER_TIMEOUT_MS,
      });
      return parseProviderAnalysis(raw, fallback, this.config.textModel);
    }
    return fallback;
  }

  async extract(stage: IntelligenceExtractionStage, input: IntelligenceAnalysisInput): Promise<IntelligenceExtraction | null> {
    if (!this.config.externalEnabled || this.config.mode === "local") return null;
    if (stage === "image_analysis" && input.canonicalType === "IMAGE" && input.mediaUrl && this.canUseFal()) {
      const model = getModel(this.config.visionModel);
      if (!model) throw new Error(`Unknown Intelligence vision model: ${this.config.visionModel}`);
      const raw = await this.runFal(model.endpoint ?? model.id.split("#")[0]!, model.input(analysisPrompt(input), "16:9", input.mediaUrl));
      const fallback = await this.local.analyze(input);
      const analysis = parseProviderAnalysis(raw, fallback, this.config.visionModel);
      return { analysis, metadata: analysis.extractedMetadata, modelVersion: this.config.visionModel };
    }
    if (stage === "transcription" && input.mediaUrl && input.canonicalType === "AUDIO" && this.canUseFal()) {
      const model = getModel(this.config.transcriptionModel);
      if (!model) throw new Error(`Unknown Intelligence transcription model: ${this.config.transcriptionModel}`);
      const raw = await this.runFal(model.endpoint ?? model.id.split("#")[0]!, model.input("", "16:9", input.mediaUrl));
      return {
        text: raw.trim(),
        segments: raw.trim() ? [{ kind: "speech", ordinal: 0, text: raw.trim(), confidence: 0.9 }] : [],
        metadata: { transcript: raw.trim() },
        modelVersion: this.config.transcriptionModel,
      };
    }
    if (stage === "video_analysis" && input.canonicalType === "VIDEO" && input.mediaUrl && this.config.videoEndpointConfigured) {
      return this.runHttpCapability(this.env.INTELLIGENCE_VIDEO_PROVIDER_URL!, input, "video");
    }
    if (stage === "face_detection" && ["IMAGE", "VIDEO"].includes(input.canonicalType) && input.mediaUrl && this.config.faceEndpointConfigured) {
      return this.runHttpCapability(this.env.INTELLIGENCE_FACE_PROVIDER_URL!, input, "face");
    }
    return null;
  }

  private canUseFal(): boolean {
    return (this.config.mode === "auto" || this.config.mode === "fal") && this.config.falConfigured;
  }

  private async runFal(endpoint: string, input: Record<string, unknown>): Promise<string> {
    const { requestId } = await this.dependencies.submit(endpoint, "text", input);
    const deadline = Date.now() + PROVIDER_TIMEOUT_MS;
    for (;;) {
      const result = await this.dependencies.status(endpoint, "text", requestId);
      if (result.status === "done") {
        if (!result.resultText?.trim()) throw new Error("Intelligence provider returned no text");
        return result.resultText;
      }
      if (result.status === "failed") throw new Error(result.error ?? "Intelligence provider failed");
      if (Date.now() >= deadline) throw new Error("Intelligence provider timed out");
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  private async runHttpCapability(url: string, input: IntelligenceAnalysisInput, capability: "video" | "face"): Promise<IntelligenceExtraction> {
    const response = await this.dependencies.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.env.INTELLIGENCE_CAPABILITY_TOKEN ? { Authorization: `Bearer ${this.env.INTELLIGENCE_CAPABILITY_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        mediaUrl: input.mediaUrl,
        mime: input.mime,
        title: input.title,
        intelligenceId: input.intelligenceId,
        prohibitIdentityGuessing: true,
      }),
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
    if (!response.ok) throw new Error(`${capability} provider failed (${response.status})`);
    const raw = await response.json() as Record<string, unknown>;
    const faces = Array.isArray(raw.faces) ? raw.faces.flatMap((face, index) => sanitizeFace(face, index)) : undefined;
    const segments = Array.isArray(raw.segments) ? raw.segments.flatMap((segment, index) => sanitizeSegment(segment, index)) : undefined;
    return {
      text: typeof raw.text === "string" ? raw.text.slice(0, 100_000) : undefined,
      faces,
      segments,
      metadata: sanitizeProviderMetadata(raw.metadata),
      modelVersion: typeof raw.modelVersion === "string" ? raw.modelVersion.slice(0, 200) : `${capability}-provider-v1`,
    };
  }
}

function sanitizeFace(value: unknown, fallbackIndex: number): NonNullable<IntelligenceAnalysis["faces"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const face = value as Record<string, unknown>;
  const embedding = Array.isArray(face.embedding)
    ? face.embedding.filter((item): item is number => typeof item === "number" && Number.isFinite(item)).slice(0, 4_096)
    : undefined;
  const box = face.boundingBox && typeof face.boundingBox === "object" && !Array.isArray(face.boundingBox)
    ? face.boundingBox as Record<string, unknown> : null;
  const number = (item: unknown) => typeof item === "number" && Number.isFinite(item) ? item : 0;
  return [{
    faceIndex: typeof face.faceIndex === "number" ? Math.max(0, Math.floor(face.faceIndex)) : fallbackIndex,
    boundingBox: box ? { x: number(box.x), y: number(box.y), width: number(box.width), height: number(box.height) } : undefined,
    embedding: embedding?.length ? embedding : undefined,
    embeddingModel: typeof face.embeddingModel === "string" ? face.embeddingModel.slice(0, 200) : undefined,
    quality: clampConfidence(face.quality, 0.5),
  }];
}

function sanitizeSegment(value: unknown, fallbackOrdinal: number): NonNullable<IntelligenceAnalysis["segments"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const segment = value as Record<string, unknown>;
  const allowedKinds = new Set(["video_scene", "speech", "speaker_turn", "document_page", "table"]);
  const kind = typeof segment.kind === "string" && allowedKinds.has(segment.kind) ? segment.kind : "video_scene";
  return [{
    kind: kind as NonNullable<IntelligenceAnalysis["segments"]>[number]["kind"],
    ordinal: typeof segment.ordinal === "number" ? Math.max(0, Math.floor(segment.ordinal)) : fallbackOrdinal,
    startMs: typeof segment.startMs === "number" ? Math.max(0, segment.startMs) : undefined,
    endMs: typeof segment.endMs === "number" ? Math.max(0, segment.endMs) : undefined,
    text: typeof segment.text === "string" ? segment.text.slice(0, 100_000) : undefined,
    speaker: typeof segment.speaker === "string" ? segment.speaker.slice(0, 200) : undefined,
    confidence: clampConfidence(segment.confidence, 0.7),
    metadata: segment.metadata && typeof segment.metadata === "object" && !Array.isArray(segment.metadata)
      ? segment.metadata as Record<string, unknown> : {},
  }];
}

export function resolveIntelligenceProvider(env: NodeJS.ProcessEnv = process.env): IntelligenceAnalysisProvider {
  const config = intelligenceProviderConfig(env);
  if (!config.externalEnabled || config.mode === "local") return new LocalIntelligenceProvider();
  return new ConfiguredIntelligenceProvider(config, env);
}
