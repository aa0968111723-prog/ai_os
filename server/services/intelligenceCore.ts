import { createHash } from "node:crypto";

export const INTELLIGENCE_ANALYSIS_VERSION = "intelligence-v1";
export const LOCAL_CLASSIFIER_MODEL = "local-intelligence-v1";
export const LOCAL_EMBEDDING_MODEL = "aios-feature-hash-96";
export const LOCAL_EMBEDDING_VERSION = "1";
export const LOCAL_EMBEDDING_DIMENSIONS = 96;

export type CanonicalAssetType =
  | "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "SPREADSHEET"
  | "PRESENTATION" | "TEXT" | "WEB" | "CODE" | "ARCHIVE" | "OTHER";

export type ConfidenceRouting = "high" | "medium" | "low";

export interface ConfidenceThresholds {
  high: number;
  medium: number;
}

export function confidenceThresholds(env: NodeJS.ProcessEnv = process.env): ConfidenceThresholds {
  const high = Number(env.INTELLIGENCE_CONFIDENCE_HIGH ?? 0.95);
  const medium = Number(env.INTELLIGENCE_CONFIDENCE_MEDIUM ?? 0.70);
  const safeHigh = Number.isFinite(high) ? Math.min(1, Math.max(0.01, high)) : 0.95;
  const safeMedium = Number.isFinite(medium) ? Math.min(safeHigh, Math.max(0, medium)) : 0.70;
  return { high: safeHigh, medium: safeMedium };
}

export function routeConfidence(confidence: number, thresholds = confidenceThresholds()): ConfidenceRouting {
  if (confidence >= thresholds.high) return "high";
  if (confidence >= thresholds.medium) return "medium";
  return "low";
}

const EXT_TYPE: Array<[RegExp, CanonicalAssetType]> = [
  [/\.(?:png|jpe?g|gif|webp|heic|heif|avif|tiff?|bmp|svg)$/i, "IMAGE"],
  [/\.(?:mp4|mov|m4v|webm|mkv|avi)$/i, "VIDEO"],
  [/\.(?:mp3|wav|m4a|aac|ogg|flac)$/i, "AUDIO"],
  [/\.(?:xlsx?|csv|tsv|ods)$/i, "SPREADSHEET"],
  [/\.(?:pptx?|key|odp)$/i, "PRESENTATION"],
  [/\.(?:pdf|docx?|odt|rtf)$/i, "DOCUMENT"],
  [/\.(?:txt|md|markdown)$/i, "TEXT"],
  [/\.(?:js|jsx|ts|tsx|py|rb|go|rs|java|c|cpp|h|css|html|json|ya?ml|sql)$/i, "CODE"],
  [/\.(?:zip|rar|7z|tar|gz|tgz)$/i, "ARCHIVE"],
];

export function canonicalTypeOf(input: { mime?: string | null; name?: string | null; legacyKind?: string | null }): CanonicalAssetType {
  const mime = input.mime?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  if (/spreadsheet|excel|csv/.test(mime)) return "SPREADSHEET";
  if (/presentation|powerpoint/.test(mime)) return "PRESENTATION";
  if (/pdf|word|officedocument|rtf/.test(mime)) return "DOCUMENT";
  if (mime.startsWith("text/html")) return "WEB";
  if (mime.startsWith("text/")) return "TEXT";
  for (const [pattern, type] of EXT_TYPE) if (pattern.test(input.name ?? "")) return type;
  if (input.legacyKind === "image") return "IMAGE";
  if (input.legacyKind === "video") return "VIDEO";
  if (input.legacyKind === "audio") return "AUDIO";
  if (input.legacyKind === "doc") return "DOCUMENT";
  if (input.legacyKind === "spreadsheet" || input.legacyKind === "table") return "SPREADSHEET";
  return "OTHER";
}

export interface IntelligenceAnalysisInput {
  intelligenceId?: string;
  groupId?: string;
  title: string;
  canonicalType: CanonicalAssetType;
  mime?: string | null;
  text?: string | null;
  /** Short-lived signed URL used only by explicitly enabled media providers. */
  mediaUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export type IntelligenceExtractionStage =
  | "ocr" | "transcription" | "image_analysis" | "video_analysis"
  | "audio_analysis" | "face_detection" | "face_embedding";

export interface IntelligenceExtraction {
  text?: string;
  segments?: IntelligenceAnalysis["segments"];
  faces?: IntelligenceAnalysis["faces"];
  metadata?: Record<string, unknown>;
  /** A provider may finish classification during media understanding and reuse it later. */
  analysis?: IntelligenceAnalysis;
  modelVersion: string;
}

export interface IntelligenceAnalysis {
  category: string;
  summary: string;
  description: string;
  tags: string[];
  categoryConfidence: number;
  tagConfidence: number;
  language: string | null;
  modelVersion: string;
  rationale: string;
  /** Optional provider artifacts; local/offline providers may omit them. */
  faces?: Array<{
    faceIndex: number;
    boundingBox?: { x: number; y: number; width: number; height: number };
    embedding?: number[];
    embeddingModel?: string;
    quality?: number;
  }>;
  segments?: Array<{
    kind: "video_scene" | "speech" | "speaker_turn" | "document_page" | "table";
    ordinal: number;
    startMs?: number;
    endMs?: number;
    text?: string;
    speaker?: string;
    confidence?: number;
    metadata?: Record<string, unknown>;
  }>;
  extractedMetadata?: Record<string, unknown>;
  perceptualFingerprint?: string;
}

export interface IntelligenceAnalysisProvider {
  readonly modelVersion: string;
  analyze(input: IntelligenceAnalysisInput): Promise<IntelligenceAnalysis>;
  extract?(stage: IntelligenceExtractionStage, input: IntelligenceAnalysisInput): Promise<IntelligenceExtraction | null>;
}

interface CategoryRule {
  category: string;
  confidence: number;
  pattern: RegExp;
  types?: CanonicalAssetType[];
}

const CATEGORY_RULES: CategoryRule[] = [
  { category: "Script", confidence: 0.97, pattern: /劇本|腳本|screenplay|script|場次|scene\s*\d+/i, types: ["DOCUMENT", "TEXT"] },
  { category: "Storyboard Script", confidence: 0.96, pattern: /分鏡|storyboard|shot\s*\d+/i, types: ["DOCUMENT", "TEXT", "IMAGE"] },
  { category: "Meeting Notes", confidence: 0.95, pattern: /會議紀錄|會議記錄|meeting\s*(?:notes?|minutes)/i, types: ["DOCUMENT", "TEXT", "AUDIO"] },
  { category: "Character Profile", confidence: 0.94, pattern: /角色設定|人物小傳|character\s*(?:profile|bible)/i, types: ["DOCUMENT", "TEXT", "IMAGE"] },
  { category: "Proposal", confidence: 0.93, pattern: /提案|企劃|proposal|pitch\s*deck/i, types: ["DOCUMENT", "PRESENTATION", "TEXT"] },
  { category: "Research", confidence: 0.90, pattern: /研究|調查|research|reference/i, types: ["DOCUMENT", "TEXT", "WEB"] },
  { category: "Contract", confidence: 0.96, pattern: /合約|契約|contract|agreement/i, types: ["DOCUMENT", "TEXT"] },
  { category: "UI Screenshot", confidence: 0.86, pattern: /截圖|screenshot|screen\s*shot|ui[\s_-]/i, types: ["IMAGE"] },
  { category: "Logo", confidence: 0.92, pattern: /logo|標誌|商標/i, types: ["IMAGE"] },
  { category: "Reference Image", confidence: 0.84, pattern: /參考|reference|moodboard|mood\s*board/i, types: ["IMAGE"] },
  { category: "Interview", confidence: 0.90, pattern: /訪談|interview/i, types: ["VIDEO", "AUDIO"] },
  { category: "Meeting Recording", confidence: 0.91, pattern: /會議|meeting/i, types: ["AUDIO", "VIDEO"] },
  { category: "Voice Over", confidence: 0.90, pattern: /旁白|voice\s*over|vo[_\s-]/i, types: ["AUDIO"] },
  { category: "SFX", confidence: 0.91, pattern: /音效|sfx|sound\s*effect/i, types: ["AUDIO"] },
  { category: "Raw Footage", confidence: 0.88, pattern: /毛片|raw\s*footage|camera\s*[ab]/i, types: ["VIDEO"] },
  { category: "Final Cut", confidence: 0.90, pattern: /成片|final(?:\s*cut)?|master/i, types: ["VIDEO"] },
];

const DEFAULT_CATEGORY: Record<CanonicalAssetType, string> = {
  IMAGE: "Image", VIDEO: "Video", AUDIO: "Audio", DOCUMENT: "Document",
  SPREADSHEET: "Spreadsheet", PRESENTATION: "Presentation", TEXT: "Text",
  WEB: "Web Page", CODE: "Code", ARCHIVE: "Archive", OTHER: "Other",
};

const TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "weather:rain", pattern: /下雨|雨天|雨中|rain(?:y|ing)?|umbrella|雨傘|撐傘/i },
  { tag: "weather:snow", pattern: /下雪|雪地|snow(?:y|ing)?/i },
  { tag: "time:evening", pattern: /傍晚|黃昏|夕陽|evening|dusk|sunset/i },
  { tag: "time:night", pattern: /夜晚|深夜|night|midnight/i },
  { tag: "scene:school", pattern: /校園|學校|教室|school|campus|classroom/i },
  { tag: "scene:office", pattern: /辦公室|office|會議室|conference\s*room/i },
  { tag: "location:tamsui", pattern: /淡水|tamsui/i },
  { tag: "action:holding-umbrella", pattern: /撐(?:著)?傘|拿(?:著)?雨傘|holding\s+(?:an?\s+)?umbrella/i },
  { tag: "emotion:calm", pattern: /平靜|沉著|calm|serene/i },
  { tag: "shot:wide", pattern: /全景|遠景|wide\s*shot/i },
  { tag: "shot:close-up", pattern: /特寫|近景|close[\s-]?up/i },
  { tag: "usage:storyboard-reference", pattern: /分鏡參考|storyboard\s*reference/i },
  { tag: "topic:peace", pattern: /和平|peace/i },
];

function detectLanguage(text: string): string | null {
  if (!text.trim()) return null;
  const han = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  if (han > latin * 0.25) return "zh-Hant";
  if (latin > 0) return "en";
  return null;
}

function compactSummary(text: string, fallback: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  const first = clean.split(/(?<=[。！？.!?])\s*/)[0] ?? clean;
  return first.slice(0, 220);
}

/** Offline-safe provider used when no external AI key is configured. */
export class LocalIntelligenceProvider implements IntelligenceAnalysisProvider {
  readonly modelVersion = LOCAL_CLASSIFIER_MODEL;

  async analyze(input: IntelligenceAnalysisInput): Promise<IntelligenceAnalysis> {
    const body = `${input.title}\n${input.text ?? ""}`.slice(0, 24_000);
    const matched = CATEGORY_RULES.find((rule) =>
      (!rule.types || rule.types.includes(input.canonicalType)) && rule.pattern.test(body),
    );
    const category = matched?.category ?? DEFAULT_CATEGORY[input.canonicalType];
    const categoryConfidence = matched?.confidence ?? (input.canonicalType === "OTHER" ? 0.55 : 0.76);
    const tags = [
      `type:${input.canonicalType.toLowerCase()}`,
      ...TAG_RULES.filter((rule) => rule.pattern.test(body)).map((rule) => rule.tag),
    ];
    const uniqueTags = [...new Set(tags)];
    const summary = compactSummary(input.text ?? "", `${input.title}（${category}）`);
    return {
      category,
      summary,
      description: summary,
      tags: uniqueTags,
      categoryConfidence,
      tagConfidence: uniqueTags.length > 1 ? 0.86 : 0.74,
      language: detectLanguage(body),
      modelVersion: this.modelVersion,
      rationale: matched ? `內容符合 ${category} 的分類線索` : "依內容型態建立基礎分類，等待更多內容訊號",
    };
  }
}

export function chunkText(text: string, maxChars = 1_200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + maxChars);
    if (end < clean.length) {
      const boundary = Math.max(clean.lastIndexOf("\n", end), clean.lastIndexOf("。", end), clean.lastIndexOf(" ", end));
      if (boundary > start + Math.floor(maxChars * 0.55)) end = boundary + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function searchTerms(text: string): string[] {
  const lower = text.normalize("NFKC").toLocaleLowerCase("zh-TW");
  const latin = lower.match(/[a-z0-9][a-z0-9_-]+/g) ?? [];
  const hanRuns = lower.match(/[\u3400-\u9fff]+/g) ?? [];
  const han = hanRuns.flatMap((run) => {
    if (run.length <= 2) return [run];
    const out: string[] = [];
    for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2));
    return out;
  });
  return [...latin, ...han];
}

function hashIndex(term: string, dimensions: number): { index: number; sign: number } {
  const digest = createHash("sha1").update(term).digest();
  return { index: digest.readUInt32BE(0) % dimensions, sign: digest[4]! % 2 === 0 ? 1 : -1 };
}

export function featureHashEmbedding(text: string, dimensions = LOCAL_EMBEDDING_DIMENSIONS): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const term of searchTerms(text)) {
    const { index, sign } = hashIndex(term, dimensions);
    vector[index] += sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => Number((value / norm).toFixed(8))) : vector;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!; aa += a[i]! ** 2; bb += b[i]! ** 2;
  }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : 0;
}

export function lexicalOverlap(query: string, candidate: string): number {
  const q = [...new Set(searchTerms(query))];
  if (q.length === 0) return 0;
  const hay = new Set(searchTerms(candidate));
  return q.filter((term) => hay.has(term)).length / q.length;
}

export type ReviewAction = "confirm" | "reject" | "change" | "ignore";

export function resolveReviewDecision(input: {
  action: ReviewAction;
  prediction: unknown;
  correction?: { category?: string; tags?: string[] };
}) {
  const prediction = input.prediction && typeof input.prediction === "object"
    ? input.prediction as Record<string, unknown>
    : {};
  const resolution = input.correction ?? (input.action === "confirm" ? prediction : null);
  return {
    reviewStatus: input.action === "ignore" ? "ignored" : "resolved",
    classificationStatus:
      input.action === "confirm" ? "confirmed"
        : input.action === "change" ? "corrected"
          : input.action === "reject" ? "rejected" : "suggested",
    category: input.correction?.category
      ?? (input.action === "confirm" && typeof prediction.category === "string" ? prediction.category : undefined),
    tags: input.correction?.tags
      ?? (input.action === "confirm" && Array.isArray(prediction.tags)
        ? prediction.tags.filter((tag): tag is string => typeof tag === "string") : undefined),
    resolution,
  } as const;
}
