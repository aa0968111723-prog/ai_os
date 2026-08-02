import { useState } from "react";
import { trpc } from "../../api";
import { Button, Card, Chip, Meta } from "../../components/ui";

const MODE_LABEL: Record<string, string> = {
  ask: "一起想",
  generate: "直接生成",
  workflow: "製作範本",
  agent_plan: "多步計畫",
  quality_review: "品質檢查",
};

export function AiTraceHistory({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = trpc.aiTrace?.listByProject?.useQuery?.({ projectId, limit: 30 }, { enabled: open })
    ?? { data: undefined, error: null, isLoading: false };
  const detail = trpc.aiTrace?.get?.useQuery?.(
    { projectId, sessionId: selectedId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(open && selectedId) },
  ) ?? { data: undefined, error: null, isLoading: false };

  return (
    <div style={{ marginLeft: 4 }}>
      <Button type="button" size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        實際運作紀錄
      </Button>
      {open ? (
        <Card style={{ position: "absolute", right: 12, zIndex: 20, width: "min(720px, calc(100vw - 32px))", maxHeight: "70vh", overflow: "auto", padding: 12, marginTop: 6 }}>
          <strong>專案 AI 實際運作紀錄</strong>
          <Meta as="p">永久隨專案保存，只開放專案編輯者；敏感金鑰與模型私密推理不會保存。</Meta>
          {list.isLoading ? <Meta as="p">載入中…</Meta> : null}
          {list.error ? <p className="error">{list.error.message}</p> : null}
          {(list.data ?? []).map((session) => (
            <button
              type="button"
              key={session.id}
              onClick={() => setSelectedId(session.id)}
              style={{ display: "flex", width: "100%", gap: 8, alignItems: "center", textAlign: "left", marginBottom: 6 }}
            >
              <Chip>{MODE_LABEL[session.mode] ?? session.mode}</Chip>
              <span style={{ flex: 1 }}>{session.title}</span>
              <Meta>{new Date(session.createdAt).toLocaleString("zh-TW", { hour12: false })}</Meta>
            </button>
          ))}
          {!list.isLoading && list.data?.length === 0 ? <Meta as="p">還沒有 AI 運作紀錄。</Meta> : null}

          {selectedId ? (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
              <strong>{detail.data?.session.title ?? "讀取紀錄…"}</strong>
              {detail.data?.events.map((event) => (
                <details key={event.id} style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer" }}>#{event.sequence} {event.summary}</summary>
                  <pre style={{ maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--card2)", padding: 8, borderRadius: 8, fontSize: 12 }}>
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
