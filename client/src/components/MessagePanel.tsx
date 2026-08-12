import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { useLocation } from "wouter";
import { trpc } from "../api";
import type { AppRouter } from "../../../server/routers";
import { Icon } from "./Icon";
import { DISCUSS_EVENT, flashAnchor, jumpToRef, setPlannerFocus, takePendingDiscussRef, type DiscussRef } from "../discuss";
import { escapeRegExp, parseMentionedNames } from "@shared/mentions";
import { INTENT_LABEL, suggestIntent, type MessageIntent } from "@shared/collabIntent";
import { useCustomQuickPhrases, MAX_PHRASE_LEN } from "../useCustomQuickPhrases";
import { useLocalDraft } from "../useLocalDraft";

import { focusAndReveal } from "../lib/scrollIntoViewForChrome";
import { Button, Card, Chip, Hint, Meta } from "./ui";
/** 單則留言(含回覆摘要／表情彙總／引用卡）——由 messages.list 推得,列元件與父層共用同一形狀 */
type MessageRowData = inferRouterOutputs<AppRouter>["messages"]["list"]["items"][number];

/** 留言 @了助手就觸發 AI 回覆——與後端 messageAssistant.ASSISTANT_TRIGGER 同字串 */
const ASSISTANT_TRIGGER = "@助手";

/**
 * ?focus=messages&mid= 往回翻找該則的頁數上限（每頁 50 則）。
 * 有上限才不會在「留言已刪」或「mid 屬於別專案」時無限往回翻整條歷史。
 */
const FOCUS_MAX_PAGES = 4;

/** 轉待辦行內表單:標題預填留言內容、選截止日 → schedule.add */
function TodoForm({ defaultTitle, pending, error, onCancel, onSubmit }: {
  defaultTitle: string;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (title: string, startsAt: string) => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [date, setDate] = useState("");
  return (
    <div className="todo-form">
      <input aria-label="待辦標題" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="待辦標題" />
      <input aria-label="截止時間" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      <Button size="sm" variant="primary"
        disabled={!title.trim() || !date || pending}
        onClick={() => onSubmit(title.trim(), new Date(date).toISOString())}>
        建立待辦
      </Button>
      <Button size="sm" onClick={onCancel}>取消</Button>
      {error && <span className="error" style={{ flexBasis: "100%" }}>{error}</span>}
    </div>
  );
}

/**
 * 轉任務行內表單（場景 4 的第一步）：標題預填留言、選負責人 → tasks.create。
 * 與「轉待辦」（schedule，個人行程）不同：這是**正式人類任務**（project_tasks），
 * 有負責人、完成時會通知原提議者——留言 → 任務 → 完成 → 回頭解決的 provenance 鏈由它起頭。
 */
function TaskForm({ defaultTitle, members, pending, error, onCancel, onSubmit }: {
  defaultTitle: string;
  members: Array<{ userId: string; name: string }>;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (title: string, assigneeId: string | null) => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [assigneeId, setAssigneeId] = useState("");
  return (
    <div className="todo-form" data-testid="task-form">
      <input aria-label="任務標題" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="任務標題" />
      <select aria-label="指派給" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
        <option value="">（先不指派）</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>{m.name}</option>
        ))}
      </select>
      <Button size="sm" variant="primary"
        disabled={!title.trim() || pending}
        onClick={() => onSubmit(title.trim(), assigneeId || null)}>
        建立任務
      </Button>
      <Button size="sm" onClick={onCancel}>取消</Button>
      {error && <span className="error" style={{ flexBasis: "100%" }}>{error}</span>}
    </div>
  );
}

/**
 * 轉決策行內表單：一句定案 → decisions.create（sourceMessageId 記 provenance，
 * 原留言會標上「決策」）。定案是一句話，不是一篇文章——所以只有一個輸入框。
 */
function DecisionForm({ defaultTitle, pending, error, onCancel, onSubmit }: {
  defaultTitle: string;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  return (
    <div className="todo-form" data-testid="decision-form">
      <input aria-label="定案內容" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="定案內容（例：使用暖色版本 B）" />
      <Button size="sm" variant="primary" disabled={!title.trim() || pending} onClick={() => onSubmit(title.trim())}>
        ✓ 定案
      </Button>
      <Button size="sm" onClick={onCancel}>取消</Button>
      {error && <span className="error" style={{ flexBasis: "100%" }}>{error}</span>}
    </div>
  );
}

/** 轉筆記行內表單:標題+內容(預填留言全文)→ notes.add */
function NoteForm({ defaultTitle, defaultContent, pending, error, onCancel, onSubmit }: {
  defaultTitle: string;
  defaultContent: string;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (title: string, content: string) => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [content, setContent] = useState(defaultContent);
  return (
    <div className="todo-form">
      <input aria-label="筆記標題" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="筆記標題" />
      <textarea aria-label="筆記內容" value={content} maxLength={5000} onChange={(e) => setContent(e.target.value)} rows={2} style={{ flexBasis: "100%" }} placeholder="筆記內容" />
      <Button size="sm" variant="primary" disabled={!title.trim() || !content.trim() || pending} onClick={() => onSubmit(title.trim(), content.trim())}>存成筆記</Button>
      <Button size="sm" onClick={onCancel}>取消</Button>
      {error && <span className="error" style={{ flexBasis: "100%" }}>{error}</span>}
    </div>
  );
}

/**
 * 站內留言(協作強化版)。即時性:同房夥伴的 mutation 會經 WebSocket 廣播 invalidate 立即刷新,
 * 8 秒輪詢只是不在房內/斷線時的後備。新增:
 * - 快速短語一鍵送出(長輩志工零打字回應)
 * - 表情回應 🙏❤️✅😊(輕確認不灌版面)
 * - @提及(輸入 @ 跳同組名單;被提及的留言高亮)
 * - 引用作品卡(分鏡/素材/生成的「討論」鈕會把作品帶進留言,點卡片跳回原件)
 * - 回覆串(帶原句摘要)與組長釘選(決議不被洗掉)
 * - 已讀水位(視窗聚焦且看到最新留言時上報,餵 TocNav 未讀徽章)
 * 第一梯隊再加:語音留言(錄音→上傳→背景逐字稿)、@助手參與對話、留言轉待辦、被提及桌面通知。
 */

/** 內建快速短語:一鍵直接送出;內容貼合團隊日常(確認/隨喜/接手/請示)。
 *  組內夥伴可在其後自行增加自訂短語(見 useCustomQuickPhrases,存本機、每組一份)。 */
const QUICK_PHRASES = ["收到 🙏", "隨喜讚歎 ✨", "我來處理 💪", "請組長過目 🙏"];

/** 自訂短語小面板的表情盤:點一下把 emoji 插進輸入框末尾,不用切輸入法找符號 */
const PHRASE_EMOJI = ["🙏", "❤️", "✅", "😊", "✨", "💪", "🎉", "👍", "📎", "🔥"] as const;

/** 桌面通知(重用 GenerationList 同一套):未授權/背景分頁靜默略過 */
function notifyDesktop(title: string, body: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    /* 某些瀏覽器背景分頁建構子會丟例外，忽略 */
  }
}

/** 表情白名單:與後端 messages.react 的 enum 同步(順序即顯示順序) */
const EMOJI = ["🙏", "❤️", "✅", "😊"] as const;

const REF_LABEL: Record<DiscussRef["refType"], string> = { scene: "分鏡", asset: "素材", generation: "生成", note: "筆記", schedule: "排程" };
const REF_ICON: Record<DiscussRef["refType"], "Clapperboard" | "FileText" | "Sparkles" | "Clock"> = {
  scene: "Clapperboard", asset: "FileText", generation: "Sparkles", note: "FileText", schedule: "Clock",
};

/** 把留言內文的 @名字 標亮(只認真的被提及者名單,不誤標普通 @ 符號) */
function renderBody(body: string, mentionNames: string[]) {
  if (!mentionNames.length) return body;
  // 名字可能含正則特殊字元,逐一跳脫;長名優先比對避免「阿明」吃掉「阿明師兄」
  // (跳脫與長名優先皆與送出端 parseMentionedNames 共用同一套規則,標亮與實際提及一致)
  const escaped = [...mentionNames].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const parts = body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return parts.map((part, idx) =>
    part.startsWith("@") && mentionNames.includes(part.slice(1)) ? (
      <mark key={idx} className="mention">{part}</mark>
    ) : (
      part
    ),
  );
}

/**
 * 單則留言列(memo 化)。留言區每 8 秒輪詢一次、且同房夥伴任何 mutation 都會廣播 invalidate 重抓;
 * react-query 的 structural sharing 讓「內容沒變的留言」跨重抓維持同一個物件參照,配上 memo,
 * 未變動的列就整棵子樹跳過重繪(含 renderBody 的正則建置),只有真正新增/變動的列才重算。
 * 父層傳入的 callback 皆為穩定參照(useCallback + 穩定的 mutate),開關狀態以布林傳入,memo 才生效。
 */
const MessageRow = memo(function MessageRow({
  m,
  myId,
  myName,
  nameById,
  isLeader,
  emojiOpen,
  todoOpen,
  noteOpen,
  taskOpen,
  decisionOpen,
  members,
  addTaskPending,
  addTaskError,
  addDecisionPending,
  addDecisionError,
  onToggleTask,
  onToggleDecision,
  onSubmitTask,
  onSubmitDecision,
  reactPending,
  setPinnedPending,
  addSchedulePending,
  addScheduleError,
  addNotePending,
  addNoteError,
  onReact,
  onToggleEmoji,
  onReply,
  onTogglePin,
  onToggleTodo,
  onToggleNote,
  onSubmitTodo,
  onCancelTodo,
  onSubmitNote,
  onCancelNote,
  onJumpRef,
}: {
  m: MessageRowData;
  myId: string | undefined;
  myName: string | undefined;
  nameById: Map<string, string>;
  isLeader: boolean;
  emojiOpen: boolean;
  todoOpen: boolean;
  noteOpen: boolean;
  taskOpen: boolean;
  decisionOpen: boolean;
  members: Array<{ userId: string; name: string }>;
  addTaskPending: boolean;
  addTaskError?: string;
  addDecisionPending: boolean;
  addDecisionError?: string;
  onToggleTask: (messageId: string) => void;
  onToggleDecision: (messageId: string) => void;
  onSubmitTask: (messageId: string, title: string, assigneeId: string | null) => void;
  onSubmitDecision: (messageId: string, title: string) => void;
  reactPending: boolean;
  setPinnedPending: boolean;
  addSchedulePending: boolean;
  addScheduleError?: string;
  addNotePending: boolean;
  addNoteError?: string;
  onReact: (messageId: string, emoji: (typeof EMOJI)[number]) => void;
  onToggleEmoji: (messageId: string) => void;
  onReply: (messageId: string, userName: string, snippet: string) => void;
  onTogglePin: (messageId: string, pinned: boolean) => void;
  onToggleTodo: (messageId: string) => void;
  onToggleNote: (messageId: string) => void;
  onSubmitTodo: (messageId: string, title: string, startsAt: string) => void;
  onCancelTodo: () => void;
  onSubmitNote: (messageId: string, title: string, content: string) => void;
  onCancelNote: () => void;
  onJumpRef: (refType: DiscussRef["refType"], refId: string) => void;
}) {
  // 系統訊息(審核結果通知等):置中淡色小字,跟夥伴的對話區隔開
  if (m.kind === "system") {
    return (
      <div style={{ textAlign: "center", color: "var(--fg-secondary)", fontSize: "var(--fs-12)", marginTop: 10 }}>
        {m.body}
      </div>
    );
  }
  const mine = m.userId === myId;
  const isAssistant = m.kind === "assistant";
  const isVoice = m.kind === "voice";
  const mentionedMe = !!myId && (m.mentions ?? []).includes(myId);
  const mentionNames = (m.mentions ?? []).map((uid) => nameById.get(uid)).filter((n): n is string => !!n);
  return (
    /* id 供 ?focus=messages&mid=<id> 深連結捲動定位＋高亮（見 discuss.ts flashAnchor） */
    <div id={`msg-${m.id}`} className={`msg-block${mentionedMe ? " mentioned-me" : ""}${isAssistant ? " assistant" : ""}`}>
      <div className="msg">
        <span className="who">
          {isAssistant ? (
            <><span className="msg-ai-orb" aria-hidden="true" />AI 助手</>
          ) : (
            <>{m.userName ?? (mine ? myName : "夥伴")}{mine ? "（我）" : ""}</>
          )}
          {m.pinned ? <Icon name="Star" size={11} style={{ marginLeft: 4, color: "var(--gold-ink)" }} /> : null}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          {/* ↩ 回覆引用:原句摘要 */}
          {m.replyTo && (
            <span className="reply-quote">
              <Icon name="Undo2" size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />
              {m.replyTo.userName ?? "夥伴"}:{m.replyTo.snippet}
            </span>
          )}
          {/* 🎙️ 語音留言:播放器 + 逐字稿(轉錄中顯示 body 佔位字) */}
          {isVoice && m.voiceUrl && (
            <audio controls preload="none" src={m.voiceUrl} style={{ height: 32, maxWidth: "100%", display: "block", marginBottom: 4 }} aria-label="語音留言" />
          )}
          {isVoice ? (
            m.voiceStatus === "pending" || m.voiceStatus === "running" ? (
              // 轉錄未完成時 body 是佔位字（「轉錄中…」）——是內容不是說明，任何模式都要看得到
              <Meta>{m.body}</Meta>
            ) : (
              <span>{m.body}</span>
            )
          ) : (
            <span>{renderBody(m.body, mentionNames)}</span>
          )}
          {/* 協作語意：已標記就顯示（「修改要求」「決策」「阻塞」）；沒標記但啟發式
              認得出「看起來是修改要求」時給一個提示捷徑——按不按仍然是人的決定。 */}
          {m.intent && m.intent !== "comment" && (
            <Chip style={{ margin: "4px 0 0", fontSize: "var(--fs-11)" }} data-testid="intent-chip">
              {INTENT_LABEL[m.intent as MessageIntent] ?? m.intent}
            </Chip>
          )}
          {!m.intent && suggestIntent(m.body) === "change_request" && (
            <button
              type="button"
              className="msg-action"
              data-testid="intent-suggest"
              title="看起來是一個修改要求——轉成任務就能指派並追蹤"
              onClick={() => onToggleTask(m.id)}
            >
              <Icon name="Lightbulb" size={12} /> 看起來是修改要求 → 轉成任務
            </button>
          )}
          {/* 🔗 引用作品卡:縮圖+標題,點「查看」跳回原件 */}
          {m.refType && m.refId && (
            <button
              type="button"
              className="ref-card"
              title={m.ref ? "跳到這個項目" : undefined}
              onClick={() => {
                if (!m.ref) return;
                onJumpRef(m.refType as DiscussRef["refType"], m.refId!);
              }}
              disabled={!m.ref}
            >
              {m.ref?.thumb ? (
                <img src={m.ref.thumb} alt="" loading="lazy" />
              ) : (
                <Icon name={REF_ICON[m.refType as DiscussRef["refType"]]} size={14} />
              )}
              <span className="ref-title">
                {REF_LABEL[m.refType as DiscussRef["refType"]]}・{m.ref ? m.ref.title : "已不存在"}
              </span>
              {m.ref && <span className="ref-go">查看</span>}
            </button>
          )}
        </span>
        <span className="time">
          {new Date(m.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      {/* 表情回應+動作列:輕量、貼在留言下緣 */}
      <div className="msg-tools">
        {m.reactions.map((r) => (
          <button
            key={r.emoji}
            type="button"
            className={`reaction-pill${r.mine ? " mine" : ""}`}
            title={r.mine ? "再按一次收回" : "我也回應"}
            disabled={reactPending}
            onClick={() => onReact(m.id, r.emoji as (typeof EMOJI)[number])}
          >
            {r.emoji} {r.count}
          </button>
        ))}
        <div style={{ position: "relative", display: "inline-flex" }}>
          <button
            type="button"
            className="msg-action"
            aria-label="加表情回應"
            title="表情回應"
            onClick={() => onToggleEmoji(m.id)}
          >
            <Icon name="Plus" size={12} />
          </button>
          {emojiOpen && (
            <div className="emoji-pop" role="menu">
              {EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  disabled={reactPending}
                  onClick={() => onReact(m.id, e)}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="msg-action"
          title="回覆這一則"
          onClick={() => onReply(m.id, m.userName ?? "夥伴", m.body.slice(0, 40))}
        >
          <Icon name="Undo2" size={12} /> 回覆
        </button>
        {isLeader && (
          <button
            type="button"
            className="msg-action"
            title={m.pinned ? "取消釘選" : "釘選(固定在頂部)"}
            disabled={setPinnedPending}
            onClick={() => onTogglePin(m.id, !m.pinned)}
          >
            <Icon name="Star" size={12} /> {m.pinned ? "取消釘選" : "釘選"}
          </button>
        )}
        {/* 轉待辦／轉筆記:把口頭承諾變成排程或會議紀錄(組內任何人可加,後端 requireGroup),
            並記 sourceMessageId 讓 Planner 反向跳回這則留言 */}
        <button
          type="button"
          className="msg-action"
          title="把這句轉成排程待辦"
          onClick={() => onToggleTodo(m.id)}
        >
          <Icon name="CalendarPlus" size={12} /> 轉待辦
        </button>
        <button
          type="button"
          className="msg-action"
          title="把這句存成筆記/會議紀錄"
          onClick={() => onToggleNote(m.id)}
        >
          <Icon name="FileText" size={12} /> 轉筆記
        </button>
        {/* 轉任務＝正式人類任務（有負責人、完成時通知原提議者）；轉決策＝進 Decision Log。
            兩者與「轉待辦」（個人行程）並列——口頭承諾的三種歸宿。 */}
        <button
          type="button"
          className="msg-action"
          title="轉成正式任務（可指派負責人；完成時會通知你）"
          onClick={() => onToggleTask(m.id)}
        >
          <Icon name="Check" size={12} /> 轉任務
        </button>
        <button
          type="button"
          className="msg-action"
          title="把這句定案進決策紀錄（可撤銷，但不會消失）"
          onClick={() => onToggleDecision(m.id)}
        >
          <Icon name="Star" size={12} /> 轉決策
        </button>
      </div>
      {/* 轉待辦行內表單:標題預填留言內容、選截止日 → schedule.add */}
      {todoOpen && (
        <TodoForm
          defaultTitle={m.body.slice(0, 120)}
          pending={addSchedulePending}
          error={addScheduleError}
          onCancel={onCancelTodo}
          onSubmit={(title, startsAt) => onSubmitTodo(m.id, title, startsAt)}
        />
      )}
      {taskOpen && (
        <TaskForm
          defaultTitle={m.body.slice(0, 160)}
          members={members}
          pending={addTaskPending}
          error={addTaskError}
          onCancel={() => onToggleTask(m.id)}
          onSubmit={(title, assigneeId) => onSubmitTask(m.id, title, assigneeId)}
        />
      )}
      {decisionOpen && (
        <DecisionForm
          defaultTitle={m.body.slice(0, 200)}
          pending={addDecisionPending}
          error={addDecisionError}
          onCancel={() => onToggleDecision(m.id)}
          onSubmit={(title) => onSubmitDecision(m.id, title)}
        />
      )}
      {/* 轉筆記行內表單:標題預填留言前段、內容預填全文 → notes.add */}
      {noteOpen && (
        <NoteForm
          defaultTitle={m.body.slice(0, 40)}
          defaultContent={m.body}
          pending={addNotePending}
          error={addNoteError}
          onCancel={onCancelNote}
          onSubmit={(title, content) => onSubmitNote(m.id, title, content)}
        />
      )}
    </div>
  );
});

export function MessagePanel({
  projectId,
  groupId,
  isLeader,
  canEdit,
  bare = false,
  focusMessageId,
  onFocusHandled,
}: {
  projectId: string;
  groupId: string;
  isLeader: boolean;
  canEdit: boolean;
  /** sheet／抽屜內嵌：去掉外層 card 與重複 h2（外層已有標題列） */
  bare?: boolean;
  /** ?focus=messages&mid=<id>：要捲到並高亮的那一則（@提及推播用） */
  focusMessageId?: string;
  /** 定位完成（成功或放棄）時通知呼叫端清掉，否則關掉再開會重閃同一則 */
  onFocusHandled?: () => void;
}) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  // 首頁：最近 50 + 全部釘選；older 用 infinite 式 prepend
  const list = trpc.messages.list.useQuery({ projectId }, { refetchInterval: 8000 });
  const messages: MessageRowData[] = list.data?.items ?? [];
  const [older, setOlder] = useState<MessageRowData[]>([]);
  const [olderHasMore, setOlderHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // 主列表刷新時清掉 older（避免與新視窗重複／亂序）；hasMore 跟伺服器首頁
  useEffect(() => {
    setOlder([]);
    setOlderHasMore(!!list.data?.hasMore);
  }, [list.data?.hasMore, projectId]);
  const allMessages = useMemo(() => {
    if (!older.length) return messages;
    const seen = new Set(messages.map((m) => m.id));
    const head = older.filter((m) => !seen.has(m.id));
    return [...head, ...messages];
  }, [older, messages]);
  // @提及名單:與 ProjectMembersCard 共用同一查詢(react-query 去重,不多打 API)
  const roles = trpc.projects.listMemberRoles.useQuery({ projectId });
  const post = trpc.messages.post.useMutation({
    onSuccess: () => {
      clearBodyDraft();
      setReplyTo(null);
      setPendingRef(null);
      // 自己送出視同回到底部:就算正往上翻舊留言,也要看見自己的留言已送出
      stickToBottom.current = true;
      utils.messages.list.invalidate({ projectId });
    },
  });
  const postVoice = trpc.messages.postVoice.useMutation({
    onSuccess: () => {
      stickToBottom.current = true;
      utils.messages.list.invalidate({ projectId });
    },
  });
  const [, navigate] = useLocation();
  // 引用排程/筆記用:本組的筆記與排程清單(picker 展開才抓)
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const notesQ = trpc.notes.list.useQuery({ groupId }, { enabled: refPickerOpen });
  const scheduleQ = trpc.schedule.list.useQuery({ groupId }, { enabled: refPickerOpen });
  const addNote = trpc.notes.add.useMutation({ onSuccess: () => { setNoteFor(null); utils.notes.list.invalidate({ groupId }); } });
  // 轉任務／轉決策（場景 4 的 provenance 鏈起點）：sourceMessageId 記「由哪則留言建立」
  const addTask = trpc.tasks.create.useMutation({ onSuccess: () => { setTaskFor(null); utils.tasks.listByProject.invalidate({ projectId }); } });
  const addDecision = trpc.decisions.create.useMutation({
    onSuccess: () => {
      setDecisionFor(null);
      utils.decisions.list.invalidate({ projectId });
      // 原留言的 intent 被回寫成「決策」——列表要重抓才看得到 chip
      utils.messages.list.invalidate({ projectId });
    },
  });
  const react = trpc.messages.react.useMutation({ onSuccess: () => utils.messages.list.invalidate({ projectId }) });
  const setPinned = trpc.messages.setPinned.useMutation({ onSuccess: () => utils.messages.list.invalidate({ projectId }) });
  const markRead = trpc.messages.markRead.useMutation({
    // silentSync：這是每 ~30s 自動觸發的「非內容」mutation，不該經即時同步廣播失效給同房所有人
    // （否則光開著留言面板就讓每位協作者每 30 秒重抓全部查詢）。realtime 的廣播訂閱會據此跳過。
    meta: { silentSync: true },
    onSuccess: () => utils.messages.unread.invalidate({ projectId }),
  });
  const addSchedule = trpc.schedule.add.useMutation({ onSuccess: () => setTodoFor(null) });

  // 草稿防丟：誤觸遮罩關 sheet／通知整頁重載都不再蒸發（送出成功才清）
  const [body, setBody, clearBodyDraft] = useLocalDraft(`msg-${projectId}`, "");
  const [replyTo, setReplyTo] = useState<{ id: string; userName: string; snippet: string } | null>(null);
  const [pendingRef, setPendingRef] = useState<DiscussRef | null>(null);
  const [emojiPickFor, setEmojiPickFor] = useState<string | null>(null);
  // todo/note 行內表單只需記「開在哪一則」的 id;預填內容直接讀該列的 m.body,不必另存
  const [todoFor, setTodoFor] = useState<string | null>(null);
  const [taskFor, setTaskFor] = useState<string | null>(null);
  const [decisionFor, setDecisionFor] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  // 自訂快速短語(每組一份,存本機):管理面板開關 + 新短語輸入框內容
  const customPhrases = useCustomQuickPhrases(groupId);
  const [phraseEditorOpen, setPhraseEditorOpen] = useState(false);
  const [newPhrase, setNewPhrase] = useState("");
  const newPhraseRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // 使用者是否停在底部:只有在底部才自動捲到最新,往上翻舊留言時不硬拉回去
  const stickToBottom = useRef(true);

  const myId = me.data?.user.id;
  const members = useMemo(
    () => (roles.data?.members ?? []).filter((m) => m.userId !== myId),
    [roles.data, myId],
  );
  const nameById = useMemo(() => new Map((roles.data?.members ?? []).map((m) => [m.userId, m.name])), [roles.data]);
  /** 任務可指派對象＝全組成員（含自己——自己認領也是常態） */
  const assignableMembers = useMemo(() => roles.data?.members ?? [], [roles.data]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [allMessages]);

  // @提及深連結（?focus=messages&mid=<id>）：捲到該則並高亮。
  // 三個地雷：
  //  1. 上面那條「自動置底」effect 每 8 秒輪詢帶進新留言就會把畫面拉回底部，
  //     看起來像捲過去又被彈開——定位前必須先關掉 stickToBottom。
  //  2. 首頁只有最近 50 則（server MESSAGE_PAGE），較舊的提及不在裡面，
  //     得往回翻；但留言被刪或 mid 屬於別專案時會無限翻，所以設頁數上限。
  //  3. 找到就 rAF 一格再捲——該列剛 render 完才有高度可捲。
  const focusHandledRef = useRef<string | null>(null);
  const focusPagesRef = useRef(0);
  useEffect(() => {
    if (!focusMessageId || focusHandledRef.current === focusMessageId) return;
    if (!allMessages.length) return;
    if (allMessages.some((m) => m.id === focusMessageId)) {
      focusHandledRef.current = focusMessageId;
      stickToBottom.current = false;
      requestAnimationFrame(() => {
        flashAnchor(`msg-${focusMessageId}`);
        onFocusHandled?.();
      });
      return;
    }
    // 不在已載入的範圍：往回翻，最多 FOCUS_MAX_PAGES 頁就放棄（面板仍是開的）
    if (!olderHasMore || focusPagesRef.current >= FOCUS_MAX_PAGES || loadingOlder) {
      if (!olderHasMore || focusPagesRef.current >= FOCUS_MAX_PAGES) {
        focusHandledRef.current = focusMessageId;
        onFocusHandled?.();
      }
      return;
    }
    focusPagesRef.current += 1;
    stickToBottom.current = false;
    void loadOlder();
  }, [focusMessageId, allMessages, olderHasMore, loadingOlder]);

  // 錄音中卸載：停掉 MediaRecorder 與麥克風軌（防切頁後麥克風常開）；
  // 清掉 onstop 再 stop，避免 unmount 後仍走 uploadVoice 造成 setState on unmounted / 幽靈留言。
  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec) {
        rec.ondataavailable = null;
        rec.onstop = null;
        try {
          if (rec.state !== "inactive") rec.stop();
        } catch { /* ignore */ }
      }
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // 已讀水位:視窗聚焦且列表刷新出「最新一則」時上報(30 秒節流,避免高頻寫)
  const lastMarked = useRef(0);
  useEffect(() => {
    if (!allMessages.length) return;
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastMarked.current < 30_000) return;
    lastMarked.current = Date.now();
    markRead.mutate({ projectId });
    // markRead 只依「最新一則留言」變化觸發——mutation 物件每 render 都新,不能進依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMessages.length && allMessages[allMessages.length - 1].id, projectId]);

  const loadOlder = async () => {
    if (loadingOlder || !allMessages.length) return;
    const earliest = allMessages[0];
    setLoadingOlder(true);
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await utils.client.messages.list.query({
        projectId,
        beforeCreatedAt: new Date(earliest.createdAt),
      });
      setOlder((prev) => {
        const seen = new Set([...prev, ...messages].map((m) => m.id));
        const add = page.items.filter((m) => !seen.has(m.id));
        return [...add, ...prev];
      });
      setOlderHasMore(page.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  // 「在留言中討論」事件:各列表的討論鈕 → 把作品掛進輸入區、捲到留言面板、聚焦
  useEffect(() => {
    const onDiscuss = (e: Event) => {
      takePendingDiscussRef(); // 事件路徑已收到，消費掉交棒暫存避免下次掛載誤收
      const ref = (e as CustomEvent<DiscussRef>).detail;
      setPendingRef(ref);
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => inputRef.current?.focus(), 350);
    };
    window.addEventListener(DISCUSS_EVENT, onDiscuss);
    return () => window.removeEventListener(DISCUSS_EVENT, onDiscuss);
  }, []);

  // 手機交棒補收：sheet 因「討論這個」被打開時，事件已在 mount 前發出——
  // 掛載時從暫存把引用卡撿回來（桌機常駐面板走上面的事件路徑，暫存已被消費）
  useEffect(() => {
    const pending = takePendingDiscussRef();
    if (!pending) return;
    setPendingRef(pending);
    window.setTimeout(() => inputRef.current?.focus(), 350);
  }, []);

  // 被提及/釘選/助手回覆桌面通知:記住看過的最新一則,新到的他人留言若 @我 或釘選就通知。
  // 首次載入(seenLatest 未定)不通知——只提示「這次會話新到的」,不轟炸歷史。
  const seenLatest = useRef<string | null>(null);
  useEffect(() => {
    const rows = allMessages;
    if (!rows?.length || !myId) return;
    const newest = rows[rows.length - 1];
    if (seenLatest.current === null) {
      seenLatest.current = newest.id;
      return;
    }
    if (seenLatest.current === newest.id) return;
    // 找出上次看過那則之後、且非自己送出的留言,挑出「@我」或「被釘選/助手回覆」的通知
    const seenIdx = rows.findIndex((m) => m.id === seenLatest.current);
    const fresh = rows.slice(seenIdx + 1).filter((m) => m.userId !== myId || m.kind === "assistant");
    seenLatest.current = newest.id;
    if (document.visibilityState === "visible") return; // 正在看就不用桌面通知
    for (const m of fresh) {
      if (m.mentions?.includes(myId)) notifyDesktop(`${m.userName ?? "夥伴"} 在留言 @了你`, m.body.slice(0, 80));
      else if (m.kind === "assistant") notifyDesktop("AI 助手回覆了留言", m.body.slice(0, 80));
    }
    // 只依最新一則 id 變化觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMessages.length && allMessages[allMessages.length - 1]?.id, myId]);

  // 錄音:MediaRecorder 收 chunks → 停止時上傳為素材 → postVoice 建語音留言(逐字稿由後端補)
  const startRecording = async () => {
    setVoiceErr(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceErr("這個瀏覽器不支援錄音，請改用打字或上傳音檔。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (streamRef.current === stream) streamRef.current = null;
        void uploadVoice(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setVoiceErr("拿不到麥克風權限，請在瀏覽器允許後再試。");
    }
  };
  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };
  const uploadVoice = async (blob: Blob) => {
    try {
      // webm 副檔名讓後端 MIME 對得上(白名單已含 audio/webm);上傳走既有 /api/upload
      const ext = (blob.type.split("/")[1] || "webm").split(";")[0];
      const fd = new FormData();
      fd.append("file", blob, `語音留言.${ext}`);
      fd.append("projectId", projectId);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error((msg as { error?: string }).error || `上傳失敗 ${res.status}`);
      }
      const data = (await res.json()) as { asset: { id: string } };
      postVoice.mutate({ projectId, assetId: data.asset.id });
    } catch (err) {
      setVoiceErr(err instanceof Error ? err.message : "語音上傳失敗，請再試一次。");
    }
  };

  // @提及下拉:偵測游標前的「@字首」,顯示同組名單(點選插入)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const detectMention = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/@([^\s@]*)$/);
    setMentionQuery(m ? m[1] : null);
  }, []);
  const mentionCandidates = useMemo(() => {
    if (mentionQuery == null) return [];
    return members.filter((m) => m.name.includes(mentionQuery)).slice(0, 6);
  }, [mentionQuery, members]);
  const insertMention = (name: string) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@[^\s@]*$/, `@${name} `);
    setBody(before + body.slice(caret));
    setMentionQuery(null);
    window.setTimeout(() => el?.focus(), 0);
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || post.isPending) return;
    // 提及=內文仍出現「@名字」的同組成員(打了又刪掉的不算)。
    // 用與留言區高亮相同的長名優先比對(parseMentionedNames):避免「@阿明師兄」誤把「阿明」也提及。
    const allMembers = roles.data?.members ?? [];
    const mentionedNames = new Set(parseMentionedNames(trimmed, allMembers.map((m) => m.name)));
    const mentions = allMembers.filter((m) => mentionedNames.has(m.name)).map((m) => m.userId);
    post.mutate({
      projectId,
      body: trimmed,
      replyToId: replyTo?.id,
      refType: pendingRef?.refType,
      refId: pendingRef?.refId,
      mentions: mentions.length ? mentions : undefined,
    });
  };

  // 加入一則自訂短語:成功才清空並保持面板開著(方便連續加),重複/超限則保留輸入讓人修改
  const commitNewPhrase = () => {
    if (customPhrases.add(newPhrase)) {
      setNewPhrase("");
      newPhraseRef.current?.focus();
    }
  };

  const pinnedMsgs = allMessages.filter((m) => m.pinned);

  // 傳給 memo 化留言列的穩定 callback:react-query 的 mutate 本身跨 render 穩定,
  // 這些 useCallback 依賴的又都是 mutate/穩定值,所以 callback 參照不變,memo 才擋得住無謂重繪。
  const reactMutate = react.mutate;
  const setPinnedMutate = setPinned.mutate;
  const addScheduleMutate = addSchedule.mutate;
  const addNoteMutate = addNote.mutate;
  const onReact = useCallback(
    (messageId: string, emoji: (typeof EMOJI)[number]) => {
      reactMutate({ messageId, emoji });
      setEmojiPickFor(null);
    },
    [reactMutate],
  );
  const onToggleEmoji = useCallback((messageId: string) => {
    setEmojiPickFor((prev) => (prev === messageId ? null : messageId));
  }, []);
  const onReply = useCallback((messageId: string, userName: string, snippet: string) => {
    setReplyTo({ id: messageId, userName, snippet });
    inputRef.current?.focus();
  }, []);
  const onTogglePin = useCallback(
    (messageId: string, pinned: boolean) => setPinnedMutate({ messageId, pinned }),
    [setPinnedMutate],
  );
  const onToggleTodo = useCallback((messageId: string) => {
    setNoteFor(null);
    setTodoFor((prev) => (prev === messageId ? null : messageId));
  }, []);
  const onToggleNote = useCallback((messageId: string) => {
    setTodoFor(null);
    setNoteFor((prev) => (prev === messageId ? null : messageId));
  }, []);
  const onToggleTask = useCallback((messageId: string) => {
    setTodoFor(null); setNoteFor(null); setDecisionFor(null);
    setTaskFor((prev) => (prev === messageId ? null : messageId));
  }, []);
  const onToggleDecision = useCallback((messageId: string) => {
    setTodoFor(null); setNoteFor(null); setTaskFor(null);
    setDecisionFor((prev) => (prev === messageId ? null : messageId));
  }, []);
  const onCancelTodo = useCallback(() => setTodoFor(null), []);
  const onCancelNote = useCallback(() => setNoteFor(null), []);
  const onSubmitTodo = useCallback(
    (messageId: string, title: string, startsAt: string) =>
      addScheduleMutate({ groupId, projectId, title, startsAt, sourceMessageId: messageId }),
    [addScheduleMutate, groupId, projectId],
  );
  const onSubmitNote = useCallback(
    (messageId: string, title: string, content: string) =>
      addNoteMutate({ groupId, projectId, title, content, sourceMessageId: messageId }),
    [addNoteMutate, groupId, projectId],
  );
  const addTaskMutate = addTask.mutate;
  const onSubmitTask = useCallback(
    (messageId: string, title: string, assigneeId: string | null) =>
      addTaskMutate({ groupId, projectId, title, assigneeId: assigneeId ?? undefined, sourceMessageId: messageId }),
    [addTaskMutate, groupId, projectId],
  );
  const addDecisionMutate = addDecision.mutate;
  const onSubmitDecision = useCallback(
    (messageId: string, title: string) =>
      addDecisionMutate({ projectId, title, sourceMessageId: messageId }),
    [addDecisionMutate, projectId],
  );
  const onJumpRef = useCallback(
    (refType: DiscussRef["refType"], refId: string) => {
      // note/schedule 住在 /planner(另一頁):交棒 sessionStorage 再跳頁,Planner 掛載時高亮
      if (refType === "note" || refType === "schedule") {
        setPlannerFocus(refType, refId);
        navigate("/planner");
      } else {
        jumpToRef(refType, refId);
      }
    },
    [navigate],
  );

  // 內容與外框分離：bare（嵌在創作工作台）與一般（獨立卡片）共用同一份內容，
  // 只有外框不同——一般模式用 <Card as="aside">，bare 模式本來就不是卡片、
  // 不穿卡皮。之前的三元 className 把「card」留在 primitive 之外，也讓
  // 「這裡是不是一張卡」這個決定藏在字串裡而不是結構裡。
  const panelBody = (
    <>

      {/* 📌 釘選列:組長固定的決議,不被日常對話洗掉 */}
      {pinnedMsgs.length > 0 && (
        <div className="pinned-bar" role="note" aria-label="釘選留言">
          {pinnedMsgs.map((m) => (
            <div key={m.id} className="pinned-item">
              <Icon name="Star" size={12} style={{ flexShrink: 0, color: "var(--gold-ink)" }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <b>{m.userName ?? "夥伴"}</b>:{m.body}
              </span>
              {isLeader && (
                <button
                  type="button"
                  className="msg-action"
                  title="取消釘選"
                  disabled={setPinned.isPending}
                  onClick={() => setPinned.mutate({ messageId: m.id, pinned: false })}
                >
                  <Icon name="X" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {list.isLoading && <Meta as="p">載入留言中…</Meta>}
      {list.error && (
        <p className="error" role="alert">
          留言載入失敗：{list.error.message}
          <Button size="sm" style={{ marginLeft: 8 }} onClick={() => list.refetch()}>重試</Button>
        </p>
      )}
      {!list.isLoading && allMessages.length === 0 && <Hint>還沒有留言——留一句給同組夥伴吧。</Hint>}

      <div
        ref={listRef}
        tabIndex={0}
        role="log"
        aria-label="組內留言"
        style={{ maxHeight: 360, overflowY: "auto" }}
        onScroll={() => {
          const el = listRef.current;
          if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {(olderHasMore || (list.data?.hasMore && !older.length)) && (
          <div style={{ textAlign: "center", marginBottom: 6 }}>
            <Button size="sm" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "載入中…" : "載入更早的留言"}
            </Button>
          </div>
        )}
        {allMessages.map((m) => (
          <MessageRow
            key={m.id}
            m={m}
            myId={myId}
            myName={me.data?.user.name}
            nameById={nameById}
            isLeader={isLeader}
            emojiOpen={emojiPickFor === m.id}
            todoOpen={todoFor === m.id}
            noteOpen={noteFor === m.id}
            taskOpen={taskFor === m.id}
            decisionOpen={decisionFor === m.id}
            members={assignableMembers}
            addTaskPending={addTask.isPending}
            addTaskError={addTask.error?.message}
            addDecisionPending={addDecision.isPending}
            addDecisionError={addDecision.error?.message}
            onToggleTask={onToggleTask}
            onToggleDecision={onToggleDecision}
            onSubmitTask={onSubmitTask}
            onSubmitDecision={onSubmitDecision}
            reactPending={react.isPending}
            setPinnedPending={setPinned.isPending}
            addSchedulePending={addSchedule.isPending}
            addScheduleError={addSchedule.error?.message}
            addNotePending={addNote.isPending}
            addNoteError={addNote.error?.message}
            onReact={onReact}
            onToggleEmoji={onToggleEmoji}
            onReply={onReply}
            onTogglePin={onTogglePin}
            onToggleTodo={onToggleTodo}
            onToggleNote={onToggleNote}
            onSubmitTodo={onSubmitTodo}
            onCancelTodo={onCancelTodo}
            onSubmitNote={onSubmitNote}
            onCancelNote={onCancelNote}
            onJumpRef={onJumpRef}
          />
        ))}
      </div>

      {/* 快速短語:一鍵送出,零打字回應;內建短語後接組內夥伴自訂的短語,末尾加「問 AI 助手」把 @助手 帶進輸入框 */}
      <div className="quick-phrases" role="group" aria-label="快速短語">
        {QUICK_PHRASES.map((q) => (
          <button key={q} type="button" className="chip" disabled={post.isPending} onClick={() => send(q)}>
            {q}
          </button>
        ))}
        {/* 自訂短語:一鍵送出(同內建),但每則帶一個「×」可移除;管理面板開啟時才顯示刪除鈕 */}
        {customPhrases.phrases.map((q) => (
          <Chip key={`c-${q}`} className={`custom-phrase${phraseEditorOpen ? " editing" : ""}`}>
            <button type="button" className="phrase-send" disabled={post.isPending} onClick={() => send(q)} title="一鍵送出這句">
              {q}
            </button>
            {phraseEditorOpen && (
              <button
                type="button"
                className="phrase-del"
                aria-label={`移除自訂短語「${q}」`}
                title="移除這則自訂短語"
                onClick={() => customPhrases.remove(q)}
              >
                <Icon name="X" size={11} />
              </button>
            )}
          </Chip>
        ))}
        {/* ＋自訂:展開小面板輸入新短語(可夾 emoji);組內夥伴自行增加自己組的常用語 */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button
            type="button"
            className={`chip${phraseEditorOpen ? " on" : ""}`}
            aria-expanded={phraseEditorOpen}
            title="新增／管理自訂快速短語（存在這台裝置，每組一份）"
            onClick={() => {
              setPhraseEditorOpen((v) => !v);
              if (!phraseEditorOpen) window.setTimeout(() => newPhraseRef.current?.focus(), 0);
            }}
          >
            <Icon name="Plus" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />自訂短語
          </button>
          {phraseEditorOpen && (
            <div className="mention-pop phrase-editor" role="dialog" aria-label="新增自訂快速短語" style={{ bottom: "auto", top: "calc(100% + 6px)", width: 260, padding: 10, gap: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  ref={newPhraseRef}
                  className="phrase-input"
                  value={newPhrase}
                  aria-label="自訂短語內容"
                  maxLength={MAX_PHRASE_LEN}
                  placeholder="例如：素材我來補 📎"
                  onChange={(e) => setNewPhrase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); commitNewPhrase(); }
                    if (e.key === "Escape") setPhraseEditorOpen(false);
                  }}
                />
                <Button size="sm" variant="primary" type="button" disabled={!newPhrase.trim() || customPhrases.atLimit} onClick={commitNewPhrase}>
                  加入
                </Button>
              </div>
              {/* 表情盤:點一下插到輸入框末尾,長輩志工不必切輸入法找符號 */}
              <div className="phrase-emoji-row" role="group" aria-label="插入表情">
                {PHRASE_EMOJI.map((e) => (
                  <button
                    key={e}
                    type="button"
                    aria-label={`插入 ${e}`}
                    onClick={() => { setNewPhrase((p) => (p + e).slice(0, MAX_PHRASE_LEN)); newPhraseRef.current?.focus(); }}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <Meta as="p" style={{ margin: 0 }}>
                {customPhrases.atLimit
                  ? "已達上限，先移除幾則再新增。"
                  : "送出時和內建短語一樣一鍵直送；只存在這台裝置。"}
              </Meta>
            </div>
          )}
        </span>
        <button
          type="button"
          className="chip"
          title="在留言裡問 AI 助手（讀專案與知識庫後回答）"
          onClick={() => {
            setBody(body.includes(ASSISTANT_TRIGGER) ? body : `${ASSISTANT_TRIGGER} ${body}`.trimEnd() + " ");
            inputRef.current?.focus();
          }}
        >
          <Icon name="Sparkles" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />問 AI 助手
        </button>
        {/* 引用排程/筆記:把本組的某個排程或筆記帶進這則留言（變成可點回原件的卡片） */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button type="button" className="chip" title="引用一個排程或筆記" onClick={() => setRefPickerOpen((v) => !v)}>
            <Icon name="Clock" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />引用排程/筆記
          </button>
          {refPickerOpen && (
            <div className="mention-pop" role="listbox" aria-label="引用排程或筆記" style={{ bottom: "auto", top: "calc(100% + 6px)", maxHeight: 240, overflowY: "auto" }}>
              {(scheduleQ.data?.items ?? []).slice(0, 8).map((s) => (
                <button key={`s-${s.id}`} type="button" role="option" aria-selected="false"
                  onClick={() => { setPendingRef({ refType: "schedule", refId: s.id, title: s.title }); setRefPickerOpen(false); }}>
                  <Icon name="Clock" size={12} style={{ marginRight: 5 }} />{s.title}
                </button>
              ))}
              {(Array.isArray(notesQ.data) ? notesQ.data : notesQ.data?.items ?? []).slice(0, 8).map((n) => (
                <button key={`n-${n.id}`} type="button" role="option" aria-selected="false"
                  onClick={() => { setPendingRef({ refType: "note", refId: n.id, title: n.title }); setRefPickerOpen(false); }}>
                  <Icon name="FileText" size={12} style={{ marginRight: 5 }} />{n.title}
                </button>
              ))}
              {!scheduleQ.data?.items.length && !(Array.isArray(notesQ.data) ? notesQ.data : notesQ.data?.items ?? []).length && (
                <Hint as="span" style={{ padding: "8px 12px" }}>還沒有排程或筆記——先到「筆記排程」建立</Hint>
              )}
            </div>
          )}
        </span>
      </div>

      {/* 回覆/引用狀態列:讓人看清楚「即將送出的是什麼」,可取消 */}
      {replyTo && (
        <div className="compose-ctx">
          <Icon name="Undo2" size={12} /> 回覆 {replyTo.userName}:{replyTo.snippet}
          <button type="button" className="msg-action" aria-label="取消回覆" onClick={() => setReplyTo(null)}>
            <Icon name="X" size={12} />
          </button>
        </div>
      )}
      {pendingRef && (
        <div className="compose-ctx">
          <Icon name="MessageCircle" size={12} /> 討論{REF_LABEL[pendingRef.refType]}:{pendingRef.title}
          <button type="button" className="msg-action" aria-label="取消引用" onClick={() => setPendingRef(null)}>
            <Icon name="X" size={12} />
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8, position: "relative" }}>
        <input
          ref={inputRef}
          value={body}
          aria-label="留言給同組夥伴"
          maxLength={2000}
          onChange={(e) => {
            setBody(e.target.value);
            detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onFocus={(e) => focusAndReveal(e.currentTarget)}
          placeholder={pendingRef ? "說說你對這個作品的想法…" : "留言給同組夥伴…（輸入 @ 可提及）"}
          onKeyDown={(e) => {
            // 注音/拼音選字中的 Enter 是「選字」不是「送出」(isComposing 需排除);
            // isPending 防連按 Enter 重複送出(送出按鈕本來就有擋,這裡補齊)
            if (e.key === "Escape") setMentionQuery(null);
            if (e.key === "Enter" && !e.nativeEvent.isComposing && mentionCandidates.length && mentionQuery !== null) {
              e.preventDefault();
              insertMention(mentionCandidates[0].name);
              return;
            }
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send(body);
          }}
        />
        {/* @提及下拉:游標前有「@字首」時浮出同組名單 */}
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div className="mention-pop" role="listbox" aria-label="提及夥伴">
            {mentionCandidates.map((m) => (
              <button key={m.userId} type="button" role="option" aria-selected="false" onClick={() => insertMention(m.name)}>
                @{m.name}
                <Meta style={{ marginLeft: 6 }}>{m.groupRole === "leader" ? "組長" : ""}</Meta>
              </button>
            ))}
          </div>
        )}
        {/* 語音留言:editor 才有(上傳需編輯權);錄音中變成停止鈕 */}
        {canEdit && (
          recording ? (
            <button className="recording" title="停止並送出語音" aria-label="停止錄音" onClick={stopRecording}>
              <Icon name="Square" size={16} /> 停止
            </button>
          ) : (
            <button
              type="button"
              aria-label="錄語音留言"
              title="按住說話比打字快——錄完自動附逐字稿"
              disabled={postVoice.isPending}
              onClick={startRecording}
              style={{ display: "inline-flex", alignItems: "center" }}
            >
              <Icon name="Mic" size={16} />
            </button>
          )
        )}
        <button className="primary" disabled={!body.trim() || post.isPending} onClick={() => send(body)}>
          送出
        </button>
      </div>
      {recording && <Meta as="p" role="status" style={{ color: "var(--danger-ink)" }}>● 錄音中…說完按「停止」送出</Meta>}
      {postVoice.isPending && <Meta as="p">語音上傳中…</Meta>}
      {voiceErr && <p className="error">{voiceErr}</p>}
      {/* 失敗要讓人看得到:先前送出失敗畫面毫無反應,使用者以為有送出 */}
      {post.error && <p className="error">留言送出失敗：{post.error.message}</p>}
      {react.error && <p className="error">表情回應失敗：{react.error.message}</p>}
      {setPinned.error && <p className="error">釘選失敗：{setPinned.error.message}</p>}
    </>
  );
  return bare ? (
    <aside className="message-panel message-panel--bare" data-fb="組內留言" ref={panelRef}>
      {panelBody}
    </aside>
  ) : (
    <Card as="aside" className="message-panel" data-fb="組內留言" ref={panelRef}>
      <h2>組內留言</h2>
      {panelBody}
    </Card>
  );
}
