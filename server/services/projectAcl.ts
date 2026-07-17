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

/** 內容寫入守衛：封存專案凍結寫入、viewer 一律擋（人話訊息說明找誰解鎖） */
export async function assertProjectEditable(auth: AuthState, project: ProjectLike): Promise<void> {
  // 封存＝軟刪除：凍結所有內容寫入路徑（生成/分鏡/知識庫/工作流…），否則拿舊 projectId 仍可對
  // 已封存專案生成並消耗組點數（滲透實測確認）。還原專案走 projects.setStatus，不經此守衛，不受影響。
  const [p] = await db
    .select({ status: schema.projects.status })
    .from(schema.projects)
    .where(eq(schema.projects.id, project.id));
  if (p?.status === "archived") {
    throw new TRPCError({ code: "FORBIDDEN", message: "此專案已封存——請先在專案頁還原，才能繼續編輯或生成" });
  }
  if ((await getProjectRole(auth, project)) === "viewer") {
    throw new TRPCError({ code: "FORBIDDEN", message: "你在此專案是「檢視者」（唯讀）——要編輯請組長到專案權限卡調整" });
  }
}

/**
 * 封存專案寫入守衛（純同步，掛在核心層）：已封存的專案不接受任何「發起新工作」的寫入
 * （生成／代理計畫／排程…）。放在 core 而非只在 MCP dispatcher，兩端（tRPC／MCP）一致——
 * 尤其擋外部 AI 客戶端拿舊 projectId 對已封存專案持續排代理／排程（網頁端靠清單濾掉封存，
 * MCP 手上是舊 id，需明確守門）。讀取類不呼叫本函式，照常放行。
 */
export function assertProjectNotArchived(project: { status: string }): void {
  if (project.status === "archived") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "此專案已封存——請先在網頁端還原專案，或改用其他專案" });
  }
}
