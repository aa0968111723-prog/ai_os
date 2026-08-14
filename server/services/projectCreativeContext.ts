/**
 * Project Creative Context composer.
 *
 * Reads the existing canonical tables. Does not copy characters, looks,
 * scenes, props, assets or knowledge into a second store.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { parseWorldviewSafe } from "../../shared/parseWorldviewSafe";
import { getModel } from "../../shared/models";
import {
  type CreativeContextItem,
  type StoryEntityKind,
} from "../../shared/projectCreativeContext";
import { listProjectBoundTableIds } from "./projectDataBindings";
import { loadQuotaConfig } from "./points";
import { isMockMode } from "./fal";
import {
  listStoryEntityBindings,
  loadCreativeContextProject,
  resolveStoryEntityBindings,
} from "./storyEntityBinding";

export interface ComposeCreativeContextInput {
  auth: AuthState;
  projectId: string;
  sceneId?: string | null;
  shotId?: string | null;
  persistBindings?: boolean;
}

export interface ComposedProjectCreativeContext {
  project: { id: string; title: string; groupId: string; format: string; rev: null };
  story: CreativeContextItem<{ content: string; lastParsedAt: Date | null }> | null;
  worldRules: CreativeContextItem[];
  characters: CreativeContextItem[];
  looks: CreativeContextItem[];
  scenes: CreativeContextItem[];
  presets: CreativeContextItem[];
  props: CreativeContextItem[];
  assets: CreativeContextItem[];
  knowledge: CreativeContextItem[];
  dataTables: CreativeContextItem[];
  bindings: Awaited<ReturnType<typeof listStoryEntityBindings>>["bindings"];
  proposals: Awaited<ReturnType<typeof listStoryEntityBindings>>["proposals"];
  continuity: {
    previousShot: { id: string; title: string; orderIndex: number } | null;
    currentShot: { id: string; title: string; orderIndex: number } | null;
    nextShot: { id: string; title: string; orderIndex: number } | null;
  };
  provider: {
    defaultImageModelId: string;
    defaultImageKind: string;
    trainingConfigured: boolean;
    paidCallsAuthorized: false;
  };
  quota: {
    weeklyQuota: number | null;
    approvalThreshold: number | null;
  };
  summary: {
    characterCount: number;
    lookCount: number;
    sceneCount: number;
    propCount: number;
    assetCount: number;
    knowledgeCount: number;
    pendingProposalCount: number;
  };
}

function item<T>(
  kind: CreativeContextItem["kind"],
  id: string,
  title: string,
  revision: number | null,
  data: T,
  whySelected: string,
  selectedBy: CreativeContextItem["provenance"]["selectedBy"] = "canonical",
): CreativeContextItem<T> {
  return {
    id,
    kind,
    revision,
    title,
    data,
    provenance: {
      sourceId: id,
      sourceKind: kind,
      revision,
      whySelected,
      selectedBy,
    },
  };
}

export async function composeProjectCreativeContext(
  input: ComposeCreativeContextInput,
): Promise<ComposedProjectCreativeContext> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);

  const [
    storyRows,
    characters,
    looks,
    storyScenes,
    presets,
    props,
    assets,
    knowledge,
    boundTableIds,
    bindingState,
    shots,
    quota,
  ] = await Promise.all([
    db.select().from(schema.stories).where(eq(schema.stories.projectId, project.id)),
    db.select().from(schema.characters).where(eq(schema.characters.projectId, project.id)),
    db.select().from(schema.characterLooks).where(eq(schema.characterLooks.projectId, project.id)),
    db.select().from(schema.storyScenes).where(eq(schema.storyScenes.projectId, project.id)).orderBy(asc(schema.storyScenes.orderIndex)),
    db.select().from(schema.scenePresets).where(eq(schema.scenePresets.projectId, project.id)),
    db.select().from(schema.props).where(eq(schema.props.projectId, project.id)),
    db.select().from(schema.assets).where(and(eq(schema.assets.projectId, project.id), isNull(schema.assets.deletedAt))),
    db.select().from(schema.knowledge).where(and(eq(schema.knowledge.projectId, project.id), isNull(schema.knowledge.deletedAt))),
    listProjectBoundTableIds(project.id),
    input.persistBindings
      ? resolveStoryEntityBindings({ auth: input.auth, projectId: project.id, persist: true })
      : listStoryEntityBindings({ auth: input.auth, projectId: project.id }),
    db.select({
      id: schema.scenes.id,
      title: schema.scenes.title,
      orderIndex: schema.scenes.orderIndex,
      storySceneId: schema.scenes.storySceneId,
    }).from(schema.scenes).where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt))).orderBy(asc(schema.scenes.orderIndex)),
    loadQuotaConfig(input.auth.user.id, project.groupId).catch(() => null),
  ]);

  const story = storyRows[0] ?? null;
  const worldview = parseWorldviewSafe(project.worldview);
  const worldRules: CreativeContextItem[] = [];
  if (worldview.logline) {
    worldRules.push(item("worldview", project.id, "一句話故事", null, { text: worldview.logline }, "專案世界觀的 logline", "canonical"));
  }
  for (const taboo of worldview.taboos) {
    worldRules.push(item("worldview", project.id, "禁忌", null, { text: taboo }, "專案世界觀禁忌，生成必須遵守", "policy"));
  }
  if (worldview.styles[0]) {
    worldRules.push(item("worldview", project.id, "主風格", null, { styles: worldview.styles }, "專案已確認的視覺風格", "canonical"));
  }

  const latestLookByCharacter = new Map<string, typeof looks[number]>();
  for (const look of looks) {
    const prev = latestLookByCharacter.get(look.characterId);
    if (!prev || look.createdAt > prev.createdAt) latestLookByCharacter.set(look.characterId, look);
  }

  const characterItems = characters.map((row) => item("character", row.id, row.name, row.rev, {
    appearance: row.appearance,
    notes: row.notes,
    referenceAssetId: row.referenceAssetId,
  }, "專案角色卡，是不可變身分錨點"));

  const lookItems = looks.map((row) => item("character_look", row.id, row.name, row.rev, {
    characterId: row.characterId,
    costume: row.costume,
    notes: row.notes,
    referenceAssetId: row.referenceAssetId,
    current: latestLookByCharacter.get(row.characterId)?.id === row.id,
  }, latestLookByCharacter.get(row.characterId)?.id === row.id
    ? "此角色目前最新造型"
    : "歷史造型，保留供場景狀態選用"));

  const sceneItems = storyScenes.map((row) => item("scene", row.id, row.title || "未命名場", row.rev, {
    summary: row.summary,
    locationId: row.locationId,
    environment: row.environment,
    storyExcerpt: row.storyExcerpt,
  }, "故事場次與環境狀態"));

  const presetItems = presets.map((row) => item("scene_preset", row.id, row.name, row.rev, {
    palette: row.palette,
    lighting: row.lighting,
    referenceAssetId: row.referenceAssetId,
  }, "場景設定卡：色板與光線錨點"));

  const propItems = props.map((row) => item("prop", row.id, row.name, row.rev, {
    appearance: row.appearance,
    notes: row.notes,
    ownerKind: row.ownerKind,
    ownerId: row.ownerId,
    referenceAssetId: row.referenceAssetId,
  }, row.ownerId ? "專案道具，已標註歸屬" : "專案道具卡"));

  const assetItems = assets.slice(0, 80).map((row) => item("asset_revision", row.id, row.title, null, {
    kind: row.kind,
    locked: row.locked,
    isAiGenerated: row.isAiGenerated,
    sha256: row.sha256,
  }, row.locked ? "鎖定原素材，交付時必須保留" : "專案素材庫中的可用檔案"));

  const knowledgeItems = knowledge.map((row) => item("knowledge", row.id, row.title, null, {
    kind: row.kind,
    pinned: row.pinned,
    summary: row.summary,
  }, row.pinned ? "釘選知識，優先注入" : "專案知識庫條目"));

  const tableIds = [...boundTableIds];
  const tables = tableIds.length
    ? await db.select({
      id: schema.dataTables.id,
      name: schema.dataTables.name,
      scope: schema.dataTables.scope,
      groupId: schema.dataTables.groupId,
    }).from(schema.dataTables).where(and(
      inArray(schema.dataTables.id, tableIds),
      isNull(schema.dataTables.deletedAt),
    ))
    : [];
  const rowCounts = tables.length
    ? await db.select({
      tableId: schema.dataRows.tableId,
      n: sql<number>`count(*)`,
    }).from(schema.dataRows).where(inArray(schema.dataRows.tableId, tables.map((t) => t.id))).groupBy(schema.dataRows.tableId)
    : [];
  const countByTable = new Map(rowCounts.map((row) => [row.tableId, Number(row.n)]));
  const dataTables = tables
    .filter((table) => table.scope !== "personal")
    .filter((table) => !table.groupId || table.groupId === project.groupId)
    .map((table) => item("data_row", table.id, table.name, null, {
      tableId: table.id,
      scope: table.scope,
      rowCount: countByTable.get(table.id) ?? 0,
    }, "已綁到本專案的資料表（非整庫傾倒）", "retrieval"));

  let continuity: ComposedProjectCreativeContext["continuity"] = {
    previousShot: null,
    currentShot: null,
    nextShot: null,
  };
  if (input.shotId) {
    const idx = shots.findIndex((shot) => shot.id === input.shotId);
    if (idx >= 0) {
      const cur = shots[idx]!;
      if (cur && (!input.sceneId || cur.storySceneId === input.sceneId || !cur.storySceneId)) {
        continuity = {
          previousShot: shots[idx - 1] ? { id: shots[idx - 1]!.id, title: shots[idx - 1]!.title, orderIndex: shots[idx - 1]!.orderIndex } : null,
          currentShot: { id: cur.id, title: cur.title, orderIndex: cur.orderIndex },
          nextShot: shots[idx + 1] ? { id: shots[idx + 1]!.id, title: shots[idx + 1]!.title, orderIndex: shots[idx + 1]!.orderIndex } : null,
        };
      } else {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個分鏡" });
      }
    } else {
      throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個分鏡" });
    }
  } else if (input.sceneId) {
    const inScene = shots.filter((shot) => shot.storySceneId === input.sceneId);
    if (inScene[0]) {
      continuity.currentShot = { id: inScene[0].id, title: inScene[0].title, orderIndex: inScene[0].orderIndex };
      if (inScene[1]) continuity.nextShot = { id: inScene[1].id, title: inScene[1].title, orderIndex: inScene[1].orderIndex };
    }
  }

  const defaultImageModelId = "fal-ai/fast-lightning-sdxl";
  const defaultModel = getModel(defaultImageModelId);

  return {
    project: { id: project.id, title: project.title, groupId: project.groupId, format: project.format, rev: null },
    story: story
      ? item("story", story.id, "故事", story.rev, {
        content: story.content,
        lastParsedAt: story.lastParsedAt,
      }, "專案目前故事修訂")
      : null,
    worldRules,
    characters: characterItems,
    looks: lookItems,
    scenes: sceneItems,
    presets: presetItems,
    props: propItems,
    assets: assetItems,
    knowledge: knowledgeItems,
    dataTables,
    bindings: bindingState.bindings,
    proposals: bindingState.proposals,
    continuity,
    provider: {
      defaultImageModelId,
      defaultImageKind: defaultModel?.kind ?? "image",
      trainingConfigured: Boolean(process.env.FAL_KEY) && !isMockMode(),
      paidCallsAuthorized: false,
    },
    quota: {
      weeklyQuota: quota?.weeklyQuota ?? null,
      approvalThreshold: quota?.approvalThreshold ?? null,
    },
    summary: {
      characterCount: characterItems.length,
      lookCount: lookItems.length,
      sceneCount: sceneItems.length,
      propCount: propItems.length,
      assetCount: assetItems.length,
      knowledgeCount: knowledgeItems.length,
      pendingProposalCount: bindingState.proposals.length,
    },
  };
}

export function creativeContextCounts(ctx: ComposedProjectCreativeContext): {
  characters: number;
  looks: number;
  scenes: number;
  props: number;
  assets: number;
  knowledge: number;
  pending: number;
} {
  return {
    characters: ctx.summary.characterCount,
    looks: ctx.summary.lookCount,
    scenes: ctx.summary.sceneCount,
    props: ctx.summary.propCount,
    assets: ctx.summary.assetCount,
    knowledge: ctx.summary.knowledgeCount,
    pending: ctx.summary.pendingProposalCount,
  };
}

export type { StoryEntityKind };
