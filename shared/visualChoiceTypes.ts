/**
 * Visual Creative Choice System — shared types (PR #710)
 *
 * Developer-seeded visual presets that map onto existing Shot fields.
 * Design rules (from product brief):
 * - Prefer EXTEND existing Storyboard / Shot / selection systems
 * - No second selection store, no second generation pipeline
 * - Structured first; free-text remains possible
 * - Stable ids: never rename; deprecate instead
 */
import {
  mergeShotDirection,
  type ShotCamera,
  type ShotPerformance,
} from "./story";

/** Bump when the overall pack contract changes (not individual preset content). */
export const VISUAL_CHOICE_MANIFEST_VERSION = 1 as const;

export type VisualChoiceFamily =
  | "action"
  | "expression"
  | "camera"
  | "lighting"
  | "style"
  | "composition";

/**
 * Provider-agnostic preview resource. React renders the resource contract and
 * never needs to know whether an eventual thumbnail came from Gemini, Adobe,
 * a designer, SVG, or a project reference.
 */
export type VisualChoiceFallbackPreview =
  | {
      kind: "composition";
      motif:
        | "wide"
        | "full"
        | "medium"
        | "close"
        | "extreme-close"
        | "low-angle"
        | "high-angle"
        | "eye-level"
        | "over-shoulder"
        | "push-in"
        | "static";
      alt: string;
    }
  | {
      kind: "pose";
      motif: string;
      energy: "still" | "gentle" | "dynamic";
      alt: string;
    }
  | {
      kind: "expression";
      motif: string;
      alt: string;
    }
  | {
      kind: "swatch";
      colors: readonly [string, string, ...string[]];
      alt: string;
    }
  | {
      kind: "fallback";
      icon: string;
      alt: string;
    };

export type VisualChoicePreview = VisualChoiceFallbackPreview | {
  kind: "image";
  source: "project" | "static" | "generated" | "reference";
  src: string;
  thumbnailSrc?: string;
  assetId?: string;
  alt: string;
  /** Asset-pack revision, independent of semantic preset ids. */
  version?: string;
  aspect?: `${number}:${number}`;
  /** Diagram/swatch rendered when the replaceable bitmap is absent. */
  fallback?: VisualChoiceFallbackPreview;
};

export const VISUAL_CHOICE_FAMILY_LABEL: Record<VisualChoiceFamily, string> = {
  action: "動作",
  expression: "表情",
  camera: "鏡頭",
  lighting: "光線",
  style: "風格",
  composition: "構圖",
};

/**
 * A single visual choice card.
 * preview can be a public asset path later; v1 allows emoji / short glyph as placeholder.
 */
export interface VisualChoicePreset {
  /** Stable id — never rename; mark deprecated instead */
  id: string;
  family: VisualChoiceFamily;
  /** UI primary label (zh) */
  label: string;
  /** Optional secondary line */
  description?: string;
  /** Legacy fallback glyph. Production UI should prefer previewResource. */
  preview?: string;
  /** Replaceable visual resource; semantic payload remains stable when art changes. */
  previewResource?: VisualChoicePreview;
  /** Fragment injected into generation prompt when this preset is active */
  promptFragment: string;
  /**
   * Structured values that map to existing shot fields.
   * Only include keys that should change when this card is chosen.
   */
  structured: {
    camera?: Partial<ShotCamera>;
    performance?: Partial<ShotPerformance>;
    /** Free-text action / blocking line */
    action?: string;
    /** Style / look boost (prompt-level for now) */
    styleHint?: string;
  };
  tags?: string[];
  /** Soft deprecation — keep id for history, hide from default tray */
  deprecated?: boolean;
}

export interface VisualChoiceManifest {
  version: typeof VISUAL_CHOICE_MANIFEST_VERSION;
  presets: VisualChoicePreset[];
}

/** Patch shape that can be fed into scenes.update / mergeShotDirection. */
export interface VisualChoiceShotPatch {
  camera?: ShotCamera | null;
  performance?: ShotPerformance | null;
  action?: string;
  styleHint?: string;
}

/**
 * Apply a preset onto an existing shot direction.
 * Uses mergeShotDirection so we never silently wipe unrelated fields.
 */
export function mapPresetToShotPatch(
  preset: VisualChoicePreset,
  current?: {
    camera?: ShotCamera | null;
    performance?: ShotPerformance | null;
    action?: string | null;
  },
): VisualChoiceShotPatch {
  const out: VisualChoiceShotPatch = {};

  if (preset.structured.camera) {
    out.camera = mergeShotDirection(current?.camera ?? null, preset.structured.camera);
  }
  if (preset.structured.performance) {
    out.performance = mergeShotDirection(
      current?.performance ?? null,
      preset.structured.performance,
    );
  }
  if (preset.structured.action !== undefined) {
    out.action = preset.structured.action;
  }
  if (preset.structured.styleHint !== undefined) {
    out.styleHint = preset.structured.styleHint;
  }

  return out;
}

export function listPresetsByFamily(
  presets: VisualChoicePreset[],
  family: VisualChoiceFamily,
  opts?: { includeDeprecated?: boolean },
): VisualChoicePreset[] {
  return presets.filter(
    (p) => p.family === family && (opts?.includeDeprecated || !p.deprecated),
  );
}

export function findPresetById(
  presets: VisualChoicePreset[],
  id: string,
): VisualChoicePreset | undefined {
  return presets.find((p) => p.id === id);
}
