/**
 * Project State Machine（TD-03）：專案生命週期對寫入的共同守衛。
 *
 * 狀態（現況 DB 以 text 存，預設 active；封存用 archived）：
 * - active：依權限可寫
 * - paused：可讀、可審核與恢復；禁止新生成與自動派工（預留；尚未全面上 UI 時行為等同 active 除非明確 paused）
 * - archived：唯讀；只允許匯出、查詢與恢復（setArchived）
 *
 * 與 projectAcl.assertProjectNotArchived 相容：assertProjectAllows(..., write) 涵蓋 archived；
 * 還原封存（setArchived → active）不應呼叫本函式的 write 守衛（與既有設計一致）。
 */
import { TRPCError } from "@trpc/server";

export type ProjectState = "active" | "paused" | "archived";

/** 正規化未知字串；空／未知視為 active（向後相容） */
export function normalizeProjectState(status: string | null | undefined): ProjectState {
  if (status === "archived") return "archived";
  if (status === "paused") return "paused";
  return "active";
}

/**
 * 專案狀態是否允許某類動作。
 * - read：永遠允許（含 archived）
 * - write：active only（paused/archived 擋）
 * - generate：等同 write（新生成／派工）
 * - approve：active 或 paused（封存不可再核准付費工作）
 * - restore：archived → 允許「還原」動作本身
 * - export：永遠允許（唯讀交付）
 */
export type ProjectStateAction = "read" | "write" | "generate" | "approve" | "restore" | "export";

export function projectStateAllows(status: string | null | undefined, action: ProjectStateAction): boolean {
  const state = normalizeProjectState(status);
  switch (action) {
    case "read":
    case "export":
      return true;
    case "restore":
      return state === "archived" || state === "paused";
    case "approve":
      // 封存專案不得再核准付費生成（與 generation.decideCost 既有守衛對齊）
      return state === "active" || state === "paused";
    case "write":
    case "generate":
      return state === "active";
    default:
      return false;
  }
}

export function assertProjectAllows(
  project: { status: string },
  action: ProjectStateAction,
): void {
  if (projectStateAllows(project.status, action)) return;
  const state = normalizeProjectState(project.status);
  if (state === "archived") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "此專案已封存——請先在網頁端還原專案，或改用其他專案",
    });
  }
  if (state === "paused") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "此專案已暫停——目前不能發起新生成或自動派工，請先恢復專案",
    });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "專案狀態不允許此操作" });
}
