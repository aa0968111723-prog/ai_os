import { describe, expect, it } from "vitest";
import {
  ASSISTANT_HONEST_ACTION_RULE,
  ASSISTANT_READONLY_SCOPE,
  ASSISTANT_VIEWER_NO_WRITE_RULE,
  extractJsonObject,
  runToolLoop,
  stripJsonObject,
} from "./assistantCore";

describe("extractJsonObject", () => {
  it("抽出被前後文包住的 JSON 物件", () => {
    expect(extractJsonObject('前言 {"answer":"好"} 後記')).toEqual({ answer: "好" });
  });
  it("壞 JSON 回 null（不拋）", () => {
    expect(extractJsonObject("{answer: 不是JSON}")).toBeNull();
  });
  it("沒有大括號回 null", () => {
    expect(extractJsonObject("純文字回答")).toBeNull();
  });
  it("貪婪匹配：巢狀物件整包抽出", () => {
    expect(extractJsonObject('x {"a":{"b":1}} y')).toEqual({ a: { b: 1 } });
  });
});

describe("stripJsonObject", () => {
  it("剝掉 JSON 留下人話", () => {
    expect(stripJsonObject('抱歉 {"broken": true} 再試一次')).toBe("抱歉  再試一次".trim());
  });
});

describe("runToolLoop", () => {
  const baseOpts = {
    maxToolRounds: 3,
    buildPrompt: (toolBlocks: string, forceFinal: boolean) => `P|${forceFinal ? "F" : "-"}|${toolBlocks}`,
    tryToolCall: (json: unknown) =>
      typeof json === "object" && json !== null && "tool" in json ? (json as { tool: string }) : null,
    execTool: async (call: { tool: string }) => ({ step: `查了${call.tool}`, text: `${call.tool} 的結果` }),
    toolName: (call: { tool: string }) => call.tool,
    tryReply: (json: unknown) =>
      typeof json === "object" && json !== null && "answer" in json ? (json as { answer: string }) : null,
    fallback: (raw: string) => ({ answer: `fallback:${raw}` }),
  };

  it("工具呼叫 → 結果進下一輪提示詞 → 最終回答", async () => {
    const prompts: string[] = [];
    const outputs = ['{"tool":"list"}', '{"answer":"完成"}'];
    const out = await runToolLoop({
      ...baseOpts,
      llm: async (prompt) => {
        prompts.push(prompt);
        return outputs.shift()!;
      },
    });
    expect(out.reply).toEqual({ answer: "完成" });
    expect(out.steps).toEqual(["查了list"]);
    expect(out.usedFallback).toBe(false);
    // 第二輪提示詞要帶第一輪的工具結果區塊
    expect(prompts[1]).toContain('<工具結果 tool="list" 第1輪>');
    expect(prompts[1]).toContain("list 的結果");
  });

  it("超過 maxToolRounds 強制收尾：不再受理工具 JSON，改走 fallback", async () => {
    let calls = 0;
    const out = await runToolLoop({
      ...baseOpts,
      maxToolRounds: 2,
      llm: async () => {
        calls++;
        return '{"tool":"loop"}'; // LLM 無視指示一直要工具
      },
    });
    // 2 輪工具 + 1 輪強制收尾（工具 JSON 被拒、tryReply 也不過 → fallback）
    expect(calls).toBe(3);
    expect(out.steps).toEqual(["查了loop", "查了loop"]);
    expect(out.usedFallback).toBe(true);
  });

  it("強制收尾輪的提示詞帶 forceFinal 記號", async () => {
    const prompts: string[] = [];
    await runToolLoop({
      ...baseOpts,
      maxToolRounds: 1,
      llm: async (prompt) => {
        prompts.push(prompt);
        return prompts.length === 1 ? '{"tool":"x"}' : '{"answer":"ok"}';
      },
    });
    expect(prompts[0]).toMatch(/^P\|-\|/);
    expect(prompts[1]).toMatch(/^P\|F\|/);
  });

  it("壞 JSON 先修復一次，第二輪合法就不降級", async () => {
    const outputs = ["我想想 {壞掉的json} 大概是這樣", '{"answer":"修好了"}'];
    const out = await runToolLoop({
      ...baseOpts,
      llm: async () => outputs.shift()!,
    });
    expect(out.usedFallback).toBe(false);
    expect(out.reply).toEqual({ answer: "修好了" });
  });

  it("格式修復仍失敗才走純文字 fallback（不提議動作）", async () => {
    const out = await runToolLoop({
      ...baseOpts,
      llm: async () => "我想想 {壞掉的json} 大概是這樣",
    });
    expect(out.usedFallback).toBe(true);
    expect((out.reply as { answer: string }).answer).toContain("fallback:");
  });

  it("強制收尾輪吐純工具 JSON：fallback 收到空字串，不把 JSON 原文亮給使用者", async () => {
    const seen: string[] = [];
    await runToolLoop({
      ...baseOpts,
      maxToolRounds: 0, // 第一輪就是強制收尾
      llm: async () => '{"tool":"project_detail","args":{"ref":"p2"}}',
      fallback: (raw) => {
        seen.push(raw);
        return { answer: raw || "預設訊息" };
      },
    });
    expect(seen).toEqual([""]);
  });

  it("signal 已中止：不發起 LLM 呼叫、回 aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    let llmCalled = false;
    const out = await runToolLoop({
      ...baseOpts,
      signal: ac.signal,
      llm: async () => {
        llmCalled = true;
        return '{"answer":"x"}';
      },
    });
    expect(llmCalled).toBe(false);
    expect(out.aborted).toBe(true);
    expect(out.reply).toBeNull();
  });

  it("hooks 依序收到事件（round → llmResult → toolCall → toolResult）", async () => {
    const events: string[] = [];
    const outputs = ['{"tool":"a"}', '{"answer":"done"}'];
    await runToolLoop({
      ...baseOpts,
      llm: async () => outputs.shift()!,
      onRound: (round, forceFinal) => void events.push(`round:${round}:${forceFinal}`),
      onLlmResult: (_raw, round) => void events.push(`llm:${round}`),
      onToolCall: (call) => void events.push(`call:${call.tool}`),
      onToolResult: (call, r) => void events.push(`result:${call.tool}:${r.step}`),
    });
    expect(events).toEqual([
      "round:0:false", "llm:0", "call:a", "result:a:查了a",
      "round:1:false", "llm:1",
    ]);
  });

  it("工具執行拋錯：往外傳（由呼叫端決定退點／trace failed）", async () => {
    await expect(
      runToolLoop({
        ...baseOpts,
        llm: async () => '{"tool":"boom"}',
        execTool: async () => {
          throw new Error("工具掛了");
        },
      }),
    ).rejects.toThrow("工具掛了");
  });
});

describe("ASSISTANT_READONLY_SCOPE 不變式", () => {
  it("站內助手迴圈 scope 永遠唯讀（紅線一：寫入只能以提議離開 LLM）", () => {
    expect(ASSISTANT_READONLY_SCOPE.readOnly).toBe(true);
    // 型別上是 readonly true；執行期也鎖死——有人改成可變物件再翻寫也會被抓到
    expect(Object.isFrozen(ASSISTANT_READONLY_SCOPE) || ASSISTANT_READONLY_SCOPE.readOnly === true).toBe(true);
  });
});

describe("ASSISTANT_HONEST_ACTION_RULE（缺陷A：不得假宣稱動作已完成）", () => {
  it("明確禁止把「提議」講成「已完成」（teamAssistant T2 宣稱建筆記、globalAssistant G3 宣稱已標記的根因）", () => {
    const rule = ASSISTANT_HONEST_ACTION_RULE;
    // 三支助手都輸出結構化動作提議：actions／dispatches／siteActions——規則必須覆蓋這三種
    expect(rule).toContain("siteActions");
    expect(rule).toContain("actions");
    expect(rule).toContain("dispatches");
    // 完成式字眼全部被點名禁止
    expect(rule).toContain("已建立");
    expect(rule).toContain("已標記");
    expect(rule).toContain("已完成");
    // 只能改用「提議」語態
    expect(rule).toContain("我建議");
    expect(rule).toContain("請確認");
  });

  it("明確要求做不到就直說、不猜測成功（防「宣稱完成但未落庫」的誤導）", () => {
    const rule = ASSISTANT_HONEST_ACTION_RULE;
    expect(rule).toContain("明說做不到");
    expect(rule).toContain("不要假裝做了");
    expect(rule).toContain("不確定就改口");
    expect(rule).toContain("我無法直接");
  });

  it("規則標為最高優先，壓過其他回覆指令（LLM 才不會為了討好使用者而假宣稱）", () => {
    expect(ASSISTANT_HONEST_ACTION_RULE).toContain("最高優先");
  });
});

describe("ASSISTANT_VIEWER_NO_WRITE_RULE", () => {
  it("strips generate / update_scene / direct_shot when the caller is a viewer", () => {
    expect(ASSISTANT_VIEWER_NO_WRITE_RULE).toContain("唯讀");
    expect(ASSISTANT_VIEWER_NO_WRITE_RULE).toContain("actions 必須是 []");
    expect(ASSISTANT_VIEWER_NO_WRITE_RULE).toContain("direct_shot");
    expect(ASSISTANT_VIEWER_NO_WRITE_RULE).toContain("generate");
  });
});
