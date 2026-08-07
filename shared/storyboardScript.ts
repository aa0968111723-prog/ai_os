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
 *   環境音：遠處鐘聲，細微鳥鳴
 *
 * 解析規則刻意寬鬆（序號、秒數、任一區塊都可省略；全形半形冒號都吃），
 * 但**套用規則刻意保守**：只更新與新增，永不刪除。文字裡少寫一鏡不該讓
 * 已經出好圖的那一格消失——要刪請到分鏡表按刪除，那裡有確認框。
 */

export type StoryboardScriptScene = {
  title: string;
  durationSec?: number;
  prompt?: string;
  voiceover?: string;
  /** 這一鏡聽得到什麼（環境音／音效）。與 voiceover 對稱，同樣是可寫回的文字。 */
  ambience?: string;
  /** 誰做了什麼、從哪走到哪。刻意與 prompt 分開：走位是時間性的，單張圖畫不出來。 */
  action?: string;
  /**
   * 標題上的鏡次（`## 3.` 的 3）。這不是裝飾，是**身分證**：中間整段沒寫時，
   * 靠它才知道「## 3.」指的仍是第 3 鏡，而不是往前遞補成第 2 鏡。見 resolveScriptTargets。
   */
  ordinal?: number;
};

/** 分鏡表現況（格式化時用；卡片名稱只讀，不從文字寫回——靠名字回推卡片太脆弱） */
export type StoryboardScriptRow = {
  title: string;
  durationSec: number;
  prompt?: string | null;
  voiceover?: string | null;
  ambience?: string | null;
  action?: string | null;
  /** 這一鏡綁定的卡片名字，僅供閱讀時標注 */
  cardNames?: string[];
};

export const SCRIPT_SCENE_HEADING = "##";
const VISUAL_LABEL = "畫面";
const ACTION_LABEL = "動作";
const VOICE_LABEL = "旁白";
const AMBIENCE_LABEL = "環境音";
const CARDS_LABEL = "設定卡";

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
export type ScriptFieldKey = "prompt" | "action" | "voiceover" | "ambience";

type ScriptFieldSpec = {
  key: ScriptFieldKey;
  label: string;
  /** 吃續行？false＝只收標籤同一行的內容，後續行落回上一個 multiline 欄位 */
  multiline: boolean;
  /** 空的也輸出一行？（只影響「編輯用」的全欄模板，唯讀通讀一律省略空欄） */
  alwaysEmit: boolean;
  max: number;
  /** 錯誤訊息裡的人話欄位名 */
  human: string;
};

export const SCRIPT_FIELDS: readonly ScriptFieldSpec[] = [
  { key: "prompt", label: VISUAL_LABEL, multiline: true, alwaysEmit: true, max: 4000, human: "畫面" },
  // 動作走位：與畫面同為描述，吃續行。上限比畫面小一個量級——它是指示不是全景描述。
  { key: "action", label: ACTION_LABEL, multiline: true, alwaysEmit: true, max: 500, human: "動作" },
  { key: "voiceover", label: VOICE_LABEL, multiline: true, alwaysEmit: true, max: 2000, human: "旁白" },
  { key: "ambience", label: AMBIENCE_LABEL, multiline: true, alwaysEmit: true, max: 500, human: "環境音" },
] as const;

/**
 * multiline=false 保留給「名單型」欄位（角色／場景／道具／配樂）——它們排在一鏡的最後，
 * 使用者在鏡末尾補一句筆記時，那句話會被吞進名單再拿去查卡片，命中 0 張就把整鏡綁定解掉。
 *
 * 描述型欄位（畫面／動作／旁白／環境音）一律 multiline：把它們設成單行會讓續行落回
 * 前一個 multiline 欄位，而那個欄位可能在後面被自己的標籤覆寫——使用者的字就這樣無聲消失。
 * 這是實測出來的：環境音一度被設成單行，「環境音：蟲鳴 / 遠處狗吠 / 旁白：說話」會讓
 * 「遠處狗吠」完全不見。
 */

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
// CARDS_LABEL 仍留在集合裡：舊文字貼回來時那一行要被安全忽略，不能被當成自由文字寫進畫面
const ALL_LABELS = [...SCRIPT_FIELDS.map((f) => f.label), CARDS_LABEL];
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
      const lines = [`${SCRIPT_SCENE_HEADING} ${i + 1}. ${row.title} (${row.durationSec}s)`];
      for (const field of SCRIPT_FIELDS) {
        const value = (row[field.key] ?? "").trim();
        if (!value && (mode === "read" || !field.alwaysEmit)) continue;
        lines.push(`${field.label}：${escapeBody(value)}`);
      }
      // 卡片是唯讀標注：讓人讀腳本時知道這鏡會帶誰，但改文字不會動到綁定
      if (row.cardNames?.length) lines.push(`${CARDS_LABEL}：${row.cardNames.join("・")}（唯讀）`);
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
    if (!scene.title) scene.title = `第 ${scenes.length + 1} 鏡`;
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
    const where = `第 ${i + 1} 鏡「${scene.title.slice(0, 12)}」`;
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
  if (scene.title !== row.title) return true;
  if (scene.durationSec !== undefined && scene.durationSec !== row.durationSec) return true;
  // 同上：逐欄比對表驅動。漏一欄的症狀是「畫面說沒變更，DB 卻被改了」——最難查的那種。
  for (const field of SCRIPT_FIELDS) {
    const next = scene[field.key];
    if (next !== undefined && next !== (row[field.key] ?? "").trim()) return true;
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
