import { splitPromptSections, type PromptSectionKey } from "./promptSections";

/**
 * 消融偵測（leave-one-out 影響力實測）。
 *
 * hosted API 不回傳 attention，拿不到「模型多看重這一段」的內部權重。
 * 在拿不到內部權重時，量測影響力的標準做法是**消融**：固定其他條件，只拿掉一段
 * 重跑，比對輸出差多少——差得多＝這一段真的在起作用；幾乎沒差＝它其實沒發揮。
 *
 * 這是實測不是推論，但要成立有前提：兩次跑的隨機噪聲必須一樣（同 seed）。
 * seed 固定不了的模型，差異裡混著噪聲，只能當參考——那個限制必須誠實講，
 * 不能讓使用者拿噪聲當結論去刪設定。
 */

export interface AblationVariant {
  /** 這一輪拿掉的段落 */
  section: PromptSectionKey;
  title: string;
  /** 拿掉該段後的完整正向提示詞（其餘原樣保留） */
  prompt: string;
}

/**
 * 產生 leave-one-out 變體：每個段落各一輪，只挖掉那一段，其餘逐字不動。
 * 挖掉的是含標記的整段（模型收到的那串），不是只挖內容。
 */
export function buildAblationVariants(positivePrompt: string): AblationVariant[] {
  const { sections } = splitPromptSections(positivePrompt);
  return sections.map((section) => {
    const before = positivePrompt.slice(0, section.start);
    const after = positivePrompt.slice(section.end);
    return {
      section: section.def.key,
      title: section.def.title,
      // 挖掉整段後會留下多餘空行，收斂成一個段落間隔，避免變體多出格式差異
      prompt: `${before}${after}`.replace(/\n{3,}/g, "\n\n").trim(),
    };
  });
}

/** 一次實測要跑幾張：基準 1 張 + 每個被拿掉的段落各 1 張 */
export function ablationRunCount(sectionCount: number): number {
  return sectionCount > 0 ? sectionCount + 1 : 0;
}
