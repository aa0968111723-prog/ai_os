import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import {
  resolveOrAskAgentQuestion,
  type AgentQuestionDefinition,
  type AgentQuestionOption,
  type AgentQuestionResolution,
} from "../../shared/agentQuestions";
import { listResolvableModels } from "./modelResolve";
import { modelIsOperationallyReady } from "./aiModelPolicy";
import { loadGroupProjectInventory } from "./projectInventory";

export const QUESTION_PICKER_LIMIT = 100;

export function pickerInventoryCopy(listed: number, total: number, noun: string): { description: string; reason: string } {
  if (total <= 0) return { description: `目前沒有可用${noun}。`, reason: `缺少${noun}。` };
  if (listed >= total) {
    return {
      description: `找到 ${total} 個可用${noun}。`,
      reason: total > 1 ? `找到多個候選${noun}。` : `缺少${noun}。`,
    };
  }
  return {
    description: `找到 ${total} 個可用${noun}；此清單只展開 ${listed} 個，不得宣稱已列出全部。`,
    reason: `找到 ${total} 個候選${noun}，清單只展開 ${listed} 個。`,
  };
}

function entityQuestion(
  title: string,
  description: string,
  reason: string,
  slot: AgentQuestionDefinition["context"]["slot"],
  entityType: AgentQuestionDefinition["context"]["entityType"],
  questionType: AgentQuestionDefinition["questionType"] = "entity_picker",
): AgentQuestionDefinition {
  return {
    questionType,
    title,
    description,
    required: true,
    options: [],
    allowCustom: false,
    context: { reason, slot, entityType },
  };
}

/**
 * Trusted entity resolver for Human-in-the-loop questions. The model may say
 * which slot it needs; only this class is allowed to populate entity options.
 */
export class AgentQuestionResolver {
  static async resolveProjectQuestion(input: {
    auth: AuthState;
    groupId: string;
    currentProjectId?: string | null;
  }): Promise<AgentQuestionResolution> {
    requireGroup(input.auth, input.groupId);
    // Same archived filter + COUNT as website projects.list / Agent inventory.
    const inventory = await loadGroupProjectInventory(input.groupId);
    const rows = inventory.listed;
    const options: AgentQuestionOption[] = rows.map((row) => ({
      id: row.id,
      label: row.title,
      description: `${row.kind}・${row.platform}`,
      recommended: row.id === input.currentProjectId,
      metadata: { updatedAt: row.updatedAt.toISOString() },
    }));
    const copy = pickerInventoryCopy(rows.length, inventory.activeCount, "專案");
    let currentValue = rows.some((row) => row.id === input.currentProjectId) ? input.currentProjectId : undefined;
    if (!currentValue && input.currentProjectId) {
      const [hit] = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(
          eq(schema.projects.id, input.currentProjectId),
          eq(schema.projects.groupId, input.groupId),
          ne(schema.projects.status, "archived"),
        ));
      if (hit) currentValue = hit.id;
    }
    return resolveOrAskAgentQuestion({
      currentValue,
      candidates: options,
      question: entityQuestion(
        "選擇專案",
        inventory.activeCount
          ? `${copy.description.replace(/。$/, "")}，請選擇這次要在哪一個專案執行。`
          : "目前沒有可用專案，請先建立專案。",
        inventory.activeCount > 1 ? `${copy.reason.replace(/。$/, "")}，缺少 projectId。` : "缺少 projectId。",
        "projectId",
        "project",
      ),
    });
  }

  static async resolveSceneQuestion(input: {
    auth: AuthState;
    projectId: string;
    currentSceneId?: string | null;
  }): Promise<AgentQuestionResolution> {
    const project = await this.checkedProject(input.auth, input.projectId);
    const rows = await db
      .select({ id: schema.scenes.id, title: schema.scenes.title, orderIndex: schema.scenes.orderIndex, durationSec: schema.scenes.durationSec })
      .from(schema.scenes)
      .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)))
      .orderBy(asc(schema.scenes.orderIndex));
    const options = rows.map((row) => ({
      id: row.id,
      label: row.title || `第 ${row.orderIndex} 鏡`,
      description: `第 ${row.orderIndex} 鏡・${row.durationSec} 秒`,
      recommended: row.id === input.currentSceneId,
      metadata: { orderIndex: row.orderIndex, durationSec: row.durationSec },
    }));
    return resolveOrAskAgentQuestion({
      currentValue: rows.some((row) => row.id === input.currentSceneId) ? input.currentSceneId : undefined,
      candidates: options,
      question: entityQuestion("選擇分鏡", `找到 ${options.length} 個可用分鏡。`, "缺少 sceneId。", "sceneId", "scene", "scene_picker"),
    });
  }

  static async resolvePersonQuestion(input: {
    auth: AuthState;
    projectId: string;
    currentPersonId?: string | null;
  }): Promise<AgentQuestionResolution> {
    const project = await this.checkedProject(input.auth, input.projectId);
    const where = and(
      eq(schema.people.groupId, project.groupId),
      eq(schema.people.status, "active"),
      or(eq(schema.people.projectId, project.id), isNull(schema.people.projectId)),
    );
    const [rows, countRows] = await Promise.all([
      db
        .select({ id: schema.people.id, name: schema.people.name, projectId: schema.people.projectId })
        .from(schema.people)
        .where(where)
        .orderBy(asc(schema.people.name))
        .limit(QUESTION_PICKER_LIMIT),
      db.select({ n: sql<number>`count(*)` }).from(schema.people).where(where),
    ]);
    const total = Number(countRows[0]?.n ?? 0);
    const options = rows.map((row) => ({
      id: row.id,
      label: row.name,
      description: row.projectId === project.id ? "此專案人物" : "組織人物庫",
      recommended: row.id === input.currentPersonId,
    }));
    const copy = pickerInventoryCopy(rows.length, total, "人物");
    return resolveOrAskAgentQuestion({
      currentValue: rows.some((row) => row.id === input.currentPersonId) ? input.currentPersonId : undefined,
      candidates: options,
      question: entityQuestion("選擇人物", copy.description, total > 1 ? copy.reason : "缺少 personId。", "personId", "person", "person_picker"),
    });
  }

  static async resolveAssetQuestion(input: {
    auth: AuthState;
    projectId: string;
    currentAssetIds?: string[];
  }): Promise<AgentQuestionResolution> {
    const project = await this.checkedProject(input.auth, input.projectId);
    const where = and(eq(schema.assets.projectId, project.id), eq(schema.assets.groupId, project.groupId), isNull(schema.assets.deletedAt));
    const [rows, countRows] = await Promise.all([
      db
        .select({ id: schema.assets.id, title: schema.assets.title, kind: schema.assets.kind, mime: schema.assets.mime })
        .from(schema.assets)
        .where(where)
        .orderBy(desc(schema.assets.createdAt))
        .limit(QUESTION_PICKER_LIMIT),
      db.select({ n: sql<number>`count(*)` }).from(schema.assets).where(where),
    ]);
    const total = Number(countRows[0]?.n ?? 0);
    const validCurrent = (input.currentAssetIds ?? []).filter((id) => rows.some((row) => row.id === id));
    const options = rows.map((row) => ({
      id: row.id,
      label: row.title,
      description: [row.kind, row.mime].filter(Boolean).join("・"),
      recommended: validCurrent.includes(row.id),
    }));
    const copy = pickerInventoryCopy(rows.length, total, "素材");
    return resolveOrAskAgentQuestion({
      currentValue: validCurrent.length ? validCurrent : undefined,
      candidates: options,
      requiresHumanJudgment: rows.length > 1 || total > 1,
      question: {
        ...entityQuestion("選擇素材", copy.description, total > 1 ? copy.reason : "缺少 assetIds。", "assetIds", "asset", "asset_picker"),
        questionType: "multi_select",
      },
    });
  }

  static resolveModelQuestion(input: {
    auth: AuthState;
    groupId: string;
    currentModelId?: string | null;
    category?: string;
  }): AgentQuestionResolution {
    requireGroup(input.auth, input.groupId);
    const ready = listResolvableModels({ category: input.category }).filter(modelIsOperationallyReady);
    const rows = ready.slice(0, 60);
    const options: AgentQuestionOption[] = rows.map((model) => ({
      id: model.id,
      label: model.label,
      description: `${model.category}・約 ${model.points} 點`,
      recommended: model.id === input.currentModelId || (!input.currentModelId && !!model.recommended),
      metadata: { category: model.category, points: model.points, kind: model.kind },
    }));
    const copy = pickerInventoryCopy(rows.length, ready.length, "模型");
    return resolveOrAskAgentQuestion({
      currentValue: rows.some((model) => model.id === input.currentModelId) ? input.currentModelId : undefined,
      candidates: options,
      requiresHumanJudgment: options.length > 1 || ready.length > 1,
      question: entityQuestion("選擇生成模型", copy.description, ready.length > 1 ? copy.reason : "缺少 modelId。", "modelId", "model", "model_choice"),
    });
  }

  private static async checkedProject(auth: AuthState, projectId: string) {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, project.groupId);
    return project;
  }
}
