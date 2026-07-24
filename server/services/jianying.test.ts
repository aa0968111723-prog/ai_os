/**
 * jianying.ts 剪映草稿產生器單元測試(實驗性直連):
 * draft_content.json 的結構比照 pyJianYingDraft(剪映 5.9/10.8 實測格式)——
 * 微秒時間、photo 素材 3 小時 duration、speed 素材登記、佔位符路徑、字幕切塊。
 */
import { describe, expect, it } from "vitest";
import { buildJianyingDraftContent, buildJianyingMetaInfo, type JyScene } from "./jianying";

const PLACEHOLDER = "##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##";

const scenes: JyScene[] = [
  { title: "開場", durationSec: 5, voiceover: "你好，歡迎收看。", media: { kind: "video", fileName: "01_開場.mp4" }, narrationFileName: "01_旁白.mp3" },
  { title: "轉場", durationSec: 0, voiceover: null, media: { kind: "photo", fileName: "02_轉場.jpg" }, narrationFileName: null }, // 非正數 → 3 秒
  { title: "收尾", durationSec: 2, voiceover: "再會", media: null, narrationFileName: null }, // 無素材:時間軸留空但仍推進時間
];

describe("buildJianyingDraftContent", () => {
  const { content, durationUs } = buildJianyingDraftContent(scenes, "測試_AI草稿");
  const draft = JSON.parse(content);

  it("總時長=各鏡秒數和(微秒),頂層欄位比照剪映 5.9 模板", () => {
    expect(durationUs).toBe((5 + 3 + 2) * 1_000_000);
    expect(draft.duration).toBe(durationUs);
    expect(draft.fps).toBe(30);
    expect(draft.version).toBe(360000);
    expect(draft.new_version).toBe("110.0.0");
    expect(draft.canvas_config).toEqual({ height: 1080, ratio: "original", width: 1920 });
    expect(draft.id).toMatch(/^[0-9A-F-]{36}$/); // 大寫 UUID
    expect(draft.name).toBe("測試_AI草稿");
  });

  it("視覺素材:影片 type=video、時長=該鏡秒數;圖片 type=photo、固定 3 小時", () => {
    expect(draft.materials.videos).toHaveLength(2);
    const [video, photo] = draft.materials.videos;
    expect(video.type).toBe("video");
    expect(video.duration).toBe(5_000_000);
    expect(video.path).toBe(`${PLACEHOLDER}/Resources/local/01_開場.mp4`);
    expect(video.material_name).toBe("01_開場.mp4");
    expect(video.id).toMatch(/^[0-9a-f]{32}$/); // uuid4 hex
    expect(video.material_id).toBe(video.id);
    expect(photo.type).toBe("photo");
    expect(photo.duration).toBe(10_800_000_000);
  });

  it("旁白素材:type=extract_music、佔位符路徑", () => {
    expect(draft.materials.audios).toHaveLength(1);
    const audio = draft.materials.audios[0];
    expect(audio.type).toBe("extract_music");
    expect(audio.path).toBe(`${PLACEHOLDER}/Resources/local/01_旁白.mp3`);
    expect(audio.local_material_id).toBe(audio.id);
    expect(audio.music_id).toBe(audio.id);
  });

  it("每個 video/audio segment 都在 materials.speeds 登記一個 speed 素材並引用", () => {
    // 2 個畫面 segment + 1 個旁白 segment = 3 個 speed
    expect(draft.materials.speeds).toHaveLength(3);
    const speedIds = new Set(draft.materials.speeds.map((s: { id: string }) => s.id));
    const tracks = draft.tracks as Array<{ type: string; segments: Array<{ extra_material_refs: string[] }> }>;
    for (const track of tracks) {
      if (track.type === "text") continue; // text 比照 pyJianYingDraft:speed 不登記
      for (const seg of track.segments) {
        expect(speedIds.has(seg.extra_material_refs[0])).toBe(true);
      }
    }
    for (const s of draft.materials.speeds) {
      expect(s).toMatchObject({ curve_speed: null, mode: 0, speed: 1.0, type: "speed" });
    }
  });

  it("video 軌:兩個 segment 時間無縫接續、無素材鏡留空;source/target timerange 一致", () => {
    const videoTrack = draft.tracks.find((t: { type: string }) => t.type === "video");
    expect(videoTrack.segments).toHaveLength(2);
    const [s1, s2] = videoTrack.segments;
    expect(s1.target_timerange).toEqual({ start: 0, duration: 5_000_000 });
    expect(s1.source_timerange).toEqual({ start: 0, duration: 5_000_000 });
    expect(s1.hdr_settings).toEqual({ intensity: 1.0, mode: 1, nits: 1000 });
    expect(s2.target_timerange).toEqual({ start: 5_000_000, duration: 3_000_000 });
    // 第三鏡無素材 → video 軌只有兩段,但總時長仍含第三鏡(見 duration 測試)
  });

  it("audio 軌:旁白對齊該鏡起點,clip/hdr_settings 為 null", () => {
    const audioTrack = draft.tracks.find((t: { type: string }) => t.type === "audio");
    expect(audioTrack.segments).toHaveLength(1);
    const seg = audioTrack.segments[0];
    expect(seg.target_timerange.start).toBe(0);
    expect(seg.clip).toBeNull();
    expect(seg.hdr_settings).toBeNull();
  });

  it("text 軌:配音詞切塊成字幕,content 是含 styles/text 的 JSON 字串,位置在畫面下緣", () => {
    const textTrack = draft.tracks.find((t: { type: string }) => t.type === "text");
    expect(textTrack.segments.length).toBeGreaterThan(0);
    expect(draft.materials.texts.length).toBe(textTrack.segments.length);
    const mat = draft.materials.texts[0];
    const parsed = JSON.parse(mat.content);
    expect(parsed.text.length).toBeGreaterThan(0);
    expect(parsed.styles[0].range).toEqual([0, parsed.text.length]);
    expect(mat.type).toBe("subtitle");
    const seg = textTrack.segments[0];
    expect(seg.clip.transform.y).toBe(-0.8);
    expect(seg.source_timerange).toBeNull();
  });

  it("render_index 依軌道匯出序(video=0、audio=1、text=2)", () => {
    draft.tracks.forEach((track: { segments: Array<{ render_index: number }> }, i: number) => {
      for (const seg of track.segments) expect(seg.render_index).toBe(i);
    });
  });

  it("空分鏡:仍是合法草稿(video 軌空、時長 0)", () => {
    const { content: emptyContent, durationUs: emptyUs } = buildJianyingDraftContent([], "空");
    const empty = JSON.parse(emptyContent);
    expect(emptyUs).toBe(0);
    expect(empty.tracks).toHaveLength(1); // 只有(空的)video 主軌
    expect(empty.tracks[0].segments).toHaveLength(0);
    expect(empty.materials.videos).toHaveLength(0);
  });
});

describe("buildJianyingMetaInfo", () => {
  it("帶入草稿名/總時長,draft_id 為大寫 UUID,draft_materials 七組空殼保留", () => {
    const meta = JSON.parse(buildJianyingMetaInfo("我的草稿", 8_000_000));
    expect(meta.draft_name).toBe("我的草稿");
    expect(meta.tm_duration).toBe(8_000_000);
    expect(meta.draft_id).toMatch(/^[0-9A-F-]{36}$/);
    expect(meta.draft_materials).toHaveLength(7);
  });
});
