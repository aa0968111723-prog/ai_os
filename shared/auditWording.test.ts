import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_ACTION_LABELS, humanizeAuditAction, summarizeAuditInput } from "./auditWording";

describe("humanizeAuditAction", () => {
  it("已知 action 翻成人話", () => {
    expect(humanizeAuditAction("projects.deleteAsset")).toBe("刪除素材（進回收桶）");
    expect(humanizeAuditAction("mcp.submit_generation")).toBe("MCP：送出生成");
  });

  it("未知 action 保留原代碼（新端點不會壞畫面）", () => {
    expect(humanizeAuditAction("future.newThing")).toBe("future.newThing");
  });

  // 字典完整性守門:掃 server/routers 的所有 mutation 路徑,漏補字典就紅
  // (審計 action 就是 tRPC path;新端點上線時這條測試會提醒把人話補上)
  it("涵蓋所有 tRPC mutation 路徑", () => {
    const dir = join(__dirname, "..", "server", "routers");
    const missing: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file === "index.ts") continue;
      const router = file.replace(/\.ts$/, "");
      const src = readFileSync(join(dir, file), "utf8");
      // 頂層 procedure 定義形如「  name: xxxProcedure…」;逐段檢查該段是否呼叫 .mutation(
      const heads = [...src.matchAll(/^ {2}(\w+):/gm)];
      heads.forEach((m, i) => {
        const seg = src.slice(m.index! + m[0].length, heads[i + 1]?.index ?? src.length);
        if (seg.includes(".mutation(") && !(`${router}.${m[1]}` in AUDIT_ACTION_LABELS)) {
          missing.push(`${router}.${m[1]}`);
        }
      });
    }
    expect(missing).toEqual([]);
  });
});

describe("summarizeAuditInput", () => {
  it("抽已知鍵組成「標籤：值」,略過 uuid", () => {
    const s = summarizeAuditInput({
      projectId: "3fa2aaaa-1111-2222-3333-444455556666",
      name: "禪堂空景",
      archived: true,
    });
    expect(s).toBe("名稱：禪堂空景・封存：是");
  });

  it("長字串截 48 字", () => {
    const s = summarizeAuditInput({ prompt: "甲".repeat(60) });
    expect(s).toBe(`提示詞：${"甲".repeat(48)}…`);
  });

  it("沒有已知鍵時退回截短 JSON,uuid 縮 8 碼", () => {
    const s = summarizeAuditInput({ sceneId: "3fa2aaaa-1111-2222-3333-444455556666", foo: 1 });
    expect(s).toContain("3fa2aaaa…");
    expect(s).not.toContain("444455556666");
  });

  it("空物件/非物件回空字串", () => {
    expect(summarizeAuditInput({})).toBe("");
    expect(summarizeAuditInput(null)).toBe("");
    expect(summarizeAuditInput("x")).toBe("");
  });
});
