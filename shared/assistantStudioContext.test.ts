import { describe, expect, it } from "vitest";
import { formatStudioShotContext } from "./assistantStudioContext";

describe("formatStudioShotContext", () => {
  it("injects the current shot and bound characters only", () => {
    const text = formatStudioShotContext({
      projectTitle: "小華 60s",
      kind: "療癒動畫",
      format: "9:16",
      displayNo: 4,
      shot: {
        title: "4-3 龜龜掉下來",
        orderIndex: 11,
        durationSec: 3,
        prompt: "龜龜從上面掉下來",
        dialogue: "@禪定龜龜：禪定龜龜。",
        voiceover: "",
        action: "撞床頭",
      },
      characters: [
        { name: "小華", appearance: "女大一新生" },
        { name: "禪定龜龜", appearance: "淡定小烏龜" },
      ],
    });
    expect(text).toContain("第 4 鏡");
    expect(text).toContain("小華");
    expect(text).toContain("禪定龜龜");
    expect(text).toContain("不要呼叫 get_project_context");
    expect(text).not.toContain("第一幕");
  });
});
