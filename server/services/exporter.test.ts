/**
 * exporter.ts 時間軸格式產生器單元測試(需求 #8 交付＋直連強化):
 * buildSrt / buildFcpxml / buildXmeml / buildEdl 的時間碼累加、最少 3 秒規則、跳脫與空清單行為,
 * 以及 fcpxml/xmeml 的「媒體連結版」(分鏡帶 mediaPath/narrationPath 時引用交付包內媒體)。
 * 共用規則:durationSec ≤ 0 以 3 秒計;時間軸依序累加;30fps 影格對齊。
 */
import { describe, expect, it } from "vitest";
import { buildEdl, buildFcpxml, buildSrt, buildXmeml, type TimelineScene } from "./exporter";

const scenes: TimelineScene[] = [
  { title: "開場", durationSec: 5, voiceover: "你好,歡迎收看" },
  { title: "第二鏡", durationSec: 0, voiceover: null }, // 非正數 → 3 秒;無詞 → 用標題
  { title: "收尾", durationSec: 1.5, voiceover: "  " }, // 空白詞視同無詞
];

describe("buildSrt", () => {
  it("空清單回空字串(不產生空字幕檔)", () => {
    expect(buildSrt([])).toBe("");
  });

  it("每鏡一塊、時間碼依 durationSec 累加、無詞用標題", () => {
    const srt = buildSrt(scenes);
    const blocks = srt.trimEnd().split("\n\n");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe("1\n00:00:00,000 --> 00:00:05,000\n你好,歡迎收看");
    // durationSec 0 → 3 秒,從 5 秒接續
    expect(blocks[1]).toBe("2\n00:00:05,000 --> 00:00:08,000\n第二鏡");
    // 1.5 秒 → 毫秒精度;空白配音詞退回標題
    expect(blocks[2]).toBe("3\n00:00:08,000 --> 00:00:09,500\n收尾");
    expect(srt.endsWith("\n")).toBe(true);
  });

  it("時間碼跨小時進位正確(HH:MM:SS,mmm)", () => {
    const srt = buildSrt([{ title: "長片", durationSec: 3661.25, voiceover: null }]);
    expect(srt).toContain("00:00:00,000 --> 01:01:01,250");
  });
});

describe("buildFcpxml(骨架版:無媒體路徑)", () => {
  it("結構完整:1.9 版本、30fps format、sequence 總長=各鏡和、gap offset 累加", () => {
    const xml = buildFcpxml(scenes, "測試專案");
    expect(xml).toContain(`<fcpxml version="1.9">`);
    expect(xml).toContain(`frameDuration="100/3000s"`);
    // 5 + 3 + 1.5 = 9.5s → 影格對齊輸出 285/30s(非整秒一律 F/30s 有理數)
    expect(xml).toContain(`<sequence format="r1" duration="285/30s"`);
    expect(xml).toContain(`offset="0s" start="0s" duration="5s"`);
    expect(xml).toContain(`offset="5s" start="0s" duration="3s"`);
    expect(xml).toContain(`offset="8s" start="0s" duration="45/30s"`);
    expect(xml).toContain(`<event name="測試專案">`);
    // 無媒體 → 不產 asset 資源
    expect(xml).not.toContain("<asset ");
  });

  it("標題/配音詞含 XML 特殊字元一律跳脫", () => {
    const xml = buildFcpxml([{ title: `A&B <"'>`, durationSec: 2, voiceover: "旁白&<詞>" }], `P&Q "計畫"`);
    expect(xml).toContain(`name="${"1_A&amp;B &lt;&quot;&apos;&gt;"}"`);
    expect(xml).toContain(`<note>A&amp;B &lt;&quot;&apos;&gt;｜旁白&amp;&lt;詞&gt;</note>`);
    expect(xml).toContain(`<project name="P&amp;Q &quot;計畫&quot;">`);
    // 原始未跳脫字串不得出現在任何屬性/元素中
    expect(xml).not.toContain(`A&B`);
  });

  it("有配音詞 note 帶「標題｜詞」,無詞只有標題", () => {
    const xml = buildFcpxml(scenes, "P");
    expect(xml).toContain(`<note>開場｜你好,歡迎收看</note>`);
    expect(xml).toContain(`<note>第二鏡</note>`);
    expect(xml).toContain(`<note>收尾</note>`); // 空白詞 → 只有標題
  });

  it("空清單仍是合法骨架(spine 內無 gap)", () => {
    const xml = buildFcpxml([], "空專案");
    expect(xml).toContain("<spine>");
    expect(xml).not.toContain("<gap");
    expect(xml).toContain(`duration="0s"`);
  });
});

// 媒體連結版共用測資:影片鏡＋圖片鏡(帶旁白)＋無素材鏡(帶旁白)
const linkedScenes: TimelineScene[] = [
  { title: "開場", durationSec: 5, voiceover: "第一句", mediaPath: "01_視頻素材/01_開場.mp4", mediaKind: "video", narrationPath: null },
  { title: "轉場", durationSec: 4, voiceover: null, mediaPath: "03_圖像/02_轉場.jpg", mediaKind: "image", narrationPath: "02_旁白音檔/02_旁白.mp3" },
  { title: "收尾", durationSec: 3, voiceover: "尾聲", mediaPath: null, mediaKind: null, narrationPath: "02_旁白音檔/03_旁白.mp3" },
];

describe("buildFcpxml(媒體連結版)", () => {
  const xml = buildFcpxml(linkedScenes, "專案", { pathPrefix: "../" });

  it("影片鏡:asset(30fps format r1)＋spine asset-clip,src 為 ../ 相對 URI 且逐段 percent-encode", () => {
    expect(xml).toContain(`hasVideo="1" hasAudio="1" format="r1"`);
    expect(xml).toContain(`src="../${encodeURIComponent("01_視頻素材")}/${encodeURIComponent("01_開場.mp4")}"`);
    expect(xml).toMatch(/<asset-clip ref="a\d+" offset="0s" start="0s" duration="5s" name="1_開場">/);
  });

  it("圖片鏡:asset duration=0s、format 用無 frameDuration 的 r2,spine 用 <video> 引用", () => {
    expect(xml).toContain(`<format id="r2" name="FFVideoFormatRateUndefined" width="1920" height="1080"/>`);
    expect(xml).toContain(`duration="0s" hasVideo="1" videoSources="1" format="r2"`);
    expect(xml).toMatch(/<video ref="a\d+" offset="5s" start="0s" duration="4s" name="2_轉場">/);
  });

  it("旁白:connected clip 巢在該鏡主元素內,lane=-1、offset=0s(對齊父 clip 開頭)", () => {
    expect(xml).toMatch(/<asset-clip ref="a\d+" lane="-1" offset="0s" duration="4s" name="2_旁白" audioRole="dialogue"\/>/);
    // 無素材鏡:gap 佔位、旁白照樣掛在 gap 下
    expect(xml).toMatch(/<gap name="3_收尾" offset="9s" start="0s" duration="3s">[\s\S]*?lane="-1"[\s\S]*?<\/gap>/);
  });

  it("旁白 asset 只聲明音訊(hasAudio、無 format ref)", () => {
    expect(xml).toMatch(/<asset id="a\d+" name="02_旁白\.mp3" start="0s" duration="4s" hasAudio="1"/);
  });
});

describe("buildXmeml(Premiere 時間軸)", () => {
  const xml = buildXmeml(linkedScenes, "專案", { pathPrefix: "../" });

  it("xmeml v4、30fps 整數(timebase 30/ntsc FALSE)、sequence 總長=影格和", () => {
    expect(xml).toContain(`<xmeml version="4">`);
    expect(xml).toContain(`<rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>`);
    // (5+4+3)*30 = 360 影格
    expect(xml).toContain(`<duration>360</duration>`);
  });

  it("影片 clipitem:start/end 依累計影格,file 帶 rate+duration,pathurl 為相對 URI", () => {
    expect(xml).toContain(`<start>0</start><end>150</end>`);
    expect(xml).toContain(`<pathurl>../${encodeURIComponent("01_視頻素材")}/${encodeURIComponent("01_開場.mp4")}</pathurl>`);
  });

  it("圖片 clipitem:file 不帶 rate/duration,只有 media/video/samplecharacteristics", () => {
    const imgFile = xml.slice(xml.indexOf("02_轉場.jpg"));
    const fileEnd = imgFile.indexOf("</file>");
    const fileBlock = imgFile.slice(0, fileEnd);
    expect(fileBlock).toContain("<media><video><samplecharacteristics>");
    expect(fileBlock).not.toContain("<duration>");
    expect(fileBlock).not.toContain("<timebase>");
  });

  it("無素材鏡不產 video clipitem(時間軸留空),但旁白 clipitem 照常在 A1", () => {
    expect(xml).not.toContain("3_收尾"); // 無素材鏡在 V 軌沒有 clipitem
    expect(xml).toContain(`<name>3_旁白</name>`);
    // 第三鏡旁白時間碼:9s→12s = 270→360 影格
    expect(xml).toContain(`<start>270</start><end>360</end>`);
    expect(xml).toContain(`<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>`);
  });

  it("標題含 XML 特殊字元一律跳脫", () => {
    const escXml = buildXmeml([{ title: `A&B<"'>`, durationSec: 2, voiceover: null, mediaPath: "03_圖像/01_x.jpg", mediaKind: "image" }], `P&Q`);
    expect(escXml).toContain(`<name>1_A&amp;B&lt;&quot;&apos;&gt;</name>`);
    expect(escXml).toContain(`<name>P&amp;Q</name>`);
  });

  it("空清單仍是合法骨架(duration 0、無 clipitem)", () => {
    const empty = buildXmeml([], "空");
    expect(empty).toContain(`<duration>0</duration>`);
    expect(empty).not.toContain("<clipitem");
  });
});

describe("buildEdl", () => {
  it("CMX 3600:TITLE/FCM 頭、事件編號 001 起、30fps timecode 累加", () => {
    const edl = buildEdl(scenes, "我的 專案");
    const lines = edl.split("\n");
    expect(lines[0]).toBe("TITLE: 我的 專案");
    expect(lines[1]).toBe("FCM: NON-DROP FRAME");
    // 事件 1:來源從 0 起、長 5 秒;錄製軌 0 → 5
    expect(edl).toContain("001  AX       V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00");
    expect(edl).toContain("* FROM CLIP NAME: 開場");
    // 事件 2:3 秒(最少值),錄製軌接在 5 秒後
    expect(edl).toContain("002  AX       V     C        00:00:00:00 00:00:03:00 00:00:05:00 00:00:08:00");
    // 事件 3:1.5 秒 = 45 影格 → 00:00:01:15;錄製 8 → 9.5 秒(9 秒 15 格)
    expect(edl).toContain("003  AX       V     C        00:00:00:00 00:00:01:15 00:00:08:00 00:00:09:15");
  });

  it("空白標題退「未命名」、標題內連續空白收斂為一格", () => {
    const edl = buildEdl([{ title: "多  空　白", durationSec: 2, voiceover: null }], "   ");
    expect(edl.split("\n")[0]).toBe("TITLE: 未命名");
    expect(edl).toContain("* FROM CLIP NAME: 多 空 白");
  });

  it("timecode 跨分鐘/小時進位(30fps 非丟格)", () => {
    const edl = buildEdl([{ title: "長", durationSec: 3723.5, voiceover: null }], "T");
    // 3723.5s = 1h 2m 3s 15 格
    expect(edl).toContain("00:00:00:00 01:02:03:15 00:00:00:00 01:02:03:15");
  });

  it("空清單只有表頭", () => {
    const edl = buildEdl([], "T");
    expect(edl).toBe("TITLE: T\nFCM: NON-DROP FRAME\n");
  });
});
