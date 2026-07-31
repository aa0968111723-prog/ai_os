/**
 * agentCore 入口 UUID 守衛：MCP 直呼 core 無 router zod，非法 id 必須 BAD_REQUEST 而非 DB 500。
 */
import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { readFileSync } from "node:fs";
import {
  assertUuid,
  buildPickedSourceBlock,
  DRIVE_PLAN_SOURCE_CHAR_CAP,
  MAX_PLAN_KNOWLEDGE_CHARS,
  plannerKnowledgeBudget,
  toEphemeralPlanSource,
} from "./agentCore";

describe("assertUuid（MCP / core 入口）", () => {
  it("合法 UUID 不拋錯", () => {
    expect(() => assertUuid("550e8400-e29b-41d4-a716-446655440000", "專案編號")).not.toThrow();
  });

  it("非法字串拋 BAD_REQUEST 中文訊息", () => {
    try {
      assertUuid("abc", "代理計畫編號");
      throw new Error("應該要拋錯");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("BAD_REQUEST");
      expect((err as TRPCError).message).toBe("代理計畫編號格式不正確");
    }
  });

  it("空字串與非 UUID 也擋", () => {
    expect(() => assertUuid("", "專案編號")).toThrow(TRPCError);
    expect(() => assertUuid("not-a-uuid", "專案編號")).toThrow(TRPCError);
  });
});

describe("agentCore source：各入口呼叫 assertUuid", () => {
  const source = readFileSync(new URL("./agentCore.ts", import.meta.url), "utf8");

  it("plan / list 驗 projectId；approve / discard / stop / get 驗 runId", () => {
    expect(source).toContain('assertUuid(input.projectId, "專案編號")');
    expect(source).toContain('assertUuid(projectId, "專案編號")');
    expect(source).toContain('assertUuid(input.runId, "代理計畫編號")');
    expect(source).toContain('assertUuid(runId, "代理計畫編號")');
    // 六個對外 core 都有守衛
    const calls = source.match(/assertUuid\(/g) ?? [];
    // export function assertUuid 定義 1 次 + 6 次呼叫
    expect(calls.length).toBeGreaterThanOrEqual(7);
  });
});

describe("agentCore CA-01 planner context (source-lock)", () => {
  const source = readFileSync(new URL("./agentCore.ts", import.meta.url), "utf8");

  it("buildPlannerContext 載入 char/preset/asset 代號並寫入 generate 欄位表", () => {
    expect(source).toContain("PlannerAliases");
    expect(source).toContain("schema.characters");
    expect(source).toContain("schema.scenePresets");
    expect(source).toContain("schema.assets");
    expect(source).toContain("<角色定裝代號>");
    expect(source).toContain("<場景設定代號>");
    expect(source).toContain("<素材庫代號>");
    expect(source).toContain("characterRefs?");
    expect(source).toContain("scenePresetRefs?");
    expect(source).toContain("sourceAssetRef?");
    expect(source).toContain("sourceUrl?");
  });
});

describe("PR-E2 buildPickedSourceBlock（使用者指定來源優先注入）", () => {
  it("來源排在預算最前、標籤供 contextUsed，未截斷時 truncated=false", () => {
    const block = buildPickedSourceBlock(
      [
        { title: "開場腳本", content: "第一段內容", origin: "knowledge" },
        { title: "週報.pdf", content: "文件內容", origin: "file" },
      ],
      6000,
    );
    expect(block.text).toContain("【指定知識｜開場腳本】");
    expect(block.text).toContain("【指定文件｜週報.pdf】");
    expect(block.labels).toEqual(["來源：開場腳本", "來源：週報.pdf"]);
    expect(block.truncated).toBe(false);
    expect(block.usedChars).toBe("第一段內容".length + "文件內容".length);
    expect(block.totalChars).toBe(block.usedChars);
  });

  it("超過預算時截斷並標記 truncated；標籤仍列出所有選中來源", () => {
    const block = buildPickedSourceBlock(
      [
        { title: "長文", content: "甲".repeat(100), origin: "knowledge" },
        { title: "擠不進", content: "乙".repeat(50), origin: "file" },
      ],
      80,
    );
    expect(block.truncated).toBe(true);
    expect(block.usedChars).toBe(80);
    expect(block.totalChars).toBe(150);
    expect(block.labels).toHaveLength(2);
    expect(block.text).toContain("…(截斷)");
    expect(block.text).not.toContain("擠不進】");
  });

  it("零預算：不注入內容但標籤完整、truncated=true", () => {
    const block = buildPickedSourceBlock([{ title: "a", content: "xx", origin: "file" }], 0);
    expect(block.text).toBe("");
    expect(block.labels).toEqual(["來源：a"]);
    expect(block.truncated).toBe(true);
  });

  it("標籤截到 60 字內（contextUsed 單項上限）", () => {
    const block = buildPickedSourceBlock([{ title: "超".repeat(80), content: "x", origin: "file" }], 100);
    expect(block.labels[0].length).toBeLessThanOrEqual(60);
  });
});

describe("PR-E3 toEphemeralPlanSource（僅本次雲端來源硬頂）", () => {
  it("正常文字：trim 後收錄、capped=false", () => {
    const s = toEphemeralPlanSource("週報", "  內容文字  ");
    expect(s).toEqual({ title: "週報", content: "內容文字", origin: "file", capped: false });
  });
  it("超過單檔硬頂即截斷並標記 capped", () => {
    const s = toEphemeralPlanSource("長文", "字".repeat(DRIVE_PLAN_SOURCE_CHAR_CAP + 5));
    expect(s?.content.length).toBe(DRIVE_PLAN_SOURCE_CHAR_CAP);
    expect(s?.capped).toBe(true);
  });
  it("空白文字回 null（呼叫端 fail-fast 給人話）", () => {
    expect(toEphemeralPlanSource("空", "   ")).toBeNull();
  });
});

describe("PR-E5 plannerKnowledgeBudget（依檔位分級＋硬頂）", () => {
  it("quality > balanced > auto/nim > economy——高檔位可注入更多", () => {
    expect(plannerKnowledgeBudget("fal_quality")).toBeGreaterThan(plannerKnowledgeBudget("fal_balanced"));
    expect(plannerKnowledgeBudget("fal_balanced")).toBeGreaterThan(plannerKnowledgeBudget("fal_economy"));
    expect(plannerKnowledgeBudget("auto")).toBe(plannerKnowledgeBudget("nim"));
    expect(plannerKnowledgeBudget("auto")).toBeGreaterThan(plannerKnowledgeBudget("fal_economy"));
  });
  it("所有檔位都不可超過產品硬頂（不是把模型窗口自動填滿）", () => {
    for (const mode of ["auto", "nim", "fal_economy", "fal_balanced", "fal_quality"] as const) {
      expect(plannerKnowledgeBudget(mode)).toBeLessThanOrEqual(MAX_PLAN_KNOWLEDGE_CHARS);
      expect(plannerKnowledgeBudget(mode)).toBeGreaterThan(0);
    }
  });
});
