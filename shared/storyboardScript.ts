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
};

/** 分鏡表現況（格式化時用；卡片名稱只讀，不從文字寫回——靠名字回推卡片太脆弱） */
export type StoryboardScriptRow = {
  title: string;
  durationSec: number;
  prompt?: string | null;
  voiceover?: string | null;
  /** 這一鏡綁定的卡片名字，僅供閱讀時標注 */
  cardNames?: string[];
};

export const SCRIPT_SCENE_HEADING = "##";
const VISUAL_LABEL = "畫面";
const VOICE_LABEL = "旁白";
const CARDS_LABEL = "設定卡";

/** 冒號：全形半形都收（中文輸入法預設打出全形） */
const COLON = "[：:]";
const HEADING_RE = /^##\s*(?:(\d+)\s*[.、．]\s*)?(.*?)\s*(?:[（(]\s*(\d+)\s*(?:s|秒)?\s*[）)])?\s*$/;
const LABEL_RE = new RegExp(`^(${VISUAL_LABEL}|${VOICE_LABEL}|${CARDS_LABEL})${COLON}\\s*(.*)$`);

/** 分鏡 → 文字腳本（可複製、可貼回來改） */
export function formatStoryboardScript(rows: StoryboardScriptRow[]): string {
  return rows
    .map((row, i) => {
      const lines = [`${SCRIPT_SCENE_HEADING} ${i + 1}. ${row.title} (${row.durationSec}s)`];
      lines.push(`${VISUAL_LABEL}：${(row.prompt ?? "").trim()}`);
      lines.push(`${VOICE_LABEL}：${(row.voiceover ?? "").trim()}`);
      // 卡片是唯讀標注：讓人讀腳本時知道這鏡會帶誰，但改文字不會動到綁定
      if (row.cardNames?.length) lines.push(`${CARDS_LABEL}：${row.cardNames.join("・")}（唯讀）`);
      return lines.join("\n");
    })
    .join("\n\n");
}

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
  let current: (StoryboardScriptScene & { _label?: string }) | null = null;
  let leading = true;

  const flush = () => {
    if (!current) return;
    const { _label, ...scene } = current;
    void _label;
    scene.title = scene.title.trim();
    scene.prompt = scene.prompt?.trim();
    scene.voiceover = scene.voiceover?.trim();
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
      const [, , title, dur] = heading;
      const durationSec = dur ? Number(dur) : undefined;
      if (durationSec !== undefined && (durationSec < 1 || durationSec > 60)) {
        warnings.push(`「${title || "未命名"}」的秒數 ${durationSec} 超出 1–60，將維持原本秒數`);
      }
      current = {
        title: title ?? "",
        durationSec: durationSec !== undefined && durationSec >= 1 && durationSec <= 60 ? durationSec : undefined,
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
      if (name === VISUAL_LABEL) {
        current._label = VISUAL_LABEL;
        current.prompt = rest ?? "";
      } else if (name === VOICE_LABEL) {
        current._label = VOICE_LABEL;
        current.voiceover = rest ?? "";
      } else {
        // 設定卡是唯讀標注，讀回來就丟掉（改綁定請到分鏡表那一列）
        current._label = CARDS_LABEL;
      }
      continue;
    }

    // 續行：接在最後一個標籤底下（沒有標籤就當畫面描述——最常見的手打情況）
    if (current._label === VOICE_LABEL) {
      current.voiceover = `${current.voiceover ?? ""}\n${line}`.trim();
    } else if (current._label === CARDS_LABEL) {
      // 唯讀區塊的續行一併忽略
    } else {
      current.prompt = `${current.prompt ?? ""}\n${line}`.trim();
    }
  }
  flush();

  if (scenes.length === 0 && text.trim()) {
    errors.push("看不到任何分鏡——每一鏡要以「## 」開頭，例如「## 1. 開場 (5s)」");
  }
  return { scenes, errors, warnings };
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
  if (scene.prompt !== undefined && scene.prompt !== (row.prompt ?? "").trim()) return true;
  if (scene.voiceover !== undefined && scene.voiceover !== (row.voiceover ?? "").trim()) return true;
  return false;
}

/** 套用前先算清楚會動到什麼——扣不扣點不談，覆寫別人寫的字也該先講 */
export function diffStoryboardScript(
  rows: StoryboardScriptRow[],
  scenes: StoryboardScriptScene[],
): StoryboardScriptDiff {
  const updated: StoryboardScriptDiff["updated"] = [];
  const created: string[] = [];
  scenes.forEach((scene, i) => {
    const row = rows[i];
    if (!row) {
      created.push(scene.title);
      return;
    }
    if (changed(row, scene)) updated.push({ index: i, title: scene.title });
  });
  return { updated, created, keptUntouched: Math.max(0, rows.length - scenes.length) };
}

/** 人話摘要（確認框用） */
export function summarizeStoryboardScriptDiff(diff: StoryboardScriptDiff): string {
  const parts: string[] = [];
  if (diff.updated.length) parts.push(`更新 ${diff.updated.length} 鏡`);
  if (diff.created.length) parts.push(`新增 ${diff.created.length} 鏡`);
  if (diff.keptUntouched) parts.push(`保留 ${diff.keptUntouched} 鏡不動（文字裡沒寫到）`);
  return parts.join("、") || "沒有任何變更";
}
