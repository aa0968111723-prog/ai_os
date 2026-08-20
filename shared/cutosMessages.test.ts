import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CUTOS_ACTIVITY_MESSAGES,
  CUTOS_APPROVAL_MESSAGES,
  CUTOS_ERROR_MESSAGES,
  CUTOS_STATUS_MESSAGES,
  cutosMessage,
  cutosMessageKeys,
  describeActivity,
  hasCutosMessage,
} from "./cutosMessages";
import { CUTOS_ERROR_CODES } from "./cutosProtocol";

/**
 * 這份測試是文案表的防脫節機制：它去掃 server 端**實際會發出**的 key，
 * 而不是重抄一份清單。少翻一個，畫面就會出現原始 key——實機踩過，所以擋在這裡。
 */

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/** 從原始碼裡撈出所有字面量 messageKey。 */
function extractKeys(source: string, prefix: string): string[] {
  const matches = source.matchAll(
    new RegExp(`["'\`](${prefix.replace(".", "\\.")}[a-zA-Z0-9_.]+)["'\`]`, "g"),
  );
  return [...new Set([...matches].map((match) => match[1]!))];
}

describe("繁中文案表與程式碼同步", () => {
  it("每一個 activity messageKey 都有繁中文案", () => {
    // CUTOS 端以 `activity.<kind>.<status>` 組出 key，AIOS 端原樣落庫與顯示。
    const kinds = extractKeys(read("shared/cutosProtocol.ts"), "activity.");
    const emitted = [
      ...kinds,
      ...extractKeys(read("server/services/cutosStepRunner.ts"), "activity."),
      ...extractKeys(read("server/services/cutosActivity.ts"), "activity."),
    ];
    const missing = emitted.filter((key) => !hasCutosMessage(key));
    expect(missing, `缺少繁中文案的 activity key：${missing.join("、")}`).toEqual([]);
  });

  it("協定的每一個錯誤碼都有繁中文案（兩種鍵形都要）", () => {
    const missing: string[] = [];
    for (const code of CUTOS_ERROR_CODES) {
      // 伺服器端用 camelCase 鍵；客戶端由 code.toLowerCase() 推導。
      const lower = `aios.error.${code.toLowerCase()}`;
      if (!hasCutosMessage(lower)) missing.push(lower);
    }
    expect(missing, `缺少繁中文案的錯誤碼：${missing.join("、")}`).toEqual([]);
  });

  it("bridge 端使用的錯誤 messageKey 都有繁中文案", () => {
    // CUTOS 的 ERROR_MESSAGE_KEYS 會直接出現在回應裡，AIOS 得看得懂。
    const keys = [
      "aios.error.protocolMismatch",
      "aios.error.capabilityNotFound",
      "aios.error.validationFailed",
      "aios.error.unauthorized",
      "aios.error.forbiddenProject",
      "aios.error.projectNotFound",
      "aios.error.jobNotFound",
      "aios.error.runNotFound",
      "aios.error.staleRevision",
      "aios.error.effectInProgress",
      "aios.error.idempotencyConflict",
      "aios.error.approvalRequired",
      "aios.error.noPendingPlan",
      "aios.error.unsupportedOperation",
      "aios.error.emptyTimeline",
      "aios.error.analysisRequired",
      "aios.error.cancelled",
      "aios.error.timeout",
      "aios.error.unavailable",
      "aios.error.internal",
    ];
    expect(keys.filter((key) => !hasCutosMessage(key))).toEqual([]);
  });

  it("核准原因與連線狀態的 key 都有繁中文案", () => {
    const approval = extractKeys(read("server/services/cutosStepRunner.ts"), "aios.approval.");
    const binding = extractKeys(read("server/services/cutosProjectBinding.ts"), "cutos.binding.");
    const memory = extractKeys(read("server/services/cutosMemory.ts"), "cutos.memory.");
    const status = extractKeys(read("server/services/cutosClient.ts"), "cutos.status.");
    const missing = [...approval, ...binding, ...memory, ...status]
      .filter((key) => !hasCutosMessage(key));
    expect(missing, `缺少繁中文案：${missing.join("、")}`).toEqual([]);
  });
});

describe("文案內容", () => {
  it("每一句都是繁體中文，沒有英文回退", () => {
    for (const [key, value] of Object.entries({
      ...CUTOS_ACTIVITY_MESSAGES,
      ...CUTOS_ERROR_MESSAGES,
      ...CUTOS_APPROVAL_MESSAGES,
      ...CUTOS_STATUS_MESSAGES,
    })) {
      expect(value.length, `${key} 是空的`).toBeGreaterThan(0);
      // 允許 CUTOS / AI-OS 這兩個專有名詞，其餘不得出現整串英文單字。
      const withoutProperNouns = value.replace(/CUTOS|AI-OS|AIOS|FFmpeg/g, "");
      expect(withoutProperNouns, `${key} 含有英文：${value}`).not.toMatch(/[a-zA-Z]{4,}/);
      expect(value, `${key} 看起來像原始 key`).not.toMatch(/^[a-z]+\./);
    }
  });

  it("使用繁體字，不是簡體", () => {
    // 只列「簡體獨有」的字形：出／除／度 等兩岸同形字不能放進來，否則
    // 「正在輸出影片」這種正確的繁中會被誤判（第一版就踩到了）。
    const simplifiedOnly = /[这个说话时间应该关闭开启视频编辑导确认删进状态错误连线备档软复制]/;
    const all = {
      ...CUTOS_ACTIVITY_MESSAGES,
      ...CUTOS_ERROR_MESSAGES,
      ...CUTOS_APPROVAL_MESSAGES,
      ...CUTOS_STATUS_MESSAGES,
    };
    for (const [key, value] of Object.entries(all)) {
      expect(value, `${key} 疑似簡體：${value}`).not.toMatch(simplifiedOnly);
    }
  });

  it("關鍵繁體字形正確", () => {
    // 抽樣確認：這些字在簡體是 视频／编辑／确认／时间／状态
    const joined = Object.values(CUTOS_ACTIVITY_MESSAGES).join("");
    expect(joined).toContain("影片");
    expect(joined).toContain("剪輯");
    expect(joined).toContain("確認");
    expect(joined).toContain("時間軸");
  });

  it("不顯示模型的思考過程", () => {
    for (const value of Object.values(CUTOS_ACTIVITY_MESSAGES)) {
      expect(value).not.toMatch(/我(認為|覺得|想)|思考|推理|讓我/);
    }
  });

  it("涵蓋規格要求的每一句進度文案", () => {
    const required = [
      "正在分析影片",
      "逐字稿已完成",
      "正在搜尋相關內容",
      "正在建立剪輯計畫",
      "正在驗證剪輯結果",
      "正在套用修改",
      "正在輸出影片",
    ];
    const all = Object.values(CUTOS_ACTIVITY_MESSAGES);
    for (const sentence of required) {
      expect(all, `缺少：${sentence}`).toContain(sentence);
    }
  });

  it("涵蓋規格要求的連線狀態文案", () => {
    expect(cutosMessage("cutos.status.connected")).toBe("CUTOS 已連線");
    expect(cutosMessage("cutos.status.disconnected")).toBe("CUTOS 未連線");
    expect(cutosMessage("aios.protocol.mismatch")).toBe("CUTOS 版本不相容");
    expect(cutosMessage("aios.status.connected")).toBe("AI-OS 已連線");
  });

  it("錯誤文案不外洩內部細節", () => {
    for (const value of Object.values(CUTOS_ERROR_MESSAGES)) {
      expect(value).not.toMatch(/stack|Error:|at \w+\.|undefined|null/);
    }
  });
});

describe("查表行為", () => {
  it("未知的 key 回中文預設值，不回原始 key", () => {
    expect(cutosMessage("activity.unknown.thing")).toBe("處理中");
    expect(cutosMessage("activity.unknown.thing")).not.toContain("activity.");
  });

  it("可帶自訂預設值", () => {
    expect(cutosMessage("nope", "無資料")).toBe("無資料");
  });

  it("附上結構化計量而不是自由文字", () => {
    expect(describeActivity({
      messageKey: "activity.semantic_search.completed",
      metadata: { count: 8 },
    })).toBe("已找到相關片段（8）");
    expect(describeActivity({ messageKey: "activity.apply.completed" }))
      .toBe("修改已套用到時間軸");
  });

  it("文案表不是空的", () => {
    expect(cutosMessageKeys().length).toBeGreaterThan(80);
  });
});
