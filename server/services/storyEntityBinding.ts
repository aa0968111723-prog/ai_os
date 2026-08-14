/**
 * Story mention → canonical entity binding.
 *
 * Proposal is not a mutation. Confirm / Apply / lock are the only writes
 * that change a binding. Re-resolve never overwrites a locked row.
 */
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { requireGroup } from "../trpc";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import {
  findMentionSpans,
  needsBindingProposal,
  resolveMentionAgainstCatalog,
  type BindingCandidate,
  type StoryEntityCatalogEntry,
  type StoryEntityKind,
} from "../../shared/projectCreativeContext";

export type StoryEntityBindingRow = typeof schema.storyEntityBindings.$inferSelect;
export type StoryEntityProposalRow = typeof schema.storyEntityBindingProposals.$inferSelect;

async function loadProjectForContext(auth: AuthState, projectId: string, forEdit: boolean) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  try {
    requireGroup(auth, project.groupId);
  } catch {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  }
  if (forEdit) {
    await assertProjectEditable(auth, project);
    assertProjectNotArchived(project);
  }
  return project;
}

export function aliasesFromNotes(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const found: string[] = [];
  for (const match of notes.matchAll(/(?:又名|別名|别名)[:：\s]*([^\n,，、；;]+)/g)) {
    const name = match[1]?.trim();
    if (name) found.push(name);
  }
  return found;
}

export async function loadProjectEntityCatalog(projectId: string): Promise<StoryEntityCatalogEntry[]> {
  const [characters, looks, scenes, presets, props, knowledge] = await Promise.all([
    db.select({
      id: schema.characters.id,
      rev: schema.characters.rev,
      name: schema.characters.name,
      notes: schema.characters.notes,
    }).from(schema.characters).where(eq(schema.characters.projectId, projectId)),
    db.select({
      id: schema.characterLooks.id,
      rev: schema.characterLooks.rev,
      name: schema.characterLooks.name,
    }).from(schema.characterLooks).where(eq(schema.characterLooks.projectId, projectId)),
    db.select({
      id: schema.storyScenes.id,
      rev: schema.storyScenes.rev,
      title: schema.storyScenes.title,
    }).from(schema.storyScenes).where(eq(schema.storyScenes.projectId, projectId)),
    db.select({
      id: schema.scenePresets.id,
      rev: schema.scenePresets.rev,
      name: schema.scenePresets.name,
    }).from(schema.scenePresets).where(eq(schema.scenePresets.projectId, projectId)),
    db.select({
      id: schema.props.id,
      rev: schema.props.rev,
      name: schema.props.name,
      notes: schema.props.notes,
    }).from(schema.props).where(eq(schema.props.projectId, projectId)),
    db.select({
      id: schema.knowledge.id,
      title: schema.knowledge.title,
    }).from(schema.knowledge).where(and(eq(schema.knowledge.projectId, projectId))),
  ]);

  const catalog: StoryEntityCatalogEntry[] = [];
  for (const row of characters) {
    catalog.push({
      kind: "character",
      id: row.id,
      rev: row.rev,
      name: row.name,
      aliases: aliasesFromNotes(row.notes),
    });
  }
  for (const row of looks) {
    catalog.push({ kind: "character_look", id: row.id, rev: row.rev, name: row.name });
  }
  for (const row of scenes) {
    if (!row.title.trim()) continue;
    catalog.push({ kind: "scene", id: row.id, rev: row.rev, name: row.title });
  }
  for (const row of presets) {
    catalog.push({ kind: "scene_preset", id: row.id, rev: row.rev, name: row.name });
  }
  for (const row of props) {
    catalog.push({
      kind: "prop",
      id: row.id,
      rev: row.rev,
      name: row.name,
      aliases: aliasesFromNotes(row.notes),
    });
  }
  for (const row of knowledge) {
    catalog.push({ kind: "knowledge", id: row.id, rev: null, name: row.title });
  }
  return catalog;
}

export async function resolveStoryEntityBindings(input: {
  auth: AuthState;
  projectId: string;
  persist?: boolean;
}): Promise<{
  bindings: StoryEntityBindingRow[];
  proposals: StoryEntityProposalRow[];
  autoBound: number;
  proposed: number;
  lockedPreserved: number;
}> {
  const project = await loadProjectForContext(input.auth, input.projectId, Boolean(input.persist));
  const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, project.id));
  if (!story || !story.content.trim()) {
    return { bindings: [], proposals: [], autoBound: 0, proposed: 0, lockedPreserved: 0 };
  }

  const [catalog, existingBindings, existingProposals] = await Promise.all([
    loadProjectEntityCatalog(project.id),
    db.select().from(schema.storyEntityBindings).where(eq(schema.storyEntityBindings.projectId, project.id)),
    db.select().from(schema.storyEntityBindingProposals).where(and(
      eq(schema.storyEntityBindingProposals.projectId, project.id),
      eq(schema.storyEntityBindingProposals.status, "pending"),
    )),
  ]);

  const bindingByKey = new Map(existingBindings.map((row) => [`${row.mentionKey}:${row.entityKind}`, row]));
  const proposalByKey = new Map(existingProposals.map((row) => [`${row.mentionKey}:${row.entityKind}`, row]));
  const mentions = findMentionSpans(story.content, catalog);

  let autoBound = 0;
  let proposed = 0;
  let lockedPreserved = 0;

  for (const mention of mentions) {
    const key = `${mention.mentionKey}:${mention.kind}`;
    const existing = bindingByKey.get(key);
    if (existing?.locked) {
      lockedPreserved += 1;
      continue;
    }
    const resolved = resolveMentionAgainstCatalog(mention, catalog, { locked: false });
    if (resolved.auto) {
      autoBound += 1;
      if (input.persist) {
        const row = await upsertBinding({
          project,
          story,
          mention,
          candidate: resolved.auto,
          source: existing?.source === "user_confirmed" ? "user_confirmed" : "auto",
          locked: false,
          actorId: input.auth.user.id,
          existing,
        });
        bindingByKey.set(key, row);
      }
      continue;
    }
    if (needsBindingProposal(resolved) && resolved.candidates.length > 0) {
      proposed += 1;
      if (input.persist && !proposalByKey.has(key)) {
        const [row] = await db.insert(schema.storyEntityBindingProposals).values({
          projectId: project.id,
          groupId: project.groupId,
          storyId: story.id,
          storyRev: story.rev,
          mentionText: mention.mentionText,
          mentionKey: mention.mentionKey,
          spanStart: mention.start,
          spanEnd: mention.end,
          entityKind: mention.kind,
          candidates: resolved.candidates,
          status: "pending",
        }).returning();
        proposalByKey.set(key, row);
      }
    }
  }

  const bindings = [...bindingByKey.values()];
  const proposals = [...proposalByKey.values()];
  return { bindings, proposals, autoBound, proposed, lockedPreserved };
}

async function upsertBinding(input: {
  project: { id: string; groupId: string };
  story: { id: string; rev: number };
  mention: { mentionText: string; mentionKey: string; start: number; end: number; kind: StoryEntityKind };
  candidate: BindingCandidate;
  source: "auto" | "user_confirmed";
  locked: boolean;
  actorId: string;
  existing?: StoryEntityBindingRow;
}): Promise<StoryEntityBindingRow> {
  if (input.existing) {
    if (input.existing.locked) return input.existing;
    const [row] = await db.update(schema.storyEntityBindings).set({
      storyRev: input.story.rev,
      mentionText: input.mention.mentionText,
      spanStart: input.mention.start,
      spanEnd: input.mention.end,
      entityId: input.candidate.entityId,
      entityRev: input.candidate.entityRev,
      source: input.source,
      confidence: input.candidate.score,
      locked: input.locked,
      reason: input.candidate.reason,
      updatedAt: new Date(),
    }).where(eq(schema.storyEntityBindings.id, input.existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(schema.storyEntityBindings).values({
    projectId: input.project.id,
    groupId: input.project.groupId,
    storyId: input.story.id,
    storyRev: input.story.rev,
    mentionText: input.mention.mentionText,
    mentionKey: input.mention.mentionKey,
    spanStart: input.mention.start,
    spanEnd: input.mention.end,
    entityKind: input.mention.kind,
    entityId: input.candidate.entityId,
    entityRev: input.candidate.entityRev,
    source: input.source,
    confidence: input.candidate.score,
    locked: input.locked,
    reason: input.candidate.reason,
    createdBy: input.actorId,
  }).onConflictDoNothing().returning();
  if (row) return row;
  const [fresh] = await db.select().from(schema.storyEntityBindings).where(and(
    eq(schema.storyEntityBindings.projectId, input.project.id),
    eq(schema.storyEntityBindings.mentionKey, input.mention.mentionKey),
    eq(schema.storyEntityBindings.entityKind, input.mention.kind),
  ));
  if (!fresh) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "綁定寫入失敗" });
  return fresh;
}

async function assertEntityInProject(projectId: string, kind: StoryEntityKind, entityId: string): Promise<number | null> {
  if (kind === "character") {
    const [row] = await db.select({ id: schema.characters.id, rev: schema.characters.rev })
      .from(schema.characters).where(and(eq(schema.characters.id, entityId), eq(schema.characters.projectId, projectId)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個角色" });
    return row.rev;
  }
  if (kind === "character_look") {
    const [row] = await db.select({ id: schema.characterLooks.id, rev: schema.characterLooks.rev })
      .from(schema.characterLooks).where(and(eq(schema.characterLooks.id, entityId), eq(schema.characterLooks.projectId, projectId)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個造型" });
    return row.rev;
  }
  if (kind === "scene") {
    const [row] = await db.select({ id: schema.storyScenes.id, rev: schema.storyScenes.rev })
      .from(schema.storyScenes).where(and(eq(schema.storyScenes.id, entityId), eq(schema.storyScenes.projectId, projectId)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個場" });
    return row.rev;
  }
  if (kind === "scene_preset") {
    const [row] = await db.select({ id: schema.scenePresets.id, rev: schema.scenePresets.rev })
      .from(schema.scenePresets).where(and(eq(schema.scenePresets.id, entityId), eq(schema.scenePresets.projectId, projectId)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這張場景卡" });
    return row.rev;
  }
  if (kind === "prop") {
    const [row] = await db.select({ id: schema.props.id, rev: schema.props.rev })
      .from(schema.props).where(and(eq(schema.props.id, entityId), eq(schema.props.projectId, projectId)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個道具" });
    return row.rev;
  }
  if (kind === "knowledge") {
    const [row] = await db.select({ id: schema.knowledge.id })
      .from(schema.knowledge).where(and(eq(schema.knowledge.id, entityId), eq(schema.knowledge.projectId, projectId)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則知識" });
    return null;
  }
  if (kind === "asset_revision") {
    const [row] = await db.select({ id: schema.assetRevisions.id })
      .from(schema.assetRevisions).where(and(eq(schema.assetRevisions.id, entityId), eq(schema.assetRevisions.projectId, projectId)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個素材版本" });
    return null;
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "此類型尚不能綁定" });
}

export async function confirmStoryEntityProposal(input: {
  auth: AuthState;
  proposalId: string;
  entityId: string;
  lock?: boolean;
}): Promise<{ binding: StoryEntityBindingRow; proposal: StoryEntityProposalRow }> {
  const [proposal] = await db.select().from(schema.storyEntityBindingProposals)
    .where(eq(schema.storyEntityBindingProposals.id, input.proposalId));
  if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆待確認項目" });
  const project = await loadProjectForContext(input.auth, proposal.projectId, true);
  if (proposal.status !== "pending") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "這筆待確認項目已處理過" });
  }
  const entityRev = await assertEntityInProject(project.id, proposal.entityKind, input.entityId);
  const picked = proposal.candidates.find((c) => c.entityId === input.entityId);
  const candidate: BindingCandidate = picked ?? {
    entityId: input.entityId,
    entityRev,
    name: proposal.mentionText,
    score: 1,
    reason: "使用者確認綁定",
  };
  const [story] = await db.select().from(schema.stories).where(eq(schema.stories.id, proposal.storyId));
  if (!story || story.projectId !== project.id) throw new TRPCError({ code: "NOT_FOUND", message: "找不到故事" });
  const existing = (await db.select().from(schema.storyEntityBindings).where(and(
    eq(schema.storyEntityBindings.projectId, project.id),
    eq(schema.storyEntityBindings.mentionKey, proposal.mentionKey),
    eq(schema.storyEntityBindings.entityKind, proposal.entityKind),
  )))[0];
  if (existing?.locked) {
    throw new TRPCError({ code: "CONFLICT", message: "這項對應已被鎖定，請先解除鎖定再改" });
  }
  const binding = await upsertBinding({
    project,
    story,
    mention: {
      mentionText: proposal.mentionText,
      mentionKey: proposal.mentionKey,
      start: proposal.spanStart ?? 0,
      end: proposal.spanEnd ?? proposal.mentionText.length,
      kind: proposal.entityKind,
    },
    candidate: { ...candidate, entityRev, reason: "使用者確認綁定" },
    source: "user_confirmed",
    locked: input.lock !== false,
    actorId: input.auth.user.id,
    existing,
  });
  const [updated] = await db.update(schema.storyEntityBindingProposals).set({
    status: "applied",
    resolvedAt: new Date(),
    resolvedBy: input.auth.user.id,
    appliedBindingId: binding.id,
  }).where(eq(schema.storyEntityBindingProposals.id, proposal.id)).returning();
  return { binding, proposal: updated };
}

export async function dismissStoryEntityProposal(input: {
  auth: AuthState;
  proposalId: string;
}): Promise<StoryEntityProposalRow> {
  const [proposal] = await db.select().from(schema.storyEntityBindingProposals)
    .where(eq(schema.storyEntityBindingProposals.id, input.proposalId));
  if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆待確認項目" });
  await loadProjectForContext(input.auth, proposal.projectId, true);
  if (proposal.status !== "pending") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "這筆待確認項目已處理過" });
  }
  const [updated] = await db.update(schema.storyEntityBindingProposals).set({
    status: "dismissed",
    resolvedAt: new Date(),
    resolvedBy: input.auth.user.id,
  }).where(eq(schema.storyEntityBindingProposals.id, proposal.id)).returning();
  return updated;
}

export async function setStoryEntityBindingLock(input: {
  auth: AuthState;
  bindingId: string;
  locked: boolean;
}): Promise<StoryEntityBindingRow> {
  const [binding] = await db.select().from(schema.storyEntityBindings)
    .where(eq(schema.storyEntityBindings.id, input.bindingId));
  if (!binding) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆對應" });
  await loadProjectForContext(input.auth, binding.projectId, true);
  const [row] = await db.update(schema.storyEntityBindings).set({
    locked: input.locked,
    source: input.locked ? "user_confirmed" : binding.source,
    updatedAt: new Date(),
  }).where(eq(schema.storyEntityBindings.id, binding.id)).returning();
  return row;
}

export async function undoStoryEntityBinding(input: {
  auth: AuthState;
  bindingId: string;
}): Promise<{ removed: true }> {
  const [binding] = await db.select().from(schema.storyEntityBindings)
    .where(eq(schema.storyEntityBindings.id, input.bindingId));
  if (!binding) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆對應" });
  await loadProjectForContext(input.auth, binding.projectId, true);
  if (binding.locked) {
    throw new TRPCError({ code: "CONFLICT", message: "鎖定的對應不能直接撤銷，請先解除鎖定" });
  }
  await db.delete(schema.storyEntityBindings).where(eq(schema.storyEntityBindings.id, binding.id));
  return { removed: true };
}

export async function listStoryEntityBindings(input: {
  auth: AuthState;
  projectId: string;
}): Promise<{ bindings: StoryEntityBindingRow[]; proposals: StoryEntityProposalRow[] }> {
  const project = await loadProjectForContext(input.auth, input.projectId, false);
  const [bindings, proposals] = await Promise.all([
    db.select().from(schema.storyEntityBindings).where(eq(schema.storyEntityBindings.projectId, project.id)),
    db.select().from(schema.storyEntityBindingProposals).where(and(
      eq(schema.storyEntityBindingProposals.projectId, project.id),
      inArray(schema.storyEntityBindingProposals.status, ["pending"]),
    )),
  ]);
  return { bindings, proposals };
}

export { loadProjectForContext as loadCreativeContextProject };
