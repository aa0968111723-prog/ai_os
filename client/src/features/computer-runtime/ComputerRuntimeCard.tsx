/**
 * AI 工作電腦卡 — PR-6A…6E（session / takeover / artifacts / desktop / persisted auth）.
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
  const detectArt = trpc.computerRuntime.detectMockArtifact.useMutation({ onSuccess: invalidate });
  const importArt = trpc.computerRuntime.importArtifact.useMutation({ onSuccess: invalidate });
  const createDesktop = trpc.computerRuntime.createDesktopSession.useMutation({ onSuccess: invalidate });
  const escalate = trpc.computerRuntime.escalateToDesktop.useMutation({ onSuccess: invalidate });
  const desktopAct = trpc.computerRuntime.desktopAct.useMutation({ onSuccess: invalidate });
  const planDesktop = trpc.computerRuntime.planDesktopActions.useMutation();
  const saveAuth = trpc.computerRuntime.saveAuthContext.useMutation({
    onSuccess: () => utils.computerRuntime.listAuthContexts.invalidate(),
  });
  const revokeAuth = trpc.computerRuntime.revokeAuthContext.useMutation({
    onSuccess: () => utils.computerRuntime.listAuthContexts.invalidate(),
  });
  const [artifactSessionId, setArtifactSessionId] = useState<string | null>(null);
  const [planPreview, setPlanPreview] = useState<string | null>(null);
  const [reuseAuthId, setReuseAuthId] = useState<string>("");
  const [showAuthList, setShowAuthList] = useState(false);
  const artifacts = trpc.computerRuntime.listArtifacts.useQuery(
    { sessionId: artifactSessionId! },
    { enabled: !!artifactSessionId && !!status.data?.artifactIngestionEnabled, refetchInterval: 10_000 },
  );
  const authContexts = trpc.computerRuntime.listAuthContexts.useQuery(
    undefined,
    {
      enabled: !!status.data?.enabled && !!status.data?.persistedAuthEnabled,
      staleTime: 15_000,
    },
  );

  if (status.isLoading) return null;
  if (!status.data?.enabled) return null;

  const takeoverOn = status.data.humanTakeoverEnabled !== false;
  const artifactsOn = status.data.artifactIngestionEnabled !== false;
  const desktopOn = !!status.data.desktopEnabled;
  const authOn = !!status.data.persistedAuthEnabled;
  const activeAuths = (authContexts.data ?? []).filter((a) => !a.revokedAt);
  const active = (sessions.data ?? []).filter(
    (s) => !["completed", "failed", "stopped", "expired"].includes(s.status),
  );

  return (
    <Card as="section" variant="primary" data-fb="AI 工作電腦" id="sec-computer-runtime">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icon name="Monitor" size={16} />
        <strong>AI 工作電腦</strong>
        <Chip>Runtime · PR-6E</Chip>
        {active.length > 0 && <Pill status="running">LIVE · {active.length}</Pill>}
      </div>
      <Meta as="p" style={{ margin: "6px 0 10px" }}>
        隔離 Browser / Desktop：可觀看、接管、交回、成品匯入、停止。
        記住登入預設關閉（COMPUTER_PERSISTED_AUTH_ENABLED）；只存加密 opaque，不含密碼。
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
        {authOn && activeAuths.length > 0 && (
          <select
            aria-label="使用已記住登入"
            value={reuseAuthId}
            onChange={(e) => setReuseAuthId(e.target.value)}
            style={{ maxWidth: 200 }}
          >
            <option value="">不使用記住登入</option>
            {activeAuths.map((a) => (
              <option key={a.id} value={a.id}>
                {a.serviceLabel || a.serviceHost}
              </option>
            ))}
          </select>
        )}
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
                authContextId: reuseAuthId || undefined,
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
        {desktopOn && (
          <Button
            size="sm"
            type="button"
            disabled={busy || createDesktop.isPending}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                await createDesktop.mutateAsync({
                  projectId,
                  startApp: "desktop",
                  label: "AI 桌面工作電腦",
                });
              } catch (err) {
                setError(err instanceof Error ? err.message : "建立桌面失敗");
              } finally {
                setBusy(false);
              }
            }}
          >
            {createDesktop.isPending ? "啟動中…" : "啟動 Desktop"}
          </Button>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {planPreview && (
        <Meta as="p" style={{ marginTop: 8 }} role="status">
          Vision 規劃預覽：{planPreview}
        </Meta>
      )}

      <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 8 }}>
        {(sessions.data ?? []).slice(0, 8).map((s) => {
          const terminal = ["completed", "failed", "stopped", "expired"].includes(s.status);
          const waitingHuman = s.status === "waiting_human";
          const humanControl = s.status === "human_control";
          const agentActive = s.status === "agent_control" || s.status === "ready";
          const isDesktop = s.runtimeKind === "desktop";
          const isBrowser = s.runtimeKind === "browser";

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
                <Chip>{isDesktop ? "Desktop" : "Browser"}</Chip>
                <Meta as="span" style={{ flex: "1 1 120px", minWidth: 0, wordBreak: "break-all" }}>
                  {s.currentUrl || s.currentApp || s.label || s.sessionId.slice(0, 8)}
                </Meta>
                <Meta as="span">{s.actionCount} 步</Meta>
                {isDesktop && typeof s.screenshotCount === "number" && (
                  <Meta as="span">截圖 {s.screenshotCount}</Meta>
                )}
                {s.needsReobserve && <Chip>需重新觀察</Chip>}
                {s.escalationReason && <Chip title={s.escalationReason}>已升級</Chip>}
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

                  {desktopOn && isBrowser && agentActive && (
                    <Button
                      size="sm"
                      type="button"
                      disabled={escalate.isPending}
                      onClick={async () => {
                        setError(null);
                        try {
                          await escalate.mutateAsync({
                            browserSessionId: s.sessionId,
                            reasonCode: "user_requested",
                            detail: "從 UI 升級到桌面",
                            startApp: "desktop",
                          });
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "升級 Desktop 失敗");
                        }
                      }}
                    >
                      升級 Desktop
                    </Button>
                  )}

                  {desktopOn && isDesktop && agentActive && (
                    <>
                      <Button
                        size="sm"
                        type="button"
                        disabled={desktopAct.isPending}
                        onClick={async () => {
                          setError(null);
                          try {
                            await desktopAct.mutateAsync({
                              sessionId: s.sessionId,
                              actionId: `shot-${Date.now()}`,
                              action: { kind: "screenshot" },
                              leaseVersion: s.leaseVersion,
                              expectedSessionRevision: s.sessionRevision,
                            });
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "截圖失敗");
                          }
                        }}
                      >
                        截圖
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        disabled={planDesktop.isPending}
                        onClick={async () => {
                          setError(null);
                          try {
                            const plan = await planDesktop.mutateAsync({
                              sessionId: s.sessionId,
                              goal: "開啟檔案並稍微捲動",
                            });
                            setPlanPreview(
                              plan.ok
                                ? `${plan.summary} → ${plan.actions.map((a) => a.kind).join(", ")}`
                                : (plan.error ?? plan.summary),
                            );
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "規劃失敗");
                          }
                        }}
                      >
                        Vision 規劃
                      </Button>
                    </>
                  )}

                  {authOn && isBrowser && s.currentUrl && (
                    <Button
                      size="sm"
                      type="button"
                      disabled={saveAuth.isPending}
                      onClick={async () => {
                        setError(null);
                        try {
                          await saveAuth.mutateAsync({
                            sessionId: s.sessionId,
                            explicitOptIn: true,
                          });
                          setShowAuthList(true);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "記住登入失敗");
                        }
                      }}
                    >
                      記住此登入
                    </Button>
                  )}

                  {artifactsOn && (
                    <Button
                      size="sm"
                      type="button"
                      disabled={detectArt.isPending}
                      onClick={async () => {
                        setError(null);
                        setArtifactSessionId(s.sessionId);
                        try {
                          await detectArt.mutateAsync({ sessionId: s.sessionId });
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "偵測成品失敗");
                        }
                      }}
                    >
                      偵測成品
                    </Button>
                  )}
                  {artifactsOn && (
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => setArtifactSessionId(
                        artifactSessionId === s.sessionId ? null : s.sessionId,
                      )}
                    >
                      {artifactSessionId === s.sessionId ? "收合成品" : "成品列表"}
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

              {artifactsOn && artifactSessionId === s.sessionId && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                  {(artifacts.data ?? []).map((a) => (
                    <li key={a.id} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <Meta as="span">{a.filename}</Meta>
                      <Chip>{a.scanStatus}</Chip>
                      <Chip>{a.importStatus}</Chip>
                      {a.assetId && (
                        <Meta as="span">asset {a.assetId.slice(0, 8)}…</Meta>
                      )}
                      {a.importStatus === "ready" && a.scanStatus === "clean" && (
                        <Button
                          size="sm"
                          type="button"
                          disabled={importArt.isPending}
                          onClick={async () => {
                            setError(null);
                            try {
                              await importArt.mutateAsync({ artifactId: a.id });
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "匯入失敗");
                            }
                          }}
                        >
                          匯入素材庫
                        </Button>
                      )}
                      {a.errorMessage && (
                        <Meta as="span" style={{ color: "var(--danger-ink)" }}>{a.errorMessage}</Meta>
                      )}
                    </li>
                  ))}
                  {(artifacts.data ?? []).length === 0 && (
                    <Meta as="span">尚無成品。可按「偵測成品」模擬外部下載。</Meta>
                  )}
                </ul>
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

      {authOn && (
        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => setShowAuthList((v) => !v)}
            >
              {showAuthList ? "收合已記住登入" : `已記住登入（${activeAuths.length}）`}
            </Button>
            <Meta as="span">可撤銷；密文不回傳前端</Meta>
          </div>
          {showAuthList && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {activeAuths.map((a) => (
                <li
                  key={a.id}
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
                  <Chip>{a.serviceHost}</Chip>
                  <Meta as="span">{a.serviceLabel}</Meta>
                  <Meta as="span">到期 {new Date(a.expiresAt).toLocaleDateString()}</Meta>
                  {a.lastUsedAt && (
                    <Meta as="span">上次 {new Date(a.lastUsedAt).toLocaleDateString()}</Meta>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    disabled={revokeAuth.isPending}
                    onClick={async () => {
                      setError(null);
                      try {
                        await revokeAuth.mutateAsync({ authContextId: a.id });
                        if (reuseAuthId === a.id) setReuseAuthId("");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "撤銷失敗");
                      }
                    }}
                  >
                    撤銷
                  </Button>
                </li>
              ))}
              {activeAuths.length === 0 && (
                <Meta as="span">尚無記住登入。登入外部服務後按「記住此登入」。</Meta>
              )}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
