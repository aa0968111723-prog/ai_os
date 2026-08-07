/**
 * 時間軸時間模型（前後端單一真相）。
 *
 * 為什麼要有這支：在它之前，「一鏡在時間軸上從第幾秒到第幾秒」被算了**五遍**——
 * `buildSrt`／`buildEdl` 用浮點秒累加，`buildFcpxml`／`buildXmeml` 各自把秒換成影格，
 * `StoryboardPlayer` 又自己 clamp 一次。五份算法目前巧合一致，因為 `scenes.durationSec`
 * 是整數秒；一旦引入修剪（in/out，必然是 sub-second），浮點那兩份就會與影格那兩份漂開，
 * 交付包裡的字幕與畫面對不上——而且是隨片長累積放大的那種對不上。
 *
 * 所以邊界一律先算成**整數影格**，秒數再從影格推回去。這樣不管鏡長是不是整數，
 * FCPXML／Premiere XML／SRT／EDL／站內預覽看到的切點都是同一個切點。
 *
 * ⚠️ 這裡只管**時間**，不管媒體路徑與軌道內容——那些仍由呼叫端（exporter／播放器）自理。
 * 先收斂最會出錯的那一半，不要為了「架構完整」把還沒有需求的多軌模型一次長出來。
 */

/** 時間軸統一 30fps：所有時間值必須對齊影格 */
export const TIMELINE_FPS = 30;

/** 影格數（整數）。時間軸上一切位置與長度的正規單位。 */
export type Frames = number;

/**
 * 鏡長無效時的退路秒數。
 *
 * 為什麼是 3 不是 1：交付出去的時間軸是對外契約，一格 1 秒的鏡在 Premiere 裡幾乎不可用；
 * 3 秒至少是個能看、能替換的佔位。`scenes.durationSec` 走 API 時有 `min(1)` 擋著，
 * 所以這條退路只會在舊資料或直接寫庫的情況下生效。
 */
export const FALLBACK_SHOT_SEC = 3;

/** 秒 → 影格（四捨五入到最近影格） */
export function secToFrames(sec: number): Frames {
  if (!Number.isFinite(sec)) return 0;
  return Math.round(sec * TIMELINE_FPS);
}

/** 影格 → 秒 */
export function framesToSec(frames: Frames): number {
  return frames / TIMELINE_FPS;
}

/**
 * 這一鏡佔多少影格——**鏡長的唯一規則**。
 *
 * 非有限值（NaN／Infinity）與 ≤0 一律走退路秒數。先前 exporter 的 `sceneDur` 靠
 * `NaN > 0 === false` 意外接住 NaN，播放器則另外 clamp 成 1 秒；兩邊對 durationSec=0
 * 的鏡給出不同長度（1 秒 vs 3 秒）。現在只有這一條規則。
 */
export function shotFrames(durationSec: number): Frames {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return secToFrames(FALLBACK_SHOT_SEC);
  return secToFrames(durationSec);
}

/**
 * 毫秒 → 影格。修剪點以毫秒儲存（整數欄位、不吃浮點），進時間軸一律吸到影格。
 *
 * 先乘後除，不是 `(ms / 1000) * FPS`：後者在 2050ms 會算出 61.4999…（2.05 在 IEEE754 沒有
 * 精確表示），四捨五入掉到 61 影格而不是 62。兩個整數先相乘沒有這個問題。
 */
export function msToFrames(ms: number): Frames {
  if (!Number.isFinite(ms)) return 0;
  return Math.round((ms * TIMELINE_FPS) / 1000);
}

/**
 * 一鏡的來源與修剪。
 *
 * 修剪採 NLE 慣用的「來源入點 ＋ 時間軸長度」模型，不是「頭尾各切掉多少」：
 * - `trimStartMs`＝從素材第幾毫秒開始播（來源入點）
 * - `trimEndMs`＝素材的出點；**null 表示沒修剪過**，鏡長仍由 `durationSec` 決定
 *
 * 為什麼出點存絕對位置而不是「尾巴切掉多少」：素材被重新生成、長度變了的時候，
 * 絕對出點仍指向素材上的同一個時間點，「切掉最後 2 秒」則會跟著素材長度飄。
 *
 * 舊資料 `trimStartMs=0`／`trimEndMs=null`，行為與修剪功能上線前完全相同。
 */
export type ShotSource = {
  durationSec: number;
  /** 來源入點（毫秒）；null/0＝從頭 */
  trimStartMs?: number | null;
  /** 來源出點（毫秒）；null＝未修剪，鏡長走 durationSec */
  trimEndMs?: number | null;
};

/** 這一鏡從素材的第幾影格開始取（來源入點）。 */
export function sourceInFrames(shot: ShotSource): Frames {
  const ms = shot.trimStartMs;
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return 0;
  return msToFrames(ms);
}

/**
 * 這一鏡在時間軸上佔多少影格——**含修剪的鏡長規則**。
 *
 * 修剪過（出點有效且大於入點）就用修剪區間，否則退回 `durationSec`。
 * 區間短於一影格時給 1 影格：零長度剪輯會讓 Premiere／FCP 匯入時整條軌報錯，
 * 寧可留一格可見的殘影讓人發現，也不要產出一個打不開的時間軸檔。
 */
export function shotDurationFrames(shot: ShotSource): Frames {
  const inFrames = sourceInFrames(shot);
  const outMs = shot.trimEndMs;
  if (outMs != null && Number.isFinite(outMs)) {
    const outFrames = msToFrames(outMs);
    if (outFrames > inFrames) return outFrames - inFrames;
    if (outFrames === inFrames) return 1;
  }
  return shotFrames(shot.durationSec);
}

/** 這一鏡有沒有被修剪過（UI 顯示「已修剪」標記用） */
export function isTrimmed(shot: ShotSource): boolean {
  return sourceInFrames(shot) > 0 || (shot.trimEndMs != null && Number.isFinite(shot.trimEndMs));
}

/**
 * 影格 → FCPXML 時間值。
 * 整秒輸出「Ns」（可讀），非整秒輸出影格有理數「F/30s」（保證影格對齊，不留浮點尾巴）。
 */
export function fcpTimeFromFrames(frames: Frames): string {
  return frames % TIMELINE_FPS === 0 ? `${frames / TIMELINE_FPS}s` : `${frames}/${TIMELINE_FPS}s`;
}

/** 一鏡在時間軸上的位置。秒數一律由影格推回，與影格值必然一致。 */
export type ShotTiming = {
  index: number;
  startFrames: Frames;
  endFrames: Frames;
  durationFrames: Frames;
  startSec: number;
  endSec: number;
  durationSec: number;
  /** 來源入點（影格）——匯出時要寫進 clip 的 in 點，預覽時是 video.currentTime 的起點 */
  sourceInFrames: Frames;
  /** 來源出點（影格）＝入點＋鏡長 */
  sourceOutFrames: Frames;
};

export type TimelineLayout = {
  fps: typeof TIMELINE_FPS;
  shots: ShotTiming[];
  totalFrames: Frames;
  totalSec: number;
};

/**
 * 把一串鏡排到時間軸上：回傳每鏡的起訖（影格與秒各一份，同源）。
 *
 * 相鄰鏡以「累計影格」交棒——前一鏡的 end 就是後一鏡的 start，中間不可能長出縫或重疊。
 * 這是 `buildFcpxml` 原本就在做的事，現在其餘格式與預覽器共用同一份結果。
 */
export function layoutTimeline(shots: ReadonlyArray<ShotSource>): TimelineLayout {
  const out: ShotTiming[] = [];
  let cursor = 0;
  for (const [index, shot] of shots.entries()) {
    const durationFrames = shotDurationFrames(shot);
    const startFrames = cursor;
    const endFrames = startFrames + durationFrames;
    const inFrames = sourceInFrames(shot);
    cursor = endFrames;
    out.push({
      index,
      startFrames,
      endFrames,
      durationFrames,
      startSec: framesToSec(startFrames),
      endSec: framesToSec(endFrames),
      durationSec: framesToSec(durationFrames),
      sourceInFrames: inFrames,
      sourceOutFrames: inFrames + durationFrames,
    });
  }
  return { fps: TIMELINE_FPS, shots: out, totalFrames: cursor, totalSec: framesToSec(cursor) };
}

/**
 * FCPXML 的 lane 配置——剪輯台的軌道概念與交付格式在這裡對齊。
 *
 * 主畫面走主故事線（lane 0＝不寫 lane 屬性），其餘掛在它下方各自一軌：
 * 環境音不與音效共用軌，否則「主素材就是音檔」的鏡會有兩個 clip 疊在同一軌互相蓋掉。
 */
export const LAYER_LANE = {
  visual: 0,
  /** 旁白 */
  narration: -1,
  /** 音效（主素材本身是音檔的鏡） */
  sfx: -2,
  /** 環境音 */
  ambience: -3,
} as const;

export type TimelineLayerKind = keyof typeof LAYER_LANE;
