/**
 * Consistency preflight and candidate evaluation.
 *
 * A low-scoring output stays a candidate. This module never adopts current.
 */
import type { ShotContextPacketPayload } from "./shotContextPacket";

export const CONSISTENCY_ADOPT_MIN = 0.75;

export interface ConsistencyIssue {
  code: string;
  message: string;
}

export interface ConsistencyScores {
  identity: number;
  look: number;
  scene: number;
  prop: number;
  semantic: number;
  continuity: number;
}

export interface ConsistencyReport {
  scores: ConsistencyScores;
  overall: number;
  issues: ConsistencyIssue[];
  adoptAllowed: boolean;
}

export function preflightShotPacket(packet: ShotContextPacketPayload): {
  ok: boolean;
  issues: ConsistencyIssue[];
} {
  const issues: ConsistencyIssue[] = [];
  if (!packet.visual.prompt?.trim() && !packet.visual.action?.trim()) {
    issues.push({ code: "missing_visual", message: "這一鏡還沒有畫面描述，不能生成" });
  }
  const charIds = new Set(packet.characters.map((row) => row.id));
  for (const look of packet.looks) {
    // look without a bound character is allowed; swapping is the later check
    if (!look.id) issues.push({ code: "empty_look", message: "造型引用是空的" });
  }
  if (packet.characters.length > 1 && packet.looks.length > 1) {
    const lookOwners = packet.looks.map((row) => row.id);
    if (new Set(lookOwners).size !== lookOwners.length) {
      issues.push({ code: "duplicate_look", message: "多角色鏡的造型不能重複綁同一套" });
    }
  }
  void charIds;
  return { ok: issues.length === 0, issues };
}

export function evaluateGenerationCandidate(input: {
  packet: ShotContextPacketPayload;
  candidate: {
    prompt?: string | null;
    characterIds?: string[] | null;
    lookIds?: string[] | null;
    scenePresetIds?: string[] | null;
    propIds?: string[] | null;
    status?: string | null;
  };
}): ConsistencyReport {
  const packetChar = new Set(input.packet.characters.map((row) => row.id));
  const packetLook = new Set(input.packet.looks.map((row) => row.id));
  const packetProp = new Set(input.packet.props.map((row) => row.id));
  const packetPreset = new Set(input.packet.presets.map((row) => row.id));
  const candChar = new Set(input.candidate.characterIds ?? []);
  const candLook = new Set(input.candidate.lookIds ?? []);
  const candProp = new Set(input.candidate.propIds ?? []);
  const candPreset = new Set(input.candidate.scenePresetIds ?? []);

  const overlap = (a: Set<string>, b: Set<string>) => {
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0) return 0.6;
    const hit = [...a].filter((id) => b.has(id)).length;
    return hit / a.size;
  };

  const issues: ConsistencyIssue[] = [];
  const identity = overlap(packetChar, candChar);
  const look = overlap(packetLook, candLook);
  const prop = overlap(packetProp, candProp);
  const scene = overlap(packetPreset, candPreset);
  const prompt = input.candidate.prompt ?? "";
  const semantic = input.packet.visual.prompt && prompt.includes(input.packet.visual.prompt.slice(0, 12))
    ? 0.9
    : input.packet.visual.prompt
      ? 0.55
      : 0.7;
  const continuity = input.packet.continuity.previousShotId ? 0.8 : 0.85;

  if (identity < 1 && packetChar.size) issues.push({ code: "identity_mismatch", message: "候選沒有沿用這一鏡綁定的角色" });
  if (look < 1 && packetLook.size) issues.push({ code: "look_mismatch", message: "候選沒有沿用這一鏡綁定的造型" });
  if (prop < 1 && packetProp.size) issues.push({ code: "prop_mismatch", message: "候選沒有沿用這一鏡綁定的道具" });

  const scores: ConsistencyScores = { identity, look, scene, prop, semantic, continuity };
  const overall = (identity + look + scene + prop + semantic + continuity) / 6;
  return {
    scores,
    overall,
    issues,
    adoptAllowed: overall >= CONSISTENCY_ADOPT_MIN && issues.length === 0,
  };
}

/** Current pointer must stay untouched by evaluation. */
export function shouldAdoptCandidate(report: ConsistencyReport, explicitAdopt: boolean): boolean {
  return Boolean(explicitAdopt && report.adoptAllowed);
}
