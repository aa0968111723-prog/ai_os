/**
 * Local 動畫組 fixture for the 淡江禪學社 小華 SHOTLIST.
 * Only 小華 + 禪定龜龜. Only the six SHOTLIST dialogue lines.
 * Visual lock comes from D:\淡大劇本 (this VM cannot read that disk).
 * No paid FAL.
 */

export const TKU_ZEN_PROMO_TITLE = "[LOCAL TEST] 淡江禪學社・小華";
export const TKU_ZEN_PROMO_STALE_TITLES = ["[LOCAL TEST] 淡江禪學社・小華 60s"] as const;
export const TKU_ZEN_PROMO_GROUP = "動畫組";
export const TKU_ZEN_PROMO_KIND = "療癒動畫";
export const TKU_ZEN_PROMO_PLATFORM = "shorts";
export const TKU_ZEN_FALLBACK_DURATION_SEC = 150;
export const TKU_ZEN_SHOT_DURATION_SEC = 25;

/** The only spoken lines allowed in this fixture. */
export const TKU_ZEN_SHOTLIST_LINES = [
  "我是大二化工系的小華。回想起大一的時光，說真的，有好多的不習慣。",
  "宇宙呀，我能怎麼做？怎麼才能真正認識自己呢？",
  "咦？你是誰？",
  "小華，我聽到你的困擾了。我是禪學社的禪定龜龜，我來拯救你了！",
  "真的嗎？帶我去！",
  "真的真的！",
] as const;

export const TKU_ZEN_FORBIDDEN = [
  "媽媽",
  "媽媽叫醒",
  "看手機",
  "彈起又躺下",
  "行李後滑",
  "早八",
  "抱頭",
  "宇宙祈禱",
  "龜龜掉下來撞床",
  "撞牆",
  "茶會字卡",
  "大一新生",
  "黑長直髮",
  "安倢",
  "慕恩",
] as const;

export const TKU_ZEN_PROMO_SCRIPT = `角色：小華（大二化工、白帽T、短髮）、禪定龜龜（吉祥物龜龜）
場景：克難坡（淡江實景）、宿舍晚上、禪學社
造型：小華＝白帽T、粉橘短髮

@小華：${TKU_ZEN_SHOTLIST_LINES[0]}

@小華：${TKU_ZEN_SHOTLIST_LINES[1]}

@小華：${TKU_ZEN_SHOTLIST_LINES[2]}

@禪定龜龜：${TKU_ZEN_SHOTLIST_LINES[3]}

@小華：${TKU_ZEN_SHOTLIST_LINES[4]}

@禪定龜龜：${TKU_ZEN_SHOTLIST_LINES[5]}
`;

/** User library root. Binaries live on the operator machine; this VM cannot read the disk. */
export const TKU_ZEN_LIBRARY_ROOT = String.raw`D:\淡大劇本`;

export const TKU_ZEN_LIBRARY = {
  xiaohua: {
    folder: String.raw`角色圖\粉橘短髮女孩`,
    files: [
      "pink_bob_girl_threeview_v01.png",
      "pink_bob_girl_expression_sheet_v01.png",
      "pink_bob_girl_action_sheet_v01.png",
    ],
  },
  turtle: { folder: String.raw`角色圖\吉祥物龜龜`, files: [] as string[] },
  slope: { folder: String.raw`場景\克難坡`, files: [] as string[] },
  photos: {
    folder: String.raw`場景`,
    files: ["茶會", "社課", "擺攤"],
  },
  boards: {
    folder: String.raw`素材`,
    files: [
      "A1-S01", "A1-S02", "A1-S03", "A1-S04", "A1-S05", "A1-S06",
      "A2-S01", "A2-S02", "A2-S03", "A2-S04", "A2-S05", "A2-S06",
      "A3-S01", "A3-S02", "A3-S03", "A3-S04", "A3-S05", "A3-S06",
      "A4-S01", "A4-S02", "A4-S03", "A4-S04", "A4-S05", "A4-S06",
      "master_cast_v02.png",
    ],
  },
  scripts: {
    folder: String.raw`各幕腳本`,
    files: ["第一幕", "第二幕", "第三幕", "第四幕"].flatMap((act) => [
      `${act} 成片稿`,
      `${act} 分鏡規劃`,
      `${act} 6格預覽`,
    ]),
  },
} as const;

export function tkuZenLibraryPath(...parts: string[]): string {
  return [TKU_ZEN_LIBRARY_ROOT, ...parts].join("\\");
}

export function tkuZenSpokenDialogue(raw: string): string {
  return raw.replace(/^@[^：:]+[：:]\s*/gm, "").trim();
}

export function tkuZenDialogueLines(shots: Array<{ dialogue: string }> = []): string[] {
  return shots.map((shot) => tkuZenSpokenDialogue(shot.dialogue)).filter(Boolean);
}

export const TKU_ZEN_CHARACTERS = [
  {
    key: "xiaohua",
    name: "小華",
    appearance: "大二化工、白帽T、短髮、粉橘短髮鮑伯、圓臉，視覺鎖定角色圖\\粉橘短髮女孩（三視圖／表情表／動作表）",
    notes: "Identity 鎖定粉橘短髮女孩：pink_bob_girl_threeview_v01.png、pink_bob_girl_expression_sheet_v01.png、pink_bob_girl_action_sheet_v01.png。",
    firstShot: 1,
    libraryFolder: TKU_ZEN_LIBRARY.xiaohua.folder,
  },
  {
    key: "turtle",
    name: "禪定龜龜",
    appearance: "吉祥物龜龜、淡定圓殼，視覺鎖定角色圖\\吉祥物龜龜",
    notes: "從第 3 句登場。定裝來源：角色圖\\吉祥物龜龜。",
    firstShot: 3,
    libraryFolder: TKU_ZEN_LIBRARY.turtle.folder,
  },
] as const;

export const TKU_ZEN_LOOKS = [
  {
    character: "xiaohua" as const,
    name: "三視圖",
    costume: "白帽T、粉橘短髮鮑伯",
    notes: tkuZenLibraryPath(TKU_ZEN_LIBRARY.xiaohua.folder, "pink_bob_girl_threeview_v01.png"),
  },
  {
    character: "xiaohua" as const,
    name: "表情表",
    costume: "白帽T、粉橘短髮鮑伯、同一張臉的表情變化",
    notes: tkuZenLibraryPath(TKU_ZEN_LIBRARY.xiaohua.folder, "pink_bob_girl_expression_sheet_v01.png"),
  },
  {
    character: "xiaohua" as const,
    name: "動作表",
    costume: "白帽T、粉橘短髮鮑伯、同一身體比例的動作",
    notes: tkuZenLibraryPath(TKU_ZEN_LIBRARY.xiaohua.folder, "pink_bob_girl_action_sheet_v01.png"),
  },
  {
    character: "turtle" as const,
    name: "吉祥物",
    costume: "吉祥物龜龜定裝",
    notes: tkuZenLibraryPath(TKU_ZEN_LIBRARY.turtle.folder),
  },
] as const;

export const TKU_ZEN_LOCATIONS = [
  { key: "slope", name: "克難坡", palette: "淡江克難坡實景、紅磚與綠蔭", lighting: "日間陽光", timeOfDay: "day" as const, libraryFolder: TKU_ZEN_LIBRARY.slope.folder },
  { key: "dorm_night", name: "宿舍晚上", palette: "桌燈暖光、天花板", lighting: "夜晚室內暖光", timeOfDay: "night" as const, libraryFolder: "" },
  { key: "club", name: "禪學社", palette: "紀實照片：茶會／社課／擺攤", lighting: "實拍現場光", timeOfDay: "neutral" as const, libraryFolder: TKU_ZEN_LIBRARY.photos.folder },
] as const;

export interface TkuZenShotSpec {
  index: number;
  title: string;
  durationSec: number;
  prompt: string;
  dialogue: string;
  speaker: "xiaohua" | "turtle";
  action: string;
  timeOfDay: "day" | "night" | "neutral";
  characters: Array<"xiaohua" | "turtle">;
  location: (typeof TKU_ZEN_LOCATIONS)[number]["key"];
  libraryHint?: string;
}

export const TKU_ZEN_SHOTS: TkuZenShotSpec[] = [
  {
    index: 1,
    title: "S01 小華自我介紹",
    durationSec: TKU_ZEN_SHOT_DURATION_SEC,
    prompt: "大二化工、白帽T、短髮的粉橘短髮女孩小華站在淡江克難坡。定裝：角色圖\\粉橘短髮女孩",
    dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[0]}`,
    speaker: "xiaohua",
    action: "小華面向鏡頭，回想大一的不習慣",
    timeOfDay: "day",
    characters: ["xiaohua"],
    location: "slope",
    libraryHint: String.raw`場景\克難坡｜角色圖\粉橘短髮女孩`,
  },
  {
    index: 2,
    title: "S02 問宇宙",
    durationSec: TKU_ZEN_SHOT_DURATION_SEC,
    prompt: "夜裡宿舍，白帽T短髮的粉橘短髮女孩小華抬頭",
    dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[1]}`,
    speaker: "xiaohua",
    action: "小華看向夜空／天花板",
    timeOfDay: "night",
    characters: ["xiaohua"],
    location: "dorm_night",
    libraryHint: String.raw`角色圖\粉橘短髮女孩`,
  },
  {
    index: 3,
    title: "S03 咦？你是誰？",
    durationSec: TKU_ZEN_SHOT_DURATION_SEC,
    prompt: "吉祥物龜龜出現在宿舍。白帽T短髮小華愣住",
    dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[2]}`,
    speaker: "xiaohua",
    action: "小華看見禪定龜龜",
    timeOfDay: "night",
    characters: ["xiaohua", "turtle"],
    location: "dorm_night",
    libraryHint: String.raw`角色圖\吉祥物龜龜`,
  },
  {
    index: 4,
    title: "S04 禪定龜龜自我介紹",
    durationSec: TKU_ZEN_SHOT_DURATION_SEC,
    prompt: "吉祥物龜龜面向白帽T短髮小華。不要另造一隻烏龜",
    dialogue: `@禪定龜龜：${TKU_ZEN_SHOTLIST_LINES[3]}`,
    speaker: "turtle",
    action: "禪定龜龜開口",
    timeOfDay: "night",
    characters: ["xiaohua", "turtle"],
    location: "dorm_night",
    libraryHint: String.raw`角色圖\吉祥物龜龜`,
  },
  {
    index: 5,
    title: "S05 真的嗎？帶我去！",
    durationSec: TKU_ZEN_SHOT_DURATION_SEC,
    prompt: "白帽T短髮小華跟上吉祥物龜龜，準備去禪學社",
    dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[4]}`,
    speaker: "xiaohua",
    action: "小華跟上龜龜",
    timeOfDay: "neutral",
    characters: ["xiaohua", "turtle"],
    location: "club",
    libraryHint: String.raw`場景\茶會｜社課｜擺攤`,
  },
  {
    index: 6,
    title: "S06 真的真的！",
    durationSec: TKU_ZEN_SHOT_DURATION_SEC,
    prompt: "吉祥物龜龜帶白帽T短髮小華走向禪學社。可疊場景\\茶會／社課／擺攤實拍",
    dialogue: `@禪定龜龜：${TKU_ZEN_SHOTLIST_LINES[5]}`,
    speaker: "turtle",
    action: "龜龜答應，兩人往禪學社去",
    timeOfDay: "neutral",
    characters: ["xiaohua", "turtle"],
    location: "club",
    libraryHint: String.raw`場景\茶會｜社課｜擺攤`,
  },
];

export function tkuZenLibraryMapContent(): string {
  const xiaohuaFiles = TKU_ZEN_LIBRARY.xiaohua.files
    .map((file) => `  - ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.xiaohua.folder, file)}`)
    .join("\n");
  const boards = TKU_ZEN_LIBRARY.boards.files
    .map((file) => `  - ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.boards.folder, file)}`)
    .join("\n");
  const scripts = TKU_ZEN_LIBRARY.scripts.files
    .map((file) => `  - ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.scripts.folder, file)}`)
    .join("\n");
  return [
    `本機素材庫（此 VM 讀不到磁碟，只鎖定路徑與身份，不呼叫付費 FAL）：${TKU_ZEN_LIBRARY_ROOT}`,
    "成片對白只准六句 SHOTLIST。素材板／各幕腳本是參考路徑，不是七幕結構。",
    "",
    "小華 visual lock = 大二化工、白帽T、短髮＝粉橘短髮女孩",
    xiaohuaFiles,
    "",
    `禪定龜龜 = ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.turtle.folder)}`,
    `克難坡 = ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.slope.folder)}`,
    "實拍：",
    ...TKU_ZEN_LIBRARY.photos.files.map((folder) => `  - ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.photos.folder, folder)}`),
    "",
    "素材\\（參考，不拆成 7 幕 20 鏡）：",
    boards,
    "",
    "各幕腳本\\（參考）：",
    scripts,
  ].join("\n");
}

export const TKU_ZEN_WORLDVIEW = {
  logline: "大二化工、白帽T、短髮的小華遇見禪學社的禪定龜龜。",
  message: "真正認識自己。",
  audience: "淡江大學同學",
  themes: ["自我認識", "禪學社"],
  tones: ["溫暖", "輕喜"],
  styles: ["2D 手繪動畫"],
  people: ["小華：大二化工、白帽T、短髮", "禪定龜龜：吉祥物龜龜"],
  taboos: ["不要寫進總會短影音／卉庭正式專案", "不要呼叫付費 FAL"],
};

export function tkuZenFixtureBlob(parts: string[] = []): string {
  return parts.join("\n");
}

export function tkuZenHasForbidden(text: string): string[] {
  return TKU_ZEN_FORBIDDEN.filter((token) => text.includes(token));
}
