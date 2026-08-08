/**
 * 協作聚合的對外端點。
 *
 * 只有一支查詢，刻意如此：首頁協作區與協作中心問的是同一組問題
 * （誰在線／有什麼找我／哪裡有人在工作／哪些卡住／哪些專案在討論），
 * 拆成十幾支會讓手機端等最慢的那一支，而且同一條組隔離規則要寫十幾遍。
 *
 * 界線：資料全部來自既有系統（notifications／messages／project_tasks／realtime 房間），
 * 一張新表都沒有、一套新通知系統都沒有。這裡只做「聚合與排序」。
 */
import { z } from "zod";
import { router, authedProcedure, requireGroup } from "../trpc";
import { collaborationSummary } from "../services/collaborationSummary";

export const collaborationRouter = router({
  /**
   * 組層級協作摘要。groupId 不給時用使用者的第一個組
   * （Launchpad 的「目前這一組」語意，與該頁其他查詢一致）。
   */
  summary: authedProcedure
    .input(z.object({ groupId: z.string().uuid().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const groupId = input.groupId ?? ctx.auth.groups[0]?.groupId;
      // 沒有任何組＝還沒被加進團隊：回空摘要而不是報錯，首頁該顯示的是引導而不是紅字
      if (!groupId) {
        return {
          groupId: null,
          onlinePeers: [],
          unreadMentions: 0,
          unreadReplies: 0,
          openAnnotations: 0,
          myTasks: 0,
          pendingApprovals: 0,
          attention: [],
          threads: [],
          recentActivity: [],
          activeProjects: [],
        };
      }
      // 組隔離在這裡把關；服務層只負責聚合，不自己做 ACL
      requireGroup(ctx.auth, groupId);
      const summary = await collaborationSummary(ctx.auth.user.id, groupId);
      return { groupId, ...summary };
    }),
});
