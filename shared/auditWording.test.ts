import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_CATEGORIES,
  auditCategoryOf,
  auditPrefixesForCategory,
  describeAuditInput,
  humanizeAuditAction,
  summarizeAuditInput,
} from "./auditWording";

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

  it("只有 uuid／id 時回空字串（動作標題已說清楚,不塞技術代碼）", () => {
    expect(summarizeAuditInput({ id: "3fa2aaaa-1111-2222-3333-444455556666" })).toBe("");
    expect(summarizeAuditInput({ sceneId: "3fa2aaaa-1111-2222-3333-444455556666" })).toBe("");
  });

  it("字串陣列串成頓號清單（如世界觀風格）", () => {
    const s = summarizeAuditInput({ worldview: { styles: ["日系水彩", "膠片質感"] } });
    expect(s).toBe("風格：日系水彩、膠片質感");
  });

  it("代碼型值翻白話（角色/決定/類別）", () => {
    expect(summarizeAuditInput({ role: "leader" })).toBe("角色：組長");
    expect(summarizeAuditInput({ decision: "approve" })).toBe("決定：通過");
    expect(summarizeAuditInput({ category: "bug" })).toBe("類別：程式錯誤");
  });

  it("空物件/非物件回空字串", () => {
    expect(summarizeAuditInput({})).toBe("");
    expect(summarizeAuditInput(null)).toBe("");
    expect(summarizeAuditInput("x")).toBe("");
  });
});

describe("describeAuditInput", () => {
  it("攤成白話標籤清單,已知鍵在前、未知鍵在後（uuid 縮 8 碼）", () => {
    const fields = describeAuditInput({
      name: "禪堂空景",
      sceneId: "3fa2aaaa-1111-2222-3333-444455556666",
      foo: 1,
    });
    expect(fields[0]).toEqual({ label: "名稱", value: "禪堂空景" });
    const scene = fields.find((f) => f.label === "sceneId");
    expect(scene?.value).toBe("3fa2aaaa…");
    expect(fields).toContainEqual({ label: "foo", value: "1" });
  });

  it("攤平巢狀 worldview 並翻白話值", () => {
    const fields = describeAuditInput({ worldview: { styles: ["日系水彩", "膠片質感"], tones: ["療癒"] } });
    expect(fields).toContainEqual({ label: "風格", value: "日系水彩、膠片質感" });
    expect(fields).toContainEqual({ label: "調性", value: "療癒" });
    // 容器本身不重複列出
    expect(fields.some((f) => f.label === "worldview")).toBe(false);
  });

  it("非物件回空陣列", () => {
    expect(describeAuditInput(null)).toEqual([]);
    expect(describeAuditInput("x")).toEqual([]);
  });
});

describe("auditCategoryOf", () => {
  it("依前綴歸類", () => {
    expect(auditCategoryOf("admin.invite").label).toBe("帳號與團隊");
    expect(auditCategoryOf("generation.submit").label).toBe("生成與點數");
    expect(auditCategoryOf("mcp.submit_generation").label).toBe("外部連線（MCP／整合）");
  });

  it("未知前綴落到「其他」", () => {
    expect(auditCategoryOf("future.newThing")).toEqual({ key: "other", label: "其他" });
  });

  it("每個 action 都歸得到非「其他」分類（分類前綴涵蓋所有路由）", () => {
    const uncategorized = Object.keys(AUDIT_ACTION_LABELS).filter((a) => auditCategoryOf(a).key === "other");
    expect(uncategorized).toEqual([]);
  });

  it("auditPrefixesForCategory 回該類前綴,未知 key 回空", () => {
    expect(auditPrefixesForCategory("account")).toContain("admin");
    expect(auditPrefixesForCategory("nope")).toEqual([]);
  });

  it("分類 key 不重複", () => {
    const keys = AUDIT_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
