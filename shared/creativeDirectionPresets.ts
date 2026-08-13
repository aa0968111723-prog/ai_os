/**
 * Creative Direction 起手包（v4 Tier 1：內建、零成本）。
 *
 * 使用者說得出口的是「這幕不夠有張力」，不是「shotSize=特寫, angle=低角度」。
 * 這份表把**創作意圖**對映成三個彼此真的不同的做法，讓「看不懂 prompt 的人」
 * 也能一眼分辨三個方向差在哪，而不是看到三張很像的圖。
 *
 * 設計約束（與 shared/creativeDirections.ts 的白名單一致）：
 * - 每個方向只動 Camera／Lighting／Action／Performance；角色、造型、場景、Style 一律 keep。
 * - 同一個 intent 底下的方向必須**彼此結構化不同**（由 creativeDirectionPresets.test.ts 鎖住），
 *   否則使用者會為「同一題抽三次卡」付三次點數。
 * - 預覽沿用既有的 starterPreviewFor 契約（路徑＋fallback），不需要 React 改動就能換圖。
 */
import { starterPreviewFor } from "./visualChoicePreviewManifest";
import type { VisualChoicePreview } from "./visualChoiceTypes";
import { CREATIVE_KEEP_FAMILIES, type CreativeDirection, type CreativeKeepFamily } from "./creativeDirections";

/** 全家族保持：起手包的預設姿態——方向是換做法，不是換角色 */
const KEEP_ALL: CreativeKeepFamily[] = [...CREATIVE_KEEP_FAMILIES];

/**
 * 創作意圖：使用者說得出口的那句話。
 * id 穩定不改名（會被寫進 generations 的 source meta，改名等於歷史對不上）。
 */
export interface CreativeIntent {
  id: string;
  /** 使用者會說的那句話 */
  label: string;
  /** 什麼時候選這個 */
  hint: string;
  directions: CreativeDirection[];
}

function withPreview(intentId: string, direction: CreativeDirection): CreativeDirection & { previewResource: VisualChoicePreview } {
  return {
    ...direction,
    previewResource: starterPreviewFor({
      id: `${intentId}.${direction.id}`,
      family: "camera",
      label: direction.label,
      description: direction.rationale,
    }),
  };
}

const RAW_INTENTS: CreativeIntent[] = [
  {
    id: "intent.tension",
    label: "不夠有張力",
    hint: "畫面平淡、看不出情緒重量時",
    directions: [
      {
        id: "closer",
        label: "更靠近人物",
        rationale: "把觀眾推到臉前，情緒直接看得到；背景維持不變",
        camera: { shotSize: "特寫", movement: "緩推", composition: "中心構圖，人物佔畫面主體" },
        performance: { emotion: "情緒外顯、克制中帶壓抑" },
        instruction: "人物 Look 與臉部特徵不要改，只把景別拉近、加強情緒張力。",
        keep: KEEP_ALL,
      },
      {
        id: "low-backlight",
        label: "低機位強逆光",
        rationale: "從下往上看＋逆光壓縮空間，人物變得有壓迫感",
        camera: { angle: "低角度", lighting: "強逆光，輪廓光明顯，環境壓暗", composition: "空間壓縮，前景邊緣入鏡" },
        instruction: "人物 Look 與臉不要改，背景壓暗，增加壓迫感。",
        keep: KEEP_ALL,
      },
      {
        id: "wide-isolate",
        label: "廣角孤立感",
        rationale: "把人物推到畫面邊緣，用大量留白說「他很孤單」",
        camera: { shotSize: "遠景", focalLength: "廣角", composition: "人物偏畫面邊緣，大面積留白" },
        performance: { gaze: "看向畫面外" },
        instruction: "維持同一個場景與造型，用構圖與比例製造孤立感，不要換地點。",
        keep: KEEP_ALL,
      },
    ],
  },
  {
    id: "intent.flat-light",
    label: "光線太平",
    hint: "畫面像打了均勻的日光燈、沒有層次時",
    directions: [
      {
        id: "side-key",
        label: "側光塑形",
        rationale: "一側亮一側暗，臉與空間立刻有立體感",
        camera: { lighting: "單側主光，明暗交界清楚，陰影保留細節" },
        instruction: "只改光線方向與對比，不要改時間地點與造型。",
        keep: KEEP_ALL,
      },
      {
        id: "practical-warm",
        label: "現場光暖調",
        rationale: "讓畫面裡本來就有的光源當主光，溫暖而可信",
        camera: { lighting: "以畫面內既有光源為主光，暖色調，周圍自然衰減" },
        instruction: "光源要看起來來自場景本身，不要變成攝影棚打光。",
        keep: KEEP_ALL,
      },
      {
        id: "silhouette",
        label: "剪影化",
        rationale: "只留輪廓，把注意力從細節推回到形狀與情緒",
        camera: { lighting: "強逆光剪影，主體幾乎全暗，背景亮", composition: "輪廓清楚不與背景交疊" },
        instruction: "人物特徵可以看不清楚，但姿態與位置要維持原本的敘事。",
        keep: KEEP_ALL,
      },
    ],
  },
  {
    id: "intent.static",
    label: "畫面太靜",
    hint: "分鏡看起來像定裝照、沒有動勢時",
    directions: [
      {
        id: "mid-action",
        label: "抓動作中段",
        rationale: "拍動作進行到一半的那一格，而不是擺好姿勢",
        action: "動作進行到一半的瞬間，重心偏移、衣角與髮絲仍在移動",
        performance: { emotion: "專注在正在做的事上" },
        instruction: "維持同一個人物與場景，只改成動作進行中的瞬間。",
        keep: KEEP_ALL,
      },
      {
        id: "foreground-layer",
        label: "增加前景",
        rationale: "前景遮擋製造深度，觀眾像是從某處望過去",
        camera: { composition: "前景有遮擋物入鏡，形成層次與偷看感", focalLength: "淺景深，前景失焦" },
        instruction: "前景元素要符合這個場景既有的陳設，不要憑空加入新道具。",
        keep: KEEP_ALL,
      },
      {
        id: "camera-move",
        label: "讓鏡頭動起來",
        rationale: "用運鏡帶出空間，而不是靠人物動",
        camera: { movement: "緩慢橫移", composition: "起幅收幅各有重點，空間關係隨移動揭露" },
        instruction: "人物可以幾乎不動，動勢來自鏡頭。",
        keep: KEEP_ALL,
      },
    ],
  },
  {
    id: "intent.unclear-subject",
    label: "看不出重點",
    hint: "畫面資訊很多、觀眾不知道該看哪裡時",
    directions: [
      {
        id: "isolate-subject",
        label: "把主體隔離出來",
        rationale: "壓掉背景資訊，只留一個該看的東西",
        camera: { focalLength: "長焦，背景大幅虛化", composition: "主體置於視覺中心，背景簡化" },
        instruction: "不要移動人物或改場景，只用景深與構圖收斂注意力。",
        keep: KEEP_ALL,
      },
      {
        id: "leading-lines",
        label: "用線條帶眼睛",
        rationale: "讓場景本來就有的線條把視線導向主體",
        camera: { composition: "利用場景既有線條引導視線至主體，三分法安置" },
        instruction: "只重新取景，不要新增場景元素。",
        keep: KEEP_ALL,
      },
      {
        id: "contrast-pop",
        label: "用明暗分出主次",
        rationale: "主體亮、周圍暗，重點自己跳出來",
        camera: { lighting: "主體受光明顯高於周圍，周圍向暗處衰減" },
        instruction: "維持原本的色調家族，只調整受光分布。",
        keep: KEEP_ALL,
      },
    ],
  },
];

export const CREATIVE_INTENTS: CreativeIntent[] = RAW_INTENTS.map((intent) => ({
  ...intent,
  directions: intent.directions.map((direction) => withPreview(intent.id, direction)),
}));

export function findCreativeIntent(id: string): CreativeIntent | undefined {
  return CREATIVE_INTENTS.find((intent) => intent.id === id);
}

/** 起手包裡所有方向的穩定 id（`<intentId>.<directionId>`）——寫進 source meta 用 */
export function starterDirectionKey(intentId: string, directionId: string): string {
  return `${intentId}.${directionId}`;
}

/**
 * 沒有指定意圖時的預設三方向：跨意圖各取一個彼此差最遠的做法。
 * 用在「使用者只按了產生變體、什麼都沒說」——仍然要給三個看得懂的不同方向，
 * 而不是退回成同一 prompt ×3。
 */
export function defaultCreativeDirections(): CreativeDirection[] {
  const tension = findCreativeIntent("intent.tension")!;
  return [
    tension.directions[0]!,
    tension.directions[1]!,
    tension.directions[2]!,
  ];
}
