import type { StoryInlineSectionId } from "./storyInlineNav";

export type FeedbackKind =
  | "character"
  | "costume"
  | "scene"
  | "camera"
  | "motion"
  | "audio"
  | "story"
  | "delivery";

export type FeedbackDiagnosis = {
  kind: FeedbackKind;
  label: string;
  section: StoryInlineSectionId | "story";
  proposal: string;
};

const RULES: Array<{ kind: FeedbackKind; needles: string[]; label: string; section: FeedbackDiagnosis["section"]; proposal: string }> = [
  {
    kind: "character",
    needles: ["人物不像", "長得不一樣", "角色不像", "臉不對", "不是同一個人"],
    label: "人物不像",
    section: "characters",
    proposal: "可能是角色身份或參考圖。打開角色區核對外觀後，只重生成引用該角色的鏡頭。",
  },
  {
    kind: "costume",
    needles: ["服裝", "造型", "衣服", "不一致", "穿錯"],
    label: "服裝不一致",
    section: "looks",
    proposal: "可能是 Character Look。先看影響範圍，Apply 後只標記引用該造型的鏡頭過時。",
  },
  {
    kind: "scene",
    needles: ["場景錯誤", "地點", "天氣", "光線", "時段", "海灘", "不像"],
    label: "場景錯誤",
    section: "scenes",
    proposal: "可能是地點或環境狀態。列出引用該場景的鏡頭，不自動重做整部影片。",
  },
  {
    kind: "camera",
    needles: ["運鏡", "構圖", "鏡頭", "秒數", "太近", "太遠"],
    label: "運鏡不對",
    section: "storyboard",
    proposal: "這是單一 Shot 的鏡頭語言。只打開該鏡，不重做其他場。",
  },
  {
    kind: "motion",
    needles: ["動作僵硬", "動作", "口型", "動態", "走位"],
    label: "動作僵硬",
    section: "production",
    proposal: "這是製作輸出。只重生成該鏡的畫面或影片軌。",
  },
  {
    kind: "audio",
    needles: ["配音", "音效", "旁白", "聲音", "聽起來"],
    label: "配音或音效不佳",
    section: "production",
    proposal: "只重做該鏡的配音或音效軌，不重畫畫面。",
  },
  {
    kind: "story",
    needles: ["節奏", "順序", "故事不對", "場次"],
    label: "整體節奏或順序",
    section: "storyboard",
    proposal: "先回到故事或分鏡順序。未影響既有 Shot 時不使全部產物失效。",
  },
  {
    kind: "delivery",
    needles: ["下載", "分享", "素材包", "匯出", "交付"],
    label: "下載或分享",
    section: "delivery",
    proposal: "打開交付區使用既有匯出、素材包、LumaFusion 與分享。",
  },
];

export const FEEDBACK_PRESETS: FeedbackKind[] = [
  "character",
  "costume",
  "scene",
  "camera",
  "motion",
  "audio",
];

export function diagnoseFeedback(text: string): FeedbackDiagnosis[] {
  const raw = text.trim();
  if (!raw) return [];
  const hits: FeedbackDiagnosis[] = [];
  for (const rule of RULES) {
    if (rule.needles.some((n) => raw.includes(n))) {
      hits.push({
        kind: rule.kind,
        label: rule.label,
        section: rule.section,
        proposal: rule.proposal,
      });
    }
  }
  return hits;
}

export function presetOf(kind: FeedbackKind): FeedbackDiagnosis {
  const rule = RULES.find((r) => r.kind === kind)!;
  return { kind: rule.kind, label: rule.label, section: rule.section, proposal: rule.proposal };
}
