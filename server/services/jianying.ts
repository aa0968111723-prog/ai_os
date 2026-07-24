/**
 * 剪映/CapCut 草稿包（實驗性）：伺服器直接產生剪映草稿資料夾（draft_content.json＋素材），
 * 使用者解壓到剪映草稿目錄後打開剪映，時間軸（畫面＋旁白＋字幕）已排好——這是 web 產品
 * 能做到「最接近直連剪輯軟體」的通道。
 *
 * 格式依據：開源專案 pyJianYingDraft（MIT；剪映 5.9 與 10.8 實測可開明文草稿）的模板與
 * export_json 邏輯逐欄位比照（見 jianyingTemplate.ts）。要點：
 * - 時間一律「微秒」；圖片素材 type="photo"、duration 固定 3 小時（等同無限長）。
 * - 每個 video/audio segment 須在 materials.speeds 登記一個 speed 素材並以 extra_material_refs 引用。
 * - 素材路徑用剪映官方佔位符「##_draftpath_placeholder_<固定UUID>_##」＝草稿資料夾根目錄，
 *   媒體放草稿資料夾內 Resources/local/ → 解壓到任何機器的草稿目錄都能直接開（免 relink）。
 * - CapCut Mac 版內容檔名為 draft_info.json，故同內容雙檔名各放一份。
 * 標「實驗性」原因：剪映屬非公開格式、新版可能變動；素材寬高未經探測一律標 1920×1080，
 * 剪映載入後會依實際檔案重新繪製，但個別版本行為未逐一驗證。
 */
import { ZipArchive } from "archiver";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { Response } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { absPathOf, extFromMime } from "./storage";
import { appendAndWait, capRemoteBytes, fetchRemoteAsset, REMOTE_FILE_MAX_BYTES, safeName, sceneDur, splitCue } from "./exporter";
import { JY_CONTENT_TEMPLATE, JY_META_TEMPLATE } from "./jianyingTemplate";

/** 剪映官方「草稿資料夾根目錄」佔位符——固定魔法字串，多個獨立開源專案一字不差交叉證實 */
const JY_PLACEHOLDER = "##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##";
/** 草稿內媒體相對位置（剪映自己匯入媒體的慣例目錄） */
const JY_MEDIA_DIR = "Resources/local";
const US = 1_000_000; // 秒 → 微秒
/** 圖片素材固定時長（3 小時＝剪映對「無限長」靜態圖的慣例值，segment 可任意截取） */
const PHOTO_DURATION_US = 10_800_000_000;

/** 剪映素材/軌道/片段 id 慣例：uuid4 的 32 位 hex（無連字號） */
const hex32 = () => randomUUID().replace(/-/g, "");

/** 草稿產生器吃的每鏡形狀：媒體/旁白為「已放進草稿包 Resources/local/ 的檔名」，null＝該鏡沒有 */
export type JyScene = {
  title: string;
  durationSec: number;
  voiceover: string | null;
  media: { kind: "video" | "photo"; fileName: string } | null;
  narrationFileName: string | null;
};

/** 佔位符路徑：##_draftpath_..._##/Resources/local/<檔名>（剪映載入時解析為草稿實際位置） */
const jyPath = (fileName: string) => `${JY_PLACEHOLDER}/${JY_MEDIA_DIR}/${fileName}`;

/** segment 共通欄位（比照 pyJianYingDraft BaseSegment/MediaSegment.export_json） */
function baseSegment(materialId: string, startUs: number, durUs: number): Record<string, unknown> {
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1.0,
    reverse: false,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    id: hex32(),
    material_id: materialId,
    target_timerange: { start: startUs, duration: durUs },
    common_keyframes: [],
    keyframe_refs: [],
    speed: 1.0,
    volume: 1.0,
    is_tone_modify: false,
  };
}

/** 不裁切的 clip 設定（圖像變換全預設） */
const defaultClip = (transformY = 0.0) => ({
  alpha: 1.0,
  flip: { horizontal: false, vertical: false },
  rotation: 0.0,
  scale: { x: 1.0, y: 1.0 },
  transform: { x: 0.0, y: transformY },
});

/**
 * 組出完整 draft_content.json 字串與總時長（微秒）。
 * 軌道：video（畫面主軌，圖片/影片混排）＋audio（旁白）＋text（字幕，配音詞依可讀性切塊、
 * 與 SRT 同一套規則）——render_index 依軌道匯出序，全部比照 pyJianYingDraft 的輸出慣例。
 */
export function buildJianyingDraftContent(scenes: JyScene[], draftName: string): { content: string; durationUs: number } {
  const content = structuredClone(JY_CONTENT_TEMPLATE) as unknown as Record<string, any>;
  content.id = randomUUID().toUpperCase();
  content.name = draftName;

  const videos: unknown[] = [];
  const audios: unknown[] = [];
  const texts: unknown[] = [];
  const speeds: unknown[] = [];
  const videoSegs: Record<string, unknown>[] = [];
  const audioSegs: Record<string, unknown>[] = [];
  const textSegs: Record<string, unknown>[] = [];

  const addSpeed = () => {
    const id = hex32();
    speeds.push({ curve_speed: null, id, mode: 0, speed: 1.0, type: "speed" });
    return id;
  };

  let cumSec = 0;
  let tUs = 0;
  for (const sc of scenes) {
    const startSec = cumSec;
    cumSec += sceneDur(sc);
    const startUs = tUs;
    const durUs = Math.round(cumSec * US) - startUs; // 邊界取累計值再回差，避免逐鏡四捨五入漂移
    tUs = startUs + durUs;

    if (sc.media) {
      const mid = hex32();
      videos.push({
        audio_fade: null,
        category_id: "",
        category_name: "local",
        check_flag: 63487,
        crop: {
          upper_left_x: 0.0, upper_left_y: 0.0, upper_right_x: 1.0, upper_right_y: 0.0,
          lower_left_x: 0.0, lower_left_y: 1.0, lower_right_x: 1.0, lower_right_y: 1.0,
        },
        crop_ratio: "free",
        crop_scale: 1.0,
        // 影片素材長度未經探測，以該鏡規劃秒數計（截取前 N 秒）；圖片固定 3 小時
        duration: sc.media.kind === "photo" ? PHOTO_DURATION_US : durUs,
        height: 1080, // 未探測實際尺寸的慣例值；剪映載入時依實檔重算畫面
        id: mid,
        local_material_id: "",
        material_id: mid,
        material_name: sc.media.fileName,
        media_path: "",
        path: jyPath(sc.media.fileName),
        type: sc.media.kind,
        width: 1920,
      });
      videoSegs.push({
        ...baseSegment(mid, startUs, durUs),
        source_timerange: { start: 0, duration: durUs },
        extra_material_refs: [addSpeed()],
        clip: defaultClip(),
        uniform_scale: { on: true, value: 1.0 },
        hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
      });
    }

    if (sc.narrationFileName) {
      const aid = hex32();
      audios.push({
        app_id: 0,
        category_id: "",
        category_name: "local",
        check_flag: 3,
        copyright_limit_type: "none",
        duration: durUs, // 音檔實際長度未探測，以該鏡秒數計
        effect_id: "",
        formula_id: "",
        id: aid,
        local_material_id: aid,
        music_id: aid,
        name: sc.narrationFileName,
        path: jyPath(sc.narrationFileName),
        source_platform: 0,
        type: "extract_music",
        wave_points: [],
      });
      audioSegs.push({
        ...baseSegment(aid, startUs, durUs),
        source_timerange: { start: 0, duration: durUs },
        extra_material_refs: [addSpeed()],
        clip: null,
        hdr_settings: null,
      });
    }

    // 字幕：與 04_字幕/SRT 同一套可讀性切塊（每塊 ≤18 全形字、最短 0.8 秒），一塊一素材一片段
    for (const cue of splitCue(sc.voiceover ?? "", startSec, cumSec)) {
      const tid = hex32();
      texts.push({
        id: tid,
        content: JSON.stringify({
          styles: [
            {
              fill: { alpha: 1.0, content: { render_type: "solid", solid: { alpha: 1.0, color: [1.0, 1.0, 1.0] } } },
              range: [0, cue.text.length],
              size: 6.0,
              bold: false,
              italic: false,
              underline: false,
              strokes: [],
            },
          ],
          text: cue.text,
        }),
        typesetting: 0,
        alignment: 1, // 置中
        letter_spacing: 0.0,
        line_spacing: 0.02,
        line_feed: 1,
        line_max_width: 0.82,
        force_apply_line_max_width: false,
        check_flag: 7,
        type: "subtitle",
        global_alpha: 1.0,
      });
      textSegs.push({
        ...baseSegment(tid, Math.round(cue.start * US), Math.max(Math.round((cue.end - cue.start) * US), 1)),
        source_timerange: null,
        // 比照 pyJianYingDraft：text 片段引用的 speed id 不登記進 materials.speeds（其實測輸出即如此）
        extra_material_refs: [hex32()],
        clip: defaultClip(-0.8), // 剪映匯入字幕的慣例位置（畫面下緣）
        uniform_scale: { on: true, value: 1.0 },
      });
    }
  }

  const trackJson = (type: "video" | "audio" | "text", segments: Record<string, unknown>[]) => ({
    attribute: 0,
    flag: 0,
    id: hex32(),
    is_default_name: true,
    name: "",
    segments,
    type,
  });
  const tracks = [trackJson("video", videoSegs)];
  if (audioSegs.length) tracks.push(trackJson("audio", audioSegs));
  if (textSegs.length) tracks.push(trackJson("text", textSegs));
  tracks.forEach((tr, i) => tr.segments.forEach((s) => { s.render_index = i; }));

  content.materials.videos = videos;
  content.materials.audios = audios;
  content.materials.texts = texts;
  content.materials.speeds = speeds;
  content.tracks = tracks;
  content.duration = tUs;
  content.fps = 30.0;

  return { content: JSON.stringify(content, null, 4), durationUs: tUs };
}

/** draft_meta_info.json：模板空殼＋草稿名/id/總時長（其餘欄位剪映開啟後自行補全） */
export function buildJianyingMetaInfo(draftName: string, durationUs: number): string {
  const meta = structuredClone(JY_META_TEMPLATE) as unknown as Record<string, unknown>;
  meta.draft_id = randomUUID().toUpperCase();
  meta.draft_name = draftName;
  meta.tm_duration = durationUs;
  return JSON.stringify(meta, null, 4);
}

/** 安裝說明（zip 根目錄）：各平台草稿目錄、步驟與實驗性注意事項 */
function installGuide(draftName: string): string {
  return [
    `「${draftName}」剪映/CapCut 草稿包 · 安裝說明`,
    "",
    "【怎麼用】",
    `1. 解壓本 zip，得到資料夾「${draftName}」（整個資料夾原封不動，別改名、別搬動裡面的檔案）。`,
    "2. 把整個資料夾放進剪映的草稿目錄（見下方路徑）。",
    "3. 打開剪映（已開著的話重啟一次），首頁草稿列表就會出現這個專案，點開即可直接剪——",
    "   畫面、旁白、字幕都已按分鏡排好在時間軸上。",
    "",
    "【剪映草稿目錄預設位置】",
    "・Windows：C:\\Users\\<你的使用者名稱>\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft",
    "・Mac：~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft",
    "（若你在剪映「全局設置→草稿位置」改過路徑，放到你設定的位置）",
    "",
    "【CapCut 國際版】",
    "・Windows：C:\\Users\\<你的使用者名稱>\\AppData\\Local\\CapCut\\User Data\\Projects\\com.lveditor.draft",
    "・Mac：~/Movies/CapCut/User Data/Projects/com.lveditor.draft",
    "（包內已同時附 draft_content.json 與 draft_info.json 兩種檔名，對應不同版本的命名差異）",
    "",
    "【注意（實驗性功能）】",
    "・草稿格式為剪映內部格式，剪映改版後可能失效；目前依開源社群在剪映 5.9～10.x 的實測格式產生。",
    "・素材路徑使用剪映官方「草稿目錄佔位符」，換電腦也能開；若個別素材顯示遺失，點該片段替換素材，",
    "  從草稿資料夾內的 Resources/local/ 選回同名檔案即可。",
    "・手機版剪映無法直接讀桌面草稿；手機剪輯請改用交付包（zip）內的素材＋字幕.srt 流程。",
    "・若剪映打不開此草稿，請改用交付包內「交付/」資料夾的時間軸檔（fcpxml/xml）走 Premiere/FCP/Resolve，",
    "  或回報給管理員（附上你的剪映版本號）。",
    "",
    "由 AI Director OS 產出",
    "",
  ].join("\n");
}

/**
 * 打包剪映草稿 zip：`<草稿名>/draft_content.json`＋`draft_info.json`＋`draft_meta_info.json`
 * ＋`Resources/local/媒體檔`，外加根目錄安裝說明。媒體取得方式與交付包同規則
 * （已落地讀 Volume、否則抓外網；逐檔容錯，失敗的鏡在時間軸上留空但草稿照樣可開）。
 */
export async function exportJianyingDraftZip(projectId: string, res: Response): Promise<void> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new Error("找不到專案");

  const scenes = await db
    .select()
    .from(schema.scenes)
    .where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt)))
    .orderBy(asc(schema.scenes.orderIndex));
  // 金錢安全比照交付包：已軟刪除素材絕不入包
  const assets = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.projectId, projectId), isNull(schema.assets.deletedAt)));

  const draftName = `${safeName(project.title)}_AI草稿`;
  const zipName = `${safeName(project.title)}_剪映草稿包.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("error", (err) => {
    console.error("[export:jianying] 打包錯誤：", err instanceof Error ? err.message : err);
    if (!res.headersSent) {
      // 標頭還沒 flush 就失敗：先撤掉 zip/attachment 標頭再回錯，否則瀏覽器把錯誤內文存成壞掉的 .zip
      res.removeHeader("Content-Disposition");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(500).end("打包失敗");
    } else res.destroy();
  });
  const clientAbort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      clientAbort.abort();
      archive.abort();
    }
  });
  archive.pipe(res);

  // 取媒體來源：與交付包同一套守門（落地檔先 stat、遠端限時+限大小），失敗回 null 走單檔容錯
  const openSource = async (a: { storagePath: string | null; url: string | null }): Promise<Readable | null> => {
    try {
      if (a.storagePath) {
        const abs = absPathOf(a.storagePath);
        await stat(abs);
        return createReadStream(abs);
      }
      if (a.url && /^https?:\/\//.test(a.url)) {
        const fileRes = await fetchRemoteAsset(a.url, clientAbort.signal);
        if (!fileRes.ok || !fileRes.body) {
          void fileRes.body?.cancel().catch(() => {});
          return null;
        }
        const len = Number(fileRes.headers.get("content-length") ?? 0);
        if (len > REMOTE_FILE_MAX_BYTES) {
          void fileRes.body.cancel().catch(() => {});
          return null;
        }
        // 標頭層守門擋不住 chunked/謊報長度的回應——串流階段由 capRemoteBytes 計數，超限即斷
        return capRemoteBytes(Readable.fromWeb(fileRes.body as unknown as import("node:stream/web").ReadableStream));
      }
      return null;
    } catch {
      return null;
    }
  };

  const numWidth = Math.max(2, String(scenes.length).length);
  const jyScenes: JyScene[] = [];
  for (const [i, scene] of scenes.entries()) {
    if (clientAbort.signal.aborted) return;
    const num = String(i + 1).padStart(numWidth, "0");
    let media: JyScene["media"] = null;
    let narrationFileName: string | null = null;

    const asset = assets.find((a) => a.id === scene.assetId);
    if (asset && (asset.kind === "video" || asset.kind === "image")) {
      const source = await openSource(asset);
      // openSource 中途斷線時 stat 不可取消、仍可能回已開檔的串流——先 destroy 再收工，別漏 fd
      if (clientAbort.signal.aborted) {
        source?.destroy();
        return;
      }
      if (source) {
        const ext = (asset.mime && extFromMime(asset.mime)) || (asset.kind === "video" ? ".mp4" : ".jpg");
        const fileName = `${num}_${safeName(scene.title)}${ext}`;
        try {
          await appendAndWait(archive, source, `${draftName}/${JY_MEDIA_DIR}/${fileName}`, clientAbort.signal);
          media = { kind: asset.kind === "video" ? "video" : "photo", fileName };
        } catch (err) {
          if (clientAbort.signal.aborted) return;
          throw err; // append 後的串流錯誤＝zip 已半寫不可修復，交給 error handler 收尾
        }
      }
    }

    if (scene.narrationAssetId) {
      const narr = assets.find((a) => a.id === scene.narrationAssetId);
      if (narr) {
        const source = await openSource(narr);
        if (clientAbort.signal.aborted) {
          source?.destroy();
          return;
        }
        if (source) {
          const ext = (narr.mime && extFromMime(narr.mime)) || ".mp3";
          const fileName = `${num}_旁白${ext}`;
          try {
            await appendAndWait(archive, source, `${draftName}/${JY_MEDIA_DIR}/${fileName}`, clientAbort.signal);
            narrationFileName = fileName;
          } catch (err) {
            if (clientAbort.signal.aborted) return;
            throw err;
          }
        }
      }
    }

    jyScenes.push({ title: scene.title, durationSec: scene.durationSec, voiceover: scene.voiceover, media, narrationFileName });
  }

  if (clientAbort.signal.aborted) return;

  const { content, durationUs } = buildJianyingDraftContent(jyScenes, draftName);
  archive.append(content, { name: `${draftName}/draft_content.json` });
  archive.append(content, { name: `${draftName}/draft_info.json` }); // CapCut Mac 版的內容檔名
  archive.append(buildJianyingMetaInfo(draftName, durationUs), { name: `${draftName}/draft_meta_info.json` });
  archive.append(installGuide(draftName), { name: "安裝說明.txt" });

  try {
    await archive.finalize();
  } catch (err) {
    if (!clientAbort.signal.aborted) throw err; // 斷線導致的中止是正常結束
  }
}
