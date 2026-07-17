import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { DISCUSS_EVENT, jumpToRef, type DiscussRef } from "../discuss";

/** 留言 @了助手就觸發 AI 回覆——與後端 messageAssistant.ASSISTANT_TRIGGER 同字串 */
const ASSISTANT_TRIGGER = "@助手";

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
      <button
        className="primary btn-sm"
        disabled={!title.trim() || !date || pending}
        onClick={() => onSubmit(title.trim(), new Date(date).toISOString())}
      >
        建立待辦
      </button>
      <button className="btn-sm" onClick={onCancel}>取消</button>
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

/** 快速短語:一鍵直接送出;內容貼合團隊日常(確認/隨喜/接手/請示) */
const QUICK_PHRASES = ["收到 🙏", "隨喜讚歎 ✨", "我來處理 💪", "請組長過目 🙏"];

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

const REF_LABEL: Record<DiscussRef["refType"], string> = { scene: "分鏡", asset: "素材", generation: "生成" };

/** 把留言內文的 @名字 標亮(只認真的被提及者名單,不誤標普通 @ 符號) */
function renderBody(body: string, mentionNames: string[]) {
  if (!mentionNames.length) return body;
  // 名字可能含正則特殊字元,逐一跳脫;長名優先比對避免「阿明」吃掉「阿明師兄」
  const escaped = [...mentionNames].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return parts.map((part, idx) =>
    part.startsWith("@") && mentionNames.includes(part.slice(1)) ? (
      <mark key={idx} className="mention">{part}</mark>
    ) : (
      part
    ),
  );
}

export function MessagePanel({ projectId, groupId, isLeader, canEdit }: { projectId: string; groupId: string; isLeader: boolean; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const list = trpc.messages.list.useQuery({ projectId }, { refetchInterval: 8000 });
  // @提及名單:與 ProjectMembersCard 共用同一查詢(react-query 去重,不多打 API)
  const roles = trpc.projects.listMemberRoles.useQuery({ projectId });
  const post = trpc.messages.post.useMutation({
    onSuccess: () => {
      setBody("");
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
  const react = trpc.messages.react.useMutation({ onSuccess: () => utils.messages.list.invalidate({ projectId }) });
  const setPinned = trpc.messages.setPinned.useMutation({ onSuccess: () => utils.messages.list.invalidate({ projectId }) });
  const markRead = trpc.messages.markRead.useMutation({
    onSuccess: () => utils.messages.unread.invalidate({ projectId }),
  });
  const addSchedule = trpc.schedule.add.useMutation({ onSuccess: () => setTodoFor(null) });

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; userName: string; snippet: string } | null>(null);
  const [pendingRef, setPendingRef] = useState<DiscussRef | null>(null);
  const [emojiPickFor, setEmojiPickFor] = useState<string | null>(null);
  const [todoFor, setTodoFor] = useState<{ id: string; body: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
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

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [list.data]);

  // 已讀水位:視窗聚焦且列表刷新出「最新一則」時上報(30 秒節流,避免高頻寫)
  const lastMarked = useRef(0);
  useEffect(() => {
    if (!list.data?.length) return;
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastMarked.current < 30_000) return;
    lastMarked.current = Date.now();
    markRead.mutate({ projectId });
    // markRead 只依「最新一則留言」變化觸發——mutation 物件每 render 都新,不能進依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data?.length && list.data[list.data.length - 1].id, projectId]);

  // 「在留言中討論」事件:各列表的討論鈕 → 把作品掛進輸入區、捲到留言面板、聚焦
  useEffect(() => {
    const onDiscuss = (e: Event) => {
      const ref = (e as CustomEvent<DiscussRef>).detail;
      setPendingRef(ref);
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => inputRef.current?.focus(), 350);
    };
    window.addEventListener(DISCUSS_EVENT, onDiscuss);
    return () => window.removeEventListener(DISCUSS_EVENT, onDiscuss);
  }, []);

  // 被提及/釘選/助手回覆桌面通知:記住看過的最新一則,新到的他人留言若 @我 或釘選就通知。
  // 首次載入(seenLatest 未定)不通知——只提示「這次會話新到的」,不轟炸歷史。
  const seenLatest = useRef<string | null>(null);
  useEffect(() => {
    const rows = list.data;
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
  }, [list.data?.length && list.data[list.data.length - 1].id, myId]);

  // 錄音:MediaRecorder 收 chunks → 停止時上傳為素材 → postVoice 建語音留言(逐字稿由後端補)
  const startRecording = async () => {
    setVoiceErr(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceErr("這個瀏覽器不支援錄音，請改用打字或上傳音檔。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
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
    // 提及=內文仍出現「@名字」的同組成員(打了又刪掉的不算)
    const mentions = (roles.data?.members ?? [])
      .filter((m) => trimmed.includes(`@${m.name}`))
      .map((m) => m.userId);
    post.mutate({
      projectId,
      body: trimmed,
      replyToId: replyTo?.id,
      refType: pendingRef?.refType,
      refId: pendingRef?.refId,
      mentions: mentions.length ? mentions : undefined,
    });
  };

  const pinnedMsgs = (list.data ?? []).filter((m) => m.pinned);

  return (
    <aside className="card" data-fb="組內留言" ref={panelRef}>
      <h2>組內留言</h2>

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

      {list.isLoading && <p className="hint">載入留言中…</p>}
      {list.error && <p className="error">留言載入失敗，稍後會自動重試。</p>}
      {!list.isLoading && list.data?.length === 0 && <p className="hint">還沒有留言——留一句給同組夥伴吧。</p>}

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
        {list.data?.map((m) => {
          // 系統訊息(審核結果通知等):置中淡色小字,跟夥伴的對話區隔開
          if (m.kind === "system") {
            return (
              <div key={m.id} style={{ textAlign: "center", color: "var(--fg-secondary)", fontSize: "var(--fs-12)", marginTop: 10 }}>
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
            <div key={m.id} className={`msg-block${mentionedMe ? " mentioned-me" : ""}${isAssistant ? " assistant" : ""}`}>
              <div className="msg">
                <span className="who">
                  {isAssistant ? (
                    <><Icon name="Sparkles" size={12} style={{ marginRight: 3, color: "var(--primary-ink)" }} />AI 助手</>
                  ) : (
                    <>{m.userName ?? (mine ? me.data?.user.name : "夥伴")}{mine ? "（我）" : ""}</>
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
                    <span className={m.voiceStatus === "pending" ? "hint" : undefined}>{m.body}</span>
                  ) : (
                    <span>{renderBody(m.body, mentionNames)}</span>
                  )}
                  {/* 🔗 引用作品卡:縮圖+標題,點「查看」跳回原件 */}
                  {m.refType && m.refId && (
                    <button
                      type="button"
                      className="ref-card"
                      title={m.ref ? "跳到這個作品" : undefined}
                      onClick={() => m.ref && jumpToRef(m.refType!, m.refId!)}
                      disabled={!m.ref}
                    >
                      {m.ref?.thumb ? (
                        <img src={m.ref.thumb} alt="" loading="lazy" />
                      ) : (
                        <Icon name={m.refType === "scene" ? "Clapperboard" : m.refType === "asset" ? "FileText" : "Sparkles"} size={14} />
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
                    disabled={react.isPending}
                    onClick={() => react.mutate({ messageId: m.id, emoji: r.emoji as (typeof EMOJI)[number] })}
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
                    onClick={() => setEmojiPickFor(emojiPickFor === m.id ? null : m.id)}
                  >
                    <Icon name="Plus" size={12} />
                  </button>
                  {emojiPickFor === m.id && (
                    <div className="emoji-pop" role="menu">
                      {EMOJI.map((e) => (
                        <button
                          key={e}
                          type="button"
                          disabled={react.isPending}
                          onClick={() => {
                            react.mutate({ messageId: m.id, emoji: e });
                            setEmojiPickFor(null);
                          }}
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
                  onClick={() => {
                    setReplyTo({ id: m.id, userName: m.userName ?? "夥伴", snippet: m.body.slice(0, 40) });
                    inputRef.current?.focus();
                  }}
                >
                  <Icon name="Undo2" size={12} /> 回覆
                </button>
                {isLeader && (
                  <button
                    type="button"
                    className="msg-action"
                    title={m.pinned ? "取消釘選" : "釘選(固定在頂部)"}
                    disabled={setPinned.isPending}
                    onClick={() => setPinned.mutate({ messageId: m.id, pinned: !m.pinned })}
                  >
                    <Icon name="Star" size={12} /> {m.pinned ? "取消釘選" : "釘選"}
                  </button>
                )}
                {/* 轉待辦:把口頭承諾變成有期限的排程項(組內任何人可加,後端 requireGroup) */}
                <button
                  type="button"
                  className="msg-action"
                  title="把這句轉成排程待辦"
                  onClick={() => setTodoFor(todoFor?.id === m.id ? null : { id: m.id, body: m.body })}
                >
                  <Icon name="CalendarPlus" size={12} /> 轉待辦
                </button>
              </div>
              {/* 轉待辦行內表單:標題預填留言內容、選截止日 → schedule.add */}
              {todoFor?.id === m.id && (
                <TodoForm
                  defaultTitle={m.body.slice(0, 120)}
                  pending={addSchedule.isPending}
                  error={addSchedule.error?.message}
                  onCancel={() => setTodoFor(null)}
                  onSubmit={(title, startsAt) => addSchedule.mutate({ groupId, projectId, title, startsAt })}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 快速短語:一鍵送出,零打字回應;末尾加「問 AI 助手」把 @助手 帶進輸入框 */}
      <div className="quick-phrases" role="group" aria-label="快速短語">
        {QUICK_PHRASES.map((q) => (
          <button key={q} type="button" className="chip" disabled={post.isPending} onClick={() => send(q)}>
            {q}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          title="在留言裡問 AI 助手（讀專案與知識庫後回答）"
          onClick={() => {
            setBody((b) => (b.includes(ASSISTANT_TRIGGER) ? b : `${ASSISTANT_TRIGGER} ${b}`.trimEnd() + " "));
            inputRef.current?.focus();
          }}
        >
          <Icon name="Sparkles" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />問 AI 助手
        </button>
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
                <span className="hint" style={{ marginLeft: 6 }}>{m.groupRole === "leader" ? "組長" : ""}</span>
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
      {recording && <p className="hint" role="status" style={{ color: "var(--danger-ink)" }}>● 錄音中…說完按「停止」送出</p>}
      {postVoice.isPending && <p className="hint">語音上傳中…</p>}
      {voiceErr && <p className="error">{voiceErr}</p>}
      {/* 失敗要讓人看得到:先前送出失敗畫面毫無反應,使用者以為有送出 */}
      {post.error && <p className="error">留言送出失敗：{post.error.message}</p>}
      {react.error && <p className="error">表情回應失敗：{react.error.message}</p>}
      {setPinned.error && <p className="error">釘選失敗：{setPinned.error.message}</p>}
    </aside>
  );
}
