import type { CreationDraft, CreationMode } from "./creationDraft";

/**
 * 「本次 AI 會讀到什麼」——四個模式的上下文語意，單一真相來源。
 *
 * 為什麼需要這支：同一份資料在四條送出路徑有四種行為，而畫面上從來沒說過，
 * 使用者的體感是「有時候有用、有時候沒用」（實測回報「不知道該如何使用在專案上」）。
 * 最傷的一條是：直接出圖與套範本**完全不讀**知識庫與資料表——很多人把逐字稿
 * 貼進專案依據，然後在直接出圖模式按生成，結果 AI 根本沒看到。
 *
 * 各模式的依據（實作出處）：
 * - generate：server/routers/generation.ts 組 context 時只取世界觀＋角色／場景／道具卡＋來源圖
 * - template：server/routers/workflows.ts 同級（套範本走同一條生成路徑）
 * - ask：server/routers/assistant.ts 自動注入知識庫，並給資料表速查表讓模型自行 query_database
 * - plan：server/services/agentCore.ts 注入可寫資料表的欄位定義＋你指定的知識來源
 *
 * 若哪天後端改了帶入規則，改這裡一處、測試會告訴你哪些描述要跟著動。
 */
export type AiContextLine = {
  /** 這次真的會被讀到的 */
  included: string[];
  /** 明確不會被讀到的——只列「使用者可能以為會被讀到」的那些，不列無關項 */
  excluded: string[];
};

export function aiContextForMode(mode: CreationMode, draft: Pick<CreationDraft,
  "characterIds" | "scenePresetIds" | "propIds" | "knowledgeIds" | "sourceAssetIds">): AiContextLine {
  const cards: string[] = [];
  if (draft.characterIds.length) cards.push(`角色 ${draft.characterIds.length}`);
  if (draft.scenePresetIds.length) cards.push(`場景 ${draft.scenePresetIds.length}`);
  if (draft.propIds.length) cards.push(`素材設定 ${draft.propIds.length}`);

  switch (mode) {
    case "generate":
    case "template": {
      const included = ["世界觀", ...cards];
      if (draft.sourceAssetIds.length) included.push("來源圖");
      // 這兩個模式是全站最容易誤會的：人把資料放進專案依據／資料表，
      // 然後在這裡按生成，卻沒有任何東西告訴他那些不會被讀到。
      return { included, excluded: ["專案依據", "團隊資料表"] };
    }
    case "ask": {
      const included = ["世界觀", ...cards, "專案依據"];
      if (draft.knowledgeIds.length) {
        included[included.length - 1] = `專案依據（優先 ${draft.knowledgeIds.length} 篇）`;
      }
      included.push("團隊資料表");
      return { included, excluded: [] };
    }
    case "plan": {
      const included = ["世界觀", ...cards];
      included.push(draft.knowledgeIds.length
        ? `指定的專案依據 ${draft.knowledgeIds.length} 篇`
        : "專案依據（未指定則不帶）");
      included.push("團隊資料表（可寫入）");
      return { included, excluded: [] };
    }
  }
}

/** 一行文字版本（給窄螢幕與 aria-label 用） */
export function aiContextSentence(line: AiContextLine): string {
  const head = `本次 AI 會讀到：${line.included.join("・")}`;
  return line.excluded.length ? `${head}。不含${line.excluded.join("與")}` : head;
}
