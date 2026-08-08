/**
 * AI 協作統籌（Collaboration Coordinator）的上下文建構。
 *
 * @助手 原本讀「世界觀＋近 10 則對話＋知識庫」——回答得了「這一鏡在講什麼」，
 * 回答不了「最近大家說了什麼、什麼卡住了、誰在等誰」。這支服務把協作狀態
 * （未解決標注／進行中任務／待核准／決策紀錄）組裝成結構化文字段落餵給它。
 *
 * 邊界（計畫 §24，一條都不放寬）：
 *  - AI 只**讀**這些資料來整理與回答；建立任務／核准／花點仍走既有的
 *    thread action 與 approval 流程，這裡不給模型任何執行工具。
 *  - Presence／viewState 只當短期即時 context——**不注入、不持久化游標歷史**。
 *
 * 組裝與格式化拆成兩層：查詢在 loadCollaborationContext（打 DB），
 * 格式化在 formatCollaborationContext（純函式、可測）——
 * 「等待你」的分類規則錯了，AI 的整理就會把責任指錯人，那必須測得到。
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";

export interface CollabContextData {
  /** 問話的人（「等待你」的「你」） */
  askerId: string;
  openAnnotations: Array<{ body: string; userName: string | null; sceneTitle: string | null }>;
  tasks: Array<{
    title: string;
    status: string;
    taskType: string;
    assigneeId: string | null;
    assigneeName: string | null;
    createdByName: string | null;
  }>;
  decisions: Array<{ title: string; decidedByName: string | null; revoked: boolean }>;
}

/**
 * 純格式化：協作狀態 → 給 LLM 的段落。
 *
 * 分類規則（也是 AI 回答「最近大家說了什麼」時被指示沿用的骨架）：
 *   已決定＝未撤銷的 decisions
 *   待處理＝未解決標注＋進行中任務
 *   等待你＝指派給**問話者本人**的任務與核准
 * 空區塊直接省略——「待處理：（無）」對模型是噪音，對 token 是浪費。
 */
export function formatCollaborationContext(data: CollabContextData): string {
  const parts: string[] = [];

  const valid = data.decisions.filter((d) => !d.revoked);
  if (valid.length > 0) {
    parts.push(`<已決定>\n${valid.map((d) => `• ${d.title}${d.decidedByName ? `（${d.decidedByName} 定案）` : ""}`).join("\n")}\n</已決定>`);
  }

  const pending: string[] = [
    ...data.openAnnotations.map((a) =>
      `• 未解決標注${a.sceneTitle ? `（${a.sceneTitle}）` : ""}：${a.body.slice(0, 60)}${a.userName ? `——${a.userName} 提出` : ""}`),
    ...data.tasks
      .filter((t) => t.assigneeId !== data.askerId)
      .map((t) =>
        `• 任務「${t.title}」（${t.assigneeName ? `${t.assigneeName} 負責` : "尚未指派"}，${t.status}）`),
  ];
  if (pending.length > 0) parts.push(`<待處理>\n${pending.join("\n")}\n</待處理>`);

  const forAsker = data.tasks.filter((t) => t.assigneeId === data.askerId);
  if (forAsker.length > 0) {
    parts.push(`<等待你>\n${forAsker
      .map((t) => `• ${t.taskType === "approval" ? "待你核准" : "指派給你"}：「${t.title}」${t.createdByName ? `（${t.createdByName} 建立）` : ""}`)
      .join("\n")}\n</等待你>`);
  }

  return parts.join("\n");
}

/** 各清單的注入上限：協作狀態是骨架不是全文，超過的部分對「現在該做什麼」沒有幫助 */
const MAX_ITEMS = 10;

export async function loadCollaborationContext(projectId: string, askerId: string): Promise<string> {
  const [annotationRows, taskRows, decisionRows] = await Promise.all([
    db
      .select({
        body: schema.messages.body,
        userName: schema.users.name,
        refId: schema.messages.refId,
      })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.users.id, schema.messages.userId))
      .where(and(
        eq(schema.messages.projectId, projectId),
        eq(schema.messages.kind, "annotation"),
        isNull(schema.messages.resolvedAt),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(MAX_ITEMS),
    db
      .select()
      .from(schema.projectTasks)
      .where(and(
        eq(schema.projectTasks.projectId, projectId),
        inArray(schema.projectTasks.status, ["todo", "doing", "waiting", "review"]),
      ))
      .orderBy(desc(schema.projectTasks.updatedAt))
      .limit(MAX_ITEMS),
    db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.projectId, projectId))
      .orderBy(desc(schema.decisions.createdAt))
      .limit(MAX_ITEMS),
  ]);

  // 名字批次補齊（標注的鏡標題也是）——不逐筆查
  const userIds = [
    ...taskRows.flatMap((t) => [t.assigneeId, t.createdBy]).filter((v): v is string => Boolean(v)),
    ...decisionRows.map((d) => d.decidedBy),
  ];
  const sceneIds = annotationRows.map((a) => a.refId).filter((v): v is string => Boolean(v));
  const [users, scenes] = await Promise.all([
    userIds.length
      ? db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, [...new Set(userIds)]))
      : Promise.resolve([]),
    sceneIds.length
      ? db.select({ id: schema.scenes.id, title: schema.scenes.title }).from(schema.scenes).where(inArray(schema.scenes.id, [...new Set(sceneIds)]))
      : Promise.resolve([]),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const sceneTitleOf = new Map(scenes.map((s) => [s.id, s.title]));

  return formatCollaborationContext({
    askerId,
    openAnnotations: annotationRows.map((a) => ({
      body: a.body,
      userName: a.userName,
      sceneTitle: a.refId ? sceneTitleOf.get(a.refId) ?? null : null,
    })),
    tasks: taskRows.map((t) => ({
      title: t.title,
      status: t.status,
      taskType: t.taskType,
      assigneeId: t.assigneeId,
      assigneeName: t.assigneeId ? nameOf.get(t.assigneeId) ?? null : null,
      createdByName: nameOf.get(t.createdBy) ?? null,
    })),
    decisions: decisionRows.map((d) => ({
      title: d.title,
      decidedByName: nameOf.get(d.decidedBy) ?? null,
      revoked: Boolean(d.revokedAt),
    })),
  });
}
