import { CARD_ANCHOR_MARKERS, WORLDVIEW_INJECT_MARKER } from "./worldview";

/**
 * 組裝後提示詞的段落切分（單一真相來源）。
 *
 * 正向提示詞是分段疊出來的（generationCore 的 buildPositive → withCharacterAnchor
 * → withSceneAnchor → withPropAnchor）。前端圖解要拆它、消融實測也要拆它，
 * 兩邊各寫一份遲早漂移——所以切分只有這一份，放在 shared 給前後端共用。
 *
 * 段落標記本身取自 `shared/worldview`（伺服器組裝用的是同一份常數）。
 */

export type PromptSectionKey = "background" | "character" | "scene" | "prop";

export interface PromptSectionDef {
  key: PromptSectionKey;
  marker: string;
  /** 給人看的段落名 */
  title: string;
  /** 這一段在流程裡負責什麼 */
  role: string;
  /** 一句話說明這段從哪來、鎖住什麼 */
  hint: string;
}

export const PROMPT_SECTIONS: readonly PromptSectionDef[] = [
  {
    key: "background",
    marker: WORLDVIEW_INJECT_MARKER,
    title: "專案背景",
    role: "自動帶入",
    hint: "專案世界觀的調性、風格與核心訊息，每次生成都會自動接上。",
  },
  {
    key: "character",
    marker: CARD_ANCHOR_MARKERS[0],
    title: "角色定裝",
    role: "外觀鎖定",
    hint: "角色卡的外觀錨點，讓同一個人跨鏡頭不變樣。",
  },
  {
    key: "scene",
    marker: CARD_ANCHOR_MARKERS[1],
    title: "場景設定",
    role: "光影鎖定",
    hint: "場景卡的色板與光線，維持同一場景的光影一致。",
  },
  {
    key: "prop",
    marker: CARD_ANCHOR_MARKERS[2],
    title: "素材設定",
    role: "材質鎖定",
    hint: "素材卡的外觀材質，讓同一件道具跨鏡頭不變樣。",
  },
];

export interface PromptSection {
  def: PromptSectionDef;
  /** 段落內容（不含標記） */
  text: string;
  /** 段落原文（含標記）——算 token 與消融時要用真正送出的那串 */
  raw: string;
  /** 在原字串裡的起訖（消融要據此原樣挖掉） */
  start: number;
  end: number;
}

export interface SplitPrompt {
  /** 第一個段落標記之前的部分＝使用者自己打的指令 */
  head: string;
  /** 依**實際出現順序**排列，不照前端假設 */
  sections: PromptSection[];
}

export function splitPromptSections(positivePrompt: string): SplitPrompt {
  const prompt = positivePrompt ?? "";
  const hits = PROMPT_SECTIONS.map((def) => ({ def, index: prompt.indexOf(def.marker) }))
    .filter((hit) => hit.index >= 0)
    .sort((a, b) => a.index - b.index);

  const head = (hits.length ? prompt.slice(0, hits[0].index) : prompt).trim();
  const sections = hits.flatMap((hit, index) => {
    const end = index + 1 < hits.length ? hits[index + 1].index : prompt.length;
    const text = prompt.slice(hit.index + hit.def.marker.length, end).trim();
    if (!text) return [];
    return [{ def: hit.def, text, raw: prompt.slice(hit.index, end).trim(), start: hit.index, end }];
  });
  return { head, sections };
}
