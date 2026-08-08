/**
 * 協作聚合（Collaboration Summary）——首頁「團隊協作」與協作中心的**單一**資料來源。
 *
 * 為什麼是一支伺服器聚合而不是前端拼十幾支查詢：
 *  1. 首頁要回答的五個問題（誰在線／有什麼找我／哪裡有人在工作／哪些卡住／哪些專案在討論）
 *     跨了 presence、notifications、messages、project_tasks、projects 五個來源。前端各打一支的話，
 *     手機端要等最慢的那一支，而且每一支都要自己處理組隔離——同一條 ACL 規則寫五遍，
 *     遲早有一遍寫錯。
 *  2. 未解決標注是「每專案一個數字」，逐專案打一支就是教科書等級的 N+1。這裡一支
 *     group-by 查完整組。
 *
 * 界線與既有系統完全一致，一個都不新開：
 *  - 「找我」讀既有 notifications（收件匣才是真相，推播只是加速通道）
 *  - 「討論」讀既有 messages
 *  - 「任務／待審」讀既有 project_tasks（含 taskType='approval'）
 *  - 「誰在線」讀既有 realtime 房間投影
 * 沒有第二套留言系統、沒有第二套通知系統。
 */
import { and, desc, eq, inArray, isNull, sql, gte } from "drizzle-orm";
import { db, schema } from "../db";
import { groupPresence, type CollaborationPresence } from "./realtime";

/** 首頁只顯示「下一步有價值」的東西，不是完整社群 feed——各區都有硬上限 */
const MAX_ATTENTION = 12;
const MAX_ACTIVITY = 15;
const MAX_THREADS = 20;
const MAX_PROJECTS = 8;
/** 動態只看最近這段時間：更舊的東西對「現在該做什麼」沒有幫助 */
const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 「找我」的排序權重。使用者的問題是「我現在該處理什麼」，所以順序不是時間，是**阻塞程度**：
 * 需要我決策 > 阻塞別人 > 被 @ > 指派任務 > 一般更新。
 * 時間只在同一層之內當第二排序鍵。
 */
const ATTENTION_WEIGHT: Record<string, number> = {
  approval: 100,       // 等我核准——我不動，別人就動不了
  agent_confirm: 95,   // AI 等我確認才能繼續
  annotation: 80,      // 有人指出問題，還沒解決
  mention: 60,
  reply: 50,
  task: 40,
  generation_done: 20,
  other: 10,
};

export type AttentionKind = keyof typeof ATTENTION_WEIGHT;

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  body: string;
  /** 站內深連結——點下去要直接到那一格／那一版／那個標注，不是到專案首頁 */
  url: string;
  projectId: string | null;
  projectTitle: string | null;
  actorName: string | null;
  createdAt: string;
  weight: number;
}

export interface CollaborationSummary {
  onlinePeers: Array<CollaborationPresence & { projectTitles: string[] }>;
  unreadMentions: number;
  unreadReplies: number;
  openAnnotations: number;
  myTasks: number;
  pendingApprovals: number;
  /** 依阻塞程度排序的「找我」清單（首頁只取前一兩筆，協作中心取完整） */
  attention: AttentionItem[];
  /** 依專案 → 內容物件分組的討論串（不是一條全專案 feed） */
  threads: Array<{
    projectId: string;
    projectTitle: string;
    refType: string | null;
    refId: string | null;
    label: string;
    count: number;
    openAnnotations: number;
    lastAt: string;
  }>;
  /** 最近的定案（Decision Log；含已撤銷——劃線顯示，不是消失） */
  recentDecisions: Array<{
    id: string;
    title: string;
    projectId: string;
    projectTitle: string | null;
    decidedByName: string | null;
    refType: string | null;
    refId: string | null;
    sourceMessageId: string | null;
    revokedAt: string | null;
    at: string;
  }>;
  recentActivity: Array<{
    id: string;
    kind: string;
    actorName: string | null;
    projectId: string | null;
    projectTitle: string | null;
    summary: string;
    at: string;
  }>;
  activeProjects: Array<{
    projectId: string;
    title: string;
    messages: number;
    openAnnotations: number;
    onlineCount: number;
    lastAt: string | null;
  }>;
}

/**
 * 組層級的協作聚合。呼叫端必須**先**確認 userId 屬於 groupId（router 的 requireGroup）——
 * 這支服務不自己做 ACL，但它收到的每一個 projectId 都限縮在該組之內。
 */
export async function collaborationSummary(userId: string, groupId: string): Promise<CollaborationSummary> {
  const since = new Date(Date.now() - ACTIVITY_WINDOW_MS);

  const projects = await db
    .select({ id: schema.projects.id, title: schema.projects.title })
    .from(schema.projects)
    .where(and(eq(schema.projects.groupId, groupId), eq(schema.projects.status, "active")));
  const projectIds = projects.map((p) => p.id);
  const titleOf = new Map(projects.map((p) => [p.id, p.title]));

  // 沒有專案時後面每一支查詢的 inArray 都會是空集合——直接短路，省掉一輪空查詢
  if (projectIds.length === 0) {
    return {
      onlinePeers: groupPresence(groupId, []).map((p) => ({ ...p, projectTitles: [] })),
      unreadMentions: 0,
      unreadReplies: 0,
      openAnnotations: 0,
      myTasks: 0,
      pendingApprovals: 0,
      attention: [],
      threads: [],
      recentDecisions: [],
      recentActivity: [],
      activeProjects: [],
    };
  }

  const [notifRows, annotationCounts, taskRows, threadRows, activityRows, decisionRows] = await Promise.all([
    // 未讀收件匣：一支查完，之後在記憶體分類，不對同一張表打五支 count
    db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(120),

    // 未解決標注：**一支 group-by 算完整組**，不逐專案 N+1（走 messages_open_annotation_idx）
    db
      .select({ projectId: schema.messages.projectId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.messages)
      .where(and(
        inArray(schema.messages.projectId, projectIds),
        eq(schema.messages.kind, "annotation"),
        isNull(schema.messages.resolvedAt),
      ))
      .groupBy(schema.messages.projectId),

    // 我的任務與待我核准：同一張表、同一支查詢，回來再分兩堆
    db
      .select()
      .from(schema.projectTasks)
      .where(and(
        eq(schema.projectTasks.groupId, groupId),
        inArray(schema.projectTasks.status, ["todo", "doing", "waiting", "review"]),
      ))
      .orderBy(desc(schema.projectTasks.updatedAt))
      .limit(100),

    // 討論串：依「專案 × 內容物件」分組，這樣使用者看到的是
    // 「Shot 03 有 2 則、Shot 08 有 5 則」，而不是一條混在一起的全專案 feed。
    db
      .select({
        projectId: schema.messages.projectId,
        refType: schema.messages.refType,
        refId: schema.messages.refId,
        n: sql<number>`count(*)`.mapWith(Number),
        openN: sql<number>`count(*) filter (where ${schema.messages.kind} = 'annotation' and ${schema.messages.resolvedAt} is null)`.mapWith(Number),
        lastAt: sql<Date>`max(${schema.messages.createdAt})`,
      })
      .from(schema.messages)
      .where(and(inArray(schema.messages.projectId, projectIds), gte(schema.messages.createdAt, since)))
      .groupBy(schema.messages.projectId, schema.messages.refType, schema.messages.refId)
      .orderBy(desc(sql`max(${schema.messages.createdAt})`))
      .limit(MAX_THREADS),

    // 動態：最近有誰說了什麼。**Activity 不是 Notification**——這裡是「發生過什麼」，
    // 收件匣是「有什麼等我處理」，混成同一個概念之後兩邊都會變得沒用。
    db
      .select({
        id: schema.messages.id,
        kind: schema.messages.kind,
        body: schema.messages.body,
        projectId: schema.messages.projectId,
        userId: schema.messages.userId,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(and(inArray(schema.messages.projectId, projectIds), gte(schema.messages.createdAt, since)))
      .orderBy(desc(schema.messages.createdAt))
      .limit(MAX_ACTIVITY),

    // 決策：AI Coordinator 與協作中心「決策」分頁共用的同一份清單。
    // 不設時間窗——定案的价值正是在於它不會被時間軸淹沒。
    db
      .select()
      .from(schema.decisions)
      .where(inArray(schema.decisions.projectId, projectIds))
      .orderBy(desc(schema.decisions.createdAt))
      .limit(20),
  ]);

  const actorIds = [
    ...notifRows.map((n) => n.actorId).filter((v): v is string => Boolean(v)),
    ...activityRows.map((a) => a.userId),
    ...taskRows.map((t) => t.assigneeId).filter((v): v is string => Boolean(v)),
    ...decisionRows.map((d) => d.decidedBy),
  ];
  const names = await namesFor(actorIds);

  const unreadMentions = notifRows.filter((n) => n.kind === "mention").length;
  const unreadReplies = notifRows.filter((n) => n.kind === "reply").length;
  const openByProject = new Map(annotationCounts.map((r) => [r.projectId as string, r.n]));
  const openAnnotations = annotationCounts.reduce((sum, r) => sum + r.n, 0);

  const myTasks = taskRows.filter((t) => t.taskType === "task" && t.assigneeId === userId).length;
  // 待我核准：approval 型任務且指派給我（或未指名而我是專案負責人——那由 router 端的
  // 可見專案清單保證，這裡只認明確指派，寧可少算也不要在首頁上謊報有事等我）
  const pendingApprovals = taskRows.filter((t) => t.taskType === "approval" && t.assigneeId === userId).length;

  const attention: AttentionItem[] = [
    ...notifRows.map((n) => {
      const kind = attentionKindOf(n.kind);
      return {
        id: n.id,
        kind,
        title: n.title,
        body: n.body,
        url: n.url,
        projectId: n.projectId,
        projectTitle: n.projectId ? titleOf.get(n.projectId) ?? null : null,
        actorName: n.actorId ? names.get(n.actorId) ?? null : null,
        createdAt: n.createdAt.toISOString(),
        weight: ATTENTION_WEIGHT[kind] ?? ATTENTION_WEIGHT.other,
      };
    }),
    ...taskRows
      .filter((t) => t.assigneeId === userId)
      .map((t) => {
        const kind: AttentionKind = t.taskType === "approval" ? "approval" : "task";
        return {
          id: t.id,
          kind,
          title: t.title,
          body: t.description ?? "",
          url: `/p/${t.projectId}?focus=task&taskId=${t.id}`,
          projectId: t.projectId,
          projectTitle: titleOf.get(t.projectId) ?? null,
          actorName: null,
          createdAt: t.updatedAt.toISOString(),
          weight: ATTENTION_WEIGHT[kind],
        };
      }),
  ]
    // 阻塞程度優先，時間只是同層之內的第二鍵
    .sort((a, b) => b.weight - a.weight || b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_ATTENTION);

  const presence = groupPresence(groupId, projectIds);
  const onlineByProject = new Map<string, number>();
  for (const p of presence) {
    for (const pid of p.projectIds) onlineByProject.set(pid, (onlineByProject.get(pid) ?? 0) + 1);
  }

  const lastMessageAt = new Map<string, string>();
  const messageCount = new Map<string, number>();
  for (const t of threadRows) {
    const pid = t.projectId as string;
    messageCount.set(pid, (messageCount.get(pid) ?? 0) + t.n);
    const at = t.lastAt instanceof Date ? t.lastAt.toISOString() : String(t.lastAt);
    if (!lastMessageAt.has(pid) || at > lastMessageAt.get(pid)!) lastMessageAt.set(pid, at);
  }

  return {
    onlinePeers: presence.map((p) => ({
      ...p,
      projectTitles: p.projectIds.map((id) => titleOf.get(id)).filter((v): v is string => Boolean(v)),
    })),
    unreadMentions,
    unreadReplies,
    openAnnotations,
    myTasks,
    pendingApprovals,
    attention,
    threads: threadRows.map((t) => ({
      projectId: t.projectId as string,
      projectTitle: titleOf.get(t.projectId as string) ?? "（已封存專案）",
      refType: t.refType,
      refId: t.refId,
      label: threadLabel(t.refType, t.refId),
      count: t.n,
      openAnnotations: t.openN,
      lastAt: t.lastAt instanceof Date ? t.lastAt.toISOString() : String(t.lastAt),
    })),
    recentDecisions: decisionRows.map((d) => ({
      id: d.id,
      title: d.title,
      projectId: d.projectId,
      projectTitle: titleOf.get(d.projectId) ?? null,
      decidedByName: names.get(d.decidedBy) ?? null,
      refType: d.refType,
      refId: d.refId,
      sourceMessageId: d.sourceMessageId,
      revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
      at: d.createdAt.toISOString(),
    })),
    recentActivity: activityRows.map((a) => ({
      id: a.id,
      kind: a.kind,
      actorName: names.get(a.userId) ?? null,
      projectId: a.projectId,
      projectTitle: a.projectId ? titleOf.get(a.projectId) ?? null : null,
      summary: activitySummary(a.kind, a.body),
      at: a.createdAt.toISOString(),
    })),
    activeProjects: projects
      .map((p) => ({
        projectId: p.id,
        title: p.title,
        messages: messageCount.get(p.id) ?? 0,
        openAnnotations: openByProject.get(p.id) ?? 0,
        onlineCount: onlineByProject.get(p.id) ?? 0,
        lastAt: lastMessageAt.get(p.id) ?? null,
      }))
      // 有人在／有未解決的事／最近有討論的排前面；全空的專案沉底
      .filter((p) => p.messages > 0 || p.openAnnotations > 0 || p.onlineCount > 0)
      .sort((a, b) =>
        b.onlineCount - a.onlineCount ||
        b.openAnnotations - a.openAnnotations ||
        (b.lastAt ?? "").localeCompare(a.lastAt ?? ""))
      .slice(0, MAX_PROJECTS),
  };
}

function attentionKindOf(notificationKind: string): AttentionKind {
  if (notificationKind in ATTENTION_WEIGHT) return notificationKind as AttentionKind;
  if (notificationKind === "generation_pending_approval") return "approval";
  if (notificationKind === "annotation_resolved") return "other";
  return "other";
}

/** 討論串的標籤：綁到具體內容物件才有意義（「Shot 08」比「專案討論」有用得多） */
function threadLabel(refType: string | null, refId: string | null): string {
  if (!refType || !refId) return "專案討論";
  const LABEL: Record<string, string> = {
    scene: "分鏡",
    asset: "素材",
    generation: "生成版本",
    note: "筆記",
    schedule: "行程",
  };
  return LABEL[refType] ?? refType;
}

function activitySummary(kind: string, body: string): string {
  const text = body.trim().replace(/\s+/g, " ");
  const head = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  if (kind === "annotation") return `標注：${head}`;
  if (kind === "voice") return `語音留言${head ? `：${head}` : ""}`;
  if (kind === "assistant") return `AI 助手：${head}`;
  return head;
}

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
