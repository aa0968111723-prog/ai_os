/**
 * PR-6A：專案頁「AI 工作電腦」卡 — session 列表、Live View、停止。
 * Feature flag off → 完全不渲染（原 Agent 行為不變）。
 */
import { useState } from "react";
import { trpc } from "../../api";
import { Button, Card, Chip, Meta, Pill } from "../../components/ui";
import { Icon } from "../../components/Icon";

export function ComputerRuntimeCard({ projectId }: { projectId: string }) {
  const status = trpc.computerRuntime.status.useQuery(undefined, { staleTime: 30_000 });
  const utils = trpc.useUtils();
  const sessions = trpc.computerRuntime.listByProject.useQuery(
    { projectId },
    { enabled: !!status.data?.enabled && !!projectId, refetchInterval: 15_000 },
  );
  const [startUrl, setStartUrl] = useState("https://example.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = trpc.computerRuntime.createSession.useMutation({
    onSuccess: async () => {
      await utils.computerRuntime.listByProject.invalidate({ projectId });
    },
  });
  const stop = trpc.computerRuntime.stop.useMutation({
    onSuccess: async () => {
      await utils.computerRuntime.listByProject.invalidate({ projectId });
    },
  });
  const live = trpc.computerRuntime.issueLiveView.useMutation();

  if (status.isLoading) return null;
  if (!status.data?.enabled) return null;

  const active = (sessions.data ?? []).filter(
    (s) => !["completed", "failed", "stopped", "expired"].includes(s.status),
  );

  return (
    <Card as="section" variant="primary" data-fb="AI 工作電腦" id="sec-computer-runtime">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icon name="Monitor" size={16} />
        <strong>AI 工作電腦</strong>
        <Chip>Browser · PR-6A</Chip>
        {active.length > 0 && <Pill status="running">LIVE · {active.length}</Pill>}
      </div>
      <Meta as="p" style={{ margin: "6px 0 10px" }}>
        隔離 Browser Runtime：可觀看、可停止。登入與敏感輸入請用後續 Human Takeover（PR-6B）。
      </Meta>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="url"
          value={startUrl}
          onChange={(e) => setStartUrl(e.target.value)}
          aria-label="起始網址"
          style={{ flex: "1 1 200px", minWidth: 0 }}
          placeholder="https://"
        />
        <Button
          size="sm"
          variant="primary"
          disabled={busy || create.isPending}
          onClick={async () => {
            setError(null);
            setBusy(true);
            try {
              await create.mutateAsync({ projectId, startUrl: startUrl.trim() || undefined, label: "AI 工作電腦" });
            } catch (err) {
              setError(err instanceof Error ? err.message : "建立失敗");
            } finally {
              setBusy(false);
            }
          }}
        >
          {create.isPending ? "啟動中…" : "啟動 Browser"}
        </Button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 8 }}>
        {(sessions.data ?? []).slice(0, 8).map((s) => (
          <li
            key={s.sessionId}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              padding: "8px 10px",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--r-6)",
            }}
          >
            <Pill status={s.status === "agent_control" || s.status === "ready" ? "running" : "queued"}>
              {s.status}
            </Pill>
            <Meta as="span" style={{ flex: "1 1 120px", minWidth: 0, wordBreak: "break-all" }}>
              {s.currentUrl || s.label || s.sessionId.slice(0, 8)}
            </Meta>
            <Meta as="span">{s.actionCount} 步</Meta>
            {!["completed", "failed", "stopped", "expired"].includes(s.status) && (
              <>
                <Button
                  size="sm"
                  type="button"
                  disabled={live.isPending}
                  onClick={async () => {
                    try {
                      const view = await live.mutateAsync({ sessionId: s.sessionId, mode: "watch" });
                      window.open(view.embedUrl, "_blank", "noopener,noreferrer");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Live View 失敗");
                    }
                  }}
                >
                  觀看
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  disabled={stop.isPending}
                  onClick={() => stop.mutate({ sessionId: s.sessionId })}
                >
                  停止
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {(sessions.data ?? []).length === 0 && (
        <Meta as="p" style={{ marginTop: 10 }}>尚無 session。啟用後可從這裡開第一台隔離瀏覽器。</Meta>
      )}
    </Card>
  );
}
