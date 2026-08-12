import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { ensureGroupOptions, getGroupOptions } from "./optionsStore";
import { worldviewSchema } from "../../shared/worldview";
import { PLATFORMS, PROJECT_FORMAT_IDS, type ProjectFormat } from "../../shared/models";

/**
 * 建立專案的唯一落地——人從表單建、組代理在 campaign 裡建，走的都是這一支。
 *
 * 為什麼要抽出來：組代理現在能自己開專案（create_project 步驟）。若讓執行器自己 insert
 * 一列 projects，那條路就繞過了 projects.create 累積下來的每一道判斷——平台必須是**該組
 * 啟用中**的選項、比例從平台推導、worldview 要有預設形狀。繞過的後果不是報錯而是靜默歪掉：
 * 代理開出來的專案帶著一個早被組長停用的平台，或 format 是空的，使用者要等到進生成頁
 * 才發現這個專案「怪怪的」，而且沒有任何地方說得出它跟自己手動建的差在哪。
 */
export async function createProjectCore(input: {
  auth: AuthState;
  groupId: string;
  title: string;
  kind: string;
  platform: string;
  /** 建立時直接指定畫面尺寸；未給就沿用平台預設比例 */
  format?: ProjectFormat;
}): Promise<typeof schema.projects.$inferSelect> {
  const { auth, groupId } = input;
  requireGroup(auth, groupId);
  const title = input.title.trim();
  if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "請填專案名稱" });
  if (title.length > 80) throw new TRPCError({ code: "BAD_REQUEST", message: "專案名稱太長（最多 80 字）" });

  // 平台與畫面比例查該組自訂選項（type=platform、啟用中）；kind 不硬性驗證（自由字串），直接存原值。
  await ensureGroupOptions(groupId); // 保證已 seed，下面才能以「該組是否有 platform 選項」判斷
  const platformOptions = await getGroupOptions(groupId, "platform");
  const match = platformOptions.find((o) => o.value === input.platform && o.active);
  // 該組已有 platform 選項（一定有，seed 過）→ 只認啟用中的；停用/刪除的平台一律拒絕，不再退回內建。
  // 僅在極端「該組完全沒有 platform 選項」時才退回 shared/models 內建（理論上 seed 後不會發生）。
  const platformFormat = match?.format ?? (platformOptions.length === 0 ? PLATFORMS.find((p) => p.id === input.platform)?.format : undefined);
  if (!platformFormat) throw new TRPCError({ code: "BAD_REQUEST", message: "這個發布平台已停用或不存在，請重新選一個" });
  // 使用者在建立表單挑過尺寸就以它為準（平台仍要合法，只是比例可另選）
  const format = input.format ?? platformFormat;

  // Retry window: a second create with the same title in the same group by the
  // same owner within 2 minutes is treated as the same Agent/client retry.
  const [recent] = await db.select().from(schema.projects).where(and(
    eq(schema.projects.groupId, groupId),
    eq(schema.projects.ownerId, auth.user.id),
    eq(schema.projects.title, title),
    gte(schema.projects.createdAt, new Date(Date.now() - 120_000)),
  )).orderBy(desc(schema.projects.createdAt)).limit(1);
  if (recent) return recent;

  const [project] = await db
    .insert(schema.projects)
    .values({
      groupId,
      ownerId: auth.user.id,
      title,
      kind: input.kind,
      platform: input.platform,
      format,
      worldview: worldviewSchema.parse({}),
    })
    .returning();
  return project;
}

/**
 * 該組現在能用的內容類型／發布平台（只列啟用中的）。
 *
 * 給規劃器看的：組代理要開專案就得挑一個平台，而平台不是全域常數而是**每組自訂**的。
 * 不餵這份清單，LLM 只能猜「youtube」「instagram」這種內建值，猜錯就在 createProjectCore
 * 被擋成 BAD_REQUEST——一份計畫在跑到第三步才失敗，且理由是使用者看不懂的「平台已停用」。
 */
export async function listProjectCreationOptions(groupId: string): Promise<{
  kinds: string[];
  platforms: Array<{ value: string; format: ProjectFormat }>;
}> {
  await ensureGroupOptions(groupId);
  const [kindOpts, platformOpts] = await Promise.all([
    getGroupOptions(groupId, "kind"),
    getGroupOptions(groupId, "platform"),
  ]);
  return {
    kinds: kindOpts.filter((o) => o.active).map((o) => o.value),
    platforms: platformOpts
      .filter((o) => o.active)
      .map((o) => ({
        value: o.value,
        format: (PROJECT_FORMAT_IDS as readonly string[]).includes(o.format ?? "")
          ? (o.format as ProjectFormat)
          : ("16:9" as ProjectFormat),
      })),
  };
}
