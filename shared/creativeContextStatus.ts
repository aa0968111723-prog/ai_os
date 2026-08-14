import { trainingActionAvailable } from "./consistencyTraining";

export interface CreativeContextCounts {
  characters: number;
  looks: number;
  scenes: number;
  props: number;
  assets: number;
  knowledge: number;
  pending: number;
}

export function compactContextStates(input: CreativeContextCounts & {
  applied: boolean;
  trainingAvailable: boolean;
}): string[] {
  const states: string[] = [];
  if (input.applied) states.push("已套用專案設定");
  if (input.pending > 0) states.push(`有 ${input.pending} 項需要確認`);
  if (input.trainingAvailable) states.push("可加強一致性");
  return states;
}

export function compactSourceSummary(input: CreativeContextCounts): string[] {
  const lines: string[] = [];
  if (input.characters) lines.push(`${input.characters} 位角色`);
  if (input.looks) lines.push(`${input.looks} 套造型`);
  if (input.scenes) lines.push(`${input.scenes} 個場景`);
  if (input.props) lines.push(`${input.props} 件道具`);
  if (input.assets) lines.push(`${input.assets} 項素材`);
  if (input.knowledge) lines.push(`${input.knowledge} 項知識引用`);
  return lines;
}

export function showConsistencyEnhance(input: {
  providerConfigured: boolean;
  paidAuthorized: boolean;
  includedAssets: number;
}): boolean {
  return trainingActionAvailable({
    providerConfigured: input.providerConfigured,
    paidAuthorized: input.paidAuthorized,
  }) && input.includedAssets >= 4;
}
