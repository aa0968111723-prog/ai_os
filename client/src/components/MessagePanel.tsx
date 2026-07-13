import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";

/** 站內留言（簡化定案：8 秒輪詢刷新） */
export function MessagePanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const list = trpc.messages.list.useQuery({ projectId }, { refetchInterval: 8000 });
  const post = trpc.messages.post.useMutation({
    onSuccess: () => {
      setBody("");
      // 自己送出視同回到底部：就算正往上翻舊留言，也要看見自己的留言已送出
      stickToBottom.current = true;
      utils.messages.list.invalidate({ projectId });
    },
  });
  const [body, setBody] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  // 使用者是否停在底部：只有在底部才自動捲到最新，往上翻舊留言時不硬拉回去
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [list.data]);

  return (
    <aside className="card" data-fb="組內留言">
      <h2>組內留言</h2>
      {list.isLoading && <p className="hint">載入留言中…</p>}
      {list.error && <p className="error">留言載入失敗，稍後會自動重試。</p>}
      {!list.isLoading && list.data?.length === 0 && <p className="hint">還沒有留言——留一句給同組夥伴吧。</p>}
      <div
        ref={listRef}
        style={{ maxHeight: 360, overflowY: "auto" }}
        onScroll={() => {
          const el = listRef.current;
          if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {list.data?.map((m) => {
          // 系統訊息（審核結果通知等）：置中淡色小字，跟夥伴的對話區隔開
          if (m.kind === "system") {
            return (
              <div key={m.id} style={{ textAlign: "center", color: "var(--soft)", fontSize: 12, marginTop: 10 }}>
                {m.body}
              </div>
            );
          }
          const mine = m.userId === me.data?.user.id;
          return (
            <div key={m.id} className="msg">
              <span className="who">{m.userName ?? (mine ? me.data?.user.name : "夥伴")}{mine ? "（我）" : ""}</span>
              <span style={{ flex: 1 }}>{m.body}</span>
              <span className="time">
                {new Date(m.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input
          value={body}
          aria-label="留言給同組夥伴"
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="留言給同組夥伴…"
          onKeyDown={(e) => {
            // 注音/拼音選字中的 Enter 是「選字」不是「送出」（isComposing 需排除）；
            // isPending 防連按 Enter 重複送出（送出按鈕本來就有擋，這裡補齊）
            if (e.key === "Enter" && !e.nativeEvent.isComposing && body.trim() && !post.isPending) {
              post.mutate({ projectId, body: body.trim() });
            }
          }}
        />
        <button className="primary" disabled={!body.trim() || post.isPending} onClick={() => post.mutate({ projectId, body: body.trim() })}>
          送出
        </button>
      </div>
      {/* 失敗要讓人看得到：先前送出失敗畫面毫無反應，使用者以為有送出 */}
      {post.error && <p className="error">留言送出失敗：{post.error.message}</p>}
    </aside>
  );
}
