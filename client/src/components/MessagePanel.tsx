import { useState } from "react";
import { trpc } from "../api";

/** 站內留言（簡化定案：8 秒輪詢刷新） */
export function MessagePanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const list = trpc.messages.list.useQuery({ projectId }, { refetchInterval: 8000 });
  const post = trpc.messages.post.useMutation({
    onSuccess: () => {
      setBody("");
      utils.messages.list.invalidate({ projectId });
    },
  });
  const [body, setBody] = useState("");

  return (
    <aside className="card">
      <h2>組內留言</h2>
      {list.data?.length === 0 && <p className="hint">還沒有留言。</p>}
      <div>
        {list.data?.map((m) => (
          <div key={m.id} className="msg">
            <span className="who">{m.userName ?? (m.userId === me.data?.user.id ? me.data.user.name : "夥伴")}</span>
            <span style={{ flex: 1 }}>{m.body}</span>
            <span className="time">
              {new Date(m.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input
          value={body}
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
