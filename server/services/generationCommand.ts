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

  return submitGenerationCore({
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
}
