/**
 * 文字分鏡腳本：整份分鏡 ↔ 一段可讀可寫的文字（前後端共用單一真相）。
 *
 * 為什麼要有這個：分鏡表是一格一格點的，適合「改某一鏡」，不適合「通讀一遍」或
 * 「一次把十二鏡寫完」。編劇的工作方式是寫一整份，不是填十二張表單。
 *
 * 格式（刻意樸素，手打得出來、貼進 Google Doc 也還是人看得懂的東西）：
 *
 *   ## 1. 開場・晨光 (5s)
 *   畫面：清晨禪堂，柔和光線灑落
 *   旁白：那一年，我第一次走進禪堂。
 *   對白：
 *   @師父：坐吧。心急的人，茶會燙。
 *   @安倢（小聲）：謝謝師父。
 *   環境音：遠處鐘聲，細微鳥鳴
 *   角色卡：安倢・師父
 *   場景卡：禪堂
 *
 * 解析規則刻意寬鬆（序號、秒數、任一區塊都可省略；全形半形冒號都吃），
 * 但**套用規則刻意保守**：只更新與新增，永不刪除。文字裡少寫一鏡不該讓
 * 已經出好圖的那一格消失——要刪請到分鏡表按刪除，那裡有確認框。
 *
 * 卡片三行（角色卡／場景卡／素材卡）比其他欄位再保守一級：留白也維持原值，
 * 要解除綁定得寫「無」。理由與整份格式一致——被誤清的旁白重打一次就有，
 * 被誤清的綁定要回分鏡表逐格重勾。名字回推卡片的規則見 shared/sceneCards.ts。
 */

import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "./cardLimits";
import { formatCardNames, parseCardLine, type SceneCardKind } from "./sceneCards";

export type StoryboardScriptScene = {
  title: string;
  durationSec?: number;
  prompt?: string;
  voiceover?: string;
  /** 這一鏡聽得到什麼（環境音／音效）。與 voiceover 對稱，同樣是可寫回的文字。 */
  ambience?: string;
  /** 誰做了什麼、從哪走到哪。刻意與 prompt 分開：走位是時間性的，單張圖畫不出來。 */
  action?: string;
  /** 說話序列（@說話者：台詞）。旁白用 @旁白，可與對白交錯。結構見 shared/sceneSpeech.ts。 */
  dialogue?: string;
  /** 配樂端點標記（「起｜描述」或「止」）；區間由 shared/sceneMusic.ts 推導 */
  music?: string;
  /** 角色卡名單原文（「安倢・師父」／「無」）。名字→id 的回推在伺服器做，見 shared/sceneCards.ts。 */
  characters?: string;
  /** 場景卡名單原文 */
  scenePresets?: string;
  /** 素材卡名單原文（可寫「安倢的紅傘」或「紅傘」） */
  props?: string;
  /**
   * 標題上的鏡次（`## 3.` 的 3）。這不是裝飾，是**身分證**：中間整段沒寫時，
   * 靠它才知道「## 3.」指的仍是第 3 鏡，而不是往前遞補成第 2 鏡。見 resolveScriptTargets。
   */
  ordinal?: number;
};

/**
 * 分鏡表現況（格式化時用）。
 *
 * 卡片以**名字**進出這份文字：使用者寫的是劇本，不是資料庫，要他在「畫面：」旁邊
 * 貼一串 UUID 這條路就白開了。名字回推卡片的嚴格規則（整行全中才套用）在 shared/sceneCards.ts。
 */
export type StoryboardScriptRow = {
  title: string;
  durationSec: number;
  /** 這一鏡綁定的角色卡名字（依綁定順序——順序會影響提示詞組裝，比對時不可忽略） */
  characterNames?: string[];
  scenePresetNames?: string[];
  /** 素材卡顯示名（「安倢的紅傘」；formatPropDisplayName 的結果） */
  propNames?: string[];
} & {
  /**
   * 描述型欄位**一律必填**（值可以是 null／undefined，但欄位不能不寫），
   * 而且直接由 ScriptTextKey 導出——欄位表長出新的一欄，這裡自動跟上。
   *
   * 為什麼要逼呼叫端寫出每一個 key：alwaysEmit 的欄位在格式化時一律輸出標籤（即使是空的），
   * 所以漏傳一欄＝使用者看到的全文裡那一欄是空的；原封不動按下「寫回分鏡」，解析回來是空字串，
   * 寫回端判定「"" ≠ 原本的值」成立，**那一欄在使用者一個字都沒改的情況下被清光**。
   * 環境音就這樣被清過一次。format→parse 的來回測試結構上抓不到這種「呼叫端漏傳」
   * ——兩邊都缺同一欄時 diff 反而顯示「沒有任何變更」——真正擋得住的是這裡的編譯錯誤。
   *
   * 卡片三欄（characters／scenePresets／props）刻意不在這裡：它們在列上是 `*Names` 陣列，
   * 由 scriptRowCardNames 讀，而且 alwaysEmit=false——留白＝維持原值，漏傳不會清空任何東西。
   */
  [K in ScriptTextKey]: string | null | undefined;
};

export const SCRIPT_SCENE_HEADING = "##";
const VISUAL_LABEL = "畫面";
const ACTION_LABEL = "動作";
const VOICE_LABEL = "旁白";
const DIALOGUE_LABEL = "對白";
const AMBIENCE_LABEL = "環境音";
const MUSIC_LABEL = "配樂";
const CHARACTERS_LABEL = "角色卡";
const SCENE_PRESETS_LABEL = "場景卡";
const PROPS_LABEL = "素材卡";
/** 舊格式的唯讀標注行；已不再輸出，但貼回來時要被安全忽略（不能被當成自由文字寫進畫面） */
const LEGACY_CARDS_LABEL = "設定卡";

/**
 * 欄位表：新增一個欄位只改這裡，parse／format／上限檢查全部由它導出。
 *
 * 為什麼要有這張表：欄位從三個長到六個以上之後，逐欄寫 if 會讓三件事各自漂移——
 * 哪些吃續行、哪些空的也印、上限幾字。三者只要有一處對不上，症狀都是「使用者的字
 * 被系統改掉」而不是報錯（環境音漏傳那次就是這樣）。
 *
 * multiline=false 的欄位**不吃續行**：它們的值是一行寫完的短指示，後面若接自由文字
 * （例如在鏡末尾補一句筆記），那句話不該被吞進這個欄位。
 */
export type ScriptTextKey = "prompt" | "action" | "voiceover" | "dialogue" | "ambience" | "music";
export type ScriptFieldKey = ScriptTextKey | SceneCardKind;

type ScriptFieldBase = {
  label: string;
  /** 吃續行？false＝只收標籤同一行的內容，後續行落回上一個 multiline 欄位 */
  multiline: boolean;
  /** 空的也輸出一行？（只影響「編輯用」的全欄模板，唯讀通讀一律省略空欄） */
  alwaysEmit: boolean;
  max: number;
  /** 錯誤訊息裡的人話欄位名 */
  human: string;
  /**
   * 值從標籤的**下一行**開始（標籤自己一行）。
   * 對白是逐句序列，把第一句擠在「對白：」後面會讓它跟其餘幾句對不齊，讀起來像漏了一行。
   */
  blockValue?: boolean;
};

/**
 * `card: true` 的欄位值是**卡片名單**不是自由文字：比對與寫回都走 shared/sceneCards.ts
 * 的規則（留白＝維持原值、「無」＝解除、整行全中才套用）。用型別聯集而不是一個布林旗標，
 * 是為了讓 `field.card` 為真時 `field.key` 自動收窄成 SceneCardKind——不必在讀 row 時硬轉型。
 */
type ScriptFieldSpec =
  | (ScriptFieldBase & { key: ScriptTextKey; card?: false })
  | (ScriptFieldBase & { key: SceneCardKind; card: true });

/** 單鏡卡片行的上限：素材卡顯示名最長（「主人名的物件名」＝40＋1＋40），四張就 328 字 */
const SCRIPT_CARD_LINE_MAX = 400;

export const SCRIPT_FIELDS: readonly ScriptFieldSpec[] = [
  { key: "prompt", label: VISUAL_LABEL, multiline: true, alwaysEmit: true, max: 4000, human: "畫面" },
  // 動作走位：與畫面同為描述，吃續行。上限比畫面小一個量級——它是指示不是全景描述。
  { key: "action", label: ACTION_LABEL, multiline: true, alwaysEmit: true, max: 500, human: "動作" },
  { key: "voiceover", label: VOICE_LABEL, multiline: true, alwaysEmit: true, max: 2000, human: "旁白" },
  // 對白：多行序列，每行「@說話者：台詞」。旁白可用 @旁白 混在裡面達成交錯。
  { key: "dialogue", label: DIALOGUE_LABEL, multiline: true, alwaysEmit: true, max: 2000, human: "對白", blockValue: true },
  { key: "ambience", label: AMBIENCE_LABEL, multiline: true, alwaysEmit: true, max: 500, human: "環境音" },
  // 配樂是區間端點，不是每鏡都有的屬性——只在有標記時輸出，且不吃續行（值是一行寫完的標記）
  { key: "music", label: MUSIC_LABEL, multiline: false, alwaysEmit: false, max: 300, human: "配樂" },
  // 卡片三行排在一鏡的最後，像分場表的場末註記：這一鏡帶誰、在哪、拿什麼。
  // alwaysEmit=false 是刻意的——空的卡片行是**沒有作用**的（留白＝維持原值），
  // 印一行「角色卡：」在編輯模板裡會誤導人以為清空它就能解除綁定。
  { key: "characters", label: CHARACTERS_LABEL, card: true, multiline: false, alwaysEmit: false, max: SCRIPT_CARD_LINE_MAX, human: CHARACTERS_LABEL },
  { key: "scenePresets", label: SCENE_PRESETS_LABEL, card: true, multiline: false, alwaysEmit: false, max: SCRIPT_CARD_LINE_MAX, human: SCENE_PRESETS_LABEL },
  { key: "props", label: PROPS_LABEL, card: true, multiline: false, alwaysEmit: false, max: SCRIPT_CARD_LINE_MAX, human: PROPS_LABEL },
];

/**
 * multiline=false 保留給「名單型」欄位（配樂／角色卡／場景卡／素材卡）——它們排在一鏡的最後，
 * 使用者在鏡末尾補一句筆記時，那句話會被吞進名單再拿去查卡片，而查不到就整行不套用，
 * 等於他補的筆記讓整鏡的綁定「看起來壞了」。
 *
 * 描述型欄位（畫面／動作／旁白／環境音）一律 multiline：把它們設成單行會讓續行落回
 * 前一個 multiline 欄位，而那個欄位可能在後面被自己的標籤覆寫——使用者的字就這樣無聲消失。
 * 這是實測出來的：環境音一度被設成單行，「環境音：蟲鳴 / 遠處狗吠 / 旁白：說話」會讓
 * 「遠處狗吠」完全不見。
 */

/** 每一種卡片各自的名單上限（與逐鏡綁定、單次生成同一組常數） */
export const SCRIPT_CARD_MAX: Record<SceneCardKind, number> = {
  characters: MAX_GENERATE_CHARACTERS,
  scenePresets: MAX_GENERATE_SCENE_PRESETS,
  props: MAX_GENERATE_PROPS,
};

/** 卡片行的標籤（伺服器回報「哪一行不套用」時要講同一個字） */
export const SCRIPT_CARD_LABELS: Record<SceneCardKind, string> = {
  characters: CHARACTERS_LABEL,
  scenePresets: SCENE_PRESETS_LABEL,
  props: PROPS_LABEL,
};

/** 這一列現況綁了哪些卡片名字（比對與格式化共用同一個讀法） */
export function scriptRowCardNames(row: StoryboardScriptRow, kind: SceneCardKind): string[] {
  if (kind === "characters") return row.characterNames ?? [];
  if (kind === "scenePresets") return row.scenePresetNames ?? [];
  return row.propNames ?? [];
}

const FIELD_BY_LABEL = new Map(SCRIPT_FIELDS.map((f) => [f.label, f]));
/** 最後一個 multiline 欄位——單行欄位後面的續行落回這裡，而不是被單行欄位吞掉 */
const LAST_MULTILINE_BEFORE = new Map<string, ScriptFieldKey>();
{
  let last: ScriptFieldKey = "prompt";
  for (const f of SCRIPT_FIELDS) {
    LAST_MULTILINE_BEFORE.set(f.label, last);
    if (f.multiline) last = f.key;
  }
}

/** 冒號：全形半形都收（中文輸入法預設打出全形） */
const COLON = "[：:]";
const HEADING_RE = /^##\s*(?:(\d+)\s*[.、．]\s*)?(.*?)\s*(?:[（(]\s*(\d+)\s*(?:s|秒)?\s*[）)])?\s*$/;
// 舊的「設定卡」仍留在集合裡：舊文字貼回來時那一行要被安全忽略，不能被當成自由文字寫進畫面
const ALL_LABELS = [...SCRIPT_FIELDS.map((f) => f.label), LEGACY_CARDS_LABEL];
const LABEL_RE = new RegExp(`^(${ALL_LABELS.join("|")})${COLON}\\s*(.*)$`);

/** 跳脫字元：內容裡「長得像結構」的那一行前面加一個反斜線 */
const ESCAPE = "\\";

/**
 * 這一行照抄進文件會被讀成結構（新的一鏡／新的欄位），所以得跳脫。
 *
 * 沒有這道手續的話，畫面描述裡只要有一行以「旁白：」開頭，光是「打開全文再原封不動寫回」
 * 就會把那行吃掉——使用者什麼都沒改，字卻不見了。
 */
function looksStructural(line: string): boolean {
  const t = line.trim();
  return t.startsWith(SCRIPT_SCENE_HEADING) || LABEL_RE.test(t) || t.startsWith(ESCAPE);
}

/** 多行內容寫進文件前：第二行起若長得像結構就加跳脫（第一行接在標籤後面，不可能被誤讀） */
function escapeBody(text: string): string {
  return text
    .split("\n")
    .map((line, i) => (i > 0 && looksStructural(line) ? `${ESCAPE}${line}` : line))
    .join("\n");
}

/** 讀回來時還原跳脫；只在「拿掉反斜線後真的長得像結構」時還原，才不會動到本來就以 \ 開頭的字 */
function unescapeLine(line: string): string {
  return line.startsWith(ESCAPE) && looksStructural(line.slice(1)) ? line.slice(1) : line;
}

/**
 * 標題寫進 `## ` 那一行前先把換行壓成空白。
 *
 * scenes.title 在 DB 是 text，沒有任何禁換行的守衛（scenes.update 只管長度，MCP 與 AI 拆分鏡
 * 只 trim+slice），所以「開場\n（分鏡師版）」是存得進去的。照原樣輸出的話，換行後那半截會被
 * parse 當成續行吃進畫面描述，標題只剩「開場」——打開全文再原封不動寫回，那半截就永久消失；
 * 若它剛好長得像結構（`旁白：…` 或 `## …`），整份腳本還會從那一鏡起錯位一格。
 * 標題本來就是單行語意，這裡壓掉最省事，也一併擋住所有既有髒資料。
 */
const flattenTitle = (title: string): string => title.replace(/\r?\n/g, " ");

/**
 * 兩種輸出模式，因為這份文字有兩種用途，而它們的需求相反：
 *
 * - `"edit"`（編輯／複製）：空欄位也印出標籤。**這是防呆的一部分**——呼叫端漏傳某欄時，
 *   全欄模板讓那一欄在寫回時被判成「使用者刻意清空」而不是「不存在」，
 *   而測試斷言得到它（環境音漏傳那次的教訓）。也讓人知道這一格可以寫。
 * - `"read"`（唯讀通讀）：省略空欄。欄位變多之後，一律輸出會讓 12 鏡從 59 行漲到 119 行，
 *   編輯框一眼從 3.7 鏡掉到 1.8 鏡——連「這一鏡接不接得上下一鏡」都看不到，
 *   而那正是打開全文的主要動作。唯讀那份從來不會被 parse，壓縮它不影響任何契約。
 */
export type ScriptFormatMode = "edit" | "read";

/** 分鏡 → 文字腳本（可複製、可貼回來改） */
export function formatStoryboardScript(
  rows: StoryboardScriptRow[],
  mode: ScriptFormatMode = "edit",
): string {
  return rows
    .map((row, i) => {
      const lines = [`${SCRIPT_SCENE_HEADING} ${i + 1}. ${flattenTitle(row.title)} (${row.durationSec}s)`];
      for (const field of SCRIPT_FIELDS) {
        const value = field.card
          ? formatCardNames(scriptRowCardNames(row, field.key))
          : (row[field.key] ?? "").trim();
        if (!value && (mode === "read" || !field.alwaysEmit)) continue;
        // blockValue：標籤自己一行，值從下一行開始（逐句序列才對得齊）
        lines.push(
          field.blockValue && value
            ? `${field.label}：\n${escapeBody(value)}`
            : `${field.label}：${escapeBody(value)}`,
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * 欄位上限：與 `scenes.update` 同口徑（有測試盯著不讓兩邊漂移）。
 * 沒有這道檢查的話，寫回這條路等於繞過單格編輯既有的護欄。
 */
export const SCRIPT_TITLE_MAX = 60;
export const SCRIPT_PROMPT_MAX = 4000;
export const SCRIPT_VOICEOVER_MAX = 2000;
/** 環境音是給音效模型的提示詞，不是台詞——比旁白短得多就夠用 */
export const SCRIPT_AMBIENCE_MAX = 500;
/** 動作走位是指示不是全景描述，與環境音同量級 */
export const SCRIPT_ACTION_MAX = 500;
/** 對白與旁白同量級——它們是同一件事的兩種標記 */
export const SCRIPT_DIALOGUE_MAX = 2000;
/** 配樂標記是一行（起｜描述），不是描述段落 */
export const SCRIPT_MUSIC_MAX = 300;
/** 一份腳本最多幾鏡：寫回是逐鏡 insert/update，沒上限等於讓一份貼錯的文件在交易裡跑幾千趟 */
export const MAX_SCRIPT_SCENES = 200;

export type ParsedStoryboardScript = {
  scenes: StoryboardScriptScene[];
  /** 人話問題（不擋套用的用 warnings；擋套用的用 errors） */
  errors: string[];
  warnings: string[];
};

/** 文字腳本 → 分鏡（寬鬆解析；問題以人話回報，不靜默吞掉） */
export function parseStoryboardScript(text: string): ParsedStoryboardScript {
  const errors: string[] = [];
  const warnings: string[] = [];
  const scenes: StoryboardScriptScene[] = [];

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let current: (StoryboardScriptScene & { _label?: ScriptFieldKey }) | null = null;
  let leading = true;

  const flush = () => {
    if (!current) return;
    const { _label, ...scene } = current;
    void _label;
    scene.title = scene.title.trim();
    for (const field of SCRIPT_FIELDS) {
      const v = scene[field.key];
      if (v !== undefined) scene[field.key] = v.trim();
    }
    // 標題留空＝「這鏡的標題我不想動」，與其餘欄位的「省略＝維持原值」同一套語意（UI 上就是這樣寫的）。
    // 以前這裡補「第 N 鏡」佔位，等於把使用者沒寫的欄位當成有寫：寫回端的 `scene.title &&` 守衛
    // 因此成立、原標題被覆蓋；更糟的是 N 取的是文字裡的出現順序，而目標格是照鏡次算的——
    // 只留 `## 1. A` 與 `## 5.` 時，第 5 鏡會被改名成「第 2 鏡」。
    // 新增鏡沒有原值可維持，佔位改在 applyScript 的 insert 分支就地補。
    scenes.push(scene);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.startsWith(SCRIPT_SCENE_HEADING) ? HEADING_RE.exec(line) : null;
    if (heading) {
      flush();
      leading = false;
      const [, ord, title, dur] = heading;
      const durationSec = dur ? Number(dur) : undefined;
      if (durationSec !== undefined && (durationSec < 1 || durationSec > 60)) {
        warnings.push(`「${title || "未命名"}」的秒數 ${durationSec} 超出 1–60，將維持原本秒數`);
      }
      current = {
        title: title ?? "",
        durationSec: durationSec !== undefined && durationSec >= 1 && durationSec <= 60 ? durationSec : undefined,
        ordinal: ord ? Number(ord) : undefined,
      };
      continue;
    }

    if (!current) {
      // 第一個 ## 之前的文字：可能是使用者貼了整份文件的抬頭，忽略但要講出來
      if (leading && line.trim()) {
        leading = false;
        warnings.push("第一個「##」之前的文字不會被匯入（分鏡從「## 」那一行開始算）");
      }
      continue;
    }

    const label = LABEL_RE.exec(line.trim());
    if (label) {
      const [, name, rest] = label;
      const spec = FIELD_BY_LABEL.get(name!);
      if (spec) {
        // 標籤是**賦值**不是附加：連寫兩行「旁白：」只會留下第二句。這是既有行為，
        // 但它會安靜地吃掉第一句，所以這裡把它講出來。
        if (current[spec.key] !== undefined) {
          warnings.push(`第 ${scenes.length + 1} 鏡的「${spec.human}」寫了不只一次，只會採用最後一次`);
        }
        current._label = spec.multiline ? spec.key : LAST_MULTILINE_BEFORE.get(name!);
        current[spec.key] = rest ?? "";
      } else {
        // 設定卡：唯讀標注，讀回來就丟掉（改綁定請到分鏡表那一列）。
        // _label 指回上一個 multiline 欄位——它後面的續行不該憑空消失。
        current._label = LAST_MULTILINE_BEFORE.get(name!);
      }
      continue;
    }

    // 續行：接在最後一個 multiline 標籤底下（沒有標籤就當畫面描述——最常見的手打情況）。
    //
    // 這裡**只接、不 trim**：逐行 trim 會把值中間的空行吃掉（「第一句」+空行+「第二句」
    // 會變成兩行相鄰），而使用者原封不動貼回來時，那個差異會被判成「有變更」寫進 DB——
    // 等於系統偷改了他寫的字。頭尾空白留到 flush() 一次處理即可。
    const content = unescapeLine(line);
    const target: ScriptFieldKey = current._label ?? "prompt";
    current[target] = `${current[target] ?? ""}\n${content}`;
  }
  flush();

  if (scenes.length === 0 && text.trim()) {
    errors.push("看不到任何分鏡——每一鏡要以「## 」開頭，例如「## 1. 開場 (5s)」");
  }
  errors.push(...limitErrors(scenes));
  return { scenes, errors, warnings };
}

/** 超長就擋下來講清楚，不靜默截短——被切掉的是使用者自己寫的字 */
function limitErrors(scenes: StoryboardScriptScene[]): string[] {
  const errors: string[] = [];
  if (scenes.length > MAX_SCRIPT_SCENES) {
    errors.push(`一份腳本最多 ${MAX_SCRIPT_SCENES} 鏡，這份有 ${scenes.length} 鏡——請分批寫回`);
    return errors; // 已經爆量就不再逐鏡列，錯誤訊息會洗版
  }
  scenes.forEach((scene, i) => {
    // 標題可以留空（＝維持原值），錯誤訊息裡別出現一對空引號
    const where = `第 ${i + 1} 鏡「${scene.title.slice(0, 12) || "未命名"}」`;
    if (scene.title.length > SCRIPT_TITLE_MAX) {
      errors.push(`${where}的標題 ${scene.title.length} 字，超過 ${SCRIPT_TITLE_MAX} 字`);
    }
    // 逐欄上限一律由 SCRIPT_FIELDS 導出——各寫一份 if 就是讓「新增欄位忘了加檢查」
    // 變成靜默通過，而繞過的正是單格編輯的護欄。
    for (const field of SCRIPT_FIELDS) {
      const len = scene[field.key]?.length ?? 0;
      if (len > field.max) {
        errors.push(`${where}的${field.human} ${len} 字，超過 ${field.max} 字`);
      }
    }
  });
  return errors;
}

export type StoryboardScriptTarget = {
  scene: StoryboardScriptScene;
  /** 對到既有分鏡的索引；null＝這鏡是新增的（接在末尾） */
  rowIndex: number | null;
};

/**
 * 每一段文字對到哪一鏡。
 *
 * 關鍵是**標題上的鏡次優先於出現順序**：匯出的 A/B/C 只留下「## 1. A」與「## 3. C」時，
 * C 仍然對到第 3 鏡。若一律照陣列位置對，C 的內容會蓋掉 B，末尾的 C 原封不動——
 * 結果是 A/C/C，而畫面上還寫著「保留 1 鏡不動」。那就是說謊。
 *
 * 鏡次倒退、重複或缺漏時不採信，退回依序對應（手打的人不必記編號）。
 */
export function resolveScriptTargets(
  rowCount: number,
  scenes: StoryboardScriptScene[],
): StoryboardScriptTarget[] {
  const targets: StoryboardScriptTarget[] = [];
  let cursor = 0; // 下一個還沒被認領的既有分鏡
  for (const scene of scenes) {
    const byOrdinal =
      scene.ordinal !== undefined && scene.ordinal - 1 >= cursor ? scene.ordinal - 1 : null;
    const index = byOrdinal ?? cursor;
    if (index < rowCount) {
      targets.push({ scene, rowIndex: index });
      cursor = index + 1;
    } else {
      // 超出既有鏡數＝新增；後面每一鏡也都只能是新增（這條路只往末尾長，不從中間插）
      targets.push({ scene, rowIndex: null });
      cursor = rowCount;
    }
  }
  return targets;
}

export type StoryboardScriptDiff = {
  /** 依序對應到既有分鏡、且內容有變的 */
  updated: Array<{ index: number; title: string }>;
  /** 文字裡多出來的鏡，將新增到末尾 */
  created: string[];
  /** 既有分鏡比文字多出來的：保留不動（絕不因為文字沒寫就刪掉已出圖的格） */
  keptUntouched: number;
};

function changed(row: StoryboardScriptRow, scene: StoryboardScriptScene): boolean {
  // `scene.title &&`：與伺服器端 applyScript 的 patch 判斷同一個守衛（標題留空＝維持原值）。
  // 兩邊少一個就會分岔——預覽說「這鏡沒變」、寫回卻把標題清成空字串。
  if (scene.title && scene.title !== row.title) return true;
  if (scene.durationSec !== undefined && scene.durationSec !== row.durationSec) return true;
  // 同上：逐欄比對表驅動。漏一欄的症狀是「畫面說沒變更，DB 卻被改了」——最難查的那種。
  for (const field of SCRIPT_FIELDS) {
    const next = scene[field.key];
    if (next === undefined) continue;
    if (field.card) {
      // 卡片行的「空」不等於「清空」，所以不能拿字串直接比：留白的那一行什麼都不會發生，
      // 照字串比會算成「更新 N 鏡」，按下去卻毫無動靜——預覽說謊比不預覽更糟。
      const intent = parseCardLine(next);
      if (intent.kind === "absent" || intent.kind === "blank") continue;
      const now = scriptRowCardNames(row, field.key);
      if (intent.kind === "clear" ? now.length > 0 : formatCardNames(intent.names) !== formatCardNames(now)) {
        return true;
      }
      continue;
    }
    if (next !== (row[field.key] ?? "").trim()) return true;
  }
  return false;
}

/** 套用前先算清楚會動到什麼——扣不扣點不談，覆寫別人寫的字也該先講 */
export function diffStoryboardScript(
  rows: StoryboardScriptRow[],
  scenes: StoryboardScriptScene[],
): StoryboardScriptDiff {
  const updated: StoryboardScriptDiff["updated"] = [];
  const created: string[] = [];
  // 與伺服器共用同一支對應規則——預覽說「保留不動」，寫回就真的不能動到它
  const targets = resolveScriptTargets(rows.length, scenes);
  let touched = 0;
  for (const { scene, rowIndex } of targets) {
    if (rowIndex === null) {
      created.push(scene.title);
      continue;
    }
    touched += 1;
    if (changed(rows[rowIndex], scene)) updated.push({ index: rowIndex, title: scene.title });
  }
  return { updated, created, keptUntouched: Math.max(0, rows.length - touched) };
}

/** 人話摘要（確認框用） */
export function summarizeStoryboardScriptDiff(diff: StoryboardScriptDiff): string {
  const parts: string[] = [];
  if (diff.updated.length) parts.push(`更新 ${diff.updated.length} 鏡`);
  if (diff.created.length) parts.push(`新增 ${diff.created.length} 鏡`);
  if (diff.keptUntouched) parts.push(`保留 ${diff.keptUntouched} 鏡不動（文字裡沒寫到）`);
  return parts.join("、") || "沒有任何變更";
}
