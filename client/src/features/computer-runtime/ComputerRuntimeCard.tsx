/**
 * AI 工作電腦卡 — PR-6A session + PR-6B Human Takeover.
 * Feature flag off → 完全不渲染。
 */
import { useState } from "react";
import { trpc } from "../../api";
import { Button, Card, Chip, Meta, Pill } from "../../components/ui";
import { Icon } from "../../components/Icon";

function statusLabel(status: string): string {
  switch (status) {
    case "agent_control":
    case "ready":
      return "AI 操作中";
    case "waiting_human":
      return "等你接管";
    case "human_control":
      return "你正在操作";
    case "stopped":
      return "已停止";
    case "expired":
      return "已逾時";
    case "failed":
      return "失敗";
    default:
      return status;
  }
}

export function ComputerRuntimeCard({ projectId }: { projectId: string }) {
  const status = trpc.computerRuntime.status.useQuery(undefined, { staleTime: 30_000 });
  const utils = trpc.useUtils();
  const sessions = trpc.computerRuntime.listByProject.useQuery(
    { projectId },
    { enabled: !!status.data?.enabled && !!projectId, refetchInterval: 8_000 },
  );
  const [startUrl, setStartUrl] = useState("https://example.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidate = async () => {
    await utils.computerRuntime.listByProject.invalidate({ projectId });
  };

  const create = trpc.computerRuntime.createSession.useMutation({ onSuccess: invalidate });
  const stop = trpc.computerRuntime.stop.useMutation({ onSuccess: invalidate });
  const live = trpc.computerRuntime.issueLiveView.useMutation();
  const requestTakeover = trpc.computerRuntime.requestTakeover.useMutation({ onSuccess: invalidate });
  const acquireControl = trpc.computerRuntime.acquireControl.useMutation({ onSuccess: invalidate });
  const releaseToAgent = trpc.computerRuntime.releaseToAgent.useMutation({ onSuccess: invalidate });

  if (status.isLoading) return null;
  if (!status.data?.enabled) return null;

  const takeoverOn = status.data.humanTakeoverEnabled !== false;
  const active = (sessions.data ?? []).filter(
    (s) => !["completed", "failed", "stopped", "expired"].includes(s.status),
  );

  return (
    <Card as="section" variant="primary" data-fb="AI 工作電腦" id="sec-computer-runtime">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icon name="Monitor" size={16} />
        <strong>AI 工作電腦</strong>
        <Chip>Browser · PR-6B</Chip>
        {active.length > 0 && <Pill status="running">LIVE · {active.length}</Pill>}
      </div>
      <Meta as="p" style={{ margin: "6px 0 10px" }}>
        隔離 Browser：可觀看、接管、交回、停止。
        登入／2FA 請用「我來操作」；密碼與 OTP 不會寫入 agent log。
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
              await create.mutateAsync({
                projectId,
                startUrl: startUrl.trim() || undefined,
                label: "AI 工作電腦",
              });
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
        {(sessions.data ?? []).slice(0, 8).map((s) => {
          const terminal = ["completed", "failed", "stopped", "expired"].includes(s.status);
          const waitingHuman = s.status === "waiting_human";
          const humanControl = s.status === "human_control";
          const agentActive = s.status === "agent_control" || s.status === "ready";

          return (
            <li
              key={s.sessionId}
              style={{
                display: "grid",
                gap: 8,
                padding: "10px 12px",
                border: "1px solid var(--border-soft)",
                borderRadius: "var(--r-6)",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <Pill
                  status={
                    humanControl || waitingHuman
                      ? "queued"
                      : agentActive
                        ? "running"
                        : "queued"
                  }
                >
                  {statusLabel(s.status)}
                </Pill>
                <Meta as="span" style={{ flex: "1 1 120px", minWidth: 0, wordBreak: "break-all" }}>
                  {s.currentUrl || s.label || s.sessionId.slice(0, 8)}
                </Meta>
                <Meta as="span">{s.actionCount} 步</Meta>
                {s.needsReobserve && <Chip>需重新觀察</Chip>}
              </div>

              {(waitingHuman || humanControl) && s.takeoverReason && (
                <Meta as="p" style={{ margin: 0 }} role="status">
                  需要你接管：{s.takeoverReason}
                </Meta>
              )}

              {!terminal && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <Button
                    size="sm"
                    type="button"
                    disabled={live.isPending}
                    onClick={async () => {
                      try {
                        const mode = humanControl ? "control" : "watch";
                        const view = await live.mutateAsync({ sessionId: s.sessionId, mode });
                        window.open(view.embedUrl, "_blank", "noopener,noreferrer");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Live View 失敗");
                      }
                    }}
                  >
                    {humanControl ? "控制畫面" : "觀看"}
                  </Button>

                  {takeoverOn && agentActive && (
                    <>
                      <Button
                        size="sm"
                        type="button"
                        disabled={requestTakeover.isPending || acquireControl.isPending}
                        onClick={async () => {
                          setError(null);
                          try {
                            await requestTakeover.mutateAsync({
                              sessionId: s.sessionId,
                              reasonCode: "user_requested",
                              userMessage: "使用者要求接管操作",
                              expectedLeaseVersion: s.leaseVersion,
                            });
                            await acquireControl.mutateAsync({
                              sessionId: s.sessionId,
                            });
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "接管失敗");
                          }
                        }}
                      >
                        我來操作
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        disabled={requestTakeover.isPending}
                        onClick={async () => {
                          setError(null);
                          try {
                            await requestTakeover.mutateAsync({
                              sessionId: s.sessionId,
                              reasonCode: "login_required",
                              userMessage: "需要你登入外部服務（請勿在聊天中貼密碼）",
                              expectedLeaseVersion: s.leaseVersion,
                            });
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "請求接管失敗");
                          }
                        }}
                      >
                        需要登入
                      </Button>
                    </>
                  )}

                  {takeoverOn && waitingHuman && (
                    <Button
                      size="sm"
                      variant="primary"
                      type="button"
                      disabled={acquireControl.isPending}
                      onClick={async () => {
                        setError(null);
                        try {
                          await acquireControl.mutateAsync({
                            sessionId: s.sessionId,
                            expectedLeaseVersion: s.leaseVersion,
                          });
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "取得控制權失敗");
                        }
                      }}
                    >
                      開始接管
                    </Button>
                  )}

                  {takeoverOn && humanControl && (
                    <Button
                      size="sm"
                      variant="primary"
                      type="button"
                      disabled={releaseToAgent.isPending}
                      onClick={async () => {
                        setError(null);
                        try {
                          await releaseToAgent.mutateAsync({
                            sessionId: s.sessionId,
                            expectedLeaseVersion: s.leaseVersion,
                          });
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "交回失敗");
                        }
                      }}
                    >
                      交回 AI
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    disabled={stop.isPending}
                    onClick={() => stop.mutate({ sessionId: s.sessionId })}
                  >
                    停止
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {(sessions.data ?? []).length === 0 && (
        <Meta as="p" style={{ marginTop: 10 }}>
          尚無 session。啟用 COMPUTER_RUNTIME_ENABLED 後可從這裡開隔離瀏覽器。
        </Meta>
      )}
    </Card>
  );
}
