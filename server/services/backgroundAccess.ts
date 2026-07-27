import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { loadAuthState } from "./auth";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";

export type BackgroundGroupRole = "admin" | "leader" | "member";

/**
 * 背景 runner 沒有 request context，執行每個新付費步驟前必須重算發起人「當下」角色。
 * 這份判定與 requireGroup 對齊，供工作流與 AI 代理共用，避免任一路徑漏掉成本核准門檻。
 */
export async function resolveBackgroundProjectRole(
  userId: string,
  projectId: string,
  subject = "背景工作",
): Promise<BackgroundGroupRole> {
  const auth = await loadAuthState(userId);
  if (!auth) {
    throw new TRPCError({ code: "FORBIDDEN", message: `發起人帳號已停用，${subject}無法繼續執行` });
  }
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: `專案不存在，${subject}無法繼續執行` });
  }
  assertProjectNotArchived(project);
  await assertProjectEditable(auth, project);

  if (auth.user.isSuperAdmin) return "admin";
  const membership = auth.groups.find((group) => group.groupId === project.groupId);
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: `發起人已不在此組，${subject}無法繼續執行` });
  }
  return membership.role;
}
