/**
 * 專案級權限（需求 2.3 v1）——疊在既有組隔離（requireGroup）之上的第二層守衛。
 * 語意（刻意極簡、完全向後相容）：
 * - project_members 無列 ＝ editor（預設組內全員可編輯——既有專案行為不變）。
 * - 組長把某人設為 viewer ＝ 該人在此專案唯讀：不能生成/改分鏡/改知識庫/改世界觀/跑工作流，
 *   仍可瀏覽、留言、送回饋、下載交付。
 * - 組長/團隊管理員/開發者永遠 editor（不受列影響）——裁決與管理不能被自己鎖住。
 * 佈線原則：只掛在「內容寫入」的 mutation 入口（各 router 逐點呼叫 assertProjectEditable），
 * 讀取路徑零改動。
 */
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { assertProjectAllows as assertProjectAllowsState } from "./projectState";

interface ProjectLike {
  id: string;
  groupId: string;
}

/** 此人在該專案的有效角色（先過組隔離；非本組直接 FORBIDDEN） */
export async function getProjectRole(auth: AuthState, project: ProjectLike): Promise<"editor" | "viewer"> {
  const groupRole = requireGroup(auth, project.groupId);
  if (groupRole !== "member") return "editor"; // 組長/管理員/開發者：永遠可編輯
  const [row] = await db
    .select({ role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .where(and(eq(schema.projectMembers.projectId, project.id), eq(schema.projectMembers.userId, auth.user.id)));
  return row?.role === "viewer" ? "viewer" : "editor"; // 無列＝editor（預設開放）
}

/** 內容寫入守衛：viewer 一律擋（人話訊息說明找誰解鎖）。
 *  註：封存專案的寫入凍結「不」放這裡——setArchived（還原）本身也呼叫本函式，放這裡會讓「還原」
 *  因專案當下仍是 archived 而被自己擋住（自鎖）。封存凍結改用 assertProjectNotArchived，掛在
 *  真正「發起新工作」的路徑（生成/排程/代理），與 scheduleCore／agentCore 同口徑。 */
export async function assertProjectEditable(auth: AuthState, project: ProjectLike): Promise<void> {
  if ((await getProjectRole(auth, project)) === "viewer") {
    throw new TRPCError({ code: "FORBIDDEN", message: "你在此專案是「檢視者」（唯讀）——要編輯請組長到專案權限卡調整" });
  }
}

/**
 * 封存／暫停專案寫入守衛（純同步，掛在核心層）：已封存或暫停的專案不接受「發起新工作」
 * （生成／代理計畫／排程…）。實作委派 projectState.assertProjectAllows（TD-03），
 * 訊息與既有 archived 人話保持相容。讀取類不呼叫本函式，照常放行。
 */
export function assertProjectNotArchived(project: { status: string }): void {
  assertProjectAllowsState(project, "generate");
}

/** TD-03：新程式碼優先用此名（read/write/generate/approve/restore/export） */
export { assertProjectAllows } from "./projectState";
