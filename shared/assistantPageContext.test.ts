import { describe, expect, it } from "vitest";
import {
  assistantPageContextSchema,
  formatAssistantPageContext,
  MAX_SELECTED_ENTITY_IDS,
  sanitizeAssistantPageContext,
} from "./assistantPageContext";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("sanitizeAssistantPageContext（伺服器端逐欄夾制；壞欄位丟棄而非整包拒絕）", () => {
  it("合法輸入原樣通過", () => {
    expect(sanitizeAssistantPageContext({
      pageType: "storyboard", entityType: "shot", entityId: UUID_A,
      entityLabel: "第 3 鏡", selectedEntityIds: [UUID_A, UUID_B], activeTab: "pro",
    })).toEqual({
      pageType: "storyboard", entityType: "shot", entityId: UUID_A,
      entityLabel: "第 3 鏡", selectedEntityIds: [UUID_A, UUID_B], activeTab: "pro",
    });
  });

  it("pageType 不合法或缺少 → 整包 null（沒有它其餘欄位無從解讀）", () => {
    expect(sanitizeAssistantPageContext({ entityType: "shot" })).toBeNull();
    expect(sanitizeAssistantPageContext({ pageType: "hacker" })).toBeNull();
    expect(sanitizeAssistantPageContext(null)).toBeNull();
    expect(sanitizeAssistantPageContext("storyboard")).toBeNull();
  });

  it("非 uuid 的 id 一律丟棄——這些值會進提示詞", () => {
    const out = sanitizeAssistantPageContext({
      pageType: "storyboard",
      entityId: "'; DROP TABLE scenes; --",
      selectedEntityIds: [UUID_A, "not-a-uuid", 42, null],
    });
    expect(out).toEqual({ pageType: "storyboard", selectedEntityIds: [UUID_A] });
  });

  it("未知實體型別丟棄，其餘欄位保留（部分壞掉不該讓整次提問失去上下文）", () => {
    const out = sanitizeAssistantPageContext({ pageType: "assets", entityType: "nuclear_launch", entityLabel: "海報" });
    expect(out).toEqual({ pageType: "assets", entityLabel: "海報" });
  });

  it("自由字串截到 60 字並 trim；空白視為未提供", () => {
    const out = sanitizeAssistantPageContext({
      pageType: "home", entityLabel: "  " + "鏡".repeat(80) + "  ", activeTab: "   ", recentAction: " 編輯了第 3 鏡 ",
    })!;
    expect(out.entityLabel).toHaveLength(60);
    expect(out.activeTab).toBeUndefined();
    expect(out.recentAction).toBe("編輯了第 3 鏡");
  });

  it("選取數量硬上限（提示詞與查詢不得無界成長）", () => {
    const many = Array.from({ length: 50 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
    const out = sanitizeAssistantPageContext({ pageType: "assets", selectedEntityIds: many })!;
    expect(out.selectedEntityIds).toHaveLength(MAX_SELECTED_ENTITY_IDS);
  });

  it("selectedEntityIds 不是陣列時整欄丟棄", () => {
    expect(sanitizeAssistantPageContext({ pageType: "assets", selectedEntityIds: "all" }))
      .toEqual({ pageType: "assets" });
  });
});

describe("assistantPageContextSchema（tRPC 路徑）", () => {
  it("與 sanitize 同一組規則：未知 pageType 直接不過", () => {
    expect(assistantPageContextSchema.safeParse({ pageType: "storyboard" }).success).toBe(true);
    expect(assistantPageContextSchema.safeParse({ pageType: "nope" }).success).toBe(false);
    expect(assistantPageContextSchema.safeParse({ pageType: "assets", entityId: "abc" }).success).toBe(false);
  });
});

describe("formatAssistantPageContext（提示詞區塊：只給指標不給資料）", () => {
  it("列出頁面／正在看／已選取，並明說「這個」指的是什麼", () => {
    const out = formatAssistantPageContext({
      pageType: "storyboard", entityType: "shot", entityId: UUID_A,
      entityLabel: "第 3 鏡", selectedEntityIds: [UUID_A, UUID_B],
    });
    expect(out).toContain("目前頁面：分鏡");
    expect(out).toContain("正在看：第 3 鏡");
    expect(out).toContain("已選取：2 個分鏡");
    expect(out).toContain("這一鏡");
    // 絕不把 id 交給模型——它只會學會把 uuid 吐回給使用者
    expect(out).not.toContain(UUID_A);
    expect(out).not.toContain(UUID_B);
  });

  it("沒有 context 或無可講的內容時回空字串（提示詞一字不多佔）", () => {
    expect(formatAssistantPageContext(null)).toBe("");
    expect(formatAssistantPageContext(undefined)).toBe("");
    expect(formatAssistantPageContext({ pageType: "other" })).toBe("");
  });

  it("有 entityType 但沒有顯示名時退回型別中文名", () => {
    expect(formatAssistantPageContext({ pageType: "assets", entityType: "asset" })).toContain("正在看：素材");
  });

  it("studio / story / project contextText mentions add_character", () => {
    for (const pageType of ["studio", "story", "project"] as const) {
      const out = formatAssistantPageContext({ pageType });
      expect(out).toContain("add_character");
      expect(out).toContain("待補外觀描述");
    }
    expect(formatAssistantPageContext({ pageType: "storyboard" })).not.toContain("add_character");
  });
});
