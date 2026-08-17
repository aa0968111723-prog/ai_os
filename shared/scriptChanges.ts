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
  /**
   * closure §9：道具轉手的結構化解析結果（可選——只有 prop_transfer／prop_loss 用）。
   * resolved=true 才能改 heldProp state；解析不到＝unresolved，不准猜，
   * 交由確認流程（更新道具持有者卡片）解決。
   */
  propId?: string | null;
  fromCharacterId?: string | null;
  toCharacterId?: string | null;
  resolved?: boolean;
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

/**
 * closure §9：把 prop_transfer／prop_loss 的 excerpt 解析成結構化轉手。
 *
 * 保守規則（不准猜）：
 * - 在「整句」（excerpt 前後擴到句界）裡找道具名與角色名的唯一匹配
 * - prop_transfer 需要恰好一個道具＋恰好一個「接收者」（動詞後出現的角色）；
 *   給予者（動詞前出現的角色）可有可無
 * - 任何歧義（0 或 >1 匹配）＝unresolved——由確認流程處理，不改 state
 */
export function resolvePropTransfers(input: {
  changes: readonly ScriptAuthorizedChange[];
  /** 完整 shot 文字（excerpt 只有動詞後 16 字，接收者常在動詞前——要整句才判得到給予者） */
  shotText: string;
  characters: ReadonlyArray<{ id: string; name: string }>;
  props: ReadonlyArray<{ id: string; name: string }>;
}): ScriptAuthorizedChange[] {
  return input.changes.map((change) => {
    if (change.type !== "prop_transfer" && change.type !== "prop_loss") return change;
    // 找含這個 excerpt 的整句（句號／分號／換行為界）
    const at = input.shotText.indexOf(change.excerpt);
    if (at < 0) return { ...change, resolved: false };
    const start = Math.max(
      ...["。", "；", ";", "\n"].map((sep) => input.shotText.lastIndexOf(sep, at)),
      -1,
    ) + 1;
    const endCandidates = ["。", "；", ";", "\n"]
      .map((sep) => input.shotText.indexOf(sep, at))
      .filter((idx) => idx >= 0);
    const end = endCandidates.length ? Math.min(...endCandidates) : input.shotText.length;
    const sentence = input.shotText.slice(start, end);
    const verbAt = sentence.indexOf(change.excerpt);

    const propsInSentence = input.props.filter((prop) => prop.name && sentence.includes(prop.name));
    if (propsInSentence.length !== 1) return { ...change, resolved: false };
    const prop = propsInSentence[0]!;

    if (change.type === "prop_loss") {
      // 弄丟／遺失：道具唯一即可解析（沒有接收者）
      return { ...change, propId: prop.id, toCharacterId: null, resolved: true };
    }

    const before = sentence.slice(0, verbAt);
    const after = sentence.slice(verbAt);
    // 動詞方向：交給／遞給／送給＝動詞後是接收者；接過／搶走＝動詞前（主詞）才是接收者
    const inverted = change.excerpt.startsWith("接過") || change.excerpt.startsWith("搶走");
    const beforeChars = input.characters.filter((row) => row.name && before.includes(row.name));
    const afterChars = input.characters.filter((row) =>
      row.name && after.includes(row.name) && !beforeChars.some((g) => g.id === row.id));
    const receivers = inverted ? beforeChars : afterChars;
    const givers = inverted ? afterChars : beforeChars;
    if (receivers.length !== 1) return { ...change, resolved: false };
    return {
      ...change,
      propId: prop.id,
      fromCharacterId: givers.length === 1 ? givers[0]!.id : null,
      toCharacterId: receivers[0]!.id,
      resolved: true,
    };
  });
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
 * Adopt 當下抽出 end-state（§11＋closure §9）：start-state ＋ 腳本授權的改變 ＝
 * 這一鏡結束時的狀態。保守規則：淋濕套用到在場全員（雨是環境事件）；擦乾解除；
 * 受傷標記；道具轉手只在「結構化解析成功（resolved）」時改 heldProp——
 * 未解析的轉手誠實留白，交確認流程，不准猜。
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
    } else if (change.type === "prop_transfer" && change.resolved && change.propId && change.toCharacterId) {
      // 藏寶圖 A 交給 B：B 開始持有；任何原持有者放手
      for (const actor of base.actors) {
        if (actor.heldPropId === change.propId) actor.heldPropId = null;
      }
      const recipient = base.actors.find((actor) => actor.characterId === change.toCharacterId);
      if (recipient) recipient.heldPropId = change.propId;
    } else if (change.type === "prop_loss" && change.resolved && change.propId) {
      for (const actor of base.actors) {
        if (actor.heldPropId === change.propId) actor.heldPropId = null;
      }
    }
  }
  return base;
}

/** closure §9：未解析的道具轉手（要進確認流程的 structured unresolved state） */
export function unresolvedPropTransfers(
  changes: readonly ScriptAuthorizedChange[],
): ScriptAuthorizedChange[] {
  return changes.filter(
    (change) => (change.type === "prop_transfer" || change.type === "prop_loss") && change.resolved === false,
  );
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
