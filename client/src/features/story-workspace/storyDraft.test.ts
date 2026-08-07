/**
 * autosave 收養規則測試：這條規則錯了會默默把夥伴（或自己未存）的字換掉——
 * 比畫面壞更難發現，必須逐狀態鎖行為。
 */
import { describe, it, expect } from "vitest";
import { shouldAdoptRemote, summaryChips } from "./storyDraft";

describe("shouldAdoptRemote", () => {
  it("尚未種初值（local=null）一律採用伺服器內容", () => {
    expect(shouldAdoptRemote("idle", null, "遠端")).toBe(true);
    expect(shouldAdoptRemote("dirty", null, "遠端")).toBe(true);
  });
  it("內容相同不動作", () => {
    expect(shouldAdoptRemote("idle", "同", "同")).toBe(false);
  });
  it("本地乾淨（idle/saved）時收養遠端變更（協作跟上）", () => {
    expect(shouldAdoptRemote("idle", "舊", "新")).toBe(true);
    expect(shouldAdoptRemote("saved", "舊", "新")).toBe(true);
  });
  it("正在打字／儲存中／儲存失敗絕不收養（不蓋掉使用者手上的字）", () => {
    expect(shouldAdoptRemote("dirty", "打到一半", "遠端")).toBe(false);
    expect(shouldAdoptRemote("saving", "打到一半", "遠端")).toBe(false);
    expect(shouldAdoptRemote("error", "沒存成功的內容", "遠端")).toBe(false);
  });
});

describe("summaryChips", () => {
  it("固定順序；造型 0 時不顯示；分鏡顯示 場×鏡", () => {
    const chips = summaryChips({ characters: 2, locations: 1, props: 3, looks: 0, storyScenes: 2, shots: 5 });
    expect(chips.map((c) => c.label)).toEqual(["角色 2", "場景 1", "道具 3", "分鏡 2 場 5 鏡"]);
    const withLooks = summaryChips({ characters: 0, locations: 0, props: 0, looks: 1, storyScenes: 0, shots: 0 });
    expect(withLooks.some((c) => c.label === "造型 1")).toBe(true);
  });
});
