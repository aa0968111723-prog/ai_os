import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import {
  contextBindableDenyReason,
  resolveContextScope,
  upsertContextBinding,
} from "./contextBindings";

export interface VerifiedAssetBindingResult {
  projectId: string;
  shotId: string;
  assetIds: string[];
  bindingIds: string[];
  verification: { status: "verified" | "unverified"; message: string };
}

/**
 * Agent-owned Shot attachment adapter over the existing Context Binding core.
 * Every client/result id is reloaded under the actor's ACL before writing, and
 * completion is based on a second database read rather than mutation success.
 */
export async function attachAssetsToShotVerified(input: {
  auth: AuthState;
  projectId: string;
  shotId: string;
  assetIds: readonly string[];
}): Promise<VerifiedAssetBindingResult> {
  const assetIds = [...new Set(input.assetIds)].slice(0, 50);
  if (!assetIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "沒有可加入的素材" });

  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(input.auth, project.groupId);
  assertProjectNotArchived(project);
  await assertProjectEditable(input.auth, project);
  const scope = await resolveContextScope({ project, scopeType: "shot", scopeId: input.shotId });

  const bindingIds: string[] = [];
  for (const assetId of assetIds) {
    const denied = await contextBindableDenyReason(input.auth, {
      resourceKind: "asset",
      resourceId: assetId,
      project,
    });
    if (denied) throw new TRPCError({ code: denied.startsWith("找不到") ? "NOT_FOUND" : "FORBIDDEN", message: denied });
    const binding = await upsertContextBinding({
      auth: input.auth,
      scope,
      resourceKind: "asset",
      resourceId: assetId,
      role: "PRODUCTION_ASSET",
      priority: "SECONDARY",
      confirmedByUser: true,
    });
    bindingIds.push(binding.id);
  }

  const readBack = await db.select({
    id: schema.contextBindings.id,
    resourceId: schema.contextBindings.resourceId,
  }).from(schema.contextBindings).where(and(
    eq(schema.contextBindings.projectId, project.id),
    eq(schema.contextBindings.scopeType, "shot"),
    eq(schema.contextBindings.scopeId, scope.scopeId),
    eq(schema.contextBindings.resourceKind, "asset"),
    eq(schema.contextBindings.role, "PRODUCTION_ASSET"),
    eq(schema.contextBindings.confirmedByUser, true),
    inArray(schema.contextBindings.resourceId, assetIds),
  ));
  const verifiedIds = new Set(readBack.map((row) => row.resourceId));
  const verified = assetIds.every((id) => verifiedIds.has(id));
  return {
    projectId: project.id,
    shotId: scope.scopeId,
    assetIds,
    bindingIds,
    verification: verified
      ? { status: "verified", message: "已重新讀取並確認素材綁定" }
      : { status: "unverified", message: "操作已送出，但重新讀取未確認全部素材綁定" },
  };
}

