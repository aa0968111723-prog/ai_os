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
  }

  const preserveScenePointer = core.preserveScenePointer ?? isVisualSceneBound(core);

  const generation = await submitGenerationCore({
    ...core,
    preserveScenePointer,
    shotContextPacketId: frozen?.packetId ?? shotContextPacketId,
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
        },
      });
    })().catch((error) => console.warn(
      "[generation] context trace skipped:",
      error instanceof Error ? error.message : error,
    ));
  }

  return generation;
}
