/**
 * exporter.ts 時間軸格式產生器單元測試(需求 #8 交付):
 * buildSrt / buildFcpxml / buildEdl 的時間碼累加、最少 3 秒規則、跳脫與空清單行為。
 * 三者共用規則:durationSec ≤ 0 以 3 秒計;時間軸依序累加。
 */
import { describe, expect, it } from "vitest";
import { buildEdl, buildFcpxml, buildSrt, type TimelineScene } from "./exporter";

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

describe("buildFcpxml", () => {
  it("結構完整:1.9 版本、30fps format、sequence 總長=各鏡和、gap offset 累加", () => {
    const xml = buildFcpxml(scenes, "測試專案");
    expect(xml).toContain(`<fcpxml version="1.9">`);
    expect(xml).toContain(`frameDuration="100/3000s"`);
    // 5 + 3 + 1.5 = 9.5s
    expect(xml).toContain(`<sequence format="r1" duration="9.5s"`);
    expect(xml).toContain(`offset="0s" start="0s" duration="5s"`);
    expect(xml).toContain(`offset="5s" start="0s" duration="3s"`);
    expect(xml).toContain(`offset="8s" start="0s" duration="1.5s"`);
    expect(xml).toContain(`<event name="測試專案">`);
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

  it("有 mediaFile 的鏡產出 asset/media-rep（src=封包內相對路徑）＋ asset-clip；無媒體維持 gap（QA-006）", () => {
    const xml = buildFcpxml(
      [
        { title: "開場", durationSec: 5, voiceover: null, mediaFile: "01_視頻素材/01_開場.mp4" },
        { title: "無素材鏡", durationSec: 3, voiceover: null, mediaFile: null },
      ],
      "P",
    );
    expect(xml).toContain(`<asset id="a1" name="01_開場.mp4" start="0s" duration="5s">`);
    expect(xml).toContain(`<media-rep kind="original-media" src="./01_視頻素材/01_開場.mp4"/>`);
    expect(xml).toContain(`<asset-clip ref="a1" name="1_開場" offset="0s" start="0s" duration="5s">`);
    // 無媒體的鏡仍是 gap，offset 接續在前一鏡之後
    expect(xml).toContain(`<gap name="2_無素材鏡" offset="5s" start="0s" duration="3s">`);
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

  it("有 mediaFile 的鏡 FROM CLIP NAME 用真實檔名並附 SOURCE FILE 相對路徑（QA-006）", () => {
    const edl = buildEdl(
      [
        { title: "開場", durationSec: 5, voiceover: null, mediaFile: "01_視頻素材/01_開場.mp4" },
        { title: "無素材鏡", durationSec: 3, voiceover: null, mediaFile: null },
      ],
      "T",
    );
    expect(edl).toContain("* FROM CLIP NAME: 01_開場.mp4");
    expect(edl).toContain("* SOURCE FILE: 01_視頻素材/01_開場.mp4");
    // 無媒體的鏡維持標題、不出 SOURCE FILE
    expect(edl).toContain("* FROM CLIP NAME: 無素材鏡");
    expect(edl.split("SOURCE FILE").length - 1).toBe(1);
  });
});
