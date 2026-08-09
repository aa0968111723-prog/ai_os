/**
 * executeGenerationCommand（TD-02）：生成寫入的正式 Command 入口。
 *
 * 固定順序：
 * 1. 載入 actor／租戶（AuthState）
 * 2. 專案狀態機（assertProjectAllows generate）
 * 3. 組隔離 + 專案 ACL（editor）
 * 4. Policy Engine generation.submit
 * 5. 委託 submitGenerationCore（估點、門檻、扣點、provider）
 *
 * Router／MCP／workflow／agent 應優先走本 Command；Runner 內部續跑可帶 source=workflow|agent
 * 並在已通過建立 run 時沿用既有 assertAccess 薄殼。
 */
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

export type ExecuteGenerationInput = Omit<SubmitCoreInput, "assertAccess" | "userId"> & {
  auth: AuthState;
  source: PolicySource;
  /** 工作流／代理背景續跑：已在建立 run 時驗過權限時可 true，仍跑狀態機＋組隔離 */
  backgroundResume?: boolean;
};

/**
 * 人類／MCP 直接發起，或背景 resume。
 * 回傳 generation 列（含 awaiting_approval）。
 */
export async function executeGenerationCommand(input: ExecuteGenerationInput): Promise<GenerationRow> {
  const { auth, source, backgroundResume, ...core } = input;

  const generation = await submitGenerationCore({
    ...core,
    userId: auth.user.id,
    assertAccess: async (project) => {
      // 專案生命週期：封存／暫停不得新生成
      assertProjectAllows(project, "generate");

      const role = requireGroup(auth, project.groupId);
      const projectRole = await getProjectRole(auth, project);

      // 背景 resume：發起人可能已被降為 viewer——仍擋寫入（與「每步重查 ACL」方向一致）
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

  /**
   * Context Source Trace（§28 / §30）：這一鏡生成時，實際可用的脈絡是哪幾份。
   *
   * 之後「這張圖為什麼長這樣？」要答得出來——人物參考、場景參考、Style、Scene Script、
   * 前後鏡各是誰——靠的就是這一列 `context_resolution_runs`。
   *
   * ★ 刻意 fire-and-forget：追蹤是加法，任何失敗都不該讓一筆已經送出的生成失敗。
   * ★ 刻意不改 prompt 組裝與 provider payload：那條路徑另有既有的錨點機制與測試。
   */
  if (generation.sceneId) {
    void (async () => {
      const { resolveContext, recordContextResolution } = await import("./contextResolver");
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
        extraTrace: { generationId: generation.id, modelId: generation.modelId, prompt: generation.prompt.slice(0, 500) },
      });
    })().catch((error) => console.warn(
      "[generation] context trace skipped:",
      error instanceof Error ? error.message : error,
    ));
  }

  return generation;
}
