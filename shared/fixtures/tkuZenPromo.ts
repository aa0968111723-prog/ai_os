/**
 * Local 動畫組 fixture for the 淡江禪學社 小華 SHOTLIST.
 * Only 小華 + 禪定龜龜. Only the six SHOTLIST dialogue lines — no silent padding acts.
 * 小華 identity is the attached 粉橘短髮女孩 lock sheets. Look does not change.
 * 龜龜 is a separate mascot and first appears on the third spoken line. No paid FAL.
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

/** Costume lock from pink_bob_girl_threeview_v01.png. Script does not change this look. */
export const TKU_ZEN_XIAOHUA_COSTUME =
  "米白寬鬆V領針織外套（三顆棕色大扣）、淺綠／薄荷內搭、橘色百褶裙、駝色斜背包（紅色火焰小標）、白色中筒襪、白色低筒球鞋";

export const TKU_ZEN_XIAOHUA_IDENTITY =
  "大二化工、粉橘／桃色短鮑伯齊瀏海、棕色大眼、淺頰紅、纖瘦圓臉";

export const TKU_ZEN_XIAOHUA_SHEETS = {
  threeview: {
    file: "pink_bob_girl_threeview_v01.png",
    role: "costume-lock" as const,
    description:
      "三視圖定裝：正面／左側／背面同一粉橘短鮑伯。米白寬鬆V領針織外套、淺綠內搭、橘色百褶裙、駝色斜背包、白襪白球鞋。",
  },
  expression: {
    file: "pink_bob_girl_expression_sheet_v01.png",
    role: "expression" as const,
    description:
      "表情表（同一張臉同一套衣服）：平靜微笑、大笑、害羞、驚訝、擔心、認真、哭泣、鼓腮、疑惑歪頭、疲倦、滿足閉眼、慌張。",
  },
  action: {
    file: "pink_bob_girl_action_sheet_v01.png",
    role: "action" as const,
    description:
      "動作表（同一身體比例同一套衣服）：走、揮手、跑、坐長椅看書、蹲下撿東西、撐傘、發傳單、指向右上方。",
  },
} as const;

export const TKU_ZEN_XIAOHUA_APPEARANCE =
  `${TKU_ZEN_XIAOHUA_IDENTITY}。定裝：${TKU_ZEN_XIAOHUA_COSTUME}。視覺鎖定角色圖\\粉橘短髮女孩：${TKU_ZEN_XIAOHUA_SHEETS.threeview.file}、${TKU_ZEN_XIAOHUA_SHEETS.expression.file}、${TKU_ZEN_XIAOHUA_SHEETS.action.file}。腳本未換裝。`;

export const TKU_ZEN_PROMO_SCRIPT = `角色：小華（${TKU_ZEN_XIAOHUA_IDENTITY}）、禪定龜龜（吉祥物龜龜）
場景：克難坡（淡江實景）、宿舍晚上、禪學社
造型：小華＝${TKU_ZEN_XIAOHUA_COSTUME}

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
      TKU_ZEN_XIAOHUA_SHEETS.threeview.file,
      TKU_ZEN_XIAOHUA_SHEETS.expression.file,
      TKU_ZEN_XIAOHUA_SHEETS.action.file,
    ],
  },
  turtle: { folder: String.raw`角色圖\吉祥物龜龜`, files: [] as string[] },
  slope: { folder: String.raw`場景\克難坡`, files: [] as string[] },
  photos: {
    folder: String.raw`場景`,
    files: ["茶會", "社課", "擺攤"],
  },
  boards: {
    folder: String.raw`角色圖\粉橘短髮女孩`,
    files: [
      TKU_ZEN_XIAOHUA_SHEETS.threeview.file,
      TKU_ZEN_XIAOHUA_SHEETS.expression.file,
      TKU_ZEN_XIAOHUA_SHEETS.action.file,
    ],
  },
  scripts: {
    folder: String.raw`腳本`,
    files: ["SHOTLIST"],
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
    appearance: TKU_ZEN_XIAOHUA_APPEARANCE,
    notes: [
      TKU_ZEN_XIAOHUA_SHEETS.threeview.description,
      TKU_ZEN_XIAOHUA_SHEETS.expression.description,
      TKU_ZEN_XIAOHUA_SHEETS.action.description,
      `路徑：${tkuZenLibraryPath(TKU_ZEN_LIBRARY.xiaohua.folder)}`,
    ].join(" "),
    firstAct: 1,
    libraryFolder: TKU_ZEN_LIBRARY.xiaohua.folder,
  },
  {
    key: "turtle",
    name: "禪定龜龜",
    appearance: "吉祥物龜龜、淡定圓殼，視覺鎖定角色圖\\吉祥物龜龜。與小華分開的吉祥物，不是她的換裝。",
    notes: "第三句才登場。定裝來源：角色圖\\吉祥物龜龜。",
    firstAct: 3,
    libraryFolder: TKU_ZEN_LIBRARY.turtle.folder,
  },
] as const;

/** One costume look for 小華 — script does not change it. Expression/action sheets are the same look. */
export const TKU_ZEN_LOOKS = [
  {
    character: "xiaohua" as const,
    name: "定裝",
    costume: TKU_ZEN_XIAOHUA_COSTUME,
    sheet: "threeview" as const,
    notes: tkuZenLibraryPath(TKU_ZEN_LIBRARY.xiaohua.folder, TKU_ZEN_XIAOHUA_SHEETS.threeview.file),
  },
  {
    character: "turtle" as const,
    name: "吉祥物",
    costume: "吉祥物龜龜定裝",
    sheet: null,
    notes: tkuZenLibraryPath(TKU_ZEN_LIBRARY.turtle.folder),
  },
] as const;

export const TKU_ZEN_LOCATIONS = [
  { key: "slope", name: "克難坡", palette: "淡江克難坡實景、紅磚與綠蔭", lighting: "日間陽光", timeOfDay: "day" as const, libraryFolder: TKU_ZEN_LIBRARY.slope.folder },
  { key: "dorm_night", name: "宿舍晚上", palette: "桌燈暖光、天花板", lighting: "夜晚室內暖光", timeOfDay: "night" as const, libraryFolder: "" },
  { key: "club", name: "禪學社", palette: "紀實照片：茶會／社課／擺攤", lighting: "實拍現場光", timeOfDay: "neutral" as const, libraryFolder: TKU_ZEN_LIBRARY.photos.folder },
] as const;

export interface TkuZenShotSpec {
  act: number;
  index: number;
  title: string;
  durationSec: number;
  prompt: string;
  dialogue: string;
  speaker?: "xiaohua" | "turtle";
  action: string;
  timeOfDay: "day" | "night" | "neutral";
  characters: Array<"xiaohua" | "turtle">;
  location: (typeof TKU_ZEN_LOCATIONS)[number]["key"];
  libraryHint?: string;
}

export interface TkuZenActSpec {
  act: number;
  title: string;
  timeOfDay: "day" | "night" | "neutral";
  location: (typeof TKU_ZEN_LOCATIONS)[number]["key"];
  shots: TkuZenShotSpec[];
}

const LOCK = `粉橘短髮女孩定裝（${TKU_ZEN_XIAOHUA_COSTUME}）`;

/** Six spoken SHOTLIST beats. No silent 走上克難坡 / 茶會社課擺攤 / 收尾 padding. */
export const TKU_ZEN_ACTS: TkuZenActSpec[] = [
  {
    act: 1,
    title: "第一句 自我介紹",
    timeOfDay: "day",
    location: "slope",
    shots: [
      {
        act: 1, index: 1, title: "1 小華自我介紹", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `${LOCK}站在淡江克難坡正面。三視圖同一張臉。`,
        dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[0]}`,
        speaker: "xiaohua",
        action: "小華面向鏡頭，平靜微笑",
        timeOfDay: "day", characters: ["xiaohua"], location: "slope",
        libraryHint: String.raw`場景\克難坡｜pink_bob_girl_threeview_v01.png`,
      },
    ],
  },
  {
    act: 2,
    title: "第二句 問宇宙",
    timeOfDay: "night",
    location: "dorm_night",
    shots: [
      {
        act: 2, index: 2, title: "2 問宇宙", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `夜裡宿舍，${LOCK}抬頭。表情表：擔心／疑惑。`,
        dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[1]}`,
        speaker: "xiaohua",
        action: "小華看向夜空，眉心微皺",
        timeOfDay: "night", characters: ["xiaohua"], location: "dorm_night",
        libraryHint: "pink_bob_girl_expression_sheet_v01.png",
      },
    ],
  },
  {
    act: 3,
    title: "第三句 咦？你是誰？",
    timeOfDay: "night",
    location: "dorm_night",
    shots: [
      {
        act: 3, index: 3, title: "3 咦？你是誰？", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `吉祥物龜龜第一次出現。${LOCK}驚訝。表情表：驚訝。`,
        dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[2]}`,
        speaker: "xiaohua",
        action: "小華看見禪定龜龜，眼睛睜大",
        timeOfDay: "night", characters: ["xiaohua", "turtle"], location: "dorm_night",
        libraryHint: String.raw`角色圖\吉祥物龜龜`,
      },
    ],
  },
  {
    act: 4,
    title: "第四句 禪定龜龜",
    timeOfDay: "night",
    location: "dorm_night",
    shots: [
      {
        act: 4, index: 4, title: "4 禪定龜龜自我介紹", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `吉祥物龜龜面向${LOCK}。不要另造一隻烏龜，也不要改小華衣服。`,
        dialogue: `@禪定龜龜：${TKU_ZEN_SHOTLIST_LINES[3]}`,
        speaker: "turtle",
        action: "禪定龜龜開口",
        timeOfDay: "night", characters: ["xiaohua", "turtle"], location: "dorm_night",
        libraryHint: String.raw`角色圖\吉祥物龜龜`,
      },
    ],
  },
  {
    act: 5,
    title: "第五句 帶我去",
    timeOfDay: "neutral",
    location: "club",
    shots: [
      {
        act: 5, index: 5, title: "5 真的嗎？帶我去！", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `${LOCK}跟上吉祥物龜龜。動作表：走／跑。不換裝。`,
        dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[4]}`,
        speaker: "xiaohua",
        action: "小華跟上龜龜",
        timeOfDay: "neutral", characters: ["xiaohua", "turtle"], location: "club",
        libraryHint: String.raw`場景\茶會｜社課｜擺攤`,
      },
    ],
  },
  {
    act: 6,
    title: "第六句 真的真的",
    timeOfDay: "neutral",
    location: "club",
    shots: [
      {
        act: 6, index: 6, title: "6 真的真的！", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `吉祥物龜龜帶${LOCK}走向禪學社。`,
        dialogue: `@禪定龜龜：${TKU_ZEN_SHOTLIST_LINES[5]}`,
        speaker: "turtle",
        action: "龜龜答應",
        timeOfDay: "neutral", characters: ["xiaohua", "turtle"], location: "club",
        libraryHint: String.raw`場景\茶會｜社課｜擺攤`,
      },
    ],
  },
];

export const TKU_ZEN_SHOTS: TkuZenShotSpec[] = TKU_ZEN_ACTS.flatMap((act) => act.shots);

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
    `本機素材庫（此 VM 讀不到磁碟時只鎖定路徑與定裝描述，不呼叫付費 FAL）：${TKU_ZEN_LIBRARY_ROOT}`,
    "六句 SHOTLIST。沒有默片過場。龜龜從第三句登場。小華不換裝。",
    "",
    `小華 visual lock = ${TKU_ZEN_XIAOHUA_IDENTITY}／${TKU_ZEN_XIAOHUA_COSTUME}`,
    TKU_ZEN_XIAOHUA_SHEETS.threeview.description,
    TKU_ZEN_XIAOHUA_SHEETS.expression.description,
    TKU_ZEN_XIAOHUA_SHEETS.action.description,
    xiaohuaFiles,
    "",
    `禪定龜龜 = ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.turtle.folder)}（第三句）`,
    `克難坡 = ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.slope.folder)}`,
    "實拍：",
    ...TKU_ZEN_LIBRARY.photos.files.map((folder) => `  - ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.photos.folder, folder)}`),
    "",
    "定裝板（粉橘短髮女孩 lock sheets）：",
    boards,
    "",
    "腳本\\（SHOTLIST only）：",
    scripts,
  ].join("\n");
}

export const TKU_ZEN_WORLDVIEW = {
  logline: "大二化工、粉橘短髮鮑伯的小華，在第三句遇見禪學社的禪定龜龜。",
  message: "真正認識自己。",
  audience: "淡江大學同學",
  themes: ["自我認識", "禪學社"],
  tones: ["溫暖", "輕喜"],
  styles: ["2D 手繪動畫"],
  people: ["小華：大二化工、粉橘短髮鮑伯、米白針織外套", "禪定龜龜：吉祥物龜龜"],
  taboos: ["不要寫進總會短影音／卉庭正式專案", "不要呼叫付費 FAL", "不要改小華定裝"],
};

export function tkuZenHasForbidden(text: string): string[] {
  return TKU_ZEN_FORBIDDEN.filter((token) => text.includes(token));
}

export function tkuZenTurtleFirstAct(shots: TkuZenShotSpec[] = TKU_ZEN_SHOTS): number {
  return Math.min(...shots.filter((s) => s.characters.includes("turtle")).map((s) => s.act));
}
