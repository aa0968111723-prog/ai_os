import { describe, expect, it } from "vitest";
import {
  describeViewState,
  followPauseReason,
  followReducer,
  initialFollowState,
  pauseLabel,
  sameViewState,
  sanitizeViewState,
  shouldFollow,
  type FollowState,
} from "./viewState";

describe("sanitizeViewState（不信任 client）", () => {
  it("收下合法的語意視圖", () => {
    const v = {
      section: "storyboard",
      sceneId: "11111111-1111-1111-1111-111111111111",
      tab: "visual",
      drawer: "generation",
      filter: "pending",
    };
    expect(sanitizeViewState(v)).toEqual(v);
  });

  it("未知 section 一律丟掉，不原樣轉發", () => {
    expect(sanitizeViewState({ section: "'; drop table--" })).toBeNull();
  });

  it("id 欄必須是 UUID 形狀——它們會進 CSS 選擇器與查詢鍵", () => {
    expect(sanitizeViewState({ sceneId: '"] , [data-x="' })).toBeNull();
    expect(sanitizeViewState({ storySceneId: "not-a-uuid" })).toBeNull();
    expect(sanitizeViewState({ assetId: "22222222-2222-2222-2222-222222222222" })).toEqual({
      assetId: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("自由字串欄限字元集與長度，擋掉能長成選擇器的東西", () => {
    expect(sanitizeViewState({ tab: 'a"] {display:none}' })).toBeNull();
    expect(sanitizeViewState({ tab: "x".repeat(41) })).toBeNull();
    expect(sanitizeViewState({ tab: "visual-2" })).toEqual({ tab: "visual-2" });
  });

  it("非物件、空物件、全部欄位都不合法 → null（不轉發垃圾）", () => {
    expect(sanitizeViewState(null)).toBeNull();
    expect(sanitizeViewState("storyboard")).toBeNull();
    expect(sanitizeViewState({})).toBeNull();
    expect(sanitizeViewState({ nope: 1 })).toBeNull();
  });

  it("混合合法與不合法：保留合法的，靜默丟掉不合法的", () => {
    expect(sanitizeViewState({ section: "story", sceneId: "bad", tab: "visual" })).toEqual({
      section: "story",
      tab: "visual",
    });
  });
});

describe("sameViewState / describeViewState", () => {
  it("比的是「指向同一個內容物件」", () => {
    expect(sameViewState({ section: "story" }, { section: "story" })).toBe(true);
    expect(sameViewState({ section: "story" }, { section: "storyboard" })).toBe(false);
    expect(sameViewState(null, null)).toBe(true);
    expect(sameViewState(null, { section: "story" })).toBe(false);
  });

  it("說得出「他正在哪」——這是點某人時要顯示的那一行", () => {
    expect(describeViewState({ section: "storyboard", tab: "visual" }, "Shot 08")).toBe("分鏡 · Shot 08 · visual");
    expect(describeViewState({ section: "story" })).toBe("故事");
    expect(describeViewState(null)).toBe("在這個專案裡");
  });
});

describe("followReducer（三條不可違反的規則）", () => {
  const joined = (): FollowState =>
    followReducer(initialFollowState(), {
      type: "join",
      presenterId: "u-bruce",
      presenterName: "Bruce",
      connId: "c-1",
    });

  it("規則一：絕不未經同意切走畫面——只有 join 會讓人開始被帶著走", () => {
    const idle = initialFollowState();
    expect(idle.status).toBe("off");
    // 別人開始主講、在場名單更新、對方換位置……都不會讓我進入跟隨
    expect(followReducer(idle, { type: "peers", onlineIds: ["u-bruce"] }).status).toBe("off");
    expect(followReducer(idle, { type: "interact", reason: "scroll" }).status).toBe("off");
    expect(followReducer(idle, { type: "resume" }).status).toBe("off");
    // 只有明確按下「加入」才會
    expect(joined().status).toBe("following");
  });

  it("規則二：跟隨者自己一動就暫停，而且不會被硬拉回去", () => {
    const s = followReducer(joined(), { type: "interact", reason: "scroll" });
    expect(s.status).toBe("paused");
    expect(s.pauseReason).toBe("scroll");
    expect(shouldFollow(s)).toBe(false);
    // 對方繼續移動也不會把我拉回跟隨狀態
    expect(followReducer(s, { type: "peers", onlineIds: ["u-bruce"] }).status).toBe("paused");
    // 只有明確按「回到 Bruce」才恢復
    const resumed = followReducer(s, { type: "resume" });
    expect(resumed.status).toBe("following");
    expect(resumed.pauseReason).toBeNull();
  });

  it("暫停時保留第一次的原因，不被後續操作覆寫成別的說法", () => {
    let s = followReducer(joined(), { type: "interact", reason: "scroll" });
    s = followReducer(s, { type: "interact", reason: "click" });
    expect(s.pauseReason).toBe("scroll");
  });

  it("規則三：主講者離線就說他離線，**絕不自動改跟另一個人**", () => {
    const s = followReducer(joined(), { type: "peers", onlineIds: ["u-wei", "u-minfeng"] });
    expect(s.status).toBe("presenter_gone");
    // 關鍵：presenterId 還是 Bruce，沒有被換成在線的任何人
    expect(s.presenterId).toBe("u-bruce");
    expect(s.presenterName).toBe("Bruce");
    expect(shouldFollow(s)).toBe(false);
  });

  it("主講者短暫斷線後回來：回到「暫停」而不是直接跳過去", () => {
    let s = followReducer(joined(), { type: "peers", onlineIds: [] });
    expect(s.status).toBe("presenter_gone");
    s = followReducer(s, { type: "peers", onlineIds: ["u-bruce"] });
    // 重連的瞬間對方可能已經在完全不同的地方，直接跳過去很突兀
    expect(s.status).toBe("paused");
    expect(shouldFollow(s)).toBe(false);
    expect(followReducer(s, { type: "resume" }).status).toBe("following");
  });

  it("主講結束的兩種原因必須分得開（實機雙瀏覽器抓到的回歸）", () => {
    // stopped：他自己按了結束，人還在房裡 → 乾淨退出
    expect(followReducer(joined(), { type: "leave" }).status).toBe("off");
    // disconnected：他斷線 → 明說「Bruce 暫時離線」，而且說得出是誰
    const gone = followReducer(joined(), { type: "presenter_offline" });
    expect(gone.status).toBe("presenter_gone");
    expect(gone.presenterName).toBe("Bruce");
    // 為什麼不能用「他還在不在在場名單」去推：斷線時 present 與 presence 是兩則
    // 獨立訊息、抵達順序不保證，推出來的答案會是還沒更新的那一份名單。
  });

  it("沒在跟任何人時，presenter_offline 不產生任何狀態", () => {
    expect(followReducer(initialFollowState(), { type: "presenter_offline" }).status).toBe("off");
  });

  it("leave 回到乾淨狀態", () => {
    expect(followReducer(joined(), { type: "leave" })).toEqual(initialFollowState());
  });

  it("沒在跟任何人時，在場名單變動不會產生 presenter_gone", () => {
    expect(followReducer(initialFollowState(), { type: "peers", onlineIds: [] }).status).toBe("off");
  });

  it("鎖定 userId + connId：同一人開兩個分頁時跟隨者不會在兩者間彈跳", () => {
    expect(joined().connId).toBe("c-1");
  });
});

describe("followPauseReason（哪些操作算「我要自己看」）", () => {
  it("輸入裝置事件 → 暫停", () => {
    // 這四種只會由真實輸入裝置產生，這正是 usePresenterFollow 只聽它們的理由
    expect(followPauseReason({ type: "wheel" })).toBe("scroll");
    expect(followPauseReason({ type: "touchmove" })).toBe("scroll");
    expect(followPauseReason({ type: "click" })).toBe("click");
    expect(followPauseReason({ type: "keydown" })).toBe("click");
  });

  it("標明為程式化的捲動不算——否則跟隨會在跟上的第一幀就自己把自己暫停掉", () => {
    expect(followPauseReason({ type: "scroll", isProgrammatic: true })).toBeNull();
    expect(followPauseReason({ type: "wheel", isProgrammatic: true })).toBeNull();
  });

  it("不相干的事件不影響跟隨", () => {
    expect(followPauseReason({ type: "mousemove" })).toBeNull();
  });

  it("暫停原因說得出人話", () => {
    expect(pauseLabel("scroll")).toBe("你自己捲動了");
    expect(pauseLabel(null)).toBe("已暫停");
  });
});
