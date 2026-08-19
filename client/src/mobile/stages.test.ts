import { describe, expect, it } from "vitest";
import { PHONE_STAGES } from "@shared/phoneStages";
import { STORY_INLINE_SECTIONS, isStoryHomeHash, sectionFromHash } from "../features/story-workspace/storyInlineNav";
import { MOBILE_STAGES, anchorForSection, continueAnchor, continueLabel, isAutoOpenProjectAnchor, isProjectAnchor, stageIndex, stageLabel, stageSentence } from "./stages";

describe("手機製作階段", () => {
  it("前後端的階段字面值完全一致", () => {
    // 兩邊各寫一組字的話，伺服器推的階段會對不上畫面上亮起來的那一格——
    // 症狀是進度列永遠停在第一格，而且不會有任何錯誤。
    expect(MOBILE_STAGES.map((s) => s.id)).toEqual([...PHONE_STAGES]);
  });

  it("未知階段退回第一格而不是炸掉", () => {
    // 伺服器加了新階段、前端還沒部署時，畫面該退化不該白屏
    expect(stageIndex("something-new")).toBe(0);
    expect(stageLabel("something-new")).toBe("故事");
  });

  it("待裁決的生成蓋過階段敘述——那是最該先處理的事", () => {
    expect(stageSentence({ stage: "generate", shots: 8, shotsWithVisual: 3, awaitingGenerations: 2 }))
      .toBe("2 筆生成等你裁決");
  });

  it("每個階段都講得出一句具體的現況與一顆具體的按鈕", () => {
    for (const step of MOBILE_STAGES) {
      const sentence = stageSentence({ stage: step.id, shots: 5, shotsWithVisual: 2, awaitingGenerations: 0 });
      expect(sentence.length).toBeGreaterThan(0);
      // 按鈕要講出它會做什麼，泛稱「繼續製作」只留給收尾階段
      expect(continueLabel(step.id).length).toBeGreaterThan(0);
      expect(continueAnchor(step.id).length).toBeGreaterThan(0);
    }
  });

  it("「繼續製作」的錨點是真正渲染在 DOM 上的 anchorId，不是 section id", () => {
    // 這條原本寫成 story/storyboard/production —— 那是 section id，DOM 上根本沒有
    // 這些 id，getElementById 永遠回 null，「繼續製作」因此不會捲到那一段。
    // 測試當時照抄了實作，所以壞掉也照樣綠。現在改成對照真實渲染的 anchorId。
    expect(continueAnchor("story")).toBe("stage-story");
    expect(continueAnchor("storyboard")).toBe("stage-board");
    expect(continueAnchor("visual")).toBe("stage-create");
    expect(continueAnchor("generate")).toBe("stage-create");
  });

  it("每個階段的錨點都真的存在於專案頁的錨點清單裡", () => {
    // 對照 storyInlineNav 的單一出處：任何一邊改名，這條就會紅
    const rendered = new Set([...STORY_INLINE_SECTIONS.map((s) => s.anchorId), "stage-story"]);
    for (const step of MOBILE_STAGES) {
      expect(rendered, `${step.id} 的錨點不在專案頁實際渲染的 id 裡`).toContain(continueAnchor(step.id));
    }
  });

  it("次級入口（分鏡／角色／場景）的錨點也是真的 anchorId", () => {
    // 這幾顆原本直接把 key 當錨點傳（characters／knowledge），同一種錯：
    // DOM 上沒有那些 id，點下去工作台會開但不會捲到該去的地方。
    const rendered = new Set([...STORY_INLINE_SECTIONS.map((s) => s.anchorId), "stage-story"]);
    for (const section of ["storyboard", "characters", "scenes"]) {
      expect(rendered).toContain(anchorForSection(section));
    }
    expect(anchorForSection("characters")).toBe("sec-characters");
    // 不認得的 section 退回故事本體，不會回一個 DOM 上不存在的字串
    expect(anchorForSection("knowledge")).toBe("stage-story");
  });

  it("isProjectAnchor 只認專案頁真的渲染得出來的錨點", () => {
    expect(isProjectAnchor("#stage-board")).toBe(true);
    expect(isProjectAnchor("stage-story")).toBe(true);
    expect(isProjectAnchor("#sec-characters")).toBe(true);
    // section id 不是錨點——這正是原本那個 bug 的形狀
    expect(isProjectAnchor("#storyboard")).toBe(false);
    expect(isProjectAnchor("#production")).toBe(false);
    expect(isProjectAnchor("")).toBe(false);
  });

  it("isAutoOpenProjectAnchor skips the desktop home hash so ~600px stays on the mobile shell", () => {
    expect(isAutoOpenProjectAnchor("#stage-board")).toBe(true);
    expect(isAutoOpenProjectAnchor("#sec-characters")).toBe(true);
    expect(isAutoOpenProjectAnchor("#stage-create")).toBe(true);
    // writeInlineHash(null) lands here; auto-opening FullProjectPage left-clips at 600px
    expect(isAutoOpenProjectAnchor("stage-story")).toBe(false);
    expect(isAutoOpenProjectAnchor("#stage-story")).toBe(false);
    expect(isAutoOpenProjectAnchor("#stage-context")).toBe(false);
    expect(isAutoOpenProjectAnchor("#story-workspace")).toBe(false);
    expect(isAutoOpenProjectAnchor("#storyboard")).toBe(false);
    expect(isAutoOpenProjectAnchor("")).toBe(false);
  });

  it("錨點同時是桌面 hash 路由認得的值（深連結契約）", () => {
    // /p/:id#stage-board 這種連結從通知或桌機分享過來時，專案頁要開對區段
    expect(sectionFromHash(`#${continueAnchor("storyboard")}`)).toBe("storyboard");
    expect(sectionFromHash(`#${continueAnchor("generate")}`)).toBe("production");
    expect(isStoryHomeHash(`#${continueAnchor("story")}`)).toBe(true);
  });
});
