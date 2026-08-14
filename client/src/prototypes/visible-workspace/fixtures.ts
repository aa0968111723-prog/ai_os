/**
 * PROTOTYPE ONLY — fixture data for the Visible Creative Workspace design study.
 *
 * 這裡的每一筆資料都是假的，**不得**接到 production truth，也不得被 production 匯入。
 * 它存在的唯一目的：讓我們第一次真正看見「新版 Aios 長什麼樣」。
 *
 * 欄位名刻意對齊 CURRENT/v4 的真實投影（scenes.listByProject / scenes.versions /
 * story.continuityCheck / agent run steps），這樣設計定案後，接線是「換資料來源」，
 * 不是「重寫畫面」。對照表見 docs/product/aios-visible-workspace-design.md §CURRENT 元件重用對照。
 */

export const PROTOTYPE_BANNER = "PROTOTYPE ONLY — 假資料，不連線、不扣點、不寫入任何 truth";

/* ── 假畫面：程序生成的 SVG frame ────────────────────────────────────────────
 * 不放 binary（本輪明確要求「不要塞幾百張 binary」）。用 SVG 讓每一格看起來
 * 真的像不同的鏡頭：不同光線、不同機位、不同構圖，而不是灰色方塊。 */

export interface FrameLook {
  /** 天空／背景漸層（上 → 下） */
  sky: [string, string];
  /** 地面／前景色 */
  ground: string;
  /** 主體剪影色 */
  subject: string;
  /** 主體水平位置 0–1（構圖：置中／偏邊） */
  subjectX: number;
  /** 主體高度佔畫面比例（鏡別：遠景小、特寫大） */
  subjectScale: number;
  /** 光暈中心 0–1；> 0.5 = 逆光在主體後方 */
  glowX: number;
  /** 前景遮擋強度 0–1 */
  foreground: number;
}

export function frameArt(look: FrameLook, seed = 0): string {
  const w = 1200;
  const h = 800;
  const cx = look.subjectX * w;
  const bodyH = look.subjectScale * h;
  const headR = bodyH * 0.16;
  const baseY = h * 0.82;
  const topY = baseY - bodyH;
  const glowCx = look.glowX * w;
  const fg = look.foreground;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="s${seed}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${look.sky[0]}"/><stop offset="1" stop-color="${look.sky[1]}"/>
</linearGradient>
<radialGradient id="g${seed}" cx="${(glowCx / w) * 100}%" cy="46%" r="55%">
<stop offset="0" stop-color="#fff" stop-opacity="${0.55 + fg * 0.2}"/>
<stop offset="1" stop-color="#fff" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#s${seed})"/>
<circle cx="${glowCx}" cy="${h * 0.46}" r="${h * 0.5}" fill="url(#g${seed})"/>
<path d="M0 ${baseY} Q ${w * 0.5} ${baseY - 40} ${w} ${baseY} L ${w} ${h} L 0 ${h} Z" fill="${look.ground}" opacity="0.92"/>
<g fill="${look.subject}" opacity="0.93">
<ellipse cx="${cx}" cy="${topY + headR}" rx="${headR * 0.82}" ry="${headR}"/>
<path d="M ${cx - bodyH * 0.17} ${baseY} L ${cx - bodyH * 0.13} ${topY + headR * 2.1} Q ${cx} ${topY + headR * 1.6} ${cx + bodyH * 0.13} ${topY + headR * 2.1} L ${cx + bodyH * 0.17} ${baseY} Z"/>
</g>
${fg > 0.05 ? `<path d="M0 ${h} L0 ${h * (0.62 - fg * 0.18)} Q ${w * 0.22} ${h * 0.78} ${w * 0.34} ${h} Z" fill="${look.ground}" opacity="${0.35 + fg * 0.5}"/>` : ""}
<rect width="${w}" height="${h}" fill="#000" opacity="${Math.max(0, fg - 0.35) * 0.25}"/>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const LOOK_CURRENT: FrameLook = {
  sky: ["#8fb6cf", "#e6d7bd"], ground: "#3c4a52", subject: "#243038",
  subjectX: 0.5, subjectScale: 0.42, glowX: 0.5, foreground: 0.05,
};
const LOOK_A: FrameLook = {
  sky: ["#c9a68d", "#f0dcc2"], ground: "#4a3a33", subject: "#2a2019",
  subjectX: 0.5, subjectScale: 0.66, glowX: 0.5, foreground: 0.08,
};
const LOOK_B: FrameLook = {
  sky: ["#2c3f5c", "#c98a4b"], ground: "#141c26", subject: "#0d1218",
  subjectX: 0.47, subjectScale: 0.58, glowX: 0.5, foreground: 0.42,
};
const LOOK_C: FrameLook = {
  sky: ["#a8c4d4", "#dfe7e4"], ground: "#5b6a68", subject: "#2f3a3c",
  subjectX: 0.79, subjectScale: 0.24, glowX: 0.28, foreground: 0.04,
};

/* ── Shot（對齊 scenes.listByProject 的投影欄位名） ───────────────────────── */

/** 對齊 shared/sceneVersions.ts 的 SceneVersionState 語彙 */
export type ShotState = "current" | "generating" | "awaiting_approval" | "failed" | "empty";

export interface PrototypeShot {
  id: string;
  /** 第幾鏡（畫面上給人看的號碼，非 DB 欄位） */
  no: number;
  title: string;
  /** 現用畫面（scenes.assetId → assets.url 的投影） */
  artUrl: string | null;
  state: ShotState;
  /** scenes.reviewStatus */
  reviewStatus: "draft" | "approved";
  /** 逐鏡完成度（真實可由 scenes 列推導，見設計文件 §Long Task） */
  hasImage: boolean;
  hasVideo: boolean;
  hasVoice: boolean;
  /** story.continuityCheck 的 outdated 投影 */
  outdatedReason?: string;
}

function shot(
  no: number,
  title: string,
  state: ShotState,
  extra: Partial<PrototypeShot> = {},
): PrototypeShot {
  const hasArt = state !== "empty";
  return {
    id: `shot-${String(no).padStart(2, "0")}`,
    no,
    title,
    artUrl: hasArt
      ? frameArt({ ...LOOK_CURRENT, subjectX: 0.34 + (no % 5) * 0.08, subjectScale: 0.3 + (no % 4) * 0.09, glowX: 0.3 + (no % 3) * 0.2 }, no)
      : null,
    state,
    reviewStatus: "draft",
    hasImage: hasArt,
    hasVideo: no <= 3,
    hasVoice: no <= 8,
    ...extra,
  };
}

export const SHOTS: PrototypeShot[] = [
  shot(1, "海面破曉", "current", { reviewStatus: "approved" }),
  shot(2, "民宿門口", "current", { reviewStatus: "approved" }),
  shot(3, "安倢推開門", "current"),
  shot(4, "行李落地", "current", { outdatedReason: "角色造型" }),
  shot(5, "窗邊坐下", "current"),
  shot(6, "遠方汽笛", "current"),
  shot(7, "回頭", "current"),
  shot(8, "看向海的側臉", "current"),
  shot(9, "手裡的信", "generating"),
  shot(10, "信紙特寫", "failed"),
  shot(11, "夜裡的燈", "awaiting_approval"),
  shot(12, "關燈", "empty"),
];

export const FOCUS_SHOT_NO = 8;

/* ── Creative Direction（呈現層契約；semantic schema 由主工程 v4 定義） ────── */

export interface PrototypeDirection {
  id: string;
  /** 一眼看懂的短標籤——不是三段說明 */
  label: string;
  /** 結構化改動的人話摘要（每項 ≤ 8 字） */
  changes: string[];
  /** 這次刻意「保持」的家族（Reference Lock 的呈現） */
  keep: string[];
  art: FrameLook;
}

export const DIRECTIONS: PrototypeDirection[] = [
  {
    id: "dir-a",
    label: "靠近人物",
    changes: ["特寫", "情緒更強"],
    keep: ["角色", "Look", "Scene"],
    art: LOOK_A,
  },
  {
    id: "dir-b",
    label: "低機位逆光",
    changes: ["低角度", "強逆光", "壓縮空間"],
    keep: ["角色", "Look", "Scene"],
    art: LOOK_B,
  },
  {
    id: "dir-c",
    label: "廣角留白",
    changes: ["廣角", "人物偏邊", "孤立感"],
    keep: ["角色", "Look", "Scene"],
    art: LOOK_C,
  },
];

/* ── 候選（對齊 shared/sceneVersions.ts 的投影，不是第二套 candidate store） ── */

export type CandidateState = "done" | "generating" | "failed" | "awaiting_approval";

export interface PrototypeCandidate {
  slot: "A" | "B" | "C";
  directionId: string;
  /** generations.id — 真實接線時用它對回 sceneVersions */
  generationId: string;
  assetUrl: string | null;
  state: CandidateState;
  /** 淨點數（pointsActual ?? pointsEst − pointsRefunded） */
  points: number | null;
  error?: string;
}

export const CANDIDATES: PrototypeCandidate[] = [
  { slot: "A", directionId: "dir-a", generationId: "gen-a", assetUrl: frameArt(LOOK_A, 101), state: "done", points: 12 },
  { slot: "B", directionId: "dir-b", generationId: "gen-b", assetUrl: frameArt(LOOK_B, 102), state: "done", points: 12 },
  { slot: "C", directionId: "dir-c", generationId: "gen-c", assetUrl: null, state: "generating", points: null },
];

export const CANDIDATES_PARTIAL: PrototypeCandidate[] = [
  { slot: "A", directionId: "dir-a", generationId: "gen-a", assetUrl: frameArt(LOOK_A, 101), state: "done", points: 12 },
  { slot: "B", directionId: "dir-b", generationId: "gen-b", assetUrl: null, state: "failed", points: 0, error: "供應商逾時，已退點" },
  { slot: "C", directionId: "dir-c", generationId: "gen-c", assetUrl: null, state: "awaiting_approval", points: null },
];

/* ── Aios 這次用到的參考（既有 continuity / 錨點層的投影） ────────────────── */

export interface PrototypeReference {
  kind: "character" | "look" | "scene";
  label: string;
  /** 是否已鎖定（Reference Lock） */
  locked: boolean;
}

export const REFERENCES: PrototypeReference[] = [
  { kind: "character", label: "安倢", locked: true },
  { kind: "look", label: "米白外套", locked: true },
  { kind: "scene", label: "海邊民宿", locked: true },
];

/* ── 長任務：一幕的進度（由 scenes 列推導，非新表） ───────────────────────── */

export interface PhaseProgress {
  phase: string;
  done: number;
  total: number;
  /** null = 這個階段還沒開始，不畫假進度 */
  started: boolean;
}

export const ACT_PROGRESS: PhaseProgress[] = [
  { phase: "分鏡", done: 12, total: 12, started: true },
  { phase: "畫面", done: 7, total: 12, started: true },
  { phase: "影片", done: 3, total: 12, started: true },
  { phase: "配音", done: 8, total: 12, started: true },
  { phase: "音效", done: 5, total: 12, started: true },
  { phase: "審核", done: 2, total: 12, started: true },
  { phase: "粗剪", done: 0, total: 1, started: false },
];

export const PROJECT_CRUMB = ["白日夢島", "第一幕", "Scene 3 海邊民宿"];

/** 情境切換：讓一個 route 就能看完所有關鍵畫面 */
export type Scenario = "shot" | "directions" | "generating" | "partial" | "act" | "idle";

export const SCENARIOS: Array<{ id: Scenario; label: string; hint: string }> = [
  { id: "shot", label: "選中一鏡", hint: "作品是主畫面，Aios 退到旁邊" },
  { id: "directions", label: "創作方向", hint: "三個看得懂、真的不同的方向" },
  { id: "generating", label: "候選生成中", hint: "候選直接出現在眼前" },
  { id: "partial", label: "部分失敗", hint: "成功／失敗／待核准分別顯示" },
  { id: "act", label: "整幕長任務", hint: "真實 filmstrip，不是長 log" },
  { id: "idle", label: "剛打開", hint: "第一眼就是作品，不是輸入框" },
];
