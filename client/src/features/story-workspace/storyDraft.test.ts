/**
 * autosave 收養規則測試：這條規則錯了會默默把夥伴（或自己未存）的字換掉——
 * 比畫面壞更難發現，必須逐狀態鎖行為。
 */
import { describe, it, expect } from "vitest";
import { createStorySaveGate, shouldAdoptRemote, summaryChips } from "./storyDraft";

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
  it("衝突態絕不收養——ConflictNotice 還在問人，不能自動選遠端", () => {
    expect(shouldAdoptRemote("conflict", "我剛打的字", "夥伴那一版")).toBe(false);
    expect(shouldAdoptRemote("conflict", "我剛打的字", "我剛打的字")).toBe(false);
  });
});

describe("summaryChips", () => {
  it("固定六顆；造型 0 也顯示；標記含 flagged+pending", () => {
    const chips = summaryChips({ characters: 2, locations: 1, props: 3, looks: 0, storyScenes: 2, shots: 5 });
    expect(chips.map((c) => c.label)).toEqual([
      "角色 2",
      "場景 1",
      "道具 3",
      "造型 0",
      "分鏡 2 場 5 鏡",
      "標記 0",
    ]);
    const withLooks = summaryChips({ characters: 0, locations: 0, props: 0, looks: 1, storyScenes: 0, shots: 0 });
    expect(withLooks.some((c) => c.label === "造型 1")).toBe(true);
    const withMarks = summaryChips({
      characters: 0,
      locations: 0,
      props: 0,
      looks: 0,
      storyScenes: 0,
      shots: 0,
      flagged: 1,
      pending: 2,
    });
    expect(withMarks.some((c) => c.label === "標記 3")).toBe(true);
  });
});

describe("createStorySaveGate", () => {
  function setup() {
    const sent: Array<{ content: string; expectedRev: number | undefined; baseline: string | undefined }> = [];
    let rev: number | undefined = 0;
    let baseline: string | undefined = "起點";
    const gate = createStorySaveGate({
      send: (req) => sent.push(req),
      getRev: () => rev,
      getBaseline: () => baseline,
      setRev: (next) => {
        rev = next;
      },
      setBaseline: (next) => {
        baseline = next;
      },
    });
    return { gate, sent, getRev: () => rev, getBaseline: () => baseline };
  }

  it("in-flight 時把更新的草稿排隊，ACK 後用新 rev 只送最新一份", () => {
    const { gate, sent, getRev, getBaseline } = setup();
    expect(gate.dispatch("第一版")).toBe("dispatched");
    expect(gate.dispatch("第二版")).toBe("queued");
    expect(gate.dispatch("第三版・最新")).toBe("queued");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ content: "第一版", expectedRev: 0, baseline: "起點" });
    expect(gate.peekQueue()).toBe("第三版・最新");

    expect(gate.onAck("第一版", 1)).toBe("dispatched");
    expect(getRev()).toBe(1);
    expect(getBaseline()).toBe("第一版");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ content: "第三版・最新", expectedRev: 1, baseline: "第一版" });
  });

  it("排隊內容與剛存進去的相同就結束，不再連打一發空轉", () => {
    const { gate, sent } = setup();
    gate.dispatch("同一份");
    gate.dispatch("同一份");
    expect(gate.onAck("同一份", 1)).toBe("idle");
    expect(sent).toHaveLength(1);
    expect(gate.peekQueue()).toBeNull();
  });

  it("衝突時丟掉排隊，避免每 800ms 再撞同一面牆", () => {
    const { gate } = setup();
    gate.dispatch("第一版");
    gate.dispatch("第二版");
    expect(gate.onFail("conflict")).toBe("conflict");
    expect(gate.isInFlight()).toBe(false);
    expect(gate.peekQueue()).toBeNull();
  });

  it("whenIdle 等 in-flight 與排隊都清完才回，給一鍵生成前的 flush 用", () => {
    const { gate } = setup();
    const results: Array<string> = [];
    gate.dispatch("第一版");
    gate.dispatch("第二版");
    gate.whenIdle((r) => results.push(r.ok ? "idle" : r.reason));
    expect(results).toEqual([]);
    gate.onAck("第一版", 1);
    expect(results).toEqual([]);
    gate.onAck("第二版", 2);
    expect(results).toEqual(["idle"]);
  });
});
