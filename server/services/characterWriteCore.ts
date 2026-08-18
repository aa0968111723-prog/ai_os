import { and, count, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import { MAX_PROJECT_CHARACTERS } from "../../shared/cardLimits";
import { PENDING_CHARACTER_APPEARANCE } from "../../shared/assistantCharacterPropose";
import { applyXiaohuaIdentityLock } from "../../shared/characterIdentityLock";
import { nameKey } from "../../shared/story";
import { publishToProject } from "./realtime";
import { assertProjectEditable } from "./projectAcl";
import type { AuthState } from "./auth";

export type UpsertProjectCharacterResult = {
  characterId: string;
  name: string;
  appearance: string;
  reused: boolean;
  appearanceChanged: boolean;
  verification: { status: "verified" | "unverified"; message: string };
};

/**
 * Write a 角色定裝卡 (characters), never 素材清單 / dataRows.
 * Story / parse is optional — unparsed projects still get a card.
 */
export async function upsertProjectCharacterCore(input: {
  auth: AuthState;
  groupId: string;
  projectId: string;
  name: string;
  appearance: string;
  notes?: string | null;
}): Promise<UpsertProjectCharacterResult> {
  requireGroup(input.auth, input.groupId);
  const [project] = await db
    .select({
      id: schema.projects.id,
      groupId: schema.projects.groupId,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, input.projectId));
  if (!project || project.groupId !== input.groupId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個專案" });
  }
  await assertProjectEditable(input.auth, project);

  const name = input.name.trim();
  const [storyRow] = await db
    .select({ content: schema.stories.content })
    .from(schema.stories)
    .where(eq(schema.stories.projectId, project.id))
    .limit(1);
  const locked = applyXiaohuaIdentityLock(
    { name, appearance: input.appearance.trim(), costume: null },
    storyRow?.content ?? "",
  );
  const appearance = (locked.appearance ?? input.appearance).trim();
  const notes = input.notes?.trim() || null;
  if (!name || !appearance) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "請填角色名與外觀" });
  }

  const existing = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.projectId, project.id));
  const reused = existing.find((row) => nameKey(row.name) === nameKey(name));
  let appearanceChanged = false;
  if (reused) {
    const requested = applyXiaohuaIdentityLock(
      { name, appearance, costume: null },
      storyRow?.content ?? "",
    );
    const nextAppearance = (requested.appearance ?? appearance).trim();
    const keepPending = nextAppearance === PENDING_CHARACTER_APPEARANCE && reused.appearance.trim();
    const writeAppearance = keepPending ? reused.appearance : nextAppearance;
    if (writeAppearance && writeAppearance !== reused.appearance) {
      await db
        .update(schema.characters)
        .set({ appearance: writeAppearance, rev: sql`${schema.characters.rev} + 1` })
        .where(eq(schema.characters.id, reused.id));
      reused.appearance = writeAppearance;
      appearanceChanged = true;
    }
  }

  const row = reused ?? await (async () => {
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.characters)
      .where(eq(schema.characters.projectId, project.id));
    if (Number(n) >= MAX_PROJECT_CHARACTERS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `此專案角色定裝已達上限（${MAX_PROJECT_CHARACTERS} 張）——先刪不用的再新增`,
      });
    }
    const [created] = await db.insert(schema.characters).values({
      projectId: project.id,
      groupId: project.groupId,
      name,
      appearance,
      notes,
      createdBy: input.auth.user.id,
    }).returning();
    return created;
  })();

  let verification: UpsertProjectCharacterResult["verification"];
  try {
    const [found] = await db
      .select({
        id: schema.characters.id,
        projectId: schema.characters.projectId,
        appearance: schema.characters.appearance,
      })
      .from(schema.characters)
      .where(and(eq(schema.characters.id, row.id), eq(schema.characters.projectId, project.id)));
    const expectedAppearance = reused ? reused.appearance : appearance;
    verification = found && found.appearance === expectedAppearance
      ? {
          status: "verified",
          message: appearanceChanged
            ? `已重新讀取並確認角色「${row.name}」外觀`
            : reused
              ? `已重新讀取並確認角色「${row.name}」已存在`
              : `已重新讀取並確認角色「${row.name}」`,
        }
      : { status: "unverified", message: "操作已送出，但驗證未通過" };
  } catch {
    verification = { status: "unverified", message: "操作已送出，但驗證未通過" };
  }

  if (!reused || appearanceChanged) {
    publishToProject(
      project.id,
      { kind: "character", id: row.id },
      appearanceChanged ? "助手已更新角色外觀" : "助手已新增角色",
    );
  }

  return {
    characterId: row.id,
    name: row.name,
    appearance: reused ? reused.appearance : appearance,
    reused: Boolean(reused),
    appearanceChanged,
    verification,
  };
}
