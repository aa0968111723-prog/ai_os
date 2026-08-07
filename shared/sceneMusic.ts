/**
 * 配樂：跨鏡的區間，用「端點標記」表達。
 *
 * 為什麼不存區間（起鏡 id ＋ 止鏡 id，或起訖秒數）：
 * 兩種都會漂。存 sceneId 會在鏡被軟刪時懸空；存秒數會在改秒數、逐鏡修剪、拖曳重排之後
 * 整條錯位。改存逐鏡的「起／止」標記之後，區間由掃描相鄰鏡推導出來——鏡怎麼搬動，
 * 配樂自動跟著走，因為它從來沒有被存過。這與 shared/timeline.ts「邊界一律先算成整數影格」
 * 是同一條原則：**會漂的東西不要存**。
 *
 * 為什麼不開 score_cues 表：一位創作者、一部弘法片，典型是整片一首曲子。一張表換來的
 * 唯一新能力是「兩段重疊配樂」，代價卻是新表＋生成綁定＋文字裡要寫得出 cue 引用。
 * 目前的限制講清楚就好：**同一時間只有一段配樂**。
 *
 * 文字寫法（一鏡最多一個標記）：
 *   配樂：起｜單音鋼琴，極簡，很慢
 *   配樂：止
 */

/** 分隔符：全形｜與半形 | 都收 */
const BAR = /\s*[｜|]\s*/;

export type MusicMarker =
  | { kind: "start"; description: string }
  | { kind: "stop" };

/** 一鏡的配樂標記；沒寫或看不懂就回 null（看不懂不報錯——寬鬆解析是這份格式的原則） */
export function parseMusicMarker(music: string | null | undefined): MusicMarker | null {
  const raw = (music ?? "").trim();
  if (!raw) return null;
  const [head, ...rest] = raw.split(BAR);
  const key = (head ?? "").trim();
  if (key === "止" || key === "停") return { kind: "stop" };
  if (key === "起" || key === "開始") return { kind: "start", description: rest.join("｜").trim() };
  // 沒寫「起／止」時視為起（使用者只描述了要什麼音樂，最合理的解讀是從這裡開始）
  return { kind: "start", description: raw };
}

/** 標記 → 文字（來回不失真的另一半） */
export function formatMusicMarker(marker: MusicMarker | null): string {
  if (!marker) return "";
  return marker.kind === "stop" ? "止" : `起｜${marker.description}`.replace(/｜$/, "");
}

export type MusicSpan = {
  /** 起鏡索引（0 起算，含） */
  fromIndex: number;
  /** 止鏡索引（含）。配樂延續到最後一鏡時就是最後一鏡的索引。 */
  toIndex: number;
  description: string;
};

/**
 * 逐鏡標記 → 區間清單。
 *
 * 規則刻意簡單，因為它要能被使用者在腦中重現：
 * - 遇到「起」就開一段；已經在播的話，新的「起」等於換曲（前一段在前一鏡結束）
 * - 遇到「止」就在**前一鏡**結束（「止」那一鏡本身已經沒有配樂）
 * - 到最後都沒遇到「止」就延續到最後一鏡
 */
export function resolveMusicSpans(
  scenes: ReadonlyArray<{ music?: string | null }>,
): MusicSpan[] {
  const spans: MusicSpan[] = [];
  let open: { fromIndex: number; description: string } | null = null;

  const close = (toIndex: number) => {
    if (!open) return;
    if (toIndex >= open.fromIndex) {
      spans.push({ fromIndex: open.fromIndex, toIndex, description: open.description });
    }
    open = null;
  };

  scenes.forEach((scene, i) => {
    const marker = parseMusicMarker(scene.music);
    if (!marker) return;
    if (marker.kind === "stop") {
      close(i - 1); // 「止」這一鏡本身不播
      return;
    }
    close(i - 1); // 換曲：前一段到前一鏡為止
    open = { fromIndex: i, description: marker.description };
  });
  close(scenes.length - 1);

  return spans;
}

/** 這一鏡有沒有配樂在播（給分鏡列顯示用） */
export function musicPlayingAt(spans: readonly MusicSpan[], index: number): MusicSpan | null {
  return spans.find((s) => index >= s.fromIndex && index <= s.toIndex) ?? null;
}
