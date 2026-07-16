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

/** 內容寫入守衛：viewer 一律擋（人話訊息說明找誰解鎖） */
export async function assertProjectEditable(auth: AuthState, project: ProjectLike): Promise<void> {
  if ((await getProjectRole(auth, project)) === "viewer") {
    throw new TRPCError({ code: "FORBIDDEN", message: "你在此專案是「檢視者」（唯讀）——要編輯請組長到專案權限卡調整" });
  }
}
