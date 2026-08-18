/**
 * The ONLY 小華 fixture: lip-sync SHOTLIST A–F (~60s).
 * Characters: 小華（大二化工、白帽T、粉橘短髮女孩）+ 禪定龜龜.
 * D:\淡大劇本 七幕 is 安倢/慕恩 — not 小華. Do not mix. No 媽媽. No 茶會字卡 as a 幕.
 * B-roll 教室/超商 and 真人禪坐 are NOT lip-sync acts.
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

/**
 * Live cold-parse bracket on 405B/150s (do not treat hash cache as a parse):
 *   66 字 A-line ~35s OK
 *   161 字 A–D ~2min OK-but-slow (sat on 405B)
 *   301 字 A–F FAIL 150s
 * 70B first-pass under ~2000 chars so 161 does not sit on 405B and 301 can finish.
 */
export const TKU_ZEN_SHOTLIST_A_LINE =
  "A 校門口自我介紹。小華穿白帽T、短髮面向鏡頭她輕聲對鏡頭說出口了。我是大二化工系的小華。回想起大一的時光，說真的，有好多的不習慣。";

/** Live overnight-test-ad A–D paste (~161 字). Must stay on 70B first-pass. */
export const TKU_ZEN_SHOTLIST_AD_PARSE = [
  "A 校門口自我介紹。小華，大二化工、白帽T、粉橘短髮女孩，面向鏡頭說：我是大二化工系的小華。回想起大一的時光，說真的，有好多的不習慣。",
  "B 校園夕陽下。小華望向天空：宇宙呀，我能怎麼做？怎麼才能真正認識自己呢？",
  "C 小華遇見禪定龜龜：咦？你是誰？",
  "D 禪定龜龜：小華，我聽到你的困擾了。我是禪學社的禪定龜龜，我來拯救你了！",
].join("\n");

/**
 * Locked A–F SHOTLIST as a ~300-char / 6-paragraph first-parse paste.
 * A 校門口 / B 夕陽 / C–F 對白. No 宿舍夜, no 七幕, no 安倢.
 */
export const TKU_ZEN_SHOTLIST_FIRST_PARSE = [
  "A 校門口自我介紹。小華穿白帽T、短髮站在校門口面向鏡頭，平靜微笑。我是大二化工系的小華。回想起大一的時光，說真的，有好多的不習慣。風從校門吹過來，她把瀏海撥開。",
  "B 夕陽。校園被夕陽染成橘色，小華抬頭看天。宇宙呀，我能怎麼做？怎麼才能真正認識自己呢？她把白帽T袖口拉好，還是想不明白。",
  "C 校門口。旁邊傳來窸窣聲，小華轉頭。咦？你是誰？白帽T皺了一角，她忘了拉平。",
  "D 龜龜開口。禪定龜龜從一旁探出頭，殼上帶禪學社圓標。小華，我聽到你的困擾了。我是禪學社的禪定龜龜，我來拯救你了！",
  "E 小華眼睛亮起來。真的嗎？帶我去！她跟上龜龜，白帽T在夕陽裡晃。",
  "F 龜龜點頭帶路。真的真的！兩人走向校門口外側，短髮被風吹起。",
].join("\n\n");

export const TKU_ZEN_FORBIDDEN = [
  "媽媽",
  "媽媽叫醒",
  "茶會字卡",
  "安倢",
  "慕恩",
  "七幕",
  "針織外套",
  "粉橘短鮑伯",
  "宿舍夜",
  "年輕男性",
  "黑長直髮",
] as const;

export const TKU_ZEN_XIAOHUA_COSTUME = "白帽T、粉橘短髮，腳本未換裝";

export const TKU_ZEN_XIAOHUA_IDENTITY = "大二化工、粉橘短髮女孩、白帽T";

export const TKU_ZEN_XIAOHUA_SHEETS = {
  costume: {
    file: "SHOTLIST.md",
    role: "costume-lock" as const,
    description: "小華定裝鎖定：大二化工、白帽T、粉橘短髮女孩。來源 lip-sync/SHOTLIST.md A–F。不換裝。",
  },
} as const;

export const TKU_ZEN_XIAOHUA_APPEARANCE =
  `${TKU_ZEN_XIAOHUA_IDENTITY}。定裝：${TKU_ZEN_XIAOHUA_COSTUME}。視覺鎖定腳本\\SHOTLIST.md。腳本未換裝。`;

export const TKU_ZEN_PROMO_SCRIPT = `角色：小華（${TKU_ZEN_XIAOHUA_IDENTITY}）、禪定龜龜（吉祥物龜龜）
場景：校門口、夕陽
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
    folder: String.raw`腳本`,
    files: [TKU_ZEN_XIAOHUA_SHEETS.costume.file],
  },
  turtle: { folder: String.raw`角色圖\吉祥物龜龜`, files: [] as string[] },
  gate: { folder: String.raw`場景\校門口`, files: [] as string[] },
  sunset: { folder: String.raw`場景\夕陽`, files: [] as string[] },
  broll: {
    folder: String.raw`場景`,
    files: ["教室", "超商", "真人禪坐"],
  },
  boards: {
    folder: String.raw`腳本`,
    files: [TKU_ZEN_XIAOHUA_SHEETS.costume.file],
  },
  scripts: {
    folder: String.raw`腳本`,
    files: ["SHOTLIST.md"],
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
      TKU_ZEN_XIAOHUA_SHEETS.costume.description,
      `路徑：${tkuZenLibraryPath(TKU_ZEN_LIBRARY.scripts.folder, "SHOTLIST.md")}`,
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

/** One costume look for 小華 — script does not change it. */
export const TKU_ZEN_LOOKS = [
  {
    character: "xiaohua" as const,
    name: "定裝",
    costume: TKU_ZEN_XIAOHUA_COSTUME,
    sheet: "costume" as const,
    notes: tkuZenLibraryPath(TKU_ZEN_LIBRARY.scripts.folder, "SHOTLIST.md"),
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
  { key: "gate", name: "校門口", palette: "淡江校門口、白天", lighting: "日間陽光", timeOfDay: "day" as const, libraryFolder: TKU_ZEN_LIBRARY.gate.folder },
  { key: "sunset", name: "夕陽", palette: "校園夕陽橘色", lighting: "黃昏逆光", timeOfDay: "day" as const, libraryFolder: TKU_ZEN_LIBRARY.sunset.folder },
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

const LOCK = `小華定裝（${TKU_ZEN_XIAOHUA_COSTUME}）`;

/** Six spoken SHOTLIST beats. B-roll 教室/超商/真人禪坐 are not acts. */
export const TKU_ZEN_ACTS: TkuZenActSpec[] = [
  {
    act: 1,
    title: "A 校門口自我介紹",
    timeOfDay: "day",
    location: "gate",
    shots: [
      {
        act: 1, index: 1, title: "A 校門口自我介紹", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `${LOCK}站在校門口正面。白帽T、短髮。`,
        dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[0]}`,
        speaker: "xiaohua",
        action: "小華面向鏡頭，平靜微笑",
        timeOfDay: "day", characters: ["xiaohua"], location: "gate",
        libraryHint: String.raw`場景\校門口｜SHOTLIST.md`,
      },
    ],
  },
  {
    act: 2,
    title: "B 夕陽 宇宙呀",
    timeOfDay: "day",
    location: "sunset",
    shots: [
      {
        act: 2, index: 2, title: "B 夕陽 宇宙呀", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `夕陽下，${LOCK}抬頭。白帽T、短髮。`,
        dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[1]}`,
        speaker: "xiaohua",
        action: "小華看向夕陽，眉心微皺",
        timeOfDay: "day", characters: ["xiaohua"], location: "sunset",
        libraryHint: String.raw`場景\夕陽｜SHOTLIST.md`,
      },
    ],
  },
  {
    act: 3,
    title: "C 咦？你是誰？",
    timeOfDay: "day",
    location: "gate",
    shots: [
      {
        act: 3, index: 3, title: "C 咦？你是誰？", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `吉祥物龜龜第一次出現。${LOCK}驚訝。白帽T不換裝。`,
        dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[2]}`,
        speaker: "xiaohua",
        action: "小華看見禪定龜龜，眼睛睜大",
        timeOfDay: "day", characters: ["xiaohua", "turtle"], location: "gate",
        libraryHint: String.raw`角色圖\吉祥物龜龜`,
      },
    ],
  },
  {
    act: 4,
    title: "D 禪定龜龜／我來拯救你了",
    timeOfDay: "day",
    location: "gate",
    shots: [
      {
        act: 4, index: 4, title: "D 禪定龜龜／我來拯救你了", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `吉祥物龜龜面向${LOCK}。不要另造一隻烏龜，也不要改白帽T。`,
        dialogue: `@禪定龜龜：${TKU_ZEN_SHOTLIST_LINES[3]}`,
        speaker: "turtle",
        action: "禪定龜龜開口",
        timeOfDay: "day", characters: ["xiaohua", "turtle"], location: "gate",
        libraryHint: String.raw`角色圖\吉祥物龜龜`,
      },
    ],
  },
  {
    act: 5,
    title: "E 真的嗎？帶我去！",
    timeOfDay: "day",
    location: "gate",
    shots: [
      {
        act: 5, index: 5, title: "E 真的嗎？帶我去！", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `${LOCK}跟上吉祥物龜龜。白帽T、短髮。不換裝。`,
        dialogue: `@小華：${TKU_ZEN_SHOTLIST_LINES[4]}`,
        speaker: "xiaohua",
        action: "小華跟上龜龜",
        timeOfDay: "day", characters: ["xiaohua", "turtle"], location: "gate",
        libraryHint: String.raw`場景\校門口｜SHOTLIST.md`,
      },
    ],
  },
  {
    act: 6,
    title: "F 真的真的！",
    timeOfDay: "day",
    location: "gate",
    shots: [
      {
        act: 6, index: 6, title: "F 真的真的！", durationSec: TKU_ZEN_SHOT_DURATION_SEC,
        prompt: `吉祥物龜龜帶${LOCK}離開校門口。教室／超商／真人禪坐不是這一鏡。`,
        dialogue: `@禪定龜龜：${TKU_ZEN_SHOTLIST_LINES[5]}`,
        speaker: "turtle",
        action: "龜龜答應",
        timeOfDay: "day", characters: ["xiaohua", "turtle"], location: "gate",
        libraryHint: String.raw`場景\校門口｜SHOTLIST.md`,
      },
    ],
  },
];

export const TKU_ZEN_SHOTS: TkuZenShotSpec[] = TKU_ZEN_ACTS.flatMap((act) => act.shots);

export function tkuZenLibraryMapContent(): string {
  const scripts = TKU_ZEN_LIBRARY.scripts.files
    .map((file) => `  - ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.scripts.folder, file)}`)
    .join("\n");
  return [
    `本機素材庫（此 VM 讀不到磁碟時只鎖定路徑與定裝描述，不呼叫付費 FAL）：${TKU_ZEN_LIBRARY_ROOT}`,
    "六句 SHOTLIST A–F。不是那條長稿。龜龜從第三句登場。小華白帽T、粉橘短髮女孩，不換裝。",
    "D:\\淡大劇本 那條長稿不是小華。不要寫進動畫組小華專案。",
    "",
    `小華 visual lock = ${TKU_ZEN_XIAOHUA_IDENTITY}／${TKU_ZEN_XIAOHUA_COSTUME}`,
    TKU_ZEN_XIAOHUA_SHEETS.costume.description,
    "",
    `禪定龜龜 = ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.turtle.folder)}（第三句）`,
    `校門口 = ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.gate.folder)}`,
    `夕陽 = ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.sunset.folder)}`,
    "B-roll（不是對白幕）：",
    ...TKU_ZEN_LIBRARY.broll.files.map((folder) => `  - ${tkuZenLibraryPath(TKU_ZEN_LIBRARY.broll.folder, folder)}（非 lip-sync 幕）`),
    "",
    "腳本\\SHOTLIST.md（A–F only）：",
    scripts,
  ].join("\n");
}

export const TKU_ZEN_WORLDVIEW = {
  logline: "大二化工、白帽T、粉橘短髮女孩的小華，在第三句遇見禪學社的禪定龜龜。",
  message: "真正認識自己。",
  audience: "淡江大學同學",
  themes: ["自我認識", "禪學社"],
  tones: ["溫暖", "輕喜"],
  styles: ["2D 手繪動畫"],
  people: ["小華：大二化工、白帽T、粉橘短髮女孩", "禪定龜龜：吉祥物龜龜"],
  taboos: ["不要寫進總會短影音／卉庭正式專案", "不要呼叫付費 FAL", "不要把那條長稿寫進小華", "不要改小華白帽T定裝"],
};

export function tkuZenHasForbidden(text: string): string[] {
  return TKU_ZEN_FORBIDDEN.filter((token) => text.includes(token));
}

export function tkuZenTurtleFirstAct(shots: TkuZenShotSpec[] = TKU_ZEN_SHOTS): number {
  return Math.min(...shots.filter((s) => s.characters.includes("turtle")).map((s) => s.act));
}
