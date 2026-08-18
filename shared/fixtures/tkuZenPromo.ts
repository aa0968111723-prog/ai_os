/**
 * Overnight animation fixture: the user-specified 60s 淡江禪學社 promo.
 * Do not invent a generic story. Characters, locations, acts, and beats
 * are locked to this script.
 */

export const TKU_ZEN_PROMO_TITLE = "[LOCAL TEST] 淡江禪學社・小華 60s";
export const TKU_ZEN_PROMO_GROUP = "動畫組";
export const TKU_ZEN_PROMO_KIND = "療癒動畫";
export const TKU_ZEN_PROMO_PLATFORM = "shorts";

export const TKU_ZEN_PROMO_SCRIPT = `【淡江禪學社 60 秒宣傳】約 1:00　七幕

角色：小華（女大一新生，搬進淡江宿舍）、媽媽（畫外超大聲）、禪定龜龜（從天上掉下來、會撞牆的淡定烏龜）
場景：小華房間 → 淡江校園大坡 → 社團博覽會／課堂／打工訊息蒙太奇 → 宿舍晚上 → 真實禪學社照片 → 茶會字卡

0:00–0:07 第一幕 大學生活要開始了
小華躺床睡翻。門外媽媽超大聲：「小華——！起床啦！妳今天不是要去搬宿舍喔！」
小華睜眼「蛤……？」看手機，停頓，「喔對齁！！」彈起來「我的大學生活要開始了欸！」又倒回床。媽媽：「妳還睡！！！」切黑。

0:07–0:15 第二幕 夢想中的大學
小華拖超大行李箱進淡江，陽光、超青春配樂。OS「大學生活……新朋友、社團、自由……」幻想「搞不好還有……戀愛？」眼睛閃亮。鏡頭轉到長坡。「……蛤？」行李箱往後滑。「欸欸欸欸欸！我的行李啦——！」追出去。

0:15–0:27 第三幕 怎麼什麼都要選
快速蒙太奇：社團博覽「學妹！要不要加社團！」朋友「晚上要去哪？」手機「明天早上 8:00 上課」小華「早八？！」課堂分組報告、打工排班、未來／研究所／大學四年、包圍字卡「課業／社團／朋友／打工／未來／感情／我要變成什麼樣的人？」抱頭「等一下啦——！為什麼上個大學突然這麼多選擇啊！」安靜後小聲「可是……我好像連自己真正想要什麼，都不知道欸。」

0:27–0:36 第四幕 宇宙可以回答一下嗎
晚上宿舍，翻左翻右坐起來。「大家都叫我要選自己喜歡的……啊問題是，我到底喜歡什麼？」看天花板合十「宇宙啊……拜託一下。有沒有什麼方法，可以讓我更了解自己啦——！」光、咚、龜龜從上面掉下來撞床頭。「痛……」「……你哪位？」淡定「禪定龜龜。」

0:36–0:46 第五幕 改變自己從靜定開始
「所以你可以告訴我，我到底要什麼嗎？」「我不能替妳決定。」「蛤？那你來幹嘛？」「但是妳可以先讓自己靜下來。」混亂字卡淡出。龜龜：「有時候不是我們沒有答案。是外面的聲音太多了。」「當妳開始看見自己的情緒、想法和真正重視的事情——才會慢慢知道，自己想往哪裡走。」字卡「改變自己，從靜定開始。」

0:46–0:55 第六幕 真實禪學社
動畫轉 4–6 張真實照片：禪定／交流／準備活動／團體照。龜龜 OS：在淡江禪學社一起練習靜下來；認識情緒想法生活；不是馬上給標準答案；陪妳更了解現在的自己。

0:55–1:00 第七幕 茶會＋演講
切回動畫。「那我可以先去看看嗎？」「可以啊！」龜龜轉身碰！撞牆。「……先等我一下。」「你真的有靜下來嗎？」「有。」停半秒「但牆沒有。」定格。最終字卡：淡江大學禪學社茶會《改變自己從靜定開始》搭配演講《由數字探索自己》——生命靈數開啟你的蛻變之路。從靜定開始，聽見自己。從認識自己開始，看見改變的方向。日期｜時間｜地點、QR、淡江大學禪學社。
`;

export const TKU_ZEN_REQUIRED_BEATS = [
  "媽媽叫醒",
  "看手機",
  "彈起又躺下",
  "坡",
  "行李後滑",
  "早八",
  "抱頭",
  "宇宙",
  "龜龜掉下來",
  "撞牆",
  "茶會字卡",
] as const;

export const TKU_ZEN_CHARACTERS = [
  {
    key: "xiaohua",
    name: "小華",
    appearance: "女大一新生、黑長直髮、清爽校園便服、剛搬進淡江宿舍的行李還沒整理完",
    notes: "Identity 全程鎖定：宿舍早晨／校園大坡／社團博覽／夜宿舍同一張臉。媽媽畫外音時仍是她的房間。",
    firstAct: 1,
  },
  {
    key: "mom",
    name: "媽媽",
    appearance: "畫外音、不入場；超大聲、急、隔著房門喊",
    notes: "off-screen loud；只在第一幕對白出現",
    firstAct: 1,
  },
  {
    key: "turtle",
    name: "禪定龜龜",
    appearance: "淡定小烏龜、圓殼、慢動作、從天上掉下來也面不改色，走路會撞牆",
    notes: "只從第四幕登場；第五～七幕可同框。不可出現在一～三幕。",
    firstAct: 4,
  },
] as const;

export const TKU_ZEN_LOCATIONS = [
  { key: "room_morning", name: "小華房間", palette: "宿舍晨光、未整理紙箱、單人床", lighting: "早晨窗光", timeOfDay: "morning" as const },
  { key: "slope", name: "淡江校園大坡", palette: "陽光、青春、長坡、紅磚與綠蔭", lighting: "正午偏上午陽光", timeOfDay: "day" as const },
  { key: "fair", name: "社團博覽會／課堂／打工訊息", palette: "攤位旗海、教室白板、手機通知疊加", lighting: "日間戶外轉室內日光燈", timeOfDay: "day" as const },
  { key: "room_night", name: "宿舍晚上", palette: "桌燈暖光、天花板、床頭", lighting: "夜晚室內暖光", timeOfDay: "night" as const },
  { key: "club_photos", name: "真實禪學社照片", palette: "紀實照片、禪定／交流／準備／團體照", lighting: "實拍現場光", timeOfDay: "neutral" as const },
  { key: "endcard", name: "茶會字卡", palette: "素底字卡、社徽、QR", lighting: "平面設計光", timeOfDay: "neutral" as const },
] as const;

export const TKU_ZEN_PROPS = [
  { key: "suitcase", name: "行李箱", appearance: "超大深色行李箱、拉桿、輪子，在坡上會自己往後滑", acts: [2] },
  { key: "phone", name: "手機", appearance: "小華的智慧型手機，螢幕會跳出搬宿舍提醒與早八課表", acts: [1, 3] },
  { key: "bed", name: "床", appearance: "宿舍單人床、皺被、枕頭，小華睡翻與龜龜撞床頭的落點", acts: [1, 4] },
  { key: "slope", name: "坡", appearance: "淡江校園著名長坡，行李箱在此後滑", acts: [2] },
] as const;

export interface TkuZenShotSpec {
  act: number;
  title: string;
  durationSec: number;
  prompt: string;
  dialogue: string;
  voiceover: string;
  action: string;
  timeOfDay: "morning" | "day" | "night" | "neutral";
  characters: Array<"xiaohua" | "mom" | "turtle">;
  props: Array<"suitcase" | "phone" | "bed" | "slope">;
  location: (typeof TKU_ZEN_LOCATIONS)[number]["key"];
  beats: string[];
}

export interface TkuZenActSpec {
  act: number;
  title: string;
  startSec: number;
  endSec: number;
  location: (typeof TKU_ZEN_LOCATIONS)[number]["key"];
  timeOfDay: "morning" | "day" | "night" | "neutral";
  excerpt: string;
  shots: TkuZenShotSpec[];
}

export const TKU_ZEN_ACTS: TkuZenActSpec[] = [
  {
    act: 1,
    title: "第一幕 大學生活要開始了",
    startSec: 0,
    endSec: 7,
    location: "room_morning",
    timeOfDay: "morning",
    excerpt: "小華躺床睡翻。門外媽媽超大聲叫醒。小華看手機、彈起來又倒回床。切黑。",
    shots: [
      {
        act: 1,
        title: "1-1 媽媽叫醒",
        durationSec: 3,
        prompt: "早晨宿舍，小華躺床睡翻，門外媽媽超大聲喊她起床去搬宿舍",
        dialogue: "@媽媽：小華——！起床啦！妳今天不是要去搬宿舍喔！",
        voiceover: "",
        action: "小華趴在床上睡翻，房門緊閉，媽媽的聲音從門外灌進來",
        timeOfDay: "morning",
        characters: ["xiaohua", "mom"],
        props: ["bed"],
        location: "room_morning",
        beats: ["媽媽叫醒"],
      },
      {
        act: 1,
        title: "1-2 看手機",
        durationSec: 2,
        prompt: "小華睜眼「蛤……？」拿起手機看螢幕，停頓",
        dialogue: "@小華：蛤……？",
        voiceover: "",
        action: "小華睜開眼，伸手拿手機，盯著螢幕停頓",
        timeOfDay: "morning",
        characters: ["xiaohua"],
        props: ["phone", "bed"],
        location: "room_morning",
        beats: ["看手機"],
      },
      {
        act: 1,
        title: "1-3 彈起又躺下",
        durationSec: 2,
        prompt: "小華突然彈起來大喊大學生活要開始了，又整個人倒回床。媽媽再吼。切黑。",
        dialogue: "@小華：喔對齁！！我的大學生活要開始了欸！\n@媽媽：妳還睡！！！",
        voiceover: "",
        action: "小華彈坐起來又整個人倒回床，畫面切黑",
        timeOfDay: "morning",
        characters: ["xiaohua", "mom"],
        props: ["bed", "phone"],
        location: "room_morning",
        beats: ["彈起又躺下"],
      },
    ],
  },
  {
    act: 2,
    title: "第二幕 夢想中的大學",
    startSec: 7,
    endSec: 15,
    location: "slope",
    timeOfDay: "day",
    excerpt: "小華拖超大行李箱進淡江。陽光青春。長坡，行李後滑，追出去。",
    shots: [
      {
        act: 2,
        title: "2-1 拖行李箱進淡江",
        durationSec: 3,
        prompt: "小華拖超大行李箱走進陽光下的淡江校園，超青春配樂",
        dialogue: "",
        voiceover: "大學生活……新朋友、社團、自由……",
        action: "小華拉著超大行李箱走進校園，步伐輕快",
        timeOfDay: "day",
        characters: ["xiaohua"],
        props: ["suitcase"],
        location: "slope",
        beats: [],
      },
      {
        act: 2,
        title: "2-2 幻想戀愛",
        durationSec: 2,
        prompt: "小華眼睛閃亮，幻想搞不好還有戀愛",
        dialogue: "@小華：搞不好還有……戀愛？",
        voiceover: "",
        action: "小華眼睛閃亮，行李箱仍握在手上",
        timeOfDay: "day",
        characters: ["xiaohua"],
        props: ["suitcase"],
        location: "slope",
        beats: [],
      },
      {
        act: 2,
        title: "2-3 坡上行李後滑",
        durationSec: 3,
        prompt: "鏡頭轉到淡江長坡。行李箱自己往後滑。小華追出去。",
        dialogue: "@小華：……蛤？欸欸欸欸欸！我的行李啦——！",
        voiceover: "",
        action: "行李箱在長坡上往後滑，小華追出去",
        timeOfDay: "day",
        characters: ["xiaohua"],
        props: ["suitcase", "slope"],
        location: "slope",
        beats: ["坡", "行李後滑"],
      },
    ],
  },
  {
    act: 3,
    title: "第三幕 怎麼什麼都要選",
    startSec: 15,
    endSec: 27,
    location: "fair",
    timeOfDay: "day",
    excerpt: "社團博覽、早八、抱頭、不知道自己想要什麼。",
    shots: [
      {
        act: 3,
        title: "3-1 社團博覽",
        durationSec: 3,
        prompt: "社團博覽會攤位包圍小華，學長姐猛招手",
        dialogue: "@學長姐：學妹！要不要加社團！",
        voiceover: "",
        action: "小華被攤位旗海包圍，左右點頭又搖頭",
        timeOfDay: "day",
        characters: ["xiaohua"],
        props: [],
        location: "fair",
        beats: [],
      },
      {
        act: 3,
        title: "3-2 早八",
        durationSec: 4,
        prompt: "朋友約晚上、手機跳出明天早上 8:00 上課，小華崩潰早八",
        dialogue: "@朋友：晚上要去哪？\n@小華：早八？！",
        voiceover: "",
        action: "小華看手機課表，螢幕寫著明天早上 8:00 上課",
        timeOfDay: "day",
        characters: ["xiaohua"],
        props: ["phone"],
        location: "fair",
        beats: ["早八"],
      },
      {
        act: 3,
        title: "3-3 抱頭",
        durationSec: 5,
        prompt: "課堂分組、打工排班、未來研究所字卡包圍，小華抱頭。然後安靜小聲承認不知道自己要什麼。",
        dialogue: "@小華：等一下啦——！為什麼上個大學突然這麼多選擇啊！\n@小華：可是……我好像連自己真正想要什麼，都不知道欸。",
        voiceover: "",
        action: "字卡「課業／社團／朋友／打工／未來／感情／我要變成什麼樣的人？」包圍小華，她抱頭，然後聲音變小",
        timeOfDay: "day",
        characters: ["xiaohua"],
        props: ["phone"],
        location: "fair",
        beats: ["抱頭"],
      },
    ],
  },
  {
    act: 4,
    title: "第四幕 宇宙可以回答一下嗎",
    startSec: 27,
    endSec: 36,
    location: "room_night",
    timeOfDay: "night",
    excerpt: "晚上宿舍。宇宙祈禱。龜龜從上面掉下來撞床頭。",
    shots: [
      {
        act: 4,
        title: "4-1 夜宿舍翻來覆去",
        durationSec: 3,
        prompt: "晚上宿舍，小華翻左翻右坐起來，問自己到底喜歡什麼",
        dialogue: "@小華：大家都叫我要選自己喜歡的……啊問題是，我到底喜歡什麼？",
        voiceover: "",
        action: "小華在床上翻左翻右，坐起來",
        timeOfDay: "night",
        characters: ["xiaohua"],
        props: ["bed"],
        location: "room_night",
        beats: [],
      },
      {
        act: 4,
        title: "4-2 宇宙祈禱",
        durationSec: 3,
        prompt: "小華看天花板合十，拜託宇宙給方法了解自己",
        dialogue: "@小華：宇宙啊……拜託一下。有沒有什麼方法，可以讓我更了解自己啦——！",
        voiceover: "",
        action: "小華看著天花板合十",
        timeOfDay: "night",
        characters: ["xiaohua"],
        props: ["bed"],
        location: "room_night",
        beats: ["宇宙"],
      },
      {
        act: 4,
        title: "4-3 龜龜掉下來",
        durationSec: 3,
        prompt: "光、咚，禪定龜龜從上面掉下來撞床頭。痛。你哪位。淡定報上名號。",
        dialogue: "@禪定龜龜：痛……\n@小華：……你哪位？\n@禪定龜龜：禪定龜龜。",
        voiceover: "",
        action: "龜龜從天花板掉下來撞上床頭，小華嚇到",
        timeOfDay: "night",
        characters: ["xiaohua", "turtle"],
        props: ["bed"],
        location: "room_night",
        beats: ["龜龜掉下來"],
      },
    ],
  },
  {
    act: 5,
    title: "第五幕 改變自己從靜定開始",
    startSec: 36,
    endSec: 46,
    location: "room_night",
    timeOfDay: "night",
    excerpt: "龜龜不替她決定。先靜下來。字卡「改變自己，從靜定開始。」",
    shots: [
      {
        act: 5,
        title: "5-1 不能替妳決定",
        durationSec: 5,
        prompt: "小華追問答案，龜龜說不能替她決定，但可以先讓自己靜下來。混亂字卡淡出。",
        dialogue: "@小華：所以你可以告訴我，我到底要什麼嗎？\n@禪定龜龜：我不能替妳決定。\n@小華：蛤？那你來幹嘛？\n@禪定龜龜：但是妳可以先讓自己靜下來。",
        voiceover: "",
        action: "混亂選擇字卡淡出，房間變安靜",
        timeOfDay: "night",
        characters: ["xiaohua", "turtle"],
        props: ["bed"],
        location: "room_night",
        beats: [],
      },
      {
        act: 5,
        title: "5-2 從靜定開始",
        durationSec: 5,
        prompt: "龜龜說外面聲音太多。字卡：改變自己，從靜定開始。",
        dialogue: "@禪定龜龜：有時候不是我們沒有答案。是外面的聲音太多了。當妳開始看見自己的情緒、想法和真正重視的事情——才會慢慢知道，自己想往哪裡走。",
        voiceover: "",
        action: "字卡「改變自己，從靜定開始。」疊在兩人中間",
        timeOfDay: "night",
        characters: ["xiaohua", "turtle"],
        props: [],
        location: "room_night",
        beats: [],
      },
    ],
  },
  {
    act: 6,
    title: "第六幕 真實禪學社",
    startSec: 46,
    endSec: 55,
    location: "club_photos",
    timeOfDay: "neutral",
    excerpt: "動畫轉 4 張真實照片。龜龜 OS：一起練習靜下來。資產後補，本 fixture 先建鏡頭與旁白。",
    shots: [
      {
        act: 6,
        title: "6-1 照片・禪定",
        durationSec: 2,
        prompt: "真實照片：淡江禪學社禪定練習（資產後補，先以字卡鏡頭佔位）",
        dialogue: "",
        voiceover: "在淡江禪學社，我們一起練習靜下來。",
        action: "動畫轉真實照片：禪定",
        timeOfDay: "neutral",
        characters: ["turtle"],
        props: [],
        location: "club_photos",
        beats: [],
      },
      {
        act: 6,
        title: "6-2 照片・交流",
        durationSec: 2,
        prompt: "真實照片：社員交流（資產後補）",
        dialogue: "",
        voiceover: "認識自己的情緒、想法和生活。",
        action: "真實照片：交流",
        timeOfDay: "neutral",
        characters: ["turtle"],
        props: [],
        location: "club_photos",
        beats: [],
      },
      {
        act: 6,
        title: "6-3 照片・準備活動",
        durationSec: 3,
        prompt: "真實照片：準備活動（資產後補）",
        dialogue: "",
        voiceover: "不是馬上給妳標準答案。",
        action: "真實照片：準備活動",
        timeOfDay: "neutral",
        characters: ["turtle"],
        props: [],
        location: "club_photos",
        beats: [],
      },
      {
        act: 6,
        title: "6-4 照片・團體照",
        durationSec: 2,
        prompt: "真實照片：禪學社團體照（資產後補）",
        dialogue: "",
        voiceover: "而是陪妳更了解現在的自己。",
        action: "真實照片：團體照",
        timeOfDay: "neutral",
        characters: ["turtle"],
        props: [],
        location: "club_photos",
        beats: [],
      },
    ],
  },
  {
    act: 7,
    title: "第七幕 茶會＋演講",
    startSec: 55,
    endSec: 60,
    location: "endcard",
    timeOfDay: "neutral",
    excerpt: "切回動畫。龜龜撞牆。茶會＋演講最終字卡。",
    shots: [
      {
        act: 7,
        title: "7-1 撞牆",
        durationSec: 3,
        prompt: "切回動畫。小華問可以先去看看嗎。龜龜轉身碰！撞牆。牆沒有靜下來。定格。",
        dialogue: "@小華：那我可以先去看看嗎？\n@禪定龜龜：可以啊！\n@禪定龜龜：……先等我一下。\n@小華：你真的有靜下來嗎？\n@禪定龜龜：有。但牆沒有。",
        voiceover: "",
        action: "龜龜轉身撞上宿舍牆，定格",
        timeOfDay: "night",
        characters: ["xiaohua", "turtle"],
        props: [],
        location: "room_night",
        beats: ["撞牆"],
      },
      {
        act: 7,
        title: "7-2 茶會字卡",
        durationSec: 2,
        prompt: "最終字卡：淡江大學禪學社茶會《改變自己從靜定開始》搭配演講《由數字探索自己》。日期｜時間｜地點、QR、淡江大學禪學社。",
        dialogue: "",
        voiceover: "從靜定開始，聽見自己。從認識自己開始，看見改變的方向。",
        action: "定格切字卡，留下茶會與演講資訊、QR、淡江大學禪學社",
        timeOfDay: "neutral",
        characters: [],
        props: [],
        location: "endcard",
        beats: ["茶會字卡"],
      },
    ],
  },
];

export const TKU_ZEN_SHOTS: TkuZenShotSpec[] = TKU_ZEN_ACTS.flatMap((act) => act.shots);

export const TKU_ZEN_WORLDVIEW = {
  logline: "大一新生小華被選擇淹沒，天上掉下來的禪定龜龜不給答案，只請她先靜下來——淡江禪學社茶會。",
  message: "改變自己，從靜定開始。從認識自己開始，看見改變的方向。",
  audience: "淡江大學新生與社團博覽會路過的同學",
  themes: ["自我認識", "靜定", "大學選擇"],
  tones: ["輕喜", "溫暖", "療癒"],
  styles: ["2D 手繪動畫"],
  taboos: ["不要把龜龜畫成驚嚇恐怖", "不要出現付費生成水印", "不要寫進總會短影音／卉庭正式專案"],
};

export function tkuZenCoveredBeats(shots: { beats: string[] }[] = TKU_ZEN_SHOTS): string[] {
  return [...new Set(shots.flatMap((s) => s.beats))];
}

export function tkuZenMissingBeats(shots: { beats: string[] }[] = TKU_ZEN_SHOTS): string[] {
  const covered = new Set(tkuZenCoveredBeats(shots));
  return TKU_ZEN_REQUIRED_BEATS.filter((beat) => !covered.has(beat));
}

/** 龜龜不可出現在第四幕之前。 */
export function tkuZenTurtleActs(shots: TkuZenShotSpec[] = TKU_ZEN_SHOTS): number[] {
  return [...new Set(shots.filter((s) => s.characters.includes("turtle")).map((s) => s.act))];
}

/** 時間軸不得無劇情地從夜晚倒回早晨。 */
export function tkuZenTimeOrderOk(shots: TkuZenShotSpec[] = TKU_ZEN_SHOTS): boolean {
  const rank = { morning: 0, day: 1, night: 2, neutral: 2 };
  let prev = 0;
  for (const shot of shots) {
    const r = rank[shot.timeOfDay];
    if (shot.timeOfDay !== "neutral" && r < prev) return false;
    if (shot.timeOfDay !== "neutral") prev = Math.max(prev, r);
  }
  return true;
}
