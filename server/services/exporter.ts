/**
 * 交付素材包（盲點掃描定案：不做雲端合成，交付媒體檔給剪映/Premiere 組裝）。
 * 業界標準編號資料夾：01_視頻素材／03_圖像／05_文件（有內容才建）；
 * 交付/ 另附三種剪輯軟體通用時間軸格式（需求 #8）：字幕.srt／時間軸.fcpxml／剪輯表.edl。
 */
import { ZipArchive } from "archiver";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { proxyFetch } from "./http";
import type { Response } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";
import { absPathOf, extFromMime } from "./storage";

export function safeName(value: string): string {
  // 控制字元一併置換：進 zip entry 名會讓部分解壓工具出錯，經 escXml 進 XML 則是 1.0 非法字元
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\\/:*?"<>|\s\x00-\x1f\x7f]+/g, "_").slice(0, 40) || "未命名";
}

/** 秒數 → SRT 時間碼 HH:MM:SS,mmm */
function srtTime(totalSec: number): string {
  const ms = Math.round(totalSec * 1000);
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${millis}`;
}

// 字幕可讀性上限：每塊約 18 個全形字，中文閱讀速度上限約 7 字/秒（過長旁白要切多塊）
const CUE_MAX_VISUAL = 18;

/** 視覺寬度：全形（中文）算 1，半形（ASCII）算 0.5，貼近「每塊 ~18 全形字」的觀感 */
function visualWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[\x00-\xff]/.test(ch) ? 0.5 : 1;
  return w;
}

/** 把過長、無標點可切的片段硬切成不超過上限的塊 */
function hardWrap(seg: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of seg) {
    const chW = /[\x00-\xff]/.test(ch) ? 0.5 : 1;
    if (cur && visualWidth(cur) + chW > CUE_MAX_VISUAL) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 把一幕旁白依標點（。！？，、；及換行）切成最小語意片段，再貪婪合併至每塊上限；
 * 單一片段超長（無標點可切）時硬切。回傳可讀的字幕文字塊陣列。
 */
function splitSegments(voiceover: string): string[] {
  const pieces: string[] = [];
  let buf = "";
  const flush = () => {
    const s = buf.trim();
    if (s) pieces.push(s);
    buf = "";
  };
  for (const ch of voiceover) {
    if (ch === "\n") {
      flush();
      continue;
    }
    buf += ch;
    if ("。！？，、；".includes(ch)) flush(); // 標點留在片尾作為斷句點
  }
  flush();

  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const p of pieces) {
    if (visualWidth(p) > CUE_MAX_VISUAL) {
      push();
      for (const chunk of hardWrap(p)) out.push(chunk);
      continue;
    }
    if (cur && visualWidth(cur) + visualWidth(p) > CUE_MAX_VISUAL) push();
    cur += p;
  }
  push();
  return out;
}

/**
 * 把一幕旁白切成多個連號字幕塊，並在該幕時間預算 [startSec, endSec] 內
 * 依各段字數比例分配起訖時間碼（末段對齊 endSec，避免累進誤差溢出幕邊界）。
 * 空旁白回空陣列（該幕不產生字幕）。
 */
/** 每塊字幕最短顯示秒數：低於此會一閃而過、來不及讀。塊數過多時合併相鄰片段以達此下限 */
const MIN_CUE_SEC = 0.8;

/** 把片段平均併成最多 count 組（依片段數平均分桶，如 8→3 桶為 3/3/2），保證塊數不超過時間放得下的數量 */
function mergeToCount(segs: string[], count: number): string[] {
  if (count >= segs.length) return segs;
  const out: string[] = [];
  const base = Math.floor(segs.length / count);
  let extra = segs.length % count;
  let idx = 0;
  for (let b = 0; b < count; b++) {
    const take = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    out.push(segs.slice(idx, idx + take).join(""));
    idx += take;
  }
  return out;
}

export function splitCue(voiceover: string, startSec: number, endSec: number): Array<{ start: number; end: number; text: string }> {
  const text = (voiceover ?? "").trim();
  if (!text) return [];
  let segments = splitSegments(text)
    .map((s) => s.replace(/[，、；]+$/, "").trim()) // 尾端非句末標點（逗/頓/分號）去掉更乾淨
    .filter((s) => s.length > 0);
  if (segments.length === 0) return [];
  // 每塊最少 MIN_CUE_SEC：把塊數上限壓到「這幕時間放得下」的數量，避免短幕多句時字幕一閃而過
  const span0 = Math.max(endSec - startSec, 0);
  const maxCues = Math.max(1, Math.floor(span0 / MIN_CUE_SEC));
  if (segments.length > maxCues) segments = mergeToCount(segments, maxCues);

  const totalChars = segments.reduce((n, s) => n + s.length, 0) || 1;
  const span = Math.max(endSec - startSec, 0);
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let t = startSec;
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    const end = isLast ? endSec : t + span * (segments[i].length / totalChars);
    cues.push({ start: t, end, text: segments[i] });
    t = end;
  }
  return cues;
}

/**
 * 從分鏡的配音詞＋秒數組出 SRT 字幕（04_字幕 用的「可讀性切塊」版）：每幕依旁白長度切成多個連號可讀塊，
 * 各幕時間依序累計（每幕佔其設定秒數，最少 3 秒）。
 * 沒有配音詞的幕仍推進時間軸（保留其秒數的空檔），只有有詞的幕才產生字幕塊。
 * 回空字串代表整片都沒有配音詞（不放空字幕檔）。
 * ※ 與下方匯出用的 buildSrt（每鏡一塊、空詞用標題）是兩套用途：這套給觀眾看，那套給剪輯對位。
 */
function buildVoiceoverSrt(scenes: Array<{ durationSec: number; voiceover: string | null }>): string {
  const blocks: string[] = [];
  let t = 0;
  let idx = 0;
  for (const sc of scenes) {
    const dur = sc.durationSec > 0 ? sc.durationSec : 3;
    const start = t;
    const end = t + dur;
    t = end;
    for (const cue of splitCue(sc.voiceover ?? "", start, end)) {
      idx += 1;
      blocks.push(`${idx}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}`);
    }
  }
  return blocks.join("\n\n");
}

// ── 剪輯軟體通用時間軸格式（需求 #8）：純字串模板產生，零新依賴 ──────────
// 產生器共用約定：呼叫端傳入「未軟刪、依 orderIndex 排序」的分鏡；
// 時間軸由各鏡 durationSec 依序累加（非正數以 3 秒計，與鏡頭表時間碼同一套規則）。

/**
 * 時間軸產生器吃的最小分鏡形狀（scenes DB 列結構相容）。
 * mediaPath/mediaKind/narrationPath 是「媒體連結版」時間軸的可選欄位：交付包打包時回填
 * 每鏡實際入包的 zip 內相對路徑（如 01_視頻素材/01_開場.mp4），FCPXML/Premiere XML 便能
 * 引用媒體、匯入即自動組好粗剪；不帶（單檔下載、無素材鏡）就退回純佔位骨架。
 */
export type TimelineScene = {
  title: string;
  durationSec: number;
  voiceover: string | null;
  /** 交付包內媒體檔相對路徑（相對 zip 根）；null/未給＝該鏡無入包素材 */
  mediaPath?: string | null;
  /** 入包媒體類型（image 走靜態圖引用、video 走視訊剪輯、audio 不上視訊軌） */
  mediaKind?: "video" | "image" | "audio" | null;
  /** 該鏡旁白音檔的 zip 內相對路徑（02_旁白音檔/…）；null/未給＝無旁白 */
  narrationPath?: string | null;
};

/** 這一鏡在時間軸上佔的秒數（與鏡頭表/字幕同規則：最少 3 秒） */
export function sceneDur(sc: { durationSec: number }): number {
  return sc.durationSec > 0 ? sc.durationSec : 3;
}

/**
 * SRT 字幕（剪映/CapCut/Premiere 皆可直接匯入）：每鏡一塊字幕、依 durationSec 累加時間碼，
 * 文字用配音詞、沒填則用分鏡標題——確保每一鏡都有可對位的字幕塊（剪輯對位用途）。
 */
export function buildSrt(scenes: TimelineScene[]): string {
  const blocks: string[] = [];
  let t = 0;
  for (const [i, sc] of scenes.entries()) {
    const start = t;
    const end = t + sceneDur(sc);
    t = end;
    const text = (sc.voiceover ?? "").trim() || sc.title;
    blocks.push(`${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}`);
  }
  return blocks.length ? blocks.join("\n\n") + "\n" : "";
}

/**
 * XML 特殊字元跳脫（&<>"'）——標題/配音詞可能含任何字元，進 XML 前一律跳脫。
 * 控制字元直接剔除：是 XML 1.0 非法字元（跳脫也救不了），留著會讓 Premiere/FCP 整檔拒讀。
 */
function escXml(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

/**
 * zip 內相對路徑 → 相對 URI（FCPXML media-rep src／Premiere pathurl 用）：
 * 逐段 percent-encode（中文檔名、# ? 等 URI 保留字全編碼），斜線保留當分隔。
 * pathPrefix 讓時間軸檔放在子資料夾（交付/）時能用 ../ 指回媒體資料夾。
 */
function relUri(pathPrefix: string, zipRelPath: string): string {
  return pathPrefix + zipRelPath.split("/").map(encodeURIComponent).join("/");
}

/** 媒體連結版產生器的共用選項：時間軸檔相對媒體資料夾的位置前綴（預設同層 ./） */
export type TimelineFileOpts = { pathPrefix?: string };

// 時間軸統一 30fps：FCPXML 時間值必須對齊影格，秒數換成影格數再輸出
const TIMELINE_FPS = 30;

/** 秒 → FCPXML 時間值：整秒輸出「Ns」（可讀），非整秒輸出影格有理數「F/30s」（保證影格對齊） */
function fcpTime(sec: number): string {
  const frames = Math.round(sec * TIMELINE_FPS);
  return frames % TIMELINE_FPS === 0 ? `${frames / TIMELINE_FPS}s` : `${frames}/${TIMELINE_FPS}s`;
}

/** zip 相對路徑取檔名（asset 顯示名用） */
function baseName(zipRelPath: string): string {
  const i = zipRelPath.lastIndexOf("/");
  return i >= 0 ? zipRelPath.slice(i + 1) : zipRelPath;
}

/**
 * FCPXML 1.9 時間軸（Final Cut Pro／DaVinci Resolve／剪映專業版可讀）。
 * 媒體連結版（需求：匯入即自動組好粗剪）：分鏡帶 mediaPath 時，resources 產 <asset>＋<media-rep>
 * 以「相對 URI」引用交付包內媒體（解壓後同資料夾結構即自動掛上；找不到媒體則匯入為離線剪輯，
 * 可在剪輯軟體內一次 relink 整個資料夾）。影片鏡用 <asset-clip>、圖片鏡用 <video>（靜態圖 asset
 * duration=0s、時長由時間軸決定）；旁白音檔以 lane="-1" connected clip 掛在該鏡主剪輯下。
 * 沒帶 mediaPath 的鏡維持 <gap> 佔位（單檔下載＝全片骨架，行為與舊版相容），note 帶標題與配音詞。
 * 時間值一律影格對齊（30fps；非整秒輸出 F/30s 有理數），offset 用累計影格差杜絕浮點漂移。
 */
export function buildFcpxml(scenes: TimelineScene[], projectTitle: string, opts: TimelineFileOpts = {}): string {
  const prefix = opts.pathPrefix ?? "./";
  const resources: string[] = [];
  const spineItems: string[] = [];
  let assetSeq = 0;
  // 累計影格：每鏡邊界先換成影格再回秒差，相鄰鏡頭必然無縫、無重疊
  let cumSec = 0;
  let cumFrames = 0;
  for (const [i, sc] of scenes.entries()) {
    cumSec += sceneDur(sc);
    const endFrames = Math.round(cumSec * TIMELINE_FPS);
    const offset = fcpTime(cumFrames / TIMELINE_FPS);
    const dur = fcpTime((endFrames - cumFrames) / TIMELINE_FPS);
    cumFrames = endFrames;

    const note = (sc.voiceover ?? "").trim() ? `${sc.title}｜${(sc.voiceover ?? "").trim()}` : sc.title;
    const clipName = escXml(`${i + 1}_${sc.title}`);

    // 音訊 asset（旁白與音訊類場景素材共用）：不宣告 duration——實際音長未探測，亂宣告會在
    // relink 後造成源範圍越界；檔案在場時 FCP 直接讀實長（Apple 文件：屬性省略即由媒體檔推導）
    const audioAsset = (path: string) => {
      assetSeq += 1;
      const id = `a${assetSeq}`;
      resources.push(
        `    <asset id="${id}" name="${escXml(baseName(path))}" start="0s" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000">\n` +
          `      <media-rep kind="original-media" src="${escXml(relUri(prefix, path))}"/>\n` +
          `    </asset>`,
      );
      return id;
    };

    // 旁白 connected clip：掛在該鏡主元素（asset-clip/video/gap）之下、lane -1（主故事線下方音訊），
    // offset 以父元素 local timeline 計（父 start=0s → offset=0s 對齊該鏡開頭）
    let connectedXml = "";
    if (sc.narrationPath) {
      const nid = audioAsset(sc.narrationPath);
      connectedXml += `\n              <asset-clip ref="${nid}" lane="-1" offset="0s" duration="${dur}" name="${escXml(`${i + 1}_旁白`)}" audioRole="dialogue"/>`;
    }
    // 音訊類場景素材（02_音訊/）：一樣要上時間軸——掛 lane -2，與旁白（lane -1）並存不打架
    if (sc.mediaPath && sc.mediaKind === "audio") {
      const sid = audioAsset(sc.mediaPath);
      connectedXml += `\n              <asset-clip ref="${sid}" lane="-2" offset="0s" duration="${dur}" name="${clipName}" audioRole="effects"/>`;
    }

    const inner = `\n              <note>${escXml(note)}</note>${connectedXml}\n            `;
    if (sc.mediaPath && sc.mediaKind === "image") {
      assetSeq += 1;
      const aid = `a${assetSeq}`;
      // 靜態圖：asset duration=0s（無限長）、format 用無 frameDuration 的 r2，spine 以 <video> 引用
      //（FCP 對靜態圖的慣例；用 asset-clip 引用 0s 素材會出錯）
      resources.push(
        `    <asset id="${aid}" name="${escXml(baseName(sc.mediaPath))}" start="0s" duration="0s" hasVideo="1" videoSources="1" format="r2">\n` +
          `      <media-rep kind="original-media" src="${escXml(relUri(prefix, sc.mediaPath))}"/>\n` +
          `    </asset>`,
      );
      spineItems.push(`            <video ref="${aid}" offset="${offset}" start="0s" duration="${dur}" name="${clipName}">${inner}</video>`);
    } else if (sc.mediaPath && sc.mediaKind === "video") {
      assetSeq += 1;
      const aid = `a${assetSeq}`;
      // 影片 asset 同樣不宣告 duration（實長未探測）；asset-clip 端明確給時間軸長度即可
      resources.push(
        `    <asset id="${aid}" name="${escXml(baseName(sc.mediaPath))}" start="0s" hasVideo="1" hasAudio="1" format="r1" audioSources="1" audioChannels="2" audioRate="48000">\n` +
          `      <media-rep kind="original-media" src="${escXml(relUri(prefix, sc.mediaPath))}"/>\n` +
          `    </asset>`,
      );
      spineItems.push(`            <asset-clip ref="${aid}" offset="${offset}" start="0s" duration="${dur}" name="${clipName}">${inner}</asset-clip>`);
    } else {
      // 無畫面素材（或素材是音訊）：gap 佔位保住時間軸節奏；旁白/音訊素材仍掛 gap 下照常出聲
      spineItems.push(`            <gap name="${clipName}" offset="${offset}" start="0s" duration="${dur}">${inner}</gap>`);
    }
  }
  // 註：不寫 <!DOCTYPE>——FCP 自家匯出亦不含；version 1.9 是 FCP/DaVinci Resolve（≤1.10）/剪映專業版的最大公約數
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- 由 AI Director OS 產出：解壓交付包後直接匯入本檔，媒體以相對路徑自動掛上；顯示離線時對整個解壓資料夾 relink 一次即可 -->`,
    `<fcpxml version="1.9">`,
    `  <resources>`,
    `    <format id="r1" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080"/>`,
    `    <format id="r2" name="FFVideoFormatRateUndefined" width="1920" height="1080"/>`,
    ...resources,
    `  </resources>`,
    `  <library>`,
    `    <event name="${escXml(projectTitle)}">`,
    `      <project name="${escXml(projectTitle)}">`,
    `        <sequence format="r1" duration="${fcpTime(cumFrames / TIMELINE_FPS)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    `          <spine>`,
    ...(spineItems.length ? [spineItems.join("\n")] : []),
    `          </spine>`,
    `        </sequence>`,
    `      </project>`,
    `    </event>`,
    `  </library>`,
    `</fcpxml>`,
    ``,
  ].join("\n");
}

/**
 * Premiere Pro 可匯入的 Final Cut Pro 7 XML（xmeml v4；DaVinci Resolve 亦可讀）。
 * 媒體連結版：V1 軌每鏡一個 clipitem，<file><pathurl> 用相對 URI 指向交付包內媒體——
 * Premiere 匯入時若依原資料夾結構解壓可直接掛上；找不到則進離線剪輯，用「連結媒體」
 * 指向解壓資料夾即可按檔名一次全部 relink。旁白音檔放 A1 軌、音訊類場景素材放 A2 軌。
 * 無媒體的鏡輸出「離線佔位 clipitem」（file 只有名稱、無 pathurl＝離線素材）——鏡名、
 * 時間碼與配音詞備註都保留，骨架版（單檔下載）匯入後也看得到完整片架構，不會是空序列。
 * file 一律不宣告我們沒探測過的媒體長度（比照 OTIO「不知道就不編」），檔案在場時由 NLE 讀實長。
 * 時間一律 30fps 整數影格（timebase 30、NTSC FALSE），邊界用累計影格差，無縫不重疊。
 */
export function buildXmeml(scenes: TimelineScene[], projectTitle: string, opts: TimelineFileOpts = {}): string {
  const prefix = opts.pathPrefix ?? "./";
  const rate = `<rate><timebase>${TIMELINE_FPS}</timebase><ntsc>FALSE</ntsc></rate>`;
  const videoItems: string[] = [];
  const audioItems: string[] = []; // A1：旁白
  const audioItems2: string[] = []; // A2：音訊類場景素材
  let fileSeq = 0;
  let cumSec = 0;
  let startF = 0;
  // 音訊 clipitem 模板（A1 旁白/A2 場景音訊共用）：file 帶 pathurl、不帶 duration
  const audioClip = (idPrefix: string, i: number, name: string, path: string, startF: number, endF: number) => {
    fileSeq += 1;
    const durF = endF - startF;
    return [
      `          <clipitem id="${idPrefix}${i + 1}" premiereChannelType="mono">`,
      `            <name>${escXml(name)}</name>`,
      `            <enabled>TRUE</enabled>`,
      `            <duration>${durF}</duration>`,
      `            ${rate}`,
      `            <start>${startF}</start><end>${endF}</end>`,
      `            <in>0</in><out>${durF}</out>`,
      `            <file id="file-${fileSeq}">`,
      `              <name>${escXml(baseName(path))}</name>`,
      `              <pathurl>${escXml(relUri(prefix, path))}</pathurl>`,
      `              ${rate}`,
      `              <media><audio><channelcount>1</channelcount></audio></media>`,
      `            </file>`,
      `            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>`,
      `          </clipitem>`,
    ].join("\n");
  };
  for (const [i, sc] of scenes.entries()) {
    cumSec += sceneDur(sc);
    const endF = Math.round(cumSec * TIMELINE_FPS);
    const durF = endF - startF;
    const label = `${i + 1}_${sc.title}`;

    fileSeq += 1;
    const fid = `file-${fileSeq}`;
    let fileXml: string;
    if (sc.mediaPath && sc.mediaKind === "video") {
      // 影片 file：帶 rate 與 pathurl，不帶 duration（實長未探測，在場時 Premiere 自己讀）
      fileXml = [
        `            <file id="${fid}">`,
        `              <name>${escXml(baseName(sc.mediaPath))}</name>`,
        `              <pathurl>${escXml(relUri(prefix, sc.mediaPath))}</pathurl>`,
        `              ${rate}`,
        `              <media><video/></media>`,
        `            </file>`,
      ].join("\n");
    } else if (sc.mediaPath && sc.mediaKind === "image") {
      // 靜態圖 file：不帶 rate/duration（Premiere 視為無限長靜態素材、長度由 start/end 決定）
      fileXml = [
        `            <file id="${fid}">`,
        `              <name>${escXml(baseName(sc.mediaPath))}</name>`,
        `              <pathurl>${escXml(relUri(prefix, sc.mediaPath))}</pathurl>`,
        `              <media><video><samplecharacteristics><width>1920</width><height>1080</height></samplecharacteristics></video></media>`,
        `            </file>`,
      ].join("\n");
    } else {
      // 無畫面素材（或素材是音訊）：離線佔位 file（無 pathurl）——保住鏡位與節奏，佔位自帶時長
      fileXml = [
        `            <file id="${fid}">`,
        `              <name>${escXml(`${label}（無素材）`)}</name>`,
        `              ${rate}`,
        `              <duration>${durF}</duration>`,
        `              <media><video/></media>`,
        `            </file>`,
      ].join("\n");
    }
    videoItems.push(
      [
        `          <clipitem id="clipitem-v${i + 1}">`,
        `            <name>${escXml(label)}</name>`,
        `            <enabled>TRUE</enabled>`,
        `            <duration>${durF}</duration>`,
        `            ${rate}`,
        `            <start>${startF}</start><end>${endF}</end>`,
        `            <in>0</in><out>${durF}</out>`,
        fileXml,
        `            <comments><mastercomment1>${escXml((sc.voiceover ?? "").trim() || sc.title)}</mastercomment1></comments>`,
        `          </clipitem>`,
      ].join("\n"),
    );

    if (sc.narrationPath) audioItems.push(audioClip("clipitem-a", i, `${i + 1}_旁白`, sc.narrationPath, startF, endF));
    if (sc.mediaPath && sc.mediaKind === "audio") audioItems2.push(audioClip("clipitem-sa", i, label, sc.mediaPath, startF, endF));
    startF = endF;
  }
  const totalF = startF;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<!-- 由 AI Director OS 產出：Premiere「檔案→匯入」本檔即建好時間軸；媒體離線時用「連結媒體」指向解壓資料夾一次 relink -->`,
    `<xmeml version="4">`,
    `  <sequence id="sequence-1">`,
    `    <name>${escXml(projectTitle)}</name>`,
    `    <duration>${totalF}</duration>`,
    `    ${rate}`,
    `    <media>`,
    `      <video>`,
    `        <format><samplecharacteristics>${rate}<width>1920</width><height>1080</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>`,
    `        <track>`,
    ...(videoItems.length ? [videoItems.join("\n")] : []),
    `          <enabled>TRUE</enabled><locked>FALSE</locked>`,
    `        </track>`,
    `      </video>`,
    `      <audio>`,
    `        <format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>`,
    `        <track>`,
    ...(audioItems.length ? [audioItems.join("\n")] : []),
    `          <enabled>TRUE</enabled><locked>FALSE</locked>`,
    `        </track>`,
    // A2：音訊類場景素材（有才輸出第二條音軌）
    ...(audioItems2.length ? [[`        <track>`, audioItems2.join("\n"), `          <enabled>TRUE</enabled><locked>FALSE</locked>`, `        </track>`].join("\n")] : []),
    `      </audio>`,
    `    </media>`,
    `  </sequence>`,
    `</xmeml>`,
    ``,
  ].join("\n");
}

/** 秒數 → CMX 3600 timecode HH:MM:SS:FF（30fps 非丟格） */
function edlTime(totalSec: number): string {
  const fps = 30;
  const totalFrames = Math.round(totalSec * fps);
  const p = (n: number) => String(n).padStart(2, "0");
  const f = totalFrames % fps;
  const s = Math.floor(totalFrames / fps) % 60;
  const m = Math.floor(totalFrames / (fps * 60)) % 60;
  const h = Math.floor(totalFrames / (fps * 3600));
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

/**
 * CMX 3600 EDL 剪輯表（DaVinci Resolve／Premiere 可讀）：TITLE 行＋每鏡一行事件（V 軌、Cut），
 * 以 30fps 換算 timecode；來源一律 AX 佔位 reel（進出點從 0 起算、長度＝該鏡秒數），
 * COMMENT 行（* FROM CLIP NAME）放分鏡標題，匯入後逐鏡替換為實際素材即可。
 */
export function buildEdl(scenes: TimelineScene[], projectTitle: string): string {
  const lines: string[] = [`TITLE: ${projectTitle.replace(/\s+/g, " ").trim() || "未命名"}`, "FCM: NON-DROP FRAME", ""];
  let t = 0;
  for (const [i, sc] of scenes.entries()) {
    const dur = sceneDur(sc);
    const num = String(i + 1).padStart(3, "0");
    lines.push(
      `${num}  AX       V     C        ${edlTime(0)} ${edlTime(dur)} ${edlTime(t)} ${edlTime(t + dur)}`,
      `* FROM CLIP NAME: ${sc.title.replace(/\s+/g, " ").trim()}`,
      "",
    );
    t += dur;
  }
  return lines.join("\n");
}

// 遠端抓取守門：滴流/掛住的外部網址不能無限期卡住匯出；超大檔先用 Content-Length 擋下，不進串流
const REMOTE_FETCH_TIMEOUT_MS = 30_000;
export const REMOTE_FILE_MAX_BYTES = 200 * 1024 * 1024;

/**
 * 抓遠端素材：逾時「只涵蓋連線/首位元組」階段（防掛住、永不回應的外部網址），response headers 一到就解除。
 * 關鍵：串流階段不再套總逾時——否則大型影片正常下載超過 30 秒會被攔腰斬斷、毀掉整份交付 ZIP。
 * 串流階段仍受 clientAbort 控制（用戶端關閉下載即停止），大檔另有 REMOTE_FILE_MAX_BYTES 上限把關。
 */
export async function fetchRemoteAsset(url: string, clientSignal: AbortSignal) {
  const conn = new AbortController();
  const timer = setTimeout(() => conn.abort(new Error("遠端連線逾時")), REMOTE_FETCH_TIMEOUT_MS);
  try {
    return await proxyFetch(url, { signal: AbortSignal.any([clientSignal, conn.signal]) });
  } finally {
    clearTimeout(timer); // headers 已到（或已失敗）→ 解除連線逾時，讓後續 body 串流不受總逾時斬斷
  }
}

/**
 * 遠端串流的「實際」大小上限：Content-Length 守門擋不住 chunked/謊報長度的回應，
 * 串流階段逐塊計數、超過 REMOTE_FILE_MAX_BYTES 即以錯誤中止（appendAndWait 的錯誤路徑會收尾）。
 * 回傳包好的串流；外層（cap）被 destroy 時連帶關掉底層來源，不佔連線。
 */
export function capRemoteBytes(source: Readable): Readable {
  let seen = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > REMOTE_FILE_MAX_BYTES) return cb(new Error(`遠端素材超過大小上限（${Math.round(REMOTE_FILE_MAX_BYTES / 1048576)}MB）`));
      cb(null, chunk);
    },
  });
  source.on("error", (err) => cap.destroy(err)); // 上游錯誤要傳遞，別讓 cap 掛著
  cap.on("close", () => source.destroy());
  return source.pipe(cap);
}

/**
 * append 並等待該 entry 寫入下游完成——archiver 內部佇列不設上限，
 * 迴圈內連發 append 會同時持有所有已排入的來源，峰值記憶體≈整包大小；
 * 逐筆等待讓背壓生效，記憶體只留單一 entry 的串流緩衝。
 * 用戶端斷線（signal 中止）時 abort 後 'entry' 永不觸發，必須靠 abort 監聽讓 promise 收尾。
 */
export function appendAndWait(archive: ZipArchive, source: Readable | Buffer, name: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const off = () => {
      archive.off("entry", onEntry);
      archive.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (err: unknown) => {
      off();
      // 釋放來源：本地檔關 fd、遠端串流中止下載，別讓半途的來源掛著
      if (source instanceof Readable) source.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const onEntry = (entry: { name: string }) => {
      if (entry.name === name) {
        off();
        resolve();
      }
    };
    const onError = (err: unknown) => fail(err);
    const onAbort = () => fail(new Error("下載已由用戶端取消"));
    if (signal.aborted) return onAbort();
    archive.on("entry", onEntry);
    archive.on("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    archive.append(source, { name });
  });
}

/**
 * 打包交付 zip。assetIds（可選）＝素材庫多選打包：提供時媒體檔只打包這些 id 的素材
 * （場景素材/旁白/鎖定素材皆套用同一過濾），交付文件（鏡頭表/字幕/交付格式/README）照常產出，
 * 鏡頭表「檔名」欄如實反映未入包者為「（無素材）」。不傳＝維持既有全量打包行為。
 */
export async function exportProjectZip(projectId: string, res: Response, assetIds?: string[]): Promise<void> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new Error("找不到專案");

  const scenes = await db
    .select()
    .from(schema.scenes)
    // 已軟刪除（回收桶）的分鏡不進交付包
    .where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt)))
    .orderBy(asc(schema.scenes.orderIndex));
  // ★ 金錢安全：已軟刪除（已付點數）的素材絕不入 ZIP——過濾 deletedAt。
  // 分鏡引用的素材若已軟刪除，下方 assets.find 找不到就跳過該鏡（不整包失敗）。
  const assets = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.projectId, projectId), isNull(schema.assets.deletedAt)));
  const generations = await db.select().from(schema.generations).where(eq(schema.generations.projectId, projectId));

  // 多選打包過濾：有給 assetIds 才啟用（空陣列視同不過濾，維持既有呼叫相容）。
  // 只影響「媒體檔入包與否」；鏡頭表等文件仍用全量 assets 補中繼資料（類型/提示詞/模型）。
  const packSet = assetIds && assetIds.length > 0 ? new Set(assetIds) : null;
  const shouldPack = (id: string) => !packSet || packSet.has(id);

  const worldview = worldviewSchema.parse(project.worldview ?? {});
  const zipName = `${safeName(project.title)}_交付包.zip`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  // archiver 對錯誤是發 'error' 事件——未監聽會變 unhandled 'error' 直接讓 Node 程序崩潰。
  archive.on("error", (err) => {
    console.error("[export] 打包錯誤：", err instanceof Error ? err.message : err);
    if (!res.headersSent) {
      // 標頭還沒 flush 就失敗：先撤掉 zip/attachment 標頭再回錯，否則瀏覽器把錯誤內文存成壞掉的 .zip
      res.removeHeader("Content-Disposition");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(500).end("打包失敗");
    } else res.destroy();
  });
  // 用戶端中途取消下載時，停止打包、釋放資源，別再往斷掉的連線寫。
  // 必須用 archive.abort() 而非 destroy()：abort 才會殺掉內部佇列並收尾（_queue.kill + _shutdown），
  // destroy 只斷資料流，佇列滯留持有所有已排入來源、finalize 的 promise 永不 settle。
  // clientAbort 同時讓進行中的 proxyFetch / append 等待立即中止，不再白抓剩餘素材。
  const clientAbort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      clientAbort.abort();
      archive.abort();
    }
  });
  archive.pipe(res);

  // 05_文件／腳本與鏡頭表.md（一定有）
  const lines: string[] = [
    `# ${project.title} · 腳本與鏡頭表`,
    "",
    `- 格式：${project.format}（${project.platform}）`,
    `- 一句話故事：${worldview.logline || "—"}`,
    `- 關鍵訊息：${worldview.message || "—"}`,
    `- 調性：${worldview.tones.join("、") || "—"}`,
    `- 禁忌事項：${worldview.taboos.join("；") || "—"}`,
    "",
    "| 鏡號 | 場次 | 秒數 | 類型 | 檔名 | 旁白音檔 | 進出點時間碼 | 提示詞 | 模型 |",
    "|---|---|---|---|---|---|---|---|---|",
  ];

  // 缺漏素材集中收集、待表格結束後再列——插在表格列中間會把 markdown 表格截斷
  const warnings: string[] = [];
  let videoIdx = 0;
  let imageIdx = 0;
  // 鏡頭表欄位：每幕實際寫入交付包的相對檔名（下方主迴圈成功入包後回填）＋依序累計的進/出點時間碼。
  // 時間碼與字幕同一套規則（每幕佔其設定秒數，最少 3 秒），組裝時間軸與分鏡順序一致即可對齊。
  const writtenNames: (string | null)[] = new Array(scenes.length).fill(null);
  // 每幕入包媒體的類型（video/image/audio）——媒體連結版時間軸（fcpxml/xmeml）要知道用哪種元素引用
  const writtenKinds: ("video" | "image" | "audio" | null)[] = new Array(scenes.length).fill(null);
  // 逐鏡旁白音檔的實際相對檔名（成功入包後回填），供鏡頭表標明該鏡有無旁白配音。
  const narrationNames: (string | null)[] = new Array(scenes.length).fill(null);
  let tcAcc = 0;
  const times = scenes.map((sc) => {
    const dur = sc.durationSec > 0 ? sc.durationSec : 3;
    const inSec = tcAcc;
    tcAcc += dur;
    return { in: inSec, out: tcAcc };
  });
  // 序號動態補零：依總鏡數決定位數（至少 2 位），避免破百鏡在檔案總管字典序亂序。
  const sceneNumWidth = Math.max(2, String(scenes.length).length);
  for (const [i, scene] of scenes.entries()) {
    if (clientAbort.signal.aborted) return; // 斷線後別再抓剩餘素材白做工
    const asset = assets.find((a) => a.id === scene.assetId);
    if (!asset || !shouldPack(asset.id)) continue; // 多選打包：未勾選的素材不入包（鏡頭表標「（無素材）」）
    // 來源一律以串流進 archive（不整檔進 RAM）；「取得來源」階段的失敗屬單檔容錯：跳過＋註記
    let source: Readable;
    try {
      // 已落地的素材直接讀 Volume（快、不吃外網、網址過期也不怕）；否則抓外部網址
      if (asset.storagePath) {
        const abs = absPathOf(asset.storagePath);
        await stat(abs); // 先確認檔案可讀：開檔失敗要走單檔跳過，而不是 append 後半寫 entry 毀掉整包
        source = createReadStream(abs);
      } else if (asset.url && /^https?:\/\//.test(asset.url)) {
        // 30 秒逾時涵蓋連線與串流階段；用戶端斷線也會中止進行中的抓取
        const fileRes = await fetchRemoteAsset(asset.url, clientAbort.signal);
        if (!fileRes.ok || !fileRes.body) {
          void fileRes.body?.cancel().catch(() => {}); // 不讀的 body 要取消，避免連線被佔住
          console.warn(`[export] 素材下載失敗 ${asset.url}: HTTP ${fileRes.status}`);
          warnings.push(`「${scene.title}」素材下載失敗（HTTP ${fileRes.status}），未入包`);
          continue;
        }
        const len = Number(fileRes.headers.get("content-length") ?? 0);
        if (len > REMOTE_FILE_MAX_BYTES) {
          void fileRes.body.cancel().catch(() => {});
          console.warn(`[export] 素材過大跳過 ${asset.url}: ${len} bytes`);
          warnings.push(`「${scene.title}」素材過大（${Math.round(len / 1048576)}MB，上限 200MB），未入包`);
          continue;
        }
        source = capRemoteBytes(Readable.fromWeb(fileRes.body as unknown as import("node:stream/web").ReadableStream));
      } else {
        continue;
      }
    } catch (err) {
      if (clientAbort.signal.aborted) return; // 斷線引發的中止不是素材問題，直接收工
      console.warn(`[export] 素材讀取失敗 ${asset.storagePath ?? asset.url}:`, err instanceof Error ? err.message : err);
      warnings.push(`「${scene.title}」素材讀取失敗，未入包（可於系統內重新生成）`);
      continue;
    }
    const num = String(i + 1).padStart(sceneNumWidth, "0");
    const extOf = (fallback: string) => (asset.mime && extFromMime(asset.mime)) || fallback;
    let name: string;
    let kind: "video" | "image" | "audio";
    if (asset.kind === "video") {
      videoIdx += 1;
      kind = "video";
      name = `01_視頻素材/${num}_${safeName(scene.title)}${extOf(".mp4")}`;
    } else if (asset.kind === "audio") {
      kind = "audio";
      name = `02_音訊/${num}_${safeName(scene.title)}${extOf(".wav")}`;
    } else {
      imageIdx += 1;
      kind = "image";
      name = `03_圖像/${num}_${safeName(scene.title)}${extOf(".jpg")}`;
    }
    try {
      await appendAndWait(archive, source, name, clientAbort.signal);
      writtenNames[i] = name; // 成功入包才回填鏡頭表的實際相對檔名
      writtenKinds[i] = kind;
    } catch (err) {
      if (clientAbort.signal.aborted) return; // 斷線中止視為正常結束，不往外拋 500
      // append 之後的串流錯誤代表該 entry 半寫、zip 已不可修復——不能 continue 交付壞包，
      // 直接往外拋，由既有 archive error handler＋index.ts 的 catch 收尾。
      throw err;
    }
  }

  if (clientAbort.signal.aborted) return;

  // 02_旁白音檔：逐鏡旁白配音（scenes.narrationAssetId 指向的 asset）。與畫面素材各自獨立——
  // 一幕即使沒有畫面素材，只要有旁白就照樣輸出，檔名鏡號與畫面素材同一套動態補零，方便對齊字幕與畫面。
  // 取來源方式比照場景素材：已落地讀 Volume、否則抓外網，逐檔容錯（失敗只記警告、不毀整包）。
  for (const [i, scene] of scenes.entries()) {
    if (clientAbort.signal.aborted) return;
    if (!scene.narrationAssetId) continue;
    const narr = assets.find((a) => a.id === scene.narrationAssetId);
    if (!narr || !shouldPack(narr.id)) continue; // 多選打包：未勾選的旁白音檔不入包
    let source: Readable;
    try {
      if (narr.storagePath) {
        const abs = absPathOf(narr.storagePath);
        await stat(abs);
        source = createReadStream(abs);
      } else if (narr.url && /^https?:\/\//.test(narr.url)) {
        const fileRes = await fetchRemoteAsset(narr.url, clientAbort.signal);
        if (!fileRes.ok || !fileRes.body) {
          void fileRes.body?.cancel().catch(() => {});
          console.warn(`[export] 旁白下載失敗 ${narr.url}: HTTP ${fileRes.status}`);
          warnings.push(`「${scene.title}」旁白音檔下載失敗（HTTP ${fileRes.status}），未入包`);
          continue;
        }
        const len = Number(fileRes.headers.get("content-length") ?? 0);
        if (len > REMOTE_FILE_MAX_BYTES) {
          void fileRes.body.cancel().catch(() => {});
          console.warn(`[export] 旁白過大跳過 ${narr.url}: ${len} bytes`);
          warnings.push(`「${scene.title}」旁白音檔過大（${Math.round(len / 1048576)}MB，上限 200MB），未入包`);
          continue;
        }
        source = capRemoteBytes(Readable.fromWeb(fileRes.body as unknown as import("node:stream/web").ReadableStream));
      } else {
        continue;
      }
    } catch (err) {
      if (clientAbort.signal.aborted) return;
      console.warn(`[export] 旁白讀取失敗 ${narr.storagePath ?? narr.url}:`, err instanceof Error ? err.message : err);
      warnings.push(`「${scene.title}」旁白音檔讀取失敗，未入包`);
      continue;
    }
    const num = String(i + 1).padStart(sceneNumWidth, "0");
    const ext = (narr.mime && extFromMime(narr.mime)) || ".mp3";
    const name = `02_旁白音檔/${num}_旁白${ext}`;
    try {
      await appendAndWait(archive, source, name, clientAbort.signal);
      narrationNames[i] = name; // 成功入包才回填鏡頭表
    } catch (err) {
      if (clientAbort.signal.aborted) return;
      throw err;
    }
  }

  if (clientAbort.signal.aborted) return;

  // 鏡頭表主體：每幕一列，補上實際寫入交付包的相對檔名（缺媒體標「（無素材）」）、旁白音檔檔名與累計進出點時間碼。
  for (const [i, scene] of scenes.entries()) {
    const asset = assets.find((a) => a.id === scene.assetId);
    const gen = asset ? generations.find((g) => g.id === (asset.meta as { generationId?: string })?.generationId) : undefined;
    const file = writtenNames[i] ?? "（無素材）";
    const narrationFile = narrationNames[i] ?? "（無）";
    const tc = `${srtTime(times[i].in)} → ${srtTime(times[i].out)}`;
    lines.push(
      `| ${i + 1} | ${scene.title} | ${scene.durationSec}s | ${asset?.kind ?? "—"} | ${file} | ${narrationFile} | ${tc} | ${gen?.prompt ?? "—"} | ${gen?.modelId ?? "—"} |`,
    );
  }

  // 00_鎖定原素材：固定素材模式的原音/開示/配樂——原封保留，剪輯時圍繞它組裝、不改動
  //（多選打包時同樣只入包被勾選者）
  const lockedAssets = assets.filter((a) => a.locked && shouldPack(a.id));
  let lockedIdx = 0;
  // 序號動態補零：與場景素材同規則（至少 2 位），破百件也維持字典序。
  const lockedNumWidth = Math.max(2, String(lockedAssets.length).length);
  const kindDir: Record<string, string> = { audio: "音訊", video: "影片", image: "圖像", doc: "文件" };
  for (const asset of lockedAssets) {
    if (clientAbort.signal.aborted) return;
    let source: Readable;
    try {
      if (asset.storagePath) {
        const abs = absPathOf(asset.storagePath);
        await stat(abs);
        source = createReadStream(abs);
      } else if (asset.url && /^https?:\/\//.test(asset.url)) {
        const fileRes = await fetchRemoteAsset(asset.url, clientAbort.signal);
        if (!fileRes.ok || !fileRes.body) {
          void fileRes.body?.cancel().catch(() => {});
          warnings.push(`鎖定素材「${asset.title}」下載失敗（HTTP ${fileRes.status}），未入包`); // 與場景素材分支一致：非 OK 要記警告
          continue;
        }
        const len = Number(fileRes.headers.get("content-length") ?? 0);
        if (len > REMOTE_FILE_MAX_BYTES) {
          void fileRes.body.cancel().catch(() => {});
          warnings.push(`鎖定素材「${asset.title}」過大（${Math.round(len / 1048576)}MB，上限 200MB），未入包`); // 補上與場景素材一致的大小守門
          continue;
        }
        source = capRemoteBytes(Readable.fromWeb(fileRes.body as unknown as import("node:stream/web").ReadableStream));
      } else {
        continue;
      }
    } catch (err) {
      if (clientAbort.signal.aborted) return;
      warnings.push(`鎖定素材「${asset.title}」讀取失敗，未入包`);
      continue;
    }
    lockedIdx += 1;
    const ext = (asset.mime && extFromMime(asset.mime)) || "";
    const num = String(lockedIdx).padStart(lockedNumWidth, "0");
    try {
      await appendAndWait(archive, source, `00_鎖定原素材/${kindDir[asset.kind] ?? "其他"}/${num}_${safeName(asset.title)}${ext}`, clientAbort.signal);
    } catch (err) {
      if (clientAbort.signal.aborted) return;
      throw err;
    }
  }
  if (lockedAssets.length) {
    lines.push("", `## 鎖定原素材（不可更動 · ${lockedIdx} 件）`, "> 師父原音／開示文字／配樂等固定素材，請原封使用、只在畫面層創作。");
  }

  if (warnings.length) lines.push("", ...warnings.map((w) => `> ⚠ ${w}`));
  lines.push(
    "",
    `> 共 ${scenes.length} 鏡（影片 ${videoIdx}・圖像 ${imageIdx}${warnings.length ? `・缺漏 ${warnings.length}` : ""}）· 由 AI Director OS 產出 · ${new Date().toISOString().slice(0, 10)}`,
  );
  archive.append(lines.join("\n"), { name: "05_文件/腳本與鏡頭表.md" });

  // 04_字幕：從分鏡配音詞產生 SRT（有配音詞才放）——剪映/Premiere/YouTube 皆可直接匯入
  const srt = buildVoiceoverSrt(scenes);
  const hasSubtitle = srt.length > 0;
  if (hasSubtitle) archive.append(srt, { name: "04_字幕/字幕.srt" });

  // 交付/：剪輯軟體通用時間軸格式（需求 #8）——一律附加（多選打包也照常）：
  // 字幕.srt（剪映/CapCut/Premiere）、時間軸.fcpxml（Final Cut Pro/DaVinci Resolve/剪映專業版）、
  // Premiere時間軸.xml（Premiere/DaVinci Resolve）、剪輯表.edl（DaVinci Resolve 備援）。
  // fcpxml/xmeml 為「媒體連結版」：引用本包內實際入包的媒體檔（相對路徑 ../），匯入即自動組好粗剪；
  // 與 04_字幕 的可讀性切塊版不同，這裡每鏡一塊、空詞用標題，供剪輯逐鏡對位；沒有分鏡時改附說明檔。
  if (scenes.length > 0) {
    // 媒體連結版時間軸：把每鏡「實際入包」的媒體/旁白相對路徑補進 TimelineScene（未入包者為 null → gap 佔位）
    const timelineScenes: TimelineScene[] = scenes.map((sc, i) => ({
      title: sc.title,
      durationSec: sc.durationSec,
      voiceover: sc.voiceover,
      mediaPath: writtenNames[i],
      mediaKind: writtenKinds[i],
      narrationPath: narrationNames[i],
    }));
    // 時間軸檔在 交付/ 子資料夾內，相對媒體資料夾要往上一層
    const opts = { pathPrefix: "../" };
    archive.append(buildSrt(timelineScenes), { name: "交付/字幕.srt" });
    archive.append(buildFcpxml(timelineScenes, project.title, opts), { name: "交付/時間軸.fcpxml" });
    archive.append(buildXmeml(timelineScenes, project.title, opts), { name: "交付/Premiere時間軸.xml" });
    archive.append(buildEdl(timelineScenes, project.title), { name: "交付/剪輯表.edl" });
  } else {
    archive.append(
      "本專案還沒有分鏡，無法產生時間軸/字幕檔。\n" +
        "請先在系統內建立分鏡（AI 拆分鏡或手動新增）後再打包，即會附上：\n" +
        "交付/字幕.srt（剪映/CapCut/Premiere）、交付/時間軸.fcpxml（Final Cut Pro/DaVinci Resolve/剪映專業版）、\n" +
        "交付/Premiere時間軸.xml（Premiere）、交付/剪輯表.edl（DaVinci Resolve）。\n",
      { name: "交付/說明.txt" },
    );
  }

  const hasNarration = narrationNames.some((n) => n !== null);
  archive.append(
    `資料夾說明：${lockedAssets.length ? "00_鎖定原素材（不可更動的原音/開示/配樂，原封使用）／" : ""}01_視頻素材（依鏡號排序）／${hasNarration ? "02_旁白音檔（逐鏡旁白配音）／" : ""}03_圖像／${hasSubtitle ? "04_字幕（字幕.srt，可匯入剪映/Premiere/YouTube）／" : ""}05_文件（腳本與鏡頭表）／交付（時間軸與字幕檔）。\n` +
      "\n" +
      "【最快組片方式：匯入一個檔，粗剪自動排好】\n" +
      "本包內的時間軸檔已「連結媒體」：先把整個 zip 解壓（保持資料夾結構不動），再依你的剪輯軟體匯入對應檔案，\n" +
      "分鏡順序、每鏡秒數與旁白音軌會自動排上時間軸：\n" +
      "・Premiere Pro：檔案→匯入→選「交付/Premiere時間軸.xml」——時間軸（鏡位/秒數/旁白軌/備註）即建好；素材通常會先顯示離線\n" +
      "　（Premiere 只認絕對路徑，而這包不知道你會解壓到哪），對專案面板任一剪輯按右鍵→連結媒體→Locate 指向解壓資料夾，會按檔名一次全部接回。\n" +
      "・Final Cut Pro／剪映專業版：匯入「交付/時間軸.fcpxml」。顯示離線時同樣 relink 到解壓資料夾即可。\n" +
      "・DaVinci Resolve：檔案→匯入→時間軸→選「交付/時間軸.fcpxml」（建議）或「交付/剪輯表.edl」（備援，需手動掛媒體）。\n" +
      "　（Resolve 不會自動解析相對路徑——匯入時跳出詢問就指向解壓資料夾，或先把解壓資料夾拖進媒體池再匯入時間軸。）\n" +
      "・剪映/CapCut（手機或桌面）：目前無時間軸匯入功能——請把 01_視頻素材/03_圖像依鏡號拖入，再匯入「交付/字幕.srt」對位（每鏡一塊字幕＝一鏡的進出點）。\n" +
      "\n" +
      "交付/ 內各檔用途：字幕.srt（剪映/CapCut/Premiere；每鏡一塊供對位）、時間軸.fcpxml（FCP/Resolve/剪映專業版；已連結媒體）、\n" +
      "Premiere時間軸.xml（Premiere；已連結媒體）、剪輯表.edl（Resolve 備援）。時間碼皆依分鏡規劃秒數累計（30fps）。\n" +
      "注意：時間軸引用的是「這一包內」的媒體相對路徑，解壓後請勿改資料夾名稱或搬動檔案再匯入。\n" +
      "\n" +
      (hasNarration
        ? "02_旁白音檔＝逐鏡旁白配音，檔名鏡號對應字幕與畫面（同一套鏡號補零）；fcpxml/Premiere XML 已把旁白排在音軌對齊各鏡，手動組裝時把同鏡號旁白對齊該鏡畫面即可；05_文件的鏡頭表「旁白音檔」欄列出每鏡對應的檔名。\n"
        : "") +
      (hasSubtitle
        ? "字幕.srt 的時間碼依「分鏡規劃秒數」依序累計（每幕佔其設定秒數），組裝時間軸與分鏡順序一致即可對齊；若實際剪輯調整了各幕長度，請在剪輯軟體裡微調字幕時間。\n"
        : "（本片分鏡尚無配音詞，故未附字幕；用 AI 拆分鏡或在分鏡填配音詞後再打包即有字幕。）\n"),
    { name: "README.txt" },
  );

  try {
    await archive.finalize();
  } catch (err) {
    // abort() 之後 finalize 會以 ABORTED reject——斷線導致的中止是正常結束，不往外拋
    if (!clientAbort.signal.aborted) throw err;
  }
}
