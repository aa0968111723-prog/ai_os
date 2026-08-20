import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(__dirname, "companion.ts"), "utf8");
const generationSrc = readFileSync(path.join(__dirname, "..", "services", "generationCore.ts"), "utf8");
const realtimeSrc = readFileSync(path.join(__dirname, "..", "services", "realtime.ts"), "utf8");
const routerIndex = readFileSync(path.join(__dirname, "index.ts"), "utf8");

/**
 * Companion 讀模型的契約。
 *
 * 這裡守的是三類「跑得動但是錯的」問題：授權漏掉、計數把回收桶算進去、
 * 以及最重要的一條——**App 不准長出自己的後端**。
 */
describe("companion router 的授權與查詢契約", () => {
  it("組級查詢一律 requireGroup", () => {
    // digest 與 context 都吃 groupId，兩支都必須守
    const guards = src.split("requireGroup(ctx.auth, input.groupId)").length - 1;
    expect(guards).toBe(2);
  });

  it("指名專案時同時比對 groupId——不能靠 projectId 讀到別組的分鏡與素材", () => {
    const at = src.indexOf("async function loadProjectChecked");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 700);
    expect(block).toContain("eq(schema.projects.id, projectId)");
    expect(block).toContain("eq(schema.projects.groupId, groupId)");
  });

  it("是唯讀 router——寫入一律走既有 globalAssistant / creativeContext", () => {
    expect(src).not.toContain(".mutation(");
  });

  it("分鏡計數濾掉回收桶（否則分母永遠比專案頁多）", () => {
    // 每一支「以專案篩分鏡」的 where 都必須同時濾掉 deletedAt
    const whereClauses = ["inArray(schema.scenes.projectId, ids)", "eq(schema.scenes.projectId, projectId)"];
    for (const clause of whereClauses) {
      const at = src.indexOf(clause);
      expect(at, `找不到分鏡查詢：${clause}`).toBeGreaterThan(-1);
      expect(src.slice(at, at + 160), `${clause} 沒有濾掉 scenes.deletedAt`)
        .toContain("isNull(schema.scenes.deletedAt)");
    }
    expect(src.split("isNull(schema.scenes.deletedAt)").length - 1).toBe(whereClauses.length);
  });

  it("素材查詢濾掉回收桶", () => {
    expect(src).toContain("isNull(schema.assets.deletedAt)");
  });

  it("每個列表都有上限——這份東西會進提示詞，不能無界", () => {
    for (const limit of [
      "CONTEXT_RECENT_PROJECTS", "CONTEXT_RECENT_ASSETS",
      "CONTEXT_RECENT_GENERATIONS", "CONTEXT_CHARACTERS", "CONTEXT_TASKS",
    ]) {
      expect(src, `${limit} 沒有被用到`).toContain(`limit(${limit})`);
    }
  });

  it("失敗原因會截斷，不把整段 provider stack 灌進提示詞", () => {
    expect(src).toContain("g.error.slice(0, 200)");
  });

  it("已註冊進 appRouter", () => {
    expect(routerIndex).toContain("companion: companionRouter");
  });
});

describe("failedGenerations（重跑確認卡的資料來源）", () => {
  it("先驗專案再 requireGroup——不能靠 projectId 讀到別組的失敗清單", () => {
    const at = src.indexOf("failedGenerations: authedProcedure");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 1200);
    expect(block).toContain("requireGroup(ctx.auth, project.groupId)");
  });

  it("錯誤原因截斷、清單有上限（20）", () => {
    const at = src.indexOf("failedGenerations: authedProcedure");
    const block = src.slice(at, at + 1800);
    expect(block).toContain(".limit(20)");
    expect(block).toContain("slice(0, 120)");
  });

  it("router 仍是唯讀——重跑走既有 generation.retry", () => {
    expect(src).not.toContain(".mutation(");
  });
});

describe("Companion 即時事件", () => {
  it("生成的四個生命週期都發事件（開始／完成／失敗／待核）", () => {
    for (const kind of [
      "generation_started", "generation_completed", "generation_failed", "approval_required",
    ]) {
      expect(generationSrc, `${kind} 沒有發出`).toContain(`kind: "${kind}"`);
    }
  });

  it("事件同時扇到專案房與組房——Companion 首頁連的是組房", () => {
    const at = realtimeSrc.indexOf("export function publishCompanionEvent");
    expect(at).toBeGreaterThan(-1);
    const block = realtimeSrc.slice(at, at + 1400);
    expect(block).toContain("`p:${input.projectId}`");
    expect(block).toContain("`g:${groupId}`");
  });

  it("查組別失敗不會讓生成流程看見錯誤（通知不是資料寫入）", () => {
    const at = realtimeSrc.indexOf("export function publishCompanionEvent");
    const block = realtimeSrc.slice(at, at + 1400);
    expect(block).toContain(".catch(() => undefined)");
  });

  it("線路上的 type 與前端解碼器同一個常數來源", () => {
    const shared = readFileSync(
      path.join(__dirname, "..", "..", "shared", "companionRealtime.ts"),
      "utf8",
    );
    expect(shared).toContain('export const COMPANION_WS_MESSAGE_TYPE = "companion-event"');
    expect(realtimeSrc).toContain('type: "companion-event"');
  });
});

describe("禁止為 App 另建一套後端（任務書 §14）", () => {
  it("Companion 不自己碰 auth／points／fal——那些只能走既有 service", () => {
    for (const forbidden of ["services/points", "services/fal", "services/auth", "bcrypt"]) {
      expect(src, `companion.ts 直接引用了 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("階段推導沿用既有的共用函式，不另寫一份", () => {
    expect(src).toContain('from "../../shared/phoneStages"');
    expect(src).toContain("inferPhoneStage(");
  });

  it("可見專案的界沿用既有 visibleProjectsWhere", () => {
    expect(src).toContain("visibleProjectsWhere([input.groupId])");
  });
});
