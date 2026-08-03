import type { AiWarning } from "@shared/aiTrace";
import { splitPromptSections, type PromptSectionKey } from "@shared/promptSections";

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

export type PromptFlowNodeKey = "instruction" | PromptSectionKey | "negative" | "model";

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
  /**
   * 這一段在送出字串裡真正佔的原文，含段落標記本身。
   * 注意力預算要算的是**模型實際收到的字**，標記（「[專案背景] 」）也吃 token，
   * 用 text 會低估。
   */
  raw: string;
}

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
 * 之後依標記在字串裡的實際出現順序排列——切分本身由 shared/promptSections 負責，
 * 與伺服器組裝、消融實測共用同一份，前端不自己再切一次。
 */
export function buildPromptFlow(positivePrompt: string): PromptFlowNode[] {
  const { head, sections } = splitPromptSections(positivePrompt);
  const nodes: PromptFlowNode[] = [];
  if (head) {
    nodes.push({
      key: "instruction",
      title: "你的指令",
      role: "這次要做什麼",
      hint: "你在創作台輸入的內容，是整段提示詞的起點。",
      fields: [],
      text: head,
      raw: head,
    });
  }
  for (const section of sections) {
    nodes.push({
      key: section.def.key,
      title: section.def.title,
      role: section.def.role,
      hint: section.def.hint,
      fields: parsePromptFields(section.text),
      text: section.text,
      raw: section.raw,
    });
  }
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
  // 超窗口是整串的問題，不屬於任何單一段落：留在 general，節點上另有 token 徽章
  manual_override: "instruction",
  prompt_unknown_to_encoder: "instruction",
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
