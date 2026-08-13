/**
 * Aios 視覺方向提案（v4）。
 *
 * ## 這一層在做什麼
 *
 * 使用者選了一鏡之後，Aios 說「可以試這幾個視覺方向」，並給出三個看得懂的選項。
 * 提案的挑選是**純函式、零成本、可預測**：看這一鏡現在的鏡頭語言，排掉「你已經是這樣了」
 * 的方向，再依相關性排序。不打模型、不花點數、打開面板不會偷偷生成任何東西
 * （Context-aware Preview 的 Tier 1）。
 *
 * ## 為什麼提案不寫入任何東西
 *
 * 這支只回傳「建議看看這幾個方向」。它不呼叫 mutation、不接受 db handle、
 * 連 Promise 都不回——型別上就不可能寫入。真正改變 durable truth 的只有兩個動作：
 * 使用者按下「產生方向」（送出真實生成工作）或「採用」（移動 current 指標）。
 * Agent 可以引用同一份詞彙來說明它的建議，但它同樣沒有一條 silent apply 的路。
 *
 * ## 與既有 assistant 契約的關係
 *
 * StoryboardStage 已經用 registerAssistantFocus 公布了 entityId／selectedEntityIds；
 * assistantContext 的不變式是「只放指標、不放資料」，所以提案內容**不進 context**——
 * 它由這支純函式在需要時就地算出來，Agent 側要用同一份詞彙時也 import 這裡。
 */
import { CREATIVE_INTENTS, type CreativeIntent } from "./creativeDirectionPresets";
import {
  compileDirection,
  directionsAreDistinct,
  type CreativeDirection,
  type DirectionBaseShot,
} from "./creativeDirections";

export interface CreativeProposal {
  intentId: string;
  intentLabel: string;
  direction: CreativeDirection;
  /** 為什麼現在建議這個（給人看的一句話） */
  because: string;
}

/** 這一鏡有沒有畫面／有沒有調過鏡頭語言——提案措辭與排序都吃這兩件事 */
export interface ProposalShotState extends DirectionBaseShot {
  hasVisual?: boolean;
  /** 已通過審核的鏡不主動提案改動；要改請人自己來 */
  reviewStatus?: string | null;
}

function directionSetsAnything(direction: CreativeDirection): boolean {
  return !!(direction.camera || direction.performance || direction.action !== undefined || direction.instruction);
}

/**
 * 挑出對「這一鏡」真的有意義的方向。
 *
 * 排除規則刻意保守——只排掉**確定沒有意義**的：
 *  - 套用後與現況完全相同（differs=false）：使用者會付一次點數拿到同一張。
 *  - 與已挑選的提案結構化重複：三個提案要是三個做法。
 * 不做「猜使用者想要什麼」的排序魔法：提案要可預測，同一鏡每次打開看到的一樣。
 */
export function proposeCreativeDirections(
  shot: ProposalShotState,
  opts?: { limit?: number; intents?: readonly CreativeIntent[] },
): CreativeProposal[] {
  // 已通過的鏡不主動慫恿改動——那是團隊審過的畫面
  if (shot.reviewStatus === "approved") return [];

  const limit = opts?.limit ?? 3;
  const intents = opts?.intents ?? CREATIVE_INTENTS;
  const picked: CreativeProposal[] = [];
  const compiledPicked: ReturnType<typeof compileDirection>[] = [];

  // 一個意圖最多貢獻一個提案：三個提案全部來自「不夠有張力」等於只給了一個角度
  for (const intent of intents) {
    if (picked.length >= limit) break;
    for (const direction of intent.directions) {
      if (!directionSetsAnything(direction)) continue;
      const compiled = compileDirection(shot, direction);
      if (!compiled.differs) continue; // 這一鏡已經是這樣了
      if (compiledPicked.some((other) => !directionsAreDistinct(other, compiled))) continue;
      picked.push({
        intentId: intent.id,
        intentLabel: intent.label,
        direction,
        because: direction.rationale ?? `${intent.label}時常用的做法`,
      });
      compiledPicked.push(compiled);
      break;
    }
  }
  return picked;
}

/**
 * 提案的開場白。刻意講成「可以試」而不是「應該改」——
 * 這是選項不是診斷，畫面好不好是創作者說了算。
 */
export function proposalHeadline(shot: ProposalShotState, count: number): string {
  if (count === 0) return "";
  return shot.hasVisual
    ? `這一鏡已經有畫面了。想換個感覺的話，可以試這 ${count} 個方向：`
    : `還沒有畫面。可以先試這 ${count} 個方向，看哪一個比較接近你要的：`;
}
