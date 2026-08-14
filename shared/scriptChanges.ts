/**
 * Script-authorized changes（master plan §11）：
 * 區分「腳本明確要求的狀態改變」與「模型自己漂移」。
 *
 * 「魯夫脫掉紅外套」是合法換裝，不得報 clothing drift；
 * 「多年後」「蒙太奇」可解除部分連戲約束。
 * 這裡只做保守的顯式標記解析——寧可漏判（多報 drift 給人確認），
 * 不可誤判（把真正的漂移當成腳本要求）。
 */
import type { ShotTransitionType } from "./shotContextPacket";

export type AuthorizedChangeType =
  | "costume_change"
  | "got_wet"
  | "dried_off"
  | "injury"
  | "prop_transfer"
  | "prop_loss";

export interface ScriptAuthorizedChange {
  type: AuthorizedChangeType;
  /** 命中的原文片段（provenance——人可以核對這是不是真的腳本要求） */
  excerpt: string;
}

const CHANGE_PATTERNS: Array<{ type: AuthorizedChangeType; pattern: RegExp }> = [
  { type: "costume_change", pattern: /(脫掉|脫下|換上|換裝|穿上|披上|摘下|戴上)[^\n。；;]{0,20}/g },
  { type: "got_wet", pattern: /(淋濕|濕透|落水|跳進水|被雨淋)[^\n。；;]{0,12}/g },
  { type: "dried_off", pattern: /(擦乾|晾乾|烘乾|換了乾)[^\n。；;]{0,12}/g },
  { type: "injury", pattern: /(受傷|擦傷|割傷|包紮|瘀青|流血)[^\n。；;]{0,12}/g },
  { type: "prop_transfer", pattern: /(交給|遞給|送給|接過|搶走)[^\n。；;]{0,16}/g },
  { type: "prop_loss", pattern: /(弄丟|遺失|掉了|落在)[^\n。；;]{0,16}/g },
];

export function parseScriptAuthorizedChanges(text: string | null | undefined): ScriptAuthorizedChange[] {
  if (!text) return [];
  const found: ScriptAuthorizedChange[] = [];
  for (const { type, pattern } of CHANGE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const excerpt = match[0]?.trim();
      if (excerpt) found.push({ type, excerpt });
    }
  }
  return found;
}

const TIME_JUMP_PATTERN = /(多年後|數年後|幾年後|隔天|翌日|一週後|一個月後|數月後|多年前|回到過去|閃回|夢中|夢裡)/;
const MONTAGE_PATTERN = /(蒙太奇|剪影集|montage|快速剪接)/i;

/**
 * 轉場類型推導（保守）：
 * 1. 腳本顯式時間跳躍／夢境標記 → time_jump；蒙太奇標記 → montage
 * 2. 換場（storyScene 不同）→ scene_change
 * 3. 其餘 → cut（完整連戲約束）
 */
export function detectTransitionType(input: {
  shotText: string | null | undefined;
  sceneText?: string | null;
  previousStorySceneId: string | null;
  currentStorySceneId: string | null;
}): ShotTransitionType {
  const text = `${input.shotText ?? ""}\n${input.sceneText ?? ""}`;
  if (TIME_JUMP_PATTERN.test(text)) return "time_jump";
  if (MONTAGE_PATTERN.test(text)) return "montage";
  if (
    input.previousStorySceneId
    && input.currentStorySceneId
    && input.previousStorySceneId !== input.currentStorySceneId
  ) {
    return "scene_change";
  }
  return "cut";
}

import type { ShotContinuityState } from "./shotContextPacket";

/**
 * Adopt 當下抽出 end-state（§11）：start-state ＋ 腳本授權的改變 ＝ 這一鏡結束時的狀態。
 * 保守規則：淋濕套用到在場全員（雨是環境事件）；擦乾解除；受傷標記；
 * 道具轉手因無法可靠對到目標角色，不改 heldProp（誠實留白，下一鏡由綁定講話）。
 */
export function deriveShotEndState(input: {
  currentStart: ShotContinuityState | null | undefined;
  authorizedChanges: readonly ScriptAuthorizedChange[];
  environment: Record<string, unknown> | null;
}): ShotContinuityState {
  const base: ShotContinuityState = {
    actors: (input.currentStart?.actors ?? []).map((actor) => ({ ...actor })),
    environment: input.currentStart?.environment ?? input.environment ?? null,
    transitionType: input.currentStart?.transitionType ?? null,
  };
  for (const change of input.authorizedChanges) {
    if (change.type === "got_wet") {
      for (const actor of base.actors) actor.wetness = "wet";
    } else if (change.type === "dried_off") {
      for (const actor of base.actors) actor.wetness = undefined;
    } else if (change.type === "injury") {
      for (const actor of base.actors) actor.injury = actor.injury ?? "injured";
    }
  }
  return base;
}

/**
 * 連戲斷裂 vs 腳本授權（§11 核心判準）。
 * 例：previousEnd 穿 look-A、這鏡綁 look-B——沒有 costume_change 授權＝continuity_costume_break；
 * 有授權＝合法換裝，不報 drift。
 */
export function classifyCostumeChange(input: {
  previousLookId: string | null;
  currentLookId: string | null;
  authorizedChanges: readonly ScriptAuthorizedChange[];
  transitionType: ShotTransitionType | null | undefined;
}): "no_change" | "script_authorized_change" | "unintentional_drift" {
  if (!input.previousLookId || !input.currentLookId) return "no_change";
  if (input.previousLookId === input.currentLookId) return "no_change";
  if (input.transitionType === "time_jump" || input.transitionType === "montage") {
    return "script_authorized_change";
  }
  if (input.authorizedChanges.some((change) => change.type === "costume_change")) {
    return "script_authorized_change";
  }
  return "unintentional_drift";
}
