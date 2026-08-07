/**
 * 一鏡的說話序列：旁白與對白按順序排在同一份文字裡，但分得出來誰是誰。
 *
 * 為什麼旁白與對白要在同一個序列，而不是各自一欄：
 * 使用者要的是「旁白說一句 → 師父插話 → 旁白接下去」。兩個獨立欄位表達不了先後，
 * 硬做就會變成「旁白一律在前」——那不是交錯，是排序被系統決定。
 *
 * 為什麼存原文 text 而不是結構化 jsonb：
 * `applyScript` 的整套保守契約（省略＝維持原值、永不刪除）建立在字串比對上。
 * 結構化儲存會讓「解析器沒完全看懂的那一行」在來回之後被正規化、被重排——
 * 使用者自己打的字被系統改掉。解析失敗的代價必須是「這句沒標到人」，
 * 絕不能是「這句少了三個字」。結構一律在讀取時由本模組導出，永不落庫。
 *
 * 格式：
 *
 *   @旁白：那一年，我第一次走進禪堂。
 *   @師父：坐吧。心急的人，茶會燙。
 *   @安倢（小聲）：謝謝師父。
 *   @師父（畫外）：茶要等，人也要等。
 *
 * `@` 是必要的，不是裝飾：它把角色名關在「值」的位置。若允許裸名（`安倢：台詞`），
 * 畫面描述裡一句「構圖：中景」就會被讀成一個叫「構圖」的角色。而 `@安倢：…` 這一行
 * 不匹配文字腳本的標籤規則，所以不需要跳脫、不會與任何既有欄位打架。
 */

/** 保留說話者：旁白（畫外音）。與角色卡同名時仍一律視為旁白——它是系統語彙。 */
export const NARRATOR_SPEAKER = "旁白";

/** 說話者前綴。半形 @ 與全形＠都收（中文輸入法會打出全形）。 */
const SPEAKER_RE = /^[@＠]\s*([^（(：:]{1,40}?)\s*(?:[（(]\s*([^）)]{0,40})\s*[）)])?\s*[：:]\s*(.*)$/;

export type SpeechLine = {
  /** 說話者名字；旁白為 NARRATOR_SPEAKER */
  speaker: string;
  /** 這一句是旁白（畫外音）還是角色台詞——字幕與配音各自據此分流 */
  isNarration: boolean;
  /** 括號指示（小聲、畫外、OS…）；沒有就是 undefined。不進 TTS 的唸詞。 */
  parenthetical?: string;
  /** 真正要唸／要上字幕的台詞 */
  text: string;
};

/**
 * 說話序列 → 逐句。
 *
 * 不以 `@` 開頭的行是**上一句的續行**（一句台詞可以跨行寫，空行也保留）。
 * 整段開頭若沒有任何 `@`，整段視為旁白——使用者只寫了一段話而沒標人，
 * 最合理的解讀是旁白，而不是報錯把他擋在門外。
 */
export function parseSpeechLines(dialogue: string | null | undefined): SpeechLine[] {
  const raw = (dialogue ?? "").replace(/\r\n?/g, "\n");
  if (!raw.trim()) return [];

  const lines: SpeechLine[] = [];
  let current: SpeechLine | null = null;

  for (const line of raw.split("\n")) {
    const m = SPEAKER_RE.exec(line.trim());
    if (m) {
      if (current) lines.push(current);
      const speaker = m[1]!.trim() || NARRATOR_SPEAKER;
      current = {
        speaker,
        isNarration: speaker === NARRATOR_SPEAKER,
        ...(m[2]?.trim() ? { parenthetical: m[2].trim() } : {}),
        text: m[3] ?? "",
      };
      continue;
    }
    if (!current) {
      // 開頭沒標人：整段當旁白（最常見的手打情況——只寫了一段話）
      current = { speaker: NARRATOR_SPEAKER, isNarration: true, text: line };
      continue;
    }
    // 續行只接不 trim：值中間的空行要保留（理由同 storyboardScript 的續行規則）
    current.text = `${current.text}\n${line}`;
  }
  if (current) lines.push(current);

  return lines
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text !== "" || l.speaker !== NARRATOR_SPEAKER);
}

/** 逐句 → 說話序列文字（來回不失真的另一半） */
export function formatSpeechLines(lines: readonly SpeechLine[]): string {
  return lines
    .map((l) => `@${l.speaker}${l.parenthetical ? `（${l.parenthetical}）` : ""}：${l.text}`)
    .join("\n");
}

/**
 * 這一鏡出現的角色名（不含旁白，去重、保留出現順序）。
 *
 * 用途是「文字裡提到誰」的一致性提示——不是綁定來源。綁定的唯一來源是卡片行，
 * 因為對白裡提到的名字未必該出現在畫面上（「安倢的紅傘還立在門邊」，她已經離開）。
 */
export function speakersOf(dialogue: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const line of parseSpeechLines(dialogue)) {
    if (!line.isNarration) seen.add(line.speaker);
  }
  return [...seen];
}

/**
 * 送去 TTS 的唸詞：括號指示要剝掉（那是給人看的表演提示，唸出來是廢音檔）。
 * `voiceOf` 給每個說話者的音色；回 undefined 代表用預設音色。
 */
export function speechForTts(
  lines: readonly SpeechLine[],
  voiceOf?: (speaker: string) => string | undefined,
): Array<{ text: string; voice?: string; speaker: string }> {
  return lines
    .filter((l) => l.text.trim() !== "")
    .map((l) => ({
      speaker: l.speaker,
      text: l.text,
      ...(voiceOf?.(l.speaker) ? { voice: voiceOf(l.speaker)! } : {}),
    }));
}

/**
 * 字幕文字：角色台詞冠上名字，旁白不冠。
 *
 * SRT 規格沒有說話者機制，業界實務就是把名字寫進內文。要正規化的標記另出 .vtt
 * （`<v 安倢>`），不動 SRT——剪映等工具只吃得下純文字。
 */
export function speechForSubtitle(lines: readonly SpeechLine[]): string {
  return lines
    .filter((l) => l.text.trim() !== "")
    .map((l) => (l.isNarration ? l.text : `${l.speaker}：${l.text}`))
    .join("\n");
}

/**
 * 一鏡的完整說話內容（舊 voiceover ＋ 新 dialogue）。
 *
 * 相容策略：既有專案的 voiceover 一個位元組都不動，讀取時視為**排在最前面的旁白**。
 * 不自動搬家是刻意的——無法可靠區分「土法寫成旁白的對白」與「真旁白裡的『他說：…』」，
 * 自動判斷等於靜默改寫使用者的字。新寫的內容一律進 dialogue，舊的原地繼續有效。
 */
export function sceneSpeechLines(scene: {
  voiceover?: string | null;
  dialogue?: string | null;
}): SpeechLine[] {
  const legacy = (scene.voiceover ?? "").trim();
  const head: SpeechLine[] = legacy
    ? [{ speaker: NARRATOR_SPEAKER, isNarration: true, text: legacy }]
    : [];
  return [...head, ...parseSpeechLines(scene.dialogue)];
}
