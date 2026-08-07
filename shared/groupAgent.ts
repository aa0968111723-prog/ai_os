import { z } from "zod";
import { agentPlannerModeSchema } from "./agentPlanner";

/**
 * 組代理總指揮（group agent commander）的共用契約。
 *
 * 為什麼要有這一層：組代理原本只有「唯讀分析＋提議派工」，能看到全組出事、卻碰不了任何一份
 * 專案代理計畫——看得到一份計畫失敗不能重跑、看得到三份待核堵著不能核准也不能撤、看得到誰逾期
 * 不能改期。專案代理才是唯一會動手的角色，組代理反而比它弱。
 *
 * 這裡定義三層能力的型別與純規則，前後端共用：
 *  L1 監督權（supervise）：跨專案核准／停止／放棄／重跑子計畫。
 *  L2 調度權（supervise）：批次派工、指派與改期人類任務。
 *  L3 常駐總指揮（command）：組代理有自己的計畫（campaign）＋步驟＋事件軌跡＋背景執行器，
 *     派完工會自己盯著子計畫，失敗會在授權範圍內補救，超出授權就停下來等人。
 *
 * 所有實際落地仍走既有的專案守門（planAgentCore／approveAgentCore／…）——這一層只決定
 * 「誰可以下令」與「下了什麼令」，不另造一套繞過 ACL 的捷徑。
 */

/* ── 能力分級 ── */

/**
 * 組代理指揮權等級（由高到低涵蓋：command ⊃ supervise ⊃ dispatch ⊃ none）。
 *
 * 刻意不沿用單一布林 `canDispatchAgent`：那個欄位只回答「能不能生出一份待核計畫」，
 * 而「能不能替別人核准並開始花點」「能不能讓組代理在無人盯著時自己補救」是完全不同量級的授權，
 * 折在同一個布林裡等於把最貴的權限偷偷送出去。
 */
export const groupCommandLevelSchema = z.enum(["none", "dispatch", "supervise", "command"]);
export type GroupCommandLevel = z.infer<typeof groupCommandLevelSchema>;

/** 等級排序（數字只用於比較，不落庫） */
const LEVEL_RANK: Record<GroupCommandLevel, number> = { none: 0, dispatch: 1, supervise: 2, command: 3 };

/** 至少具備某等級（唯一的比較出處；露出面與執行面共用，兩邊不會分岔） */
export function levelAtLeast(level: GroupCommandLevel, required: GroupCommandLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[required];
}

/**
 * 角色＋授權欄位 → 指揮權等級（純規則，DB 取值後套用）。
 *
 * 組長／團隊管理員／開發者恆為 command：他們本來就能在各專案頁做完全部這些事，
 * 組代理只是把同一組動作換個入口，不該因為換入口而變得更嚴或更鬆。
 * 一般組員讀 `agentCommandLevel`；沒設過的（欄位剛上線）退回舊布林 `canDispatchAgent`，
 * 讓既有授權不會在 migration 當下無聲失效。
 */
export function resolveCommandLevel(
  role: "admin" | "leader" | "member",
  member: { agentCommandLevel?: GroupCommandLevel | string | null; canDispatchAgent?: boolean | null } | null | undefined,
): GroupCommandLevel {
  if (role !== "member") return "command";
  const explicit = member?.agentCommandLevel;
  if (typeof explicit === "string") {
    const parsed = groupCommandLevelSchema.safeParse(explicit);
    if (parsed.success) return parsed.data;
  }
  return member?.canDispatchAgent === true ? "dispatch" : "none";
}

/** 組代理可下的指令種類（ask 會提議、UI 會按、campaign 會自己用） */
export const groupCommandKindSchema = z.enum([
  "create_project", // 在組內開一個新專案（沒有既有專案可派工時的第一步）
  "dispatch",      // 在某專案發起代理計畫（建立待核計畫）
  "approve_run",   // 核准某份待核子計畫（這一刻起才開始花點）
  "stop_run",      // 停止執行中／等待中的子計畫
  "discard_run",   // 放棄尚未核准的子計畫
  "retry_run",     // 以同一目標重新規劃一份（原計畫失敗／被停止時）
  "assign_task",   // 指派、改期或改優先序一件既有人類任務
]);
export type GroupCommandKind = z.infer<typeof groupCommandKindSchema>;

/** 每種指令所需的最低等級（唯一出處：router、campaign 執行器、前端露出都讀這張表） */
export const COMMAND_MIN_LEVEL: Record<GroupCommandKind, GroupCommandLevel> = {
  // 開專案本身不花點、可封存還原，門檻與 dispatch 同級：它存在的理由就是「還沒有專案可派工」，
  // 訂得比 dispatch 高的話，被授權派工的人會遇到「代理說要先開專案、但開不了」的死路。
  create_project: "dispatch",
  dispatch: "dispatch",
  approve_run: "supervise",
  stop_run: "supervise",
  discard_run: "supervise",
  retry_run: "supervise",
  assign_task: "supervise",
};

/** 等級的人話標籤（錯誤訊息與成員設定頁共用一份用詞，兩邊不會各叫各的） */
export const COMMAND_LEVEL_LABEL: Record<GroupCommandLevel, string> = {
  none: "不可用",
  dispatch: "可派工",
  supervise: "可監督",
  command: "可總指揮",
};

/** 指令的人話標籤（審計摘要與 UI 共用，避免兩邊各寫一份中文） */
export const COMMAND_LABEL: Record<GroupCommandKind, string> = {
  create_project: "開專案",
  dispatch: "派工",
  approve_run: "核准計畫",
  stop_run: "停止計畫",
  discard_run: "放棄計畫",
  retry_run: "重新規劃",
  assign_task: "調整人員任務",
};

export function canRunCommand(level: GroupCommandLevel, kind: GroupCommandKind): boolean {
  return levelAtLeast(level, COMMAND_MIN_LEVEL[kind]);
}

/**
 * 發起／核准／續跑一份 campaign（L3 常駐總指揮）所需的最低等級。
 *
 * 為什麼不塞進 COMMAND_MIN_LEVEL：那張表的鍵是「一道人按下去的指令」——按一次、花一次、有人看著。
 * campaign 不是指令，是「授權組代理在無人盯著時反覆下那些指令」，量級完全不同。
 *
 * 但它必須跟 COMMAND_MIN_LEVEL 一樣是**唯一出處**：後端守門、前端露出、成員設定頁的授權說明
 * 全部讀這一個常數。任何一邊自己寫死等級字串，就會回到這個常數存在之前的狀態——
 * 後端只驗 supervise、前端只露給 command、設定頁又跟組長說「可監督」不會自動花錢：
 * 組長照著那段文案決定只給「可監督」，被授權的人卻能直接打 API 排一份帶自動核准授權的計畫
 * 再自己核准。組長以為沒授出去的「無人盯著時自動花點」，其實授出去了，而且畫面上看不到那份計畫。
 */
export const CAMPAIGN_MIN_LEVEL: GroupCommandLevel = "command";

export function canRunCampaign(level: GroupCommandLevel): boolean {
  return levelAtLeast(level, CAMPAIGN_MIN_LEVEL);
}

export const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

/**
 * 一道組級指令的完整輸入（router 的 zod、ask 的提議解析、campaign 執行器共用同一份形狀）。
 *
 * 一律用 id 而非代號：代號（p1／t1）只存在於「那一次提問的上下文」，指令可能在幾分鐘後才被按下，
 * 那時候清單早就變了。代號→id 的解析在產生提議的當下就做完（見 router 的 resolveActions）。
 */
export const groupCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_project"),
    title: z.string().trim().min(1, "請填專案名稱").max(80),
    // 欄位名是 projectKind 而不是 kind：kind 已經是這個 union 的判別欄位，
    // 再叫一次 kind 會讓「這個專案是什麼內容類型」與「這是哪一種指令」在同一個物件裡打架。
    projectKind: z.string().min(1).max(40),
    platform: z.string().min(1).max(40),
  }),
  z.object({
    kind: z.literal("dispatch"),
    projectId: z.string().uuid(),
    goal: z.string().min(5, "目標至少 5 個字").max(1000),
    plannerMode: agentPlannerModeSchema.optional(),
    playbookId: z.string().max(80).optional(),
  }),
  z.object({ kind: z.literal("approve_run"), runId: z.string().uuid() }),
  z.object({ kind: z.literal("stop_run"), runId: z.string().uuid() }),
  z.object({ kind: z.literal("discard_run"), runId: z.string().uuid() }),
  z.object({
    kind: z.literal("retry_run"),
    runId: z.string().uuid(),
    // 重新規劃時沿用原本的規劃檔位與 playbook（campaign 的步驟保存得到；人手動重跑時沒有就用預設）
    plannerMode: agentPlannerModeSchema.optional(),
    playbookId: z.string().max(80).optional(),
  }),
  z.object({
    kind: z.literal("assign_task"),
    taskId: z.string().uuid(),
    assigneeId: z.string().uuid().nullable().optional(),
    dueAt: z.string().max(40).nullable().optional(),
    priority: taskPrioritySchema.optional(),
  }),
]);
export type GroupCommand = z.infer<typeof groupCommandSchema>;

/** 指令執行結果（UI 直接顯示 message；id 欄位讓前端知道要 invalidate 哪些查詢） */
export interface GroupCommandResult {
  kind: GroupCommandKind;
  message: string;
  projectId?: string;
  /** create_project 才有：讓 campaign 的步驟能把新專案的名字寫在進度上，不必再查一次 DB */
  projectTitle?: string;
  runId?: string;
  taskId?: string;
  estPoints?: number;
}

/* ── L3：組代理計畫（campaign） ── */

/**
 * 組級步驟種類。刻意比專案代理少很多——組代理不該自己生圖、寫資料庫或改分鏡，
 * 那些是專案代理的工作。它只做「調度」：派下去、盯著、修、找人、下結論。
 */
export const groupStepKindSchema = z.enum([
  "create_project", // 開一個新專案（後續的 dispatch 可以指向它）
  "dispatch",       // 在某專案建立子計畫（planAgentCore）
  "watch",          // 盯著某個 dispatch 步驟的子計畫：核准 → 等終局 → 失敗在授權內重試
  "assign_task",    // 指派／改期一件既有人類任務
  "wait_for_human", // 組級人工關卡：整份計畫轉 waiting，要有人按繼續
  "report",         // 產出一段結論（不動任何資料）
]);
export type GroupStepKind = z.infer<typeof groupStepKindSchema>;

export const groupStepStatusSchema = z.enum(["pending", "running", "waiting", "done", "failed", "stopped", "skipped"]);
export type GroupStepStatus = z.infer<typeof groupStepStatusSchema>;

export const groupRunStatusSchema = z.enum(["awaiting_approval", "running", "waiting", "done", "failed", "stopped", "discarded"]);
export type GroupRunStatus = z.infer<typeof groupRunStatusSchema>;

/** 組級步驟（與 group_agent_runs.steps jsonb 的形狀一致；執行器是這份 JSON 的單一寫者） */
export interface GroupCampaignStep {
  id: string;
  kind: GroupStepKind;
  title: string;
  /** 人話說明（核准畫面與進度列表顯示） */
  note: string;
  status: GroupStepStatus;
  /** 真實依賴（不硬湊線性流程）：全部 done 才輪得到這步 */
  dependsOn?: string[];
  /* create_project：規劃時就決定好要開什麼；projectId／projectTitle 由執行器建完回填 */
  projectKind?: string;
  platform?: string;
  /* dispatch */
  projectId?: string;
  projectTitle?: string;
  /**
   * 這一步要派工到「某個 create_project 步驟開出來的專案」。
   *
   * 為什麼需要：規劃當下那個專案還不存在，沒有 projectId 可以寫。若不支援這個指向，
   * create_project 就只能開出一個空專案然後整份計畫結束——「幫我開一個中秋活動宣傳專案」
   * 會得到一個什麼都沒有的殼，而使用者要的是連內容一起。
   * 執行期由執行器讀那一步的 projectId 補上（該步必為前置依賴，見 resolveCampaignPlan）。
   */
  projectFromStepId?: string;
  goal?: string;
  plannerMode?: z.infer<typeof agentPlannerModeSchema>;
  playbookId?: string;
  /* watch：指向哪個 dispatch 步驟 */
  targetStepId?: string;
  /** 失敗可重新規劃幾次（0＝不重試，失敗就停下來等人） */
  maxAttempts?: number;
  /* assign_task */
  taskId?: string;
  assigneeId?: string;
  dueAt?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  /* 執行期（執行器寫） */
  childRunId?: string;
  childStatus?: string;
  attempts?: number;
  /** 因暫時性阻礙（併發鎖／節流）空轉了幾輪；成功或轉 waiting 後歸零 */
  transientWaits?: number;
  estPoints?: number;
  result?: string;
  error?: string;
}

/** 規劃器輸出的步驟草稿（LLM 只准給這些欄位；執行期欄位一律由執行器自己寫） */
export const groupStepDraftSchema = z.object({
  id: z.string().min(1).max(40),
  kind: groupStepKindSchema,
  title: z.string().min(1).max(120),
  note: z.string().max(600).optional(),
  dependsOn: z.array(z.string().min(1).max(40)).max(8).optional(),
  // 既有專案代號（p1…）**或**某個 create_project 步驟的 id，所以長度放寬到步驟 id 的上限。
  // 用同一個欄位而不是再開一個 fromStepId：規劃器每多一個欄位就多一種填錯的方式，
  // 而「派到哪個專案」在人的腦裡本來就是一件事。
  projectRef: z.string().max(40).optional(),
  goal: z.string().max(1000).optional(),
  /* create_project */
  projectTitle: z.string().max(80).optional(),
  projectKind: z.string().max(40).optional(),
  platform: z.string().max(40).optional(),
  targetStepId: z.string().max(40).optional(),
  maxAttempts: z.number().int().min(0).max(3).optional(),
  taskRef: z.string().max(8).optional(),
  assigneeRef: z.string().max(8).optional(),
  dueAt: z.string().max(40).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});
export type GroupStepDraft = z.infer<typeof groupStepDraftSchema>;

export const groupPlanDraftSchema = z.object({
  summary: z.string().min(1).max(600),
  rationale: z.string().max(600).optional(),
  steps: z.array(groupStepDraftSchema).max(20),
});
export type GroupPlanDraft = z.infer<typeof groupPlanDraftSchema>;

/** 一份 campaign 最多幾步：組級調度再多就不是計畫、是失控 */
export const MAX_CAMPAIGN_STEPS = 12;
/**
 * 一份 campaign 最多開幾個新專案。
 *
 * 沒有這個上限的話，一句含糊的目標（「幫我把明年的內容都規劃好」）足以讓規劃器排出十二步
 * create_project，一次在組裡長出十二個空專案。專案本身刪不掉（只能封存），使用者要一個一個
 * 收拾。三個是「主活動＋兩條支線」的合理上限；真的需要更多，人再排第二份計畫。
 */
export const MAX_CAMPAIGN_NEW_PROJECTS = 3;
/**
 * 遇到「暫時性阻礙」最多空轉幾輪才改成停下來等人（8 秒一輪 ≈ 8 分鐘）。
 *
 * 什麼算暫時性：核准撞到同專案的併發鎖（等前一份跑完就能核准）、派工撞到規劃節流
 * （每人每分鐘 4 次）。這些都不是輸入錯誤，隔一下就會好——照失敗處理的話，
 * 組長手上剛好在跑一份代理計畫，就足以讓整份 campaign 死掉，而前面已核准的子計畫還在燒點。
 * 但也不能無限等：一份其實永遠過不了的計畫在清單上裝忙一整天，沒人知道要去停哪一份。
 */
export const MAX_TRANSIENT_WAITS = 60;

/**
 * 這個錯誤是不是「等一下就會好」。
 *
 * 用 tRPC 錯誤碼判斷而不是比對中文訊息：訊息文案一改，這裡就會靜默失效，
 * 而失效的方向是「把暫時性阻礙當成永久失敗」——整份計畫死掉，最難查。
 */
export function isTransientCommandError(code: string | undefined): boolean {
  return code === "CONFLICT" || code === "TOO_MANY_REQUESTS" || code === "SERVICE_UNAVAILABLE";
}
/** 單一 watch 步驟最多重新規劃幾次（硬頂；LLM 給再大也收斂到這裡） */
export const MAX_WATCH_ATTEMPTS = 3;

export const GROUP_STEP_KIND_LABEL: Record<GroupStepKind, string> = {
  create_project: "開專案",
  dispatch: "派工",
  watch: "盯進度",
  assign_task: "調整任務",
  wait_for_human: "等待人員",
  report: "結論",
};

export const GROUP_RUN_STATUS_LABEL: Record<GroupRunStatus, string> = {
  awaiting_approval: "待核准",
  running: "執行中",
  waiting: "等待人員",
  done: "完成",
  failed: "失敗",
  stopped: "已停止",
  discarded: "已放棄",
};

/* ── 純函式：進度與可執行性（前後端共用，避免兩邊各算一套） ── */

/** 已完成步數（skipped 不算完成，也不算未完成——它是「不必做」，見 campaignProgress） */
export function countDoneCampaignSteps(steps: GroupCampaignStep[]): number {
  return steps.filter((s) => s.status === "done").length;
}

/**
 * 進度（done / 需要做的總數）。skipped 從分母移除：一份因前置失敗而略過三步的計畫
 * 若還把那三步算進分母，畫面會永遠停在 5/8 讓人以為卡住，其實它已經結束了。
 */
export function campaignProgress(steps: GroupCampaignStep[]): { done: number; total: number } {
  const total = steps.filter((s) => s.status !== "skipped").length;
  return { done: countDoneCampaignSteps(steps), total };
}

/**
 * 下一個可推進的步驟：pending 且所有 dependsOn 皆 done。
 * 依賴若已 failed/stopped/skipped 就永遠等不到——那條支線交給 skipTailAfterFailure 收尾。
 */
export function nextRunnableStep(steps: GroupCampaignStep[]): GroupCampaignStep | undefined {
  const byId = new Map(steps.map((s) => [s.id, s]));
  return steps.find((s) =>
    s.status === "pending"
    && (s.dependsOn ?? []).every((dep) => byId.get(dep)?.status === "done"));
}

/**
 * 把「依賴已經確定不會完成」的後續步驟標成 skipped（遞移閉包）。
 *
 * 沒有這個的話，一個 dispatch 失敗會讓後面每一步永遠 pending，run 既不 done 也不 failed，
 * 就成了永遠掛在清單上、每 tick 都被撈起來又什麼都不做的殭屍。
 * 回傳被標記的步驟數，供事件軌跡誠實記錄「因此略過 N 步」。
 */
export function skipUnreachableSteps(steps: GroupCampaignStep[]): number {
  const dead = new Set(steps.filter((s) => s.status === "failed" || s.status === "stopped" || s.status === "skipped").map((s) => s.id));
  if (dead.size === 0) return 0;
  let changed = true;
  let marked = 0;
  while (changed) {
    changed = false;
    for (const step of steps) {
      if (step.status !== "pending") continue;
      if (!(step.dependsOn ?? []).some((dep) => dead.has(dep))) continue;
      step.status = "skipped";
      dead.add(step.id);
      marked += 1;
      changed = true;
    }
  }
  return marked;
}

/**
 * 人按下「繼續」時，各個 waiting 步驟該變成什麼（純函式：單元測試就能證明它不會回到原地）。
 *
 * 兩種 waiting 的語意完全不同，一律回 pending 會出事：
 *  - wait_for_human：這一步的內容本來就是「等人」，人回來按了繼續＝這道關卡已經過了 → done。
 *    若回 pending，下一輪執行器對 wait_for_human 唯一的動作就是再設回 waiting，
 *    於是 resolveCampaignOutcome 永遠回 null、依賴它的步驟永遠 pending、
 *    skipUnreachableSteps 也收不掉（waiting 不在 dead 集合裡）——使用者按幾次繼續都只會
 *    看到「等待人員」，整份計畫永遠掛在清單上。
 *  - watch（子計畫估點超出授權而停手）：加了授權之後要重新判一次要不要核准 → pending，
 *    讓執行器再輪詢一遍。
 * 回傳被放行的人工關卡 id，讓呼叫端能誠實記一筆「這一步是人放行的」。
 */
export function resumeCampaignSteps(steps: GroupCampaignStep[]): { steps: GroupCampaignStep[]; passedHumanGates: string[] } {
  const passedHumanGates: string[] = [];
  const next = steps.map((s) => {
    if (s.status !== "waiting") return s;
    if (s.kind === "wait_for_human") {
      passedHumanGates.push(s.id);
      return { ...s, status: "done" as const, result: "人已確認，放行", error: undefined };
    }
    return { ...s, status: "pending" as const, error: undefined };
  });
  return { steps: next, passedHumanGates };
}

/**
 * 這份計畫還有沒有「執行器現在就推得動」的事。
 *
 * 用途是把 run 的 waiting 與 running 分清楚：一份計畫可能有多條獨立支線，
 * 其中一條卡在人工關卡（waiting）、另一條的子計畫還在跑。若只要有任何 waiting 步驟就把整份
 * 標成 waiting，執行器（只撈 running）就再也不會回來輪詢另一條支線——已經花了錢的子計畫
 * 跑完了不會被標完成、失敗了也不會用掉重試額度，而畫面只說「等待人員」，
 * 看起來像只有一條支線在等人。
 */
export function campaignHasActiveWork(steps: GroupCampaignStep[]): boolean {
  return steps.some((s) => s.status === "running") || nextRunnableStep(steps) !== undefined;
}

/**
 * 由步驟狀態決定整份計畫的終局（還沒結束回 null）。
 *
 * 規則刻意直白：還有 running/waiting/pending → 未結束；有任何 failed → failed；
 * 有任何 stopped → stopped；其餘（全 done 或 done+skipped）→ done。
 * 「有 skipped 就算失敗」是錯的：使用者停掉一條支線後，剩下的支線正常完成，那份計畫是完成的。
 */
export function resolveCampaignOutcome(steps: GroupCampaignStep[]): "done" | "failed" | "stopped" | null {
  if (steps.some((s) => s.status === "running" || s.status === "waiting" || s.status === "pending")) return null;
  if (steps.some((s) => s.status === "failed")) return "failed";
  if (steps.some((s) => s.status === "stopped")) return "stopped";
  return "done";
}

/**
 * 這一步花得起嗎（campaign 的點數授權閘）。
 *
 * 組代理能自動核准子計畫＝能在無人盯著時自動花錢，所以每份 campaign 都帶一個「本次授權上限」，
 * 超過就不核准、把步驟轉 waiting 等人決定。budgetPoints ≤ 0 視為「不授權自動花點」——
 * 預設不給，比預設給了再靠人記得關安全。
 */
export function withinCampaignBudget(input: { budgetPoints: number; spentPoints: number; stepPoints: number }): boolean {
  if (input.budgetPoints <= 0) return false;
  return input.spentPoints + input.stepPoints <= input.budgetPoints;
}

/** 一份 waiting 計畫在等什麼（budget＝授權不夠停手；human＝組級人工關卡） */
export type CampaignWaitReason =
  | { kind: "budget"; stepId: string; title: string; detail: string }
  | { kind: "human"; stepId: string; title: string; detail: string };

/**
 * waiting 的成因。
 *
 * 為什麼要有這一支：run 層只有一個 waiting 狀態，但它有兩種完全不同的解法——人工關卡要人去做事，
 * 預算停手要人加授權（或自己去核准那份子計畫）。畫面上不分成因，使用者唯一能做的就是亂按「繼續」；
 * 而預算停手時不加點就按繼續，執行器下一輪照樣判 hold，狀態原地彈回 waiting，看起來就像功能壞掉。
 * watch 步驟會轉 waiting 的唯一來源就是預算閘，所以用 kind 分即可。
 */
export function resolveCampaignWaitReason(steps: GroupCampaignStep[]): CampaignWaitReason | null {
  const step = steps.find((s) => s.status === "waiting");
  if (!step) return null;
  const detail = (step.error || step.note || "").trim();
  return step.kind === "watch"
    ? { kind: "budget", stepId: step.id, title: step.title, detail: detail || "子計畫的估點超出本次授權" }
    : { kind: "human", stepId: step.id, title: step.title, detail: detail || "需要有人處理後才能繼續" };
}

/** watch 步驟這一輪該做什麼（純決策，執行留給執行器） */
export type WatchDecision =
  | { action: "approve" }
  | { action: "hold"; reason: string }
  | { action: "wait" }
  | { action: "done" }
  | { action: "retry" }
  | { action: "fail"; reason: string };

/**
 * 盯著子計畫的決策規則——整個 L3 唯一會「自己開始花錢」的判斷，所以抽成純函式獨立驗證。
 *
 * 順序有意義：
 *  1. 待核准 → 先過預算閘。放得進授權才核准；放不進**不是失敗**，是停下來等人加授權——
 *     一份因為估點多 10 點就整份失敗的計畫，使用者只能重排一次，那比停下來問一句糟得多。
 *  2. 執行中／等待人員 → 什麼都不做，下一輪再看（子計畫可能跑數十分鐘）。
 *  3. 完成 → 這步完成。
 *  4. 失敗 → 還有重試額度就重新規劃；沒有就失敗，並在理由裡說清楚是「試過幾次」還是「本來就不重試」。
 *  5. 被停止／被放棄 → 一律失敗且**不重試**：那是人做的決定，組代理不該把人剛停掉的東西再開一次。
 */
export function decideWatchAction(input: {
  childStatus: string;
  childEstPoints: number;
  childError?: string | null;
  budgetPoints: number;
  spentPoints: number;
  attempts: number;
  maxAttempts: number;
}): WatchDecision {
  if (input.childStatus === "awaiting_approval") {
    if (withinCampaignBudget({ budgetPoints: input.budgetPoints, spentPoints: input.spentPoints, stepPoints: input.childEstPoints })) {
      return { action: "approve" };
    }
    return {
      action: "hold",
      reason: `子計畫估 ${input.childEstPoints} 點，超出本次授權（已用 ${input.spentPoints}／${input.budgetPoints} 點）——請人決定要不要加授權`,
    };
  }
  if (input.childStatus === "running" || input.childStatus === "waiting") return { action: "wait" };
  if (input.childStatus === "done") return { action: "done" };
  if (input.childStatus === "failed") {
    if (input.attempts < input.maxAttempts) return { action: "retry" };
    const detail = input.childError ? `：${input.childError.slice(0, 120)}` : "";
    return {
      action: "fail",
      reason: `子計畫失敗${detail}${input.maxAttempts > 0 ? `（已重新規劃 ${input.attempts} 次，達上限）` : ""}`,
    };
  }
  return { action: "fail", reason: `子計畫${input.childStatus === "stopped" ? "被停止" : "已放棄"}` };
}
