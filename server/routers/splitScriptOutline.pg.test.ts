import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { splitScriptCore } from "./director";
import { RATE_LIMIT_SCOPES } from "../services/rateLimit";

/**
 * 「用大綱拆分鏡」（fromOutline）的來源選擇規則。
 *
 * 守的是一個真實的斷點：三幕本來只以 formatWorldviewForAi 的一行摘要進 prompt，
 * 拆分鏡的腳本來源只認「貼上的全文」或知識庫——使用者填完三幕，到拆分鏡卻仍被
 * 要求再貼一份腳本，同一個故事因此被寫兩次。這裡確認三幕真的能當來源，而且
 * **不會**在大綱是空的時候靜默改拆知識庫（按鈕名稱與實際行為對不上最難查）。
 */
const RUN_PG = process.env.RUN_PG_INTEGRATION === "1"
  && process.env.E2E_MOCK === "1"
  && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("splitScript fromOutline（三幕大綱當腳本來源）", () => {
  const userId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();
  const emptyActsProjectId = randomUUID();

  const ACTS = { hook: "深夜獨坐，說不出的累", turn: "一句開示，心門打開", cta: "晨光下釋懷，邀請一起靜心" };

  beforeAll(async () => {
    await db.insert(schema.users).values({
      id: userId,
      name: "Outline split test",
      email: `outline-split-${userId}@example.test`,
      passwordHash: "test-only",
    });
    await db.insert(schema.projects).values([
      {
        id: projectId,
        groupId,
        ownerId: userId,
        title: "大綱拆分鏡",
        kind: "video",
        platform: "test",
        format: "16:9",
        worldview: { acts: ACTS },
      },
      {
        id: emptyActsProjectId,
        groupId,
        ownerId: userId,
        title: "沒有大綱",
        kind: "video",
        platform: "test",
        format: "16:9",
        worldview: {},
      },
    ]);
    // 知識庫裡放一份腳本：空大綱時若退回知識庫就會拆出東西，測試要抓的正是「不許退回」
    await db.insert(schema.knowledge).values({
      projectId: emptyActsProjectId,
      groupId,
      title: "備用腳本",
      kind: "script",
      content: "知識庫第一段。\n\n知識庫第二段。",
      createdBy: userId,
    });
  });

  afterAll(async () => {
    for (const id of [projectId, emptyActsProjectId]) {
      await db.delete(schema.scenes).where(eq(schema.scenes.projectId, id));
      await db.delete(schema.knowledge).where(eq(schema.knowledge.projectId, id));
      await db.delete(schema.projects).where(eq(schema.projects.id, id));
    }
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.rateLimitBuckets).where(
      eq(schema.rateLimitBuckets.scope, RATE_LIMIT_SCOPES.director),
    );
  });

  it("三幕當來源切出三幕——空行分段讓每一幕各成一鏡，不是整份塞成一鏡", async () => {
    const result = await splitScriptCore({
      userId,
      projectId,
      fromOutline: true,
      assertAccess: () => {},
    });

    expect(result.count).toBe(3);
    const rows = await db
      .select({ voiceover: schema.scenes.voiceover, orderIndex: schema.scenes.orderIndex })
      .from(schema.scenes)
      .where(eq(schema.scenes.projectId, projectId));
    const byOrder = rows.sort((a, b) => a.orderIndex - b.orderIndex);
    expect(byOrder[0]!.voiceover).toContain("深夜獨坐");
    expect(byOrder[1]!.voiceover).toContain("一句開示");
    expect(byOrder[2]!.voiceover).toContain("晨光下釋懷");
  });

  it("大綱是空的就報錯，不會靜默改拆知識庫", async () => {
    await expect(splitScriptCore({
      userId,
      projectId: emptyActsProjectId,
      fromOutline: true,
      assertAccess: () => {},
    })).rejects.toThrow(/三幕大綱是空的/);

    const rows = await db
      .select({ id: schema.scenes.id })
      .from(schema.scenes)
      .where(eq(schema.scenes.projectId, emptyActsProjectId));
    expect(rows).toHaveLength(0);
  });

  it("沒有 fromOutline 時行為不變：同一個空大綱專案仍照舊退回知識庫", async () => {
    const result = await splitScriptCore({
      userId,
      projectId: emptyActsProjectId,
      assertAccess: () => {},
    });
    expect(result.count).toBeGreaterThan(0);
  });

  it("fromOutline 蓋過貼上的腳本——按鈕說用大綱就用大綱", async () => {
    await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
    const result = await splitScriptCore({
      userId,
      projectId,
      fromOutline: true,
      scriptText: "這份貼上的腳本不該被用到。\n\n它有兩段。",
      assertAccess: () => {},
    });

    expect(result.count).toBe(3);
    const rows = await db
      .select({ voiceover: schema.scenes.voiceover })
      .from(schema.scenes)
      .where(eq(schema.scenes.projectId, projectId));
    expect(rows.some((r) => r.voiceover?.includes("不該被用到"))).toBe(false);
  });
});
