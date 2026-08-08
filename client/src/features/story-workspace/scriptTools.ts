/**
 * 劇本編寫的專業工具（純函式；不含 React）。
 *
 * 一個純 textarea 對「寫故事」是夠的，對「寫劇本」不夠：編劇要標注（誰是角色、
 * 哪一行是對白、哪句是寫給自己的備註）、要在長稿裡跳場、要知道現在寫了多長、
 * 要能一次改掉主角名字。這些全部是可以錯的邏輯——「標注後選取範圍跑掉」
 * 「取代把備註行也改了」在 UI 裡看不出來，所以規則抽在這裡，由測試守住。
 *
 * 標注一律落在**故事全文本身**（不是另一張旁邊的表）：故事是唯一來源，
 * 版本、協作、複製貼上、AI 解析吃的都是這份文字。編輯器不發明只有自己看得懂的
 * 中繼格式——插進去的前綴就是解析引擎讀的那一套（角色：／場景：／道具：／造型：）。
 */
import { isStoryNoteLine, STORY_NOTE_PREFIX } from "@shared/story";

export type MarkKind =
  | "character"
  | "location"
  | "prop"
  | "look"
  | "dialogue"
  | "voiceover"
  | "action"
  | "transition"
  | "note";

export interface ScriptMark {
  kind: MarkKind;
  label: string;
  prefix: string;
  /**
   * declare＝自成一行的宣告（角色／場景／道具／造型）：在游標所在行**上方**插一行，
   *   原文一字不動——使用者是在替一段已經寫好的散文補設定，不是把散文改寫成表格。
   * line＝就地標注（對白／旁白／動作／轉場／註記）：在選取到的每一行前面加前綴，
   *   再按一次拿掉（toggle）——標錯了要能一鍵還原，不然只能手動刪前綴。
   */
  mode: "declare" | "line";
  /** 工具列 title：講清楚它會做什麼、AI 解析會怎麼讀它 */
  hint: string;
  shortcut?: string;
}

/** 標注清單（工具列順序＝這份順序；快捷鍵對照表由此產生，不各寫一次） */
export const SCRIPT_MARKS: ScriptMark[] = [
  {
    kind: "character",
    label: "角色",
    prefix: "角色：",
    mode: "declare",
    hint: "把選取的名字宣告成角色（AI 解析會建角色卡）。可寫成「名（外觀描述）」",
    shortcut: "Alt+1",
  },
  {
    kind: "location",
    label: "場景",
    prefix: "場景：",
    mode: "declare",
    hint: "宣告一個場景／地點（AI 解析會建場景卡）。可寫成「名（固定特徵）」",
    shortcut: "Alt+2",
  },
  {
    kind: "prop",
    label: "道具",
    prefix: "道具：",
    mode: "declare",
    hint: "宣告一件道具（AI 解析會建道具卡）。可寫成「名（材質外觀）」",
    shortcut: "Alt+3",
  },
  {
    kind: "look",
    label: "造型",
    prefix: "造型：",
    mode: "declare",
    hint: "指定某個角色在這段故事裡的服裝造型，格式「造型：角色＝描述」",
    shortcut: "Alt+4",
  },
  {
    kind: "dialogue",
    label: "對白",
    prefix: "對白：",
    mode: "line",
    hint: "把整行標成角色說出口的話（再按一次取消）",
    shortcut: "Alt+5",
  },
  {
    kind: "voiceover",
    label: "旁白",
    prefix: "旁白：",
    mode: "line",
    hint: "把整行標成旁白／獨白（再按一次取消）",
    shortcut: "Alt+6",
  },
  {
    kind: "action",
    label: "動作",
    prefix: "動作：",
    mode: "line",
    hint: "把整行標成動作走位（再按一次取消）",
    shortcut: "Alt+7",
  },
  {
    kind: "transition",
    label: "轉場",
    prefix: "轉場：",
    mode: "line",
    hint: "標一個轉場點（淡出、切至…），大綱會把它當段落分界",
    shortcut: "Alt+8",
  },
  {
    kind: "note",
    label: "註記",
    prefix: STORY_NOTE_PREFIX,
    mode: "line",
    hint: "寫給自己或夥伴的備註——會留在稿子裡，但 AI 解析一律略過",
    shortcut: "Alt+9",
  },
];

export const MARK_BY_KIND: Record<MarkKind, ScriptMark> = Object.fromEntries(
  SCRIPT_MARKS.map((m) => [m.kind, m]),
) as Record<MarkKind, ScriptMark>;

export interface EditResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** 游標所在（或選取涵蓋）的整行範圍 [行首, 行尾)——行尾不含換行 */
export function lineRange(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = text.indexOf("\n", end);
  return { from, to: nextBreak === -1 ? text.length : nextBreak };
}

/**
 * 套用一個標注。回傳新全文與新的選取範圍——選取範圍一定要跟著算，
 * 不然每標一次游標就跳回開頭，連續標三個東西＝重新找三次位置。
 */
export function applyMark(text: string, start: number, end: number, mark: ScriptMark): EditResult {
  const selected = text.slice(start, end);
  if (mark.mode === "declare") return applyDeclaration(text, start, end, mark, selected);
  return toggleLinePrefix(text, start, end, mark.prefix);
}

function applyDeclaration(
  text: string,
  start: number,
  end: number,
  mark: ScriptMark,
  selected: string,
): EditResult {
  const { from } = lineRange(text, start, end);
  // 造型需要「角色＝描述」；選了名字就先把等號擺好，游標停在描述位置
  const body = selected.trim().replace(/\s+/g, " ");
  const payload = mark.kind === "look" && body ? `${body}＝` : body;
  const insertion = `${mark.prefix}${payload}\n`;
  const next = text.slice(0, from) + insertion + text.slice(from);
  // 游標落在宣告行末尾（等著補描述），而不是選回原本那段散文
  const caret = from + insertion.length - 1;
  return { text: next, selectionStart: caret, selectionEnd: caret };
}

function toggleLinePrefix(text: string, start: number, end: number, prefix: string): EditResult {
  const { from, to } = lineRange(text, start, end);
  const block = text.slice(from, to);
  const lines = block.split("\n");
  const meaningful = lines.filter((l) => l.trim().length > 0);
  // 全部都已經有這個前綴 → 這次是「取消標注」
  const allMarked = meaningful.length > 0 && meaningful.every((l) => l.trimStart().startsWith(prefix));
  const nextLines = lines.map((line) => {
    if (!line.trim()) return line;
    const indent = line.slice(0, line.length - line.trimStart().length);
    const bare = line.trimStart();
    if (allMarked) return indent + bare.slice(prefix.length).trimStart();
    // 換標注（原本是旁白、現在改對白）：先脫掉舊前綴再加新的，不要疊成「對白：旁白：」
    const stripped = stripAnyMarkPrefix(bare);
    return indent + prefix + stripped;
  });
  const replaced = nextLines.join("\n");
  const nextText = text.slice(0, from) + replaced + text.slice(to);
  // 空行游標：停在前綴後面等著打字；其餘情況選起整個標注區塊
  if (start === end && !block.trim()) {
    const caret = from + replaced.length;
    return { text: nextText, selectionStart: caret, selectionEnd: caret };
  }
  return { text: nextText, selectionStart: from, selectionEnd: from + replaced.length };
}

const ALL_PREFIXES = SCRIPT_MARKS.map((m) => m.prefix);

function stripAnyMarkPrefix(line: string): string {
  for (const p of ALL_PREFIXES) {
    if (line.startsWith(p)) return line.slice(p.length).trimStart();
  }
  return line;
}

/* ── 大綱（長稿導覽）────────────────────────────────── */

export interface OutlineItem {
  /** 在全文中的字元位移（點一下就把游標送過去） */
  offset: number;
  /** 顯示用標籤 */
  label: string;
  /** heading＝作者明寫的分場（場景：／# 標題／轉場：）；paragraph＝空行分段的推測分場 */
  kind: "heading" | "paragraph";
}

const HEADING_LINE = /^\s*(?:#{1,6}\s+|場景[:：]|轉場[:：]|第\s*[0-9一二三四五六七八九十]+\s*[場幕])/;

/**
 * 大綱：作者明寫的分場優先；一個都沒有時退回「空行分段」——
 * 因為解析引擎就是拿空行當分場依據（一段＝一場戲），大綱要跟它講同一件事，
 * 不能自己另一套，否則使用者照大綱數的場數跟解析結果對不起來。
 */
export function scriptOutline(text: string, limit = 200): OutlineItem[] {
  const lines = text.split("\n");
  const headings: OutlineItem[] = [];
  let offset = 0;
  for (const line of lines) {
    if (!isStoryNoteLine(line) && HEADING_LINE.test(line)) {
      headings.push({ offset, label: previewOf(line), kind: "heading" });
    }
    offset += line.length + 1;
  }
  if (headings.length) return headings.slice(0, limit);

  const items: OutlineItem[] = [];
  let cursor = 0;
  let n = 0;
  for (const para of text.split(/\n{2,}/)) {
    const lead = para.length - para.trimStart().length;
    const body = para.trim();
    if (body) {
      n += 1;
      items.push({ offset: cursor + lead, label: `第 ${n} 段・${previewOf(body)}`, kind: "paragraph" });
    }
    cursor += para.length + 2;
    if (items.length >= limit) break;
  }
  return items;
}

function previewOf(line: string, max = 24): string {
  const t = line.replace(/^\s*#{1,6}\s+/, "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/* ── 統計（寫了多長、大概幾場幾鏡）────────────────────────── */

export interface ScriptStats {
  /** 不含空白與備註行的字數（中文稿看的是這個，不是含空白的 length） */
  chars: number;
  /** 備註行字數（另計，讓人知道有多少是寫給自己的） */
  noteChars: number;
  /** 空行分段數＝解析預期的場數 */
  paragraphs: number;
  /** 句子數＝解析預期的鏡數量級 */
  sentences: number;
  /** 預估片長（秒）：以解析引擎的預設 5 秒／鏡估 */
  estSeconds: number;
}

/** 預設每鏡秒數（與 storyParse 的 durationSec 預設同值，估算才不會跟實際分鏡打架） */
export const SECONDS_PER_SHOT = 5;

export function scriptStats(text: string): ScriptStats {
  const lines = text.split(/\r?\n/);
  const noteChars = lines
    .filter(isStoryNoteLine)
    .reduce((n, l) => n + l.replace(/\s+/g, "").length, 0);
  const body = lines.filter((l) => !isStoryNoteLine(l)).join("\n");
  const chars = body.replace(/\s+/g, "").length;
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim()).length;
  const sentences = body
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
  return { chars, noteChars, paragraphs, sentences, estSeconds: sentences * SECONDS_PER_SHOT };
}

/** 「3 分 05 秒」——秒數直接給人看太難換算 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m > 0 ? `${m} 分 ${String(rest).padStart(2, "0")} 秒` : `${rest} 秒`;
}

/* ── 尋找／取代 ────────────────────────────────────── */

export interface Match {
  start: number;
  end: number;
}

export function findMatches(text: string, query: string, caseSensitive = false): Match[] {
  if (!query) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: Match[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    out.push({ start: at, end: at + needle.length });
    from = at + needle.length; // 不重疊：改名時重疊命中會取代出亂碼
  }
  return out;
}

/**
 * 全部取代。備註行不動——備註常常寫著「主角原本叫小美，先不要改」，
 * 一起被改掉的話那句話就自相矛盾了；而且備註本來就不是作品內容。
 */
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  caseSensitive = false,
): { text: string; count: number } {
  if (!query) return { text, count: 0 };
  let count = 0;
  const next = text
    .split("\n")
    .map((line) => {
      if (isStoryNoteLine(line)) return line;
      const hits = findMatches(line, query, caseSensitive);
      if (!hits.length) return line;
      count += hits.length;
      let out = "";
      let cursor = 0;
      for (const h of hits) {
        out += line.slice(cursor, h.start) + replacement;
        cursor = h.end;
      }
      return out + line.slice(cursor);
    })
    .join("\n");
  return { text: next, count };
}

/* ── 快捷鍵 ────────────────────────────────────────── */

export type ScriptAction =
  | { type: "mark"; kind: MarkKind }
  | { type: "toggleImmersive" }
  | { type: "exitImmersive" }
  | { type: "toggleFind" }
  | { type: "toggleOutline" };

export interface ScriptKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const ALT_DIGIT_TO_KIND: Record<string, MarkKind> = {
  "1": "character",
  "2": "location",
  "3": "prop",
  "4": "look",
  "5": "dialogue",
  "6": "voiceover",
  "7": "action",
  "8": "transition",
  "9": "note",
};

/**
 * 事件 → 動作。
 *
 * 與動畫創作室的快捷鍵表刻意不同：那裡焦點在畫布上，這裡**焦點就在 textarea 裡**
 * （手不會離開鍵盤才是重點），所以不能沿用「在輸入框裡一律讓路」的規則。
 * 代價是每一顆鍵都必須帶修飾鍵，否則使用者打「1」就會插進一行「角色：」。
 */
export function resolveScriptShortcut(event: ScriptKeyEvent): ScriptAction | null {
  const mod = !!event.ctrlKey || !!event.metaKey;
  if (event.altKey && !mod) {
    const kind = ALT_DIGIT_TO_KIND[event.key];
    if (kind) return { type: "mark", kind };
    return null;
  }
  if (event.key === "Escape") return { type: "exitImmersive" };
  if (!mod) return null;
  const key = event.key.toLowerCase();
  if (key === "f") return event.shiftKey ? { type: "toggleImmersive" } : { type: "toggleFind" };
  if (key === "o" && event.shiftKey) return { type: "toggleOutline" };
  return null;
}

export const SCRIPT_SHORTCUT_HINTS: Array<{ keys: string; what: string }> = [
  { keys: "Ctrl/⌘ + Shift + F", what: "全螢幕寫作" },
  { keys: "Esc", what: "離開全螢幕" },
  { keys: "Ctrl/⌘ + F", what: "尋找／取代" },
  { keys: "Ctrl/⌘ + Shift + O", what: "大綱" },
  { keys: "Alt + 1～9", what: "角色／場景／道具／造型／對白／旁白／動作／轉場／註記" },
];
