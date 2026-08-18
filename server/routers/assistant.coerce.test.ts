/**
 * C2 迴歸測試：LLM 把「提議動作」誤用唯讀工具格式吐出（如 {"tool":"split_script",…}）時，
 * 助手必須把它救回成正規的 {answer, actions} 提議，而不是把原始工具 JSON 洩漏成聊天訊息。
 * 這正是線上實測到的 bug：對代理下多步目標，回覆變成一段 {"tool":"split_script","args":{…}} 純文字。
 */
import { describe, it, expect } from "vitest";
import { coerceActionToolCall } from "./assistant";

describe("coerceActionToolCall（畸形工具呼叫救回）", () => {
  it("把 {\"tool\":\"split_script\",args} 救回成 split_script 動作", () => {
    const r = coerceActionToolCall({ tool: "split_script", args: { script: "第一鏡：清晨的公寓，機器人醒來泡咖啡；第二鏡：牠望向窗外的城市。" } });
    expect(r).not.toBeNull();
    expect(r!.actions).toHaveLength(1);
    expect(r!.actions![0]).toMatchObject({ type: "split_script" });
    expect(r!.answer).toMatch(/分鏡/); // 給人話回覆，不是原始 JSON
  });

  it("欄位攤在頂層（無 args）也能救回", () => {
    const r = coerceActionToolCall({ tool: "split_script", script: "第一鏡：清晨的公寓，機器人醒來泡咖啡；第二鏡：牠望向窗外的城市。" });
    expect(r?.actions?.[0]).toMatchObject({ type: "split_script" });
  });

  it("把 {\"tool\":\"plan_agent\",args} 救回成 plan_agent 動作", () => {
    const r = coerceActionToolCall({ tool: "plan_agent", args: { goal: "把腳本拆成分鏡並逐鏡生成畫面" } });
    expect(r?.actions?.[0]).toMatchObject({ type: "plan_agent", goal: "把腳本拆成分鏡並逐鏡生成畫面" });
  });

  it("把 apply_worldview_chips 畸形工具呼叫救回", () => {
    const r = coerceActionToolCall({
      tool: "apply_worldview_chips",
      args: { styles: ["水墨禪意"], tones: ["溫暖", "真誠"], themes: ["禪修日常"] },
    });
    expect(r?.actions?.[0]).toMatchObject({
      type: "apply_worldview_chips",
      styles: ["水墨禪意"],
      tones: ["溫暖", "真誠"],
      themes: ["禪修日常"],
    });
  });

  it("把 direct_shot 畸形工具呼叫救回（逐鏡鏡頭語言）", () => {
    const r = coerceActionToolCall({
      tool: "direct_shot",
      args: { sceneNo: 3, camera: { shotSize: "特寫", movement: "緩推" }, performance: { emotion: "若有所思" } },
    });
    expect(r?.actions?.[0]).toMatchObject({
      type: "direct_shot",
      sceneNo: 3,
      camera: { shotSize: "特寫", movement: "緩推" },
      performance: { emotion: "若有所思" },
    });
  });

  it("direct_shot 只帶一個欄位也合法（單點指令是常態）", () => {
    const r = coerceActionToolCall({ tool: "direct_shot", sceneNo: 1, camera: { shotSize: "大特寫" } });
    expect(r?.actions?.[0]).toMatchObject({ type: "direct_shot", sceneNo: 1, camera: { shotSize: "大特寫" } });
  });

  it("direct_shot 的 sceneNo 不合法（0／負數）→ 回 null", () => {
    expect(coerceActionToolCall({ tool: "direct_shot", sceneNo: 0, camera: { shotSize: "特寫" } })).toBeNull();
    expect(coerceActionToolCall({ tool: "direct_shot", sceneNo: -2, camera: { shotSize: "特寫" } })).toBeNull();
  });

  it("把 add_character 畸形工具呼叫救回", () => {
    const r = coerceActionToolCall({
      tool: "add_character",
      args: { name: "小華", appearance: "粉橘短髮鮑伯、米白針織外套" },
    });
    expect(r?.answer).toBe("我幫你準備了角色定裝卡，確認下方就寫入。");
    expect(r?.actions?.[0]).toMatchObject({
      type: "add_character",
      name: "小華",
      appearance: "粉橘短髮鮑伯、米白針織外套",
    });
  });

  it("把 add_database_row 畸形工具呼叫救回", () => {
    const r = coerceActionToolCall({
      tool: "add_database_row",
      args: { dbRef: "db1", values: { 標題: "王羲之", 分類: "書法" } },
    });
    expect(r?.actions?.[0]).toMatchObject({
      type: "add_database_row",
      dbRef: "db1",
      values: { 標題: "王羲之", 分類: "書法" },
    });
  });

  it("真正的唯讀工具（list_assets）不當動作救回 → 回 null", () => {
    expect(coerceActionToolCall({ tool: "list_assets", args: { kind: "image" } })).toBeNull();
  });

  it("正規的最終回答（{answer}）不誤救 → 回 null", () => {
    expect(coerceActionToolCall({ answer: "目前有 3 個分鏡", actions: [] })).toBeNull();
  });

  it("動作參數不合法（腳本太短）→ 回 null（不硬塞壞動作）", () => {
    expect(coerceActionToolCall({ tool: "split_script", args: { script: "太短" } })).toBeNull();
  });

  it("非物件輸入 → 回 null", () => {
    expect(coerceActionToolCall(null)).toBeNull();
    expect(coerceActionToolCall("string")).toBeNull();
    expect(coerceActionToolCall(42)).toBeNull();
  });
});
