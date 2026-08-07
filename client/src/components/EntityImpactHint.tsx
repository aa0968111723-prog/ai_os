/**
 * 雙向影響提示（PE 計畫 §23）：改一張卡之前，先講清楚它牽動哪些鏡、哪些畫面會過時。
 *
 * 為什麼要有這一行：紅傘改成黃傘之後，引用它的鏡與**已經生成好的畫面**會靜默變成
 * 「描述與成品不一致」——使用者通常要到成片才發現傘還是紅的。這裡把後果先攤開，
 * 但**不自動重生成**：重生成要花點數，那是使用者的決定。
 */
import { trpc } from "../api";
import { Hint } from "./ui";
import { Icon } from "./Icon";

export type ImpactKind = "character" | "location" | "prop" | "look";

export interface EntityImpact {
  shots: number;
  shotsWithVisual: number;
  generations: number;
  sampleTitles: string[];
}

/**
 * 影響提示句（純函式，方便窮舉測）。回 null＝沒有鏡在用這張卡，不必占版面。
 * 刻意不講「會自動更新」——不會，而且重生成要花點數，必須由使用者決定。
 */
export function impactSentence(data: EntityImpact | undefined | null): string | null {
  if (!data || data.shots <= 0) return null;
  const sample = data.sampleTitles.map((t) => t.trim()).filter(Boolean).slice(0, 3);
  const parts = [`這張卡有 ${data.shots} 個分鏡在用`];
  if (data.shotsWithVisual > 0) parts.push(`，其中 ${data.shotsWithVisual} 鏡已經有畫面`);
  parts.push("。");
  if (sample.length) parts.push(`（例如：${sample.join("、")}${data.shots > sample.length ? "…" : ""}）`);
  if (data.shotsWithVisual > 0) parts.push(" 改完不會自動重畫，要更新畫面請到分鏡逐鏡重新生成。");
  return parts.join("");
}

export function EntityImpactHint({
  projectId,
  kind,
  entityId,
}: {
  projectId: string;
  kind: ImpactKind;
  entityId: string;
}) {
  // 只在編輯中掛載，所以進來就查一次；30 秒內重開同一張卡不重打
  const impact = trpc.story.entityImpact.useQuery({ projectId, kind, entityId }, { staleTime: 30_000 });
  // 還沒被任何鏡引用＝改了不影響誰，不必占版面（載入中同理，不閃一行灰字）
  const sentence = impactSentence(impact.data);
  if (!sentence) return null;

  return (
    <Hint as="div" style={{ marginTop: "var(--sp-4)" }}>
      <Icon name="Info" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
      {sentence}
    </Hint>
  );
}
