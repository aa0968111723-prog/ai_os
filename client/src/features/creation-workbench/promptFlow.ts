import type { AiWarning } from "@shared/aiTrace";
import { CARD_ANCHOR_MARKERS, WORLDVIEW_INJECT_MARKER } from "@shared/worldview";

/**
 * 「AI 會怎麼理解？」的提示詞圖解資料層。
 *
 * 送出的正向提示詞其實是**分段疊出來的**：使用者指令 → [專案背景] → [角色定裝]
 * → [場景設定] → [素材設定]（順序見 generationCore 的 buildPositive／withXxxAnchor）。
 * 但攤成一整塊純文字之後，那個結構就消失了——使用者在手機上看到的是一牆字，
 * 無從判斷「哪一段是我打的、哪一段是系統自動接上的、哪一段鎖住了什麼」。
 *
 * 這裡把同一份字串拆回它本來的結構，讓 UI 能畫成流程圖。
 * 段落標記直接吃 shared/worldview 的常數（伺服器組裝用的是同一份），
 * 前端不自己再寫一次字串——否則兩邊遲早漂移，圖解就會騙人。
 */

export type PromptFlowNodeKey =
  | "instruction"
  | "background"
  | "character"
  | "scene"
  | "prop"
  | "negative"
  | "model";

export interface PromptFlowField {
  /** 欄位名（例：調性、視覺風格、安捷）。拆不出名稱時不給，整段當內容。 */
  label?: string;
  value: string;
}

export interface PromptFlowNode {
  key: PromptFlowNodeKey;
  /** 節點標題（＝提示詞裡的段落名） */
  title: string;
  /** 這一段在整條組裝流程裡負責什麼 */
  role: string;
  /** 一句話說明這段從哪來、鎖住什麼 */
  hint: string;
  /** 拆出來的欄位；拆不出時為空陣列，改看 text */
  fields: PromptFlowField[];
  /** 段落原文（欄位拆不出來時的回退，也供「原文」檢視比對） */
  text: string;
}

interface SectionDef {
  key: Extract<PromptFlowNodeKey, "background" | "character" | "scene" | "prop">;
  marker: string;
  title: string;
  role: string;
  hint: string;
}

/** 段落定義。marker 一律取自 shared，不在前端重寫字串。 */
const SECTIONS: readonly SectionDef[] = [
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

/** 段落內的項目分隔：世界觀用 `|`、定裝卡列表用 `；` */
const ENTRY_SEPARATOR = /[|｜；]/;
/** 卡片錨點的動詞前綴（節點副標已經寫了「外觀鎖定」，欄位裡不必再重複一次） */
const LOCK_PREFIX = /^(?:外觀鎖定|光影鎖定|材質鎖定)\s*/;
/**
 * 欄位名：冒號前 12 字以內、且不含句讀。
 * 沒有長度與句讀限制的話，「故事錨點:一位訪客…，把心交還給平靜。」這種長句
 * 只要句中再出現一個冒號，就會把半句話當成欄位名。
 */
const FIELD_PATTERN = /^([^:：。，、！？\n]{1,12})[:：]\s*([\s\S]+)$/;

/** 把一個段落拆成欄位；拆不出名稱的項目保留原文當內容。 */
export function parsePromptFields(text: string): PromptFlowField[] {
  return text
    .split(ENTRY_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const body = entry.replace(LOCK_PREFIX, "").trim();
      const match = body.match(FIELD_PATTERN);
      return match ? { label: match[1].trim(), value: match[2].trim() } : { value: body };
    })
    .filter((field) => field.value.length > 0);
}

/**
 * 正向提示詞 → 流程節點。
 * 第一個節點永遠是使用者自己打的指令（段落標記之前的部分）；
 * 之後依標記在字串裡的實際出現順序排列——順序照實反映伺服器疊加的結果，
 * 不照前端自己的假設。
 */
export function buildPromptFlow(positivePrompt: string): PromptFlowNode[] {
  const prompt = positivePrompt ?? "";
  const hits = SECTIONS.map((section) => ({ section, index: prompt.indexOf(section.marker) }))
    .filter((hit) => hit.index >= 0)
    .sort((a, b) => a.index - b.index);

  const head = (hits.length ? prompt.slice(0, hits[0].index) : prompt).trim();
  const nodes: PromptFlowNode[] = [];
  if (head) {
    nodes.push({
      key: "instruction",
      title: "你的指令",
      role: "這次要做什麼",
      hint: "你在創作台輸入的內容，是整段提示詞的起點。",
      fields: [],
      text: head,
    });
  }

  hits.forEach((hit, index) => {
    const start = hit.index + hit.section.marker.length;
    const end = index + 1 < hits.length ? hits[index + 1].index : prompt.length;
    const text = prompt.slice(start, end).trim();
    if (!text) return;
    nodes.push({
      key: hit.section.key,
      title: hit.section.title,
      role: hit.section.role,
      hint: hit.section.hint,
      fields: parsePromptFields(text),
      text,
    });
  });

  return nodes;
}

/**
 * 中日韓文字與全形標點約佔兩個半形字寬。欄位要不要佔滿整列得看**視覺寬度**而非字數：
 * 「療癒(soothing, healing)」只有 21 字元卻比 22 字元的中文句子還寬，
 * 純數字元會把它塞進半欄，於是折成三行、旁邊空一格。
 */
const FULL_WIDTH = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︐-﹯＀-｠￠-￦]/;

/** 以半形字為單位的概略視覺寬度（全形 1、半形 0.5，回傳等同「全形字數」） */
export function visualWidth(text: string): number {
  let width = 0;
  for (const char of text) width += FULL_WIDTH.test(char) ? 1 : 0.5;
  return width;
}

/** 負向提示詞是逗號／頓號串起來的禁忌清單，拆開才看得出「擋掉了哪幾項」。 */
export function parseNegativeItems(negativePrompt: string): string[] {
  return (negativePrompt ?? "")
    .split(/[,，、；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 警告 → 它真正在講的那個節點。
 * 攤在最上方時，使用者得自己把「卡片參考圖沒有直接送給模型」對回下面哪一段；
 * 掛到節點上就不用對——警告出現在它描述的那張卡旁邊。
 * code 取自 generationCore 的 prepare 警告表。
 */
const WARNING_NODE: Record<string, PromptFlowNodeKey> = {
  cards_ignored: "character",
  card_images_not_sent: "character",
  continuity_text_only: "character",
  continuity_partial_references: "character",
  continuity_ambiguous_names: "character",
  multi_reference_unsupported: "character",
  continuity_references_capped: "character",
  negative_prompt_unsupported: "negative",
  manual_override: "instruction",
};

export interface DistributedWarnings {
  /** 掛到節點上的警告（節點不存在時不會硬掛，改留在 general） */
  byNode: Partial<Record<PromptFlowNodeKey, AiWarning[]>>;
  /** 沒有對應節點的警告，仍要完整顯示 */
  general: AiWarning[];
}

export function distributePromptWarnings(
  warnings: readonly AiWarning[],
  presentKeys: ReadonlySet<PromptFlowNodeKey>,
): DistributedWarnings {
  const byNode: Partial<Record<PromptFlowNodeKey, AiWarning[]>> = {};
  const general: AiWarning[] = [];
  for (const warning of warnings) {
    const target = WARNING_NODE[warning.code];
    if (target && presentKeys.has(target)) {
      (byNode[target] ??= []).push(warning);
    } else {
      general.push(warning);
    }
  }
  return { byNode, general };
}
