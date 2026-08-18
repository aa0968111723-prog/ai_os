import { z } from "zod";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, adminProcedure, requireGroup, requireLeader } from "../trpc";
import type { AuthState } from "../services/auth";
import { db, schema } from "../db";
import { getSettings, updateSettings, usedTotal, usedThisWeek, usedToday, effectiveDailyQuota, groupUsage, usedByGroup, usedByMember, loadQuotaConfig } from "../services/points";
import { getFalAccountBalance } from "../services/falBilling";
import { getFalPointsCeiling } from "../services/falCeiling";
import { canRunCommand, groupCommandLevelSchema, levelAtLeast, resolveCommandLevel, type GroupCommandLevel } from "../../shared/groupAgent";

/** 團隊管理權檢查（組預算是由上往下分配的，只有團隊管理員以上能調）：開發者或該組所屬團隊的 admin */
async function assertGroupTeamAdmin(auth: { user: { isSuperAdmin: boolean }; adminTeamIds: string[] }, groupId: string): Promise<void> {
  const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
  if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個組" });
  if (!auth.user.isSuperAdmin && !auth.adminTeamIds.includes(group.teamId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有團隊管理員以上能分配組預算" });
  }
}

/**
 * 對「某組員」分配額度/預算的授權：組長對其他組員即可；但對「自己」必須是團隊管理員以上。
 * 安全關鍵（自我提額防護）：setMemberOverride/setMemberBudget 只檢查 requireLeader 而未排除自我目標時，
 * 組長可 setMemberOverride({ userId: 自己, weeklyPointsOverride: 999999 }) 自抬週額度，架空團隊管理員
 * 設給他的個人上限（真金白銀的 fal 花費）。分配一律由上往下：自己的額度由上級調。
 */
async function assertCanAllocateToMember(
  auth: AuthState,
  groupId: string,
  targetUserId: string,
  /** 錯誤訊息裡的受詞（額度／預算之外，組代理指揮權也走同一把尺——見 setMemberCommandLevel） */
  subject = "額度／預算",
): Promise<void> {
  requireLeader(auth, groupId); // 需組長以上，且確認呼叫者屬於這個組
  // 大小寫無關比對（安全關鍵）：z.string().uuid() 接受大寫 UUID，而 Postgres uuid 比較大小寫無關，
  // 故大寫版的自己 id 仍會 UPDATE 到自己那列。若在此用大小寫敏感的 !== 比，攻擊者把自己 id 轉大寫即可
  // 讓「!==」成立而跳過下方團隊管理員閘門，達成自我提額。一律正規化成小寫再比。
  if (targetUserId.toLowerCase() !== auth.user.id.toLowerCase()) return; // 對其他組員：組長權限即可
  const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
  if (!auth.user.isSuperAdmin && !(group && auth.adminTeamIds.includes(group.teamId))) {
    throw new TRPCError({ code: "FORBIDDEN", message: `不能調整自己的${subject}——請由團隊管理員以上調整（分配是由上往下）` });
  }
}

/* ── 組代理指揮權（agent_command_level）的寫入規則 ──
 *
 * 這個欄位有兩個寫入端：新的 setMemberCommandLevel（四級）與舊的 setMemberDispatch（布林開關）。
 * 兩支都必須把「等級」與「舊布林」寫成同一個意思，否則兩套規則會分岔——而分岔的後果不是顯示錯字，
 * 是授權錯誤：resolveCommandLevel 的規則是「明確設過的等級優先，null 才退回讀布林」，
 * 所以只要有一支只寫其中一欄，就會出現「畫面上關掉了、後端仍放行」或反過來的落差。
 */

/**
 * 指揮權等級 → 舊布林 canDispatchAgent 該寫成什麼。
 *
 * 為什麼還要維護這個舊欄位：站內仍有直接讀 canDispatchAgent 的舊路徑（見 shared/groupAgent
 * 的 resolveCommandLevel fallback，以及尚未遷移的讀取面）。把它留在原地不動，會讓「等級降到 none
 * 但布林還是 true」的成員在那些路徑上照樣派得動工——降權失效是最不該無聲發生的事。
 * 關閉時寫 null 而非 false：沿用本欄「null＝未授權」的原始語意，不製造第二種「關」。
 */
export function dispatchFlagForLevel(level: GroupCommandLevel): true | null {
  return canRunCommand(level, "dispatch") ? true : null;
}

/**
 * 舊「可派工」開關的一次切換 → 該落庫的指揮權等級。
 *
 * 兩條規則都刻意不對稱，因為兩個方向的誤判代價不同：
 *  - 打開時**不降級**：組長已經把某人設成「可監督」，別人在舊 UI 按一下「派工權：開」，
 *    若無條件寫成 dispatch 就是把監督權默默收回——使用者按的是「開」，結果權限變小，沒有人會預期。
 *  - 關掉時一律寫 none：若只把布林設回 null 而留著 supervise，畫面顯示「關」但後端仍准他替別人核准
 *    並開始花點。收權必須是真的收權，寧可多收也不能假收。
 */
export function levelFromDispatchToggle(current: GroupCommandLevel, canDispatch: boolean): GroupCommandLevel {
  if (!canDispatch) return "none";
  return levelAtLeast(current, "dispatch") ? current : "dispatch";
}

/** 點數與額度管理（定案：不鎖死——開發者調全域、管理員調組、組長調成員） */
export const quotaRouter = router({
  /** 我的額度＋剩餘（頂欄徽章；groupId 用當前作用組） */
  my: authedProcedure.input(z.object({ groupId: z.string().uuid().optional() }).optional()).query(async ({ ctx, input }) => {
    const uid = ctx.auth.user.id;
    // 只在使用者確實屬於該組時才算組額度（舊版任意 groupId 都算，洩漏他組額度設定）
    const isMember = input?.groupId ? ctx.auth.groups.some((g) => g.groupId === input.groupId) : false;
    const gid = isMember ? input!.groupId! : null;
    // 本組成員：一次讀齊組態（settings＋組員列＋組列，取代舊版 getSettings＋effectiveWeeklyQuota
    // ＋memberBudget＋groupBudget＋額外 group 讀共數趟）；非成員只需全域設定（不讀他組列）。
    const cfg = gid ? await loadQuotaConfig(uid, gid) : null;
    const settings = cfg ? cfg.settings : await getSettings();
    // 用量 SUM 彼此獨立、純查詢（無交易/無鎖）——這是每次頁面載入的最熱路徑，並行讀縮短延遲。
    // member/group 累計只在真的設了對應預算上限時才查（沿用舊版「有 budget 才算 remaining」）。
    const [total, weekly, today, memberUsed, groupUsed] = await Promise.all([
      usedTotal(),
      usedThisWeek(uid, gid ?? undefined), // 週用量與守門同口徑：本組成員只算本組（週額度為每組上限）
      usedToday(uid),
      gid && cfg?.memberBudget != null ? usedByMember(uid, gid) : Promise.resolve(0),
      gid && cfg?.groupBudget != null ? usedByGroup(gid) : Promise.resolve(0),
    ]);
    const quota = cfg ? cfg.weeklyQuota : null;
    // 成本審核門檻（需求 2.1）：前端生成確認彈窗要提示「這筆需組長核准」——同樣只給本組成員看
    const approvalThreshold = cfg ? cfg.approvalThreshold : null;
    // 分配樹（累計上限）：個人預算 → 組預算——只給本組成員看自己的剩餘
    const memberBudgetRemaining = cfg?.memberBudget != null ? Math.max(0, cfg.memberBudget - memberUsed) : null;
    const groupBudgetRemaining = cfg?.groupBudget != null ? Math.max(0, cfg.groupBudget - groupUsed) : null;
    // 方案 C（#220）：可花點數硬上限對齊 Fal 台幣等值餘額。查不到（未設定／上游異常）→ null＝不套用
    //（fail-open，與 points.ts 的 falCeilingReason 同口徑；billing 與 FX 皆有快取，不打爆熱路徑）
    const ceiling = await getFalPointsCeiling();
    const falPointsCap = ceiling.ok ? ceiling.pointsCap : null;
    const budgetRemaining = settings.totalBudgetPoints != null && settings.totalBudgetPoints > 0
      ? Math.max(0, settings.totalBudgetPoints - total)
      : null;
    return {
      totalBudget: settings.totalBudgetPoints, // null＝不限
      totalUsed: total,
      /**
       * 站內總預算剩餘（cost_ledger 淨消耗）。不要跟 Fal 台幣等值上限取小——
       * 那是平台守門（reserveQuota / falCeilingReason），不是使用者的週／日已用。
       * 一次 1 點 generateInto 若重試打了 3 次 Fal，徽章「剩」會少 3、週已用只加 1。
       * null＝站內總預算不限（頂欄再跟個人／組預算取最緊）。
       */
      totalRemaining: budgetRemaining,
      /** null＝Fal 未設定或查詢失敗（不套硬上限；守門仍看這欄，不進「剩」） */
      falPointsCap,
      weeklyQuota: quota, // null＝不限
      weeklyUsed: weekly,
      dailyQuota: effectiveDailyQuota(settings), // null＝不限
      dailyUsed: today,
      approvalThreshold, // null＝不啟用成本審核門檻
      memberBudgetRemaining, // null＝個人無累計上限
      groupBudgetRemaining, // null＝組無累計上限
    };
  }),

  /** 全域設定（開發者改；管理員可看） */
  getSettings: adminProcedure.query(() => getSettings()),
  updateSettings: adminProcedure
    .input(
      z.object({
        totalBudgetPoints: z.number().int().min(0).max(1_000_000_000).nullable(),
        defaultWeeklyPoints: z.number().int().min(0).max(1_000_000_000).nullable(),
        defaultDailyPoints: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
        /** 資料庫文件每人儲存配額 GB（null＝預設 5；0＝不限） */
        fileQuotaGb: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.auth.user.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "只有開發者能調全域預算" });
      return updateSettings(input);
    }),

  /**
   * 平台 Fal 帳戶 credits 餘額（USD）——僅開發者（isSuperAdmin）。
   * 唯讀 query，不記審計；金鑰永不進回傳。錯誤以 ok:false 結構化回傳，不拋 TRPC（除權限）。
   * 見 docs/product/fal-balance-and-personal-usage-plan.md
   */
  falAccountBalance: adminProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.auth.user.isSuperAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有開發者能查看平台 Fal 帳戶餘額" });
      }
      const force = input?.force === true;
      const billing = await getFalAccountBalance({ force });
      if (!billing.ok) return billing;
      // 方案 C（#220）：USD 之外並陳台幣等值與可花點數上限（1 點＝NT$1）
      const ceiling = await getFalPointsCeiling({ force });
      return {
        ...billing,
        balanceTwd: ceiling.ok ? Math.round(billing.balance * ceiling.rate) : null,
        rate: ceiling.ok ? ceiling.rate : null,
        rateSource: ceiling.ok ? ceiling.rateSource : null,
        pointsCap: ceiling.ok ? ceiling.pointsCap : null,
      };
    }),

  /** 組週額度（團隊管理/組長可調；0 或空＝不限） */
  setGroupQuota: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), weeklyPointsPerUser: z.number().int().min(0).max(1_000_000_000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      // 修 R3-BINV-02：改需團隊管理員以上（比照 setGroupBudget「分配由上往下」）。原本只 requireLeader，
      // 組長可拉高全組週額度；因生效額度 fallback 為「個人覆寫→組→全域」，沒有個人 override 的組長等於
      // 抬高自己的週上限，繞過 setMemberOverride 的自我提額防護。組長對「個別組員」的分配仍走 setMemberOverride。
      await assertGroupTeamAdmin(ctx.auth, input.groupId);
      await db.update(schema.groups).set({ weeklyPointsPerUser: input.weeklyPointsPerUser }).where(eq(schema.groups.id, input.groupId));
      return { ok: true };
    }),

  /** 組總預算（累計上限）：開發者/團隊管理員分配給組的點數池；0 或空＝不限。組長不可調（分配是由上往下） */
  setGroupBudget: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), budgetPoints: z.number().int().min(0).max(1_000_000_000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertGroupTeamAdmin(ctx.auth, input.groupId);
      // 0 一律正規化成 null（不限）——守門處只判 null，不用兩套「不限」語意
      const value = input.budgetPoints && input.budgetPoints > 0 ? input.budgetPoints : null;
      await db.update(schema.groups).set({ budgetPoints: value }).where(eq(schema.groups.id, input.groupId));
      return { ok: true, budgetPoints: value };
    }),

  /** 組員個人預算（累計上限）：組長從組預算再分配給組員；0 或空＝不限。組長對自己組員調 */
  setMemberBudget: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), userId: z.string().uuid(), budgetPoints: z.number().int().min(0).max(1_000_000_000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanAllocateToMember(ctx.auth, input.groupId, input.userId); // 組長對他人即可；對自己需團隊管理員以上
      const value = input.budgetPoints && input.budgetPoints > 0 ? input.budgetPoints : null;
      const updated = await db
        .update(schema.groupMembers)
        .set({ budgetPoints: value })
        .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.userId)))
        .returning({ id: schema.groupMembers.id });
      if (updated.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "這位成員不在這個組" });
      return { ok: true, budgetPoints: value };
    }),

  /** 成本審核門檻（需求 2.1）：組員單筆生成估點 ≥ 門檻需組長核准；0/null＝不啟用。組長以上可調 */
  setApprovalThreshold: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), thresholdPoints: z.number().int().min(0).max(1_000_000_000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      requireLeader(ctx.auth, input.groupId);
      // 0 一律正規化成 null（不啟用）——守門處只需判 null，不用兩套「關閉」語意
      const value = input.thresholdPoints && input.thresholdPoints > 0 ? input.thresholdPoints : null;
      await db.update(schema.groups).set({ approvalThresholdPoints: value }).where(eq(schema.groups.id, input.groupId));
      return { ok: true, thresholdPoints: value };
    }),

  /**
   * 組代理指揮權等級（分級授權的唯一設定入口）：組長對個別組員設 none／dispatch／supervise／command。
   *
   * 為什麼需要這支：等級已經落庫並在 L1/L2/L3 全面生效，但先前只有一支布林 mutation，
   * 於是「可監督」以上根本沒有任何管道設得出來——後端做完的分級授權對一般組員等於不存在。
   *
   * 守門刻意沿用 assertCanAllocateToMember（與個人預算／週額度同一把尺）：組長對別的組員即可，
   * 對「自己」需團隊管理員以上。後者不是形式主義——supervise 以上能替別人核准子計畫，
   * 也就是能直接開始花真金白銀的點；讓被授權者自己往上調等於把提權的鑰匙交到他手上。
   * （組長角色本身恆為 command、不看此欄，但他隨時可能被降成組員，屆時這個自設值就會生效。）
   */
  setMemberCommandLevel: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), userId: z.string().uuid(), level: groupCommandLevelSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertCanAllocateToMember(ctx.auth, input.groupId, input.userId, "組代理指揮權");
      const canDispatch = dispatchFlagForLevel(input.level);
      const updated = await db
        .update(schema.groupMembers)
        // 兩欄一起寫：只寫等級的話，舊讀取路徑仍看得到相反的布林（見上方寫入規則註解）
        .set({ agentCommandLevel: input.level, canDispatchAgent: canDispatch })
        .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.userId)))
        .returning({ id: schema.groupMembers.id });
      if (updated.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "這位成員不在這個組" });
      return { ok: true, level: input.level, canDispatch: canDispatch === true };
    }),

  /** 團隊代理派工授權（需求 12 v2）：組長對個別組員開/關「用組彙總 AI 派工到專案」的權。
   *  組長以上本就有派工權、不需也不受此欄影響——只對 role='member' 的成員有意義。
   *
   *  分級授權上線後這支**只是 setMemberCommandLevel 的粗糙版**（開＝至少 dispatch、關＝none），
   *  保留是因為既有 UI（組長「監控與紀錄」頁點數分配卡的派工權按鈕）與外部呼叫仍在用它，直接刪掉會讓那些入口壞掉。
   *  但它不能只寫布林：resolveCommandLevel 以「明確設過的等級」優先，舊布林只是 null 時的退路，
   *  所以只寫布林的話，一位已被設成 supervise 的組員按下「關」之後，後端仍會讓他替別人核准並花點——
   *  開關變成謊言。故一律折算成等級一起寫（見 levelFromDispatchToggle 的兩條不對稱規則）。 */
  setMemberDispatch: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), userId: z.string().uuid(), canDispatch: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // 守門與 setMemberCommandLevel 完全一致（含「不能改自己」）：兩支寫同樣的欄位，
      // 若守門寬嚴不同，攻擊者只要挑寬的那支下手，嚴的那支就白設了。
      await assertCanAllocateToMember(ctx.auth, input.groupId, input.userId, "組代理指揮權");
      const [member] = await db
        .select({ agentCommandLevel: schema.groupMembers.agentCommandLevel, canDispatchAgent: schema.groupMembers.canDispatchAgent, role: schema.groupMembers.role })
        .from(schema.groupMembers)
        .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.userId)));
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "這位成員不在這個組" });
      // 以「這位成員目前的實際等級」為基準折算：對組長讀出來的是 command，但那來自角色而非欄位，
      // 這裡只在乎欄位值，故一律以 member 身分解析（組長本來就不看此欄）。
      const current = resolveCommandLevel("member", member);
      const level = levelFromDispatchToggle(current, input.canDispatch);
      await db
        .update(schema.groupMembers)
        .set({ agentCommandLevel: level, canDispatchAgent: dispatchFlagForLevel(level) })
        .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.userId)));
      return { ok: true, canDispatch: input.canDispatch, level };
    }),

  /** 個別成員覆寫（組長對自己組員微調） */
  setMemberOverride: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), userId: z.string().uuid(), weeklyPointsOverride: z.number().int().min(0).max(1_000_000_000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanAllocateToMember(ctx.auth, input.groupId, input.userId); // 組長對他人即可；對自己需團隊管理員以上（防自抬額度）
      await db
        .update(schema.groupMembers)
        .set({ weeklyPointsOverride: input.weeklyPointsOverride })
        .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.userId)));
      return { ok: true };
    }),

  /** 組用量儀表（組長/管理層）＋點數分配狀態（組預算、各組員分配額與累計用量） */
  usage: authedProcedure.input(z.object({ groupId: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireLeader(ctx.auth, input.groupId);
    const usage = await groupUsage(input.groupId); // 只含有帳本的成員（weekly/total）
    const usageByUser = new Map(usage.map((u) => [u.userId, u]));
    const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
    const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, input.groupId));
    // 全體組員（含零用量者，才能對還沒花點的人分配預算）＋各自個人預算與角色
    const members = await db.select().from(schema.groupMembers).where(eq(schema.groupMembers.groupId, input.groupId));
    const rows = members.map((m) => {
      const u = usageByUser.get(m.userId);
      // 組代理指揮權：設定 UI 要顯示目前等級（沒有回傳就只能顯示布林，四級選單永遠選不到正確的現值）。
      // canDispatch 一律由等級推導，不再自己判斷布林——否則一位設成 supervise 但舊布林仍為 null 的組員，
      // 會在畫面上顯示「不可派工」而後端放行，兩邊各說各話。
      const commandLevel = resolveCommandLevel(m.role, m);
      return {
        userId: m.userId,
        name: users.find((x) => x.id === m.userId)?.name ?? "?",
        role: m.role,
        weekly: u?.weekly ?? 0,
        total: u?.total ?? 0, // 累計淨消耗——個人預算的分母
        weeklyOverride: m.weeklyPointsOverride ?? null, // null＝跟組
        budget: m.budgetPoints ?? null, // null＝不限（未分配個人預算）
        /** 組代理指揮權等級（組長以上恆為 command，不看欄位） */
        commandLevel,
        // 團隊代理派工授權（組長以上本就可派，此旗標只對一般組員有意義；null/false＝未授權）
        canDispatch: canRunCommand(commandLevel, "dispatch"),
      };
    });
    const allocated = rows.reduce((s, r) => s + (r.budget ?? 0), 0); // 已分配給組員的個人預算總和
    return {
      groupQuota: group?.weeklyPointsPerUser ?? null,
      /** 成本審核門檻（需求 2.1）：組長設定 UI 讀這裡 */
      approvalThreshold: group?.approvalThresholdPoints ?? null,
      /** 組預算（累計上限；null＝不限）＋組累計用量＋已分配給組員的總和——分配 UI 的「還剩多少可分」用 */
      groupBudget: group?.budgetPoints ?? null,
      groupUsed: await usedByGroup(input.groupId),
      allocated,
      rows,
    };
  }),

  /**
   * 點數消耗監控（盲點修補：無成本異常告警）——管理／組長儀表資料源。
   * 口徑一律「毛消耗」＝只加總扣點列（delta<0 取絕對值），退點「不」抵銷：
   * 監控要看的是「實際發動了多少花費」；若讓退點沖銷扣點，大量失敗重試的異常日
   * （正是最該被看見的日子）在淨額口徑下反而近乎隱形。
   * （額度守門的 usedThisWeek 是淨額口徑且退點跟隨生成週，兩者用途不同，屬刻意差異。）
   * 日界採台北時區：比照 points.ts 的 TPE_OFFSET 平移法，(created_at + interval '8 hours')::date 即台北日期。
   * 可見界：比照 audit.list——開發者看全站；組長／團隊管理員看自己「非純組員」身分的組（組長也看得到）。
   * 用 authedProcedure（非 adminProcedure）：組長沒有團隊管理權，adminProcedure 會把他擋在門外。
   */
  consumptionStats: authedProcedure
    .input(z.object({ days: z.number().int().min(7).max(30).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 14;

      // 可見範圍比照 audit.list：開發者看全站；組長／管理員只看自己「非純組員」（leader／admin）身分的組。
      // loadAuthState 已把管理的團隊展開成 admin 組員資格，故這裡一律用 role !== "member" 收斂即可。
      let visibleGroupIds: string[] | null = null; // null＝不過濾（全站，僅開發者）
      if (!ctx.auth.user.isSuperAdmin) {
        visibleGroupIds = ctx.auth.groups.filter((g) => g.role !== "member").map((g) => g.groupId);
        if (visibleGroupIds.length === 0) {
          // 純組員（或無可管組的管理員）：回空資料（不拋錯，讓 UI 顯示「沒有可監控的組」即可）
          return {
            perDay: [] as Array<{ date: string; points: number }>,
            todayPoints: 0,
            avg7: 0,
            alert: false,
            byGroup: [] as Array<{
              groupId: string;
              groupName: string;
              weekPoints: number;
              members: Array<{ userId: string; name: string; weekPoints: number }>;
              projects: Array<{ projectId: string; title: string; weekPoints: number }>;
            }>,
          };
        }
      }
      const groupCond = visibleGroupIds ? [inArray(schema.costLedger.groupId, visibleGroupIds)] : [];

      // 台北日界（同 points.ts dayStart 的平移法）：+8h 後用 UTC 欄位讀到的就是台北牆鐘時間
      const TPE_OFFSET_MS = 8 * 60 * 60 * 1000;
      const DAY_MS = 24 * 60 * 60 * 1000;
      const tpeToday = new Date(Date.now() + TPE_OFFSET_MS);
      tpeToday.setUTCHours(0, 0, 0, 0); // 平移座標系裡的「台北今日 00:00」
      // avg7 要「不含今天的前 7 個整天」——即使只畫 7 天圖也得撈滿 8 天才夠算
      const fetchDays = Math.max(days, 8);
      const sinceUtc = new Date(tpeToday.getTime() - (fetchDays - 1) * DAY_MS - TPE_OFFSET_MS); // 平移回真 UTC 時刻

      // 逐日毛消耗：SQL 一次聚合撈回（只回有紀錄的日子，缺日在下面補 0）
      const tpeDay = sql<string>`to_char((${schema.costLedger.createdAt} + interval '8 hours')::date, 'YYYY-MM-DD')`;
      const gross = sql<number>`sum(case when ${schema.costLedger.delta} < 0 then -${schema.costLedger.delta} else 0 end)`;
      const dailyRows = await db
        .select({ date: tpeDay, points: gross })
        .from(schema.costLedger)
        .where(and(gte(schema.costLedger.createdAt, sinceUtc), ...groupCond))
        .groupBy(tpeDay);
      const byDate = new Map(dailyRows.map((r) => [r.date, Number(r.points)]));

      // 補齊整段日期（含 0 消耗日），前端長條圖才不會缺格
      const series: Array<{ date: string; points: number }> = [];
      for (let i = fetchDays - 1; i >= 0; i--) {
        const key = new Date(tpeToday.getTime() - i * DAY_MS).toISOString().slice(0, 10); // 平移座標系直接讀＝台北日期
        series.push({ date: key, points: byDate.get(key) ?? 0 });
      }
      const todayPoints = series[series.length - 1]?.points ?? 0;
      const avg7Raw = series.slice(-8, -1).reduce((s, d) => s + d.points, 0) / 7; // 不含今天的前 7 天平均
      // 異常門檻：今日毛消耗 > max(50, 前 7 日均值 × 3)。50 點下限避免「均值趨近 0、今天才幾點」的假警報
      const alert = todayPoints > Math.max(50, avg7Raw * 3);

      // 各組近 7 天（含今天）毛消耗，高到低——告警時可快速定位是哪個組在燒
      const weekSinceUtc = new Date(tpeToday.getTime() - 6 * DAY_MS - TPE_OFFSET_MS);
      const weekCond = and(gte(schema.costLedger.createdAt, weekSinceUtc), ...groupCond);
      const groupRows = await db
        .select({ groupId: schema.costLedger.groupId, groupName: schema.groups.name, weekPoints: gross })
        .from(schema.costLedger)
        .leftJoin(schema.groups, eq(schema.groups.id, schema.costLedger.groupId))
        .where(weekCond)
        .groupBy(schema.costLedger.groupId, schema.groups.name);

      // 再細節一點：各組再往下拆到「成員近 7 天」毛消耗——組長要看得出是組裡「誰」在燒點，
      // 而不只是一個組總數。與 groupRows 同時段、同可見界，前端把成員掛回各自的組即可。
      const memberRows = await db
        .select({ groupId: schema.costLedger.groupId, userId: schema.costLedger.userId, name: schema.users.name, weekPoints: gross })
        .from(schema.costLedger)
        .leftJoin(schema.users, eq(schema.users.id, schema.costLedger.userId))
        .where(weekCond)
        .groupBy(schema.costLedger.groupId, schema.costLedger.userId, schema.users.name);
      // 依 groupId 收成 map：只留真的有毛消耗（>0）的成員，組內由高到低
      const membersByGroup = new Map<string, Array<{ userId: string; name: string; weekPoints: number }>>();
      for (const r of memberRows) {
        const pts = Number(r.weekPoints);
        if (pts <= 0) continue; // 只退點/淨零的成員不列（避免一排 0 稀釋重點）
        const list = membersByGroup.get(r.groupId) ?? [];
        list.push({ userId: r.userId, name: r.name ?? "（已離開的成員）", weekPoints: pts });
        membersByGroup.set(r.groupId, list);
      }
      for (const list of membersByGroup.values()) list.sort((a, b) => b.weekPoints - a.weekPoints);

      // 再往下一個維度：各組再拆到「專案近 7 天」毛消耗——組長要看得出組裡「哪個專案」在燒點。
      // 走 generationId → generations.projectId → projects.title：只有生成有帳可歸的消耗會計入
      // （手動增減等無 generationId 的列不歸專案），故專案小計可能少於組總數，屬正常。
      const projectRows = await db
        .select({ groupId: schema.costLedger.groupId, projectId: schema.generations.projectId, title: schema.projects.title, weekPoints: gross })
        .from(schema.costLedger)
        .innerJoin(schema.generations, eq(schema.generations.id, schema.costLedger.generationId))
        .leftJoin(schema.projects, eq(schema.projects.id, schema.generations.projectId))
        .where(weekCond)
        .groupBy(schema.costLedger.groupId, schema.generations.projectId, schema.projects.title);
      const projectsByGroup = new Map<string, Array<{ projectId: string; title: string; weekPoints: number }>>();
      for (const r of projectRows) {
        const pts = Number(r.weekPoints);
        if (pts <= 0) continue; // 只退點/淨零的專案不列
        const list = projectsByGroup.get(r.groupId) ?? [];
        list.push({ projectId: r.projectId, title: r.title ?? "（已刪除的專案）", weekPoints: pts });
        projectsByGroup.set(r.groupId, list);
      }
      for (const list of projectsByGroup.values()) list.sort((a, b) => b.weekPoints - a.weekPoints);

      const byGroup = groupRows
        .map((r) => ({
          groupId: r.groupId,
          groupName: r.groupName ?? "（已不存在的組）",
          weekPoints: Number(r.weekPoints),
          members: membersByGroup.get(r.groupId) ?? [],
          projects: projectsByGroup.get(r.groupId) ?? [],
        }))
        .sort((a, b) => b.weekPoints - a.weekPoints);

      return {
        perDay: series.slice(-days),
        todayPoints,
        avg7: Math.round(avg7Raw * 10) / 10, // 顯示用取 1 位小數；alert 已用原始均值判定
        alert,
        byGroup,
      };
    }),
});
