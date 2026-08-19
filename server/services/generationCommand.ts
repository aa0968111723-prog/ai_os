/**
 * executeGenerationCommand（TD-02）：生成寫入的正式 Command 入口。
 *
 * 固定順序：
 * 1. 載入 actor／租戶（AuthState）
 * 2. 專案狀態機（assertProjectAllows generate）
 * 3. 組隔離 + 專案 ACL（editor）
 * 4. Policy Engine generation.submit
 * 5. 若綁分鏡：同步 freeze Shot Context Packet，並在扣點前跑 consistency preflight
 * 6. 委託 submitGenerationCore（估點、門檻、扣點、provider）
 *
 * Scene-bound 視覺生成預設 preserveScenePointer：結果只當 Candidate，
 * 必須明確 Adopt 才改 current。
 */
import { TRPCError } from "@trpc/server";
import type { AuthState } from "./auth";
import { getProjectRole } from "./projectAcl";
import { assertProjectAllows } from "./projectState";
import {
  assertPolicy,
  policyContextFromAuth,
  type PolicySource,
} from "./policyEngine";
import { requireGroup } from "../trpc";
import {
  submitGenerationCore,
  type GenerationRow,
  type SubmitCoreInput,
} from "./generationCore";
import type { ShotContextPacketPayload } from "../../shared/shotContextPacket";
import {
  IDEMPOTENT_FAILED_GENERATION_RETRY,
  shouldReplayIdempotentGeneration,
} from "../../shared/generationIdempotency";

export type ExecuteGenerationInput = Omit<SubmitCoreInput, "assertAccess" | "userId"> & {
  auth: AuthState;
  source: PolicySource;
  /** 工作流／代理背景續跑：已在建立 run 時驗過權限時可 true，仍跑狀態機＋組隔離 */
  backgroundResume?: boolean;
  /** Reuse a packet frozen at batch/approval time. Do not rebuild from a later shot edit. */
  shotContextPacketId?: string;
};

function isVisualSceneBound(input: Pick<ExecuteGenerationInput, "sceneId" | "sceneRole">): boolean {
  return Boolean(input.sceneId) && (input.sceneRole ?? "visual") === "visual";
}

/**
 * 人類／MCP 直接發起，或背景 resume。
 * 回傳 generation 列（含 awaiting_approval）。
 */
export async function executeGenerationCommand(input: ExecuteGenerationInput): Promise<GenerationRow> {
  const { auth, source, backgroundResume, shotContextPacketId, ...core } = input;

  let frozen: { packetId: string; fingerprint: string; payload: ShotContextPacketPayload } | null = null;
  if (isVisualSceneBound(core) && core.sceneId) {
    const { freezeShotContextPacket, loadShotContextPacket } = await import("./shotContextPackets");
    const { preflightShotPacket } = await import("../../shared/consistencyEval");
    frozen = shotContextPacketId
      ? await loadShotContextPacket({
        auth,
        projectId: core.projectId,
        packetId: shotContextPacketId,
      })
      : await freezeShotContextPacket({
        auth,
        projectId: core.projectId,
        shotId: core.sceneId,
        modelId: core.modelId,
      });
    const preflight = preflightShotPacket(frozen.payload);
    if (!preflight.ok) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: preflight.issues[0]?.message ?? "這一鏡尚未準備好生成",
      });
    }

    // Execution-rights revalidation（closure §3）：重用凍結 packet 的路徑
    //（batch／agent approval resume）——packet 凍結時的 canon 授權可能已被撤回，
    // 送 provider 前重驗；權限失效直接擋，不 silent fallback、不偷 rebuild packet。
    if (shotContextPacketId) {
      const { revalidatePacketCanonRights, formatExecutionRightsError } = await import("./executionRights");
      const rightsBlockers = await revalidatePacketCanonRights({
        payload: frozen.payload,
        projectId: core.projectId,
      });
      if (rightsBlockers.length) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: formatExecutionRightsError(rightsBlockers),
        });
      }
    }

    // §13：影片一致性血緣——image-to-video 只能由「這一鏡已採用的畫面」或
    // 呼叫端明確指定的 parent 生成；不得退回角色卡湊圖（那正是換臉的來源）。
    const { getModel } = await import("../../shared/models");
    const { capabilityForModel } = await import("../../shared/providerCapabilities");
    const model = getModel(core.modelId);

    // §10：Canon 訓練成果（identity adapter）→ LoRA 模型的來源槽。
    // 這類模型 needs=zip：不在這裡填，needs gate 會在 adapter 能生效前就擋下；
    // 使用者自己給了來源（自選 LoRA）時尊重使用者，不覆蓋。
    const activeAdapter = frozen.payload.provider.activeAdapter;
    if (activeAdapter && !core.sourceUrl && !core.sourceAssetId
      && model && capabilityForModel(model).identityAdapterSupport) {
      core.sourceUrl = activeAdapter;
    }

    if (model && capabilityForModel(model).imageToVideo && !core.sourceAssetId && !core.sourceUrl) {
      const { db, schema } = await import("../db");
      const { and, eq, isNull } = await import("drizzle-orm");
      const [shotRow] = await db.select({ assetId: schema.scenes.assetId })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, core.sceneId), isNull(schema.scenes.deletedAt)));
      // current 必須真的是圖片才能當 i2v parent——current 已是影片時不能把影片餵給圖生影模型
      const [currentAsset] = shotRow?.assetId
        ? await db.select({ id: schema.assets.id, kind: schema.assets.kind })
          .from(schema.assets)
          .where(and(eq(schema.assets.id, shotRow.assetId), isNull(schema.assets.deletedAt)))
        : [];
      if (currentAsset?.kind === "image") {
        core.sourceAssetId = currentAsset.id; // 血緣預設：current 畫面就是影片的 parent
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: currentAsset
            ? "這一鏡目前的採用結果不是圖片——請明確指定要當影片來源的畫面"
            : "這一鏡還沒有已採用的畫面——先生成並採用一張畫面，或明確指定影片來源",
        });
      }
    }
  }

  const preserveScenePointer = core.preserveScenePointer ?? isVisualSceneBound(core);

  const generation = await submitGenerationCore({
    ...core,
    preserveScenePointer,
    shotContextPacketId: frozen?.packetId ?? shotContextPacketId,
    shotContextPacket: frozen?.payload,
    userId: auth.user.id,
    assertAccess: async (project) => {
      assertProjectAllows(project, "generate");

      const role = requireGroup(auth, project.groupId);
      const projectRole = await getProjectRole(auth, project);

      assertPolicy(
        "generation.submit",
        policyContextFromAuth(auth, {
          groupId: project.groupId,
          projectId: project.id,
          source: backgroundResume && (source === "workflow" || source === "agent") ? source : source,
          projectRole,
        }),
      );

      return role;
    },
  });

  if (generation.sceneId && frozen) {
    void (async () => {
      const { evaluateGenerationCandidate } = await import("../../shared/consistencyEval");
      const { preflightShotPacket } = await import("../../shared/consistencyEval");
      const { resolveContext, recordContextResolution } = await import("./contextResolver");
      const evaluation = evaluateGenerationCandidate({
        packet: frozen.payload,
        candidate: {
          prompt: generation.prompt,
          characterIds: generation.characterIds,
          lookIds: frozen.payload.looks.map((row) => row.id),
          scenePresetIds: generation.scenePresetIds,
          propIds: generation.propIds,
          status: generation.status,
        },
      });
      const context = await resolveContext({
        auth,
        projectId: generation.projectId,
        shotId: generation.sceneId,
        intent: generation.kind === "video" ? "video" : generation.kind === "audio" ? "audio" : "image",
        query: generation.prompt,
        budgetChars: 4_000,
      });
      await recordContextResolution({
        context,
        auth,
        intent: generation.kind === "video" ? "video" : generation.kind === "audio" ? "audio" : "image",
        shotId: generation.sceneId,
        extraTrace: {
          generationId: generation.id,
          modelId: generation.modelId,
          prompt: generation.prompt.slice(0, 500),
          shotContextPacketId: frozen.packetId,
          shotContextFingerprint: frozen.fingerprint,
          preflight: preflightShotPacket(frozen.payload),
          evaluation,
          adoptAllowed: evaluation.adoptAllowed,
          silentAdopt: false,
          preserveScenePointer,
          // closure §10：多角色路由決策落軌跡——「為什麼這一鏡用這顆模型、降了什麼級」
          // 可回答。決策不 silent 改模型（suggestedModelId 只是建議，由 UI 呈現）。
          multiCharacterRouting: await (async () => {
            const slotCount = frozen.payload.characterSlots?.length ?? frozen.payload.characters.length;
            if (slotCount <= 1) return null;
            const { routeMultiCharacterModel } = await import("../../shared/modelRouting");
            const { getModel: getModelById } = await import("../../shared/models");
            const { capabilityForModel: capOf } = await import("../../shared/providerCapabilities");
            const requested = getModelById(generation.modelId);
            if (!requested) return null;
            const { listResolvableModels } = await import("./modelResolve");
            const alternatives = listResolvableModels()
              .filter((row) => row.kind === requested.kind && row.id !== requested.id && row.verified)
              .slice(0, 40)
              .map((row) => ({ modelId: row.id, capability: capOf(row) }));
            return routeMultiCharacterModel({
              requestedModelId: requested.id,
              characterCount: slotCount,
              capability: capOf(requested),
              alternatives,
            });
          })().catch(() => null),
        },
      });
    })().catch((error) => console.warn(
      "[generation] context trace skipped:",
      error instanceof Error ? error.message : error,
    ));
  }

  // generateInto already refused a failed first send. MCP generate_into /
  // generation.submit / submit_generation still returned that failed row as
  // success — same silent no-op, other doors.
  if (!shouldReplayIdempotentGeneration(generation.status)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: IDEMPOTENT_FAILED_GENERATION_RETRY,
    });
  }
  return generation;
}
