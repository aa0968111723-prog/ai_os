/**
 * Project Creative Context — 共用契約。
 *
 * 專案裡的角色、造型、場景、道具、素材、知識與資料列仍是既有表的真相。
 * 這裡只定義「為什麼選中它們」與「故事裡的名字如何對到真實 ID」。
 * 不另建一套 AI 專用角色／場景庫。
 */
import { nameKey } from "./story";
import type { OutputKind } from "./models";

export const STORY_ENTITY_KINDS = [
  "character",
  "character_look",
  "scene",
  "scene_preset",
  "environment_state",
  "prop",
  "asset_revision",
  "knowledge",
  "data_row",
] as const;
export type StoryEntityKind = (typeof STORY_ENTITY_KINDS)[number];

export function isStoryEntityKind(value: string): value is StoryEntityKind {
  return (STORY_ENTITY_KINDS as readonly string[]).includes(value);
}

export const STORY_ENTITY_KIND_LABEL: Record<StoryEntityKind, string> = {
  character: "角色",
  character_look: "造型",
  scene: "場",
  scene_preset: "場景卡",
  environment_state: "環境狀態",
  prop: "道具",
  asset_revision: "素材版本",
  knowledge: "知識",
  data_row: "資料列",
};

export const ENTITY_BINDING_SOURCES = ["auto", "user_confirmed", "inherited"] as const;
export type EntityBindingSource = (typeof ENTITY_BINDING_SOURCES)[number];

export const ENTITY_BINDING_AUTO_MIN = 0.9;
export const ENTITY_BINDING_AMBIGUOUS_MAX = 0.7;

export const ENTITY_PROPOSAL_STATUSES = ["pending", "applied", "dismissed"] as const;
export type EntityProposalStatus = (typeof ENTITY_PROPOSAL_STATUSES)[number];

export interface StoryEntityRef {
  kind: StoryEntityKind;
  id: string;
  rev: number | null;
  name: string;
  aliases: string[];
}

export interface ContextItemProvenance {
  sourceId: string;
  sourceKind: StoryEntityKind | "project" | "story" | "worldview" | "generation" | "quota" | "provider";
  revision: number | null;
  whySelected: string;
  selectedBy: "canonical" | "binding" | "lock" | "retrieval" | "continuity" | "policy";
}

export interface CreativeContextItem<T = Record<string, unknown>> {
  id: string;
  kind: ContextItemProvenance["sourceKind"];
  revision: number | null;
  title: string;
  data: T;
  provenance: ContextItemProvenance;
}

export interface BindingCandidate {
  entityId: string;
  entityRev: number | null;
  name: string;
  score: number;
  reason: string;
}

export interface MentionSpan {
  mentionText: string;
  mentionKey: string;
  start: number;
  end: number;
  kind: StoryEntityKind;
}

export interface BindingResolution {
  mention: MentionSpan;
  auto: BindingCandidate | null;
  candidates: BindingCandidate[];
  lockedExisting: boolean;
}

export interface StoryEntityCatalogEntry {
  kind: StoryEntityKind;
  id: string;
  rev: number | null;
  name: string;
  aliases?: string[];
}

export function mentionKeyOf(raw: string): string {
  return nameKey(raw);
}

/**
 * 在故事正文裡找已存在實體的名字／別名。
 * 最長優先，已覆蓋的字元不再重疊——避免「安倢」與「安」各算一次。
 */
export function findMentionSpans(
  text: string,
  catalog: readonly StoryEntityCatalogEntry[],
): MentionSpan[] {
  const terms: Array<{ display: string; key: string; kind: StoryEntityKind; length: number }> = [];
  for (const entry of catalog) {
    const names = [entry.name, ...(entry.aliases ?? [])].map((n) => n.trim()).filter(Boolean);
    for (const display of names) {
      if (display.length < 2) continue;
      terms.push({ display, key: mentionKeyOf(display), kind: entry.kind, length: display.length });
    }
  }
  terms.sort((a, b) => b.length - a.length || a.display.localeCompare(b.display, "zh-Hant"));
  const used = new Array<boolean>(text.length).fill(false);
  const out: MentionSpan[] = [];
  for (const term of terms) {
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(term.display, from);
      if (at < 0) break;
      const end = at + term.display.length;
      const overlap = used.slice(at, end).some(Boolean);
      if (!overlap) {
        for (let i = at; i < end; i += 1) used[i] = true;
        out.push({
          mentionText: term.display,
          mentionKey: term.key,
          start: at,
          end,
          kind: term.kind,
        });
      }
      from = at + 1;
    }
  }
  return out.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
}

export function scoreCatalogMatch(
  mention: MentionSpan,
  entry: StoryEntityCatalogEntry,
): BindingCandidate | null {
  if (entry.kind !== mention.kind) return null;
  const names = [entry.name, ...(entry.aliases ?? [])];
  let best: BindingCandidate | null = null;
  for (const name of names) {
    const key = mentionKeyOf(name);
    if (!key || key !== mention.mentionKey) continue;
    const exactName = name.trim() === mention.mentionText;
    const score = exactName && name.trim() === entry.name.trim() ? 0.96 : exactName ? 0.9 : 0.88;
    const reason = exactName && name.trim() === entry.name.trim()
      ? "故事用詞與專案實體名稱完全相同"
      : exactName
        ? "故事用詞命中這個實體的別名"
        : "正規化後與專案實體同名";
    if (!best || score > best.score) {
      best = { entityId: entry.id, entityRev: entry.rev, name: entry.name, score, reason };
    }
  }
  return best;
}

export function resolveMentionAgainstCatalog(
  mention: MentionSpan,
  catalog: readonly StoryEntityCatalogEntry[],
  opts?: { locked?: boolean },
): BindingResolution {
  if (opts?.locked) {
    return { mention, auto: null, candidates: [], lockedExisting: true };
  }
  const hits: BindingCandidate[] = [];
  for (const entry of catalog) {
    const hit = scoreCatalogMatch(mention, entry);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-Hant"));
  const uniqueIds = [...new Set(hits.map((h) => h.entityId))];
  if (uniqueIds.length === 1 && (hits[0]?.score ?? 0) >= ENTITY_BINDING_AUTO_MIN) {
    return { mention, auto: hits[0]!, candidates: hits, lockedExisting: false };
  }
  return { mention, auto: null, candidates: hits, lockedExisting: false };
}

export function needsBindingProposal(resolution: BindingResolution): boolean {
  if (resolution.lockedExisting) return false;
  if (resolution.auto) return false;
  return resolution.candidates.length > 1
    || (resolution.candidates.length === 1 && resolution.candidates[0]!.score < ENTITY_BINDING_AUTO_MIN);
}

/** 一鍵批次目前仍是靜態圖模型；文案必須跟實際輸出一致。 */
export function oneClickOutputUnit(kind: OutputKind | null | undefined): "畫面" | "影片" | "音訊" {
  if (kind === "video") return "影片";
  if (kind === "audio") return "音訊";
  return "畫面";
}

export function oneClickPrimaryLabel(opts: {
  pending: boolean;
  hasBatch: boolean;
  modelKind?: OutputKind | null;
  /** 0 shots: do not advertise generate — that path silently no-ops. */
  sceneCount?: number;
}): string {
  if (opts.pending) return "準備生成中…";
  if ((opts.sceneCount ?? 1) <= 0) return "先解析／產生分鏡";
  const unit = oneClickOutputUnit(opts.modelKind);
  return opts.hasBatch ? `繼續生成${unit}` : `生成${unit}`;
}

/**
 * 單鏡的 video 成品不是整部片。
 * 只有明確標記為組裝成片／交付影片的資產才算「已有成片」。
 */
export function isAssembledProjectFilm(input: {
  kind?: string | null;
  role?: string | null;
  assembled?: boolean | null;
} | null | undefined): boolean {
  if (!input) return false;
  if (input.assembled === true) return true;
  return input.role === "assembled_film" || input.role === "deliverable_film";
}

export function batchGenerateFingerprint(input: {
  modelId: string;
  sceneIds: readonly string[];
}): string {
  return `${input.modelId}::${[...input.sceneIds].sort().join(",")}`;
}
