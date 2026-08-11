import { useMemo, useState } from "react";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { Card, Pill } from "../components/ui";
import { MCP_TOOLS } from "../../../shared/mcpCatalog";
import { McpPage } from "./McpPage";

type Approval = {
  id: string;
  name: string;
  arguments: string;
  serverLabel: string;
};

type CallTrace = {
  id: string;
  name: string;
  status?: string;
  arguments?: string;
  output?: string;
  error?: string;
};

type BridgeResult = {
  text: string;
  approvals: Approval[];
  calls: CallTrace[];
  continuation: string | null;
  responseId: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

type Decision = "approve" | "reject";

function toolTitle(name: string): string {
  return MCP_TOOLS.find((tool) => tool.name === name)?.title ?? name;
}

function prettyArguments(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * /mcp 保留原本完整的 MCP 金鑰管理頁，再疊一個「GPT 直接做」工作面板。
 * 使用者不需要把自己的長效 aidmcp_ 金鑰貼給 GPT：後端只為單次 Responses 請求建立短效 key，
 * 讀取自動執行，任何寫入會在這裡逐項要求一次性確認。
 */
function OpenAiMcpDock() {
  const status = trpc.openaiMcp.status.useQuery();
  const ask = trpc.openaiMcp.ask.useMutation();
  const decide = trpc.openaiMcp.decide.useMutation();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<BridgeResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const pending = ask.isPending || decide.isPending;
  const allDecided = useMemo(
    () => Boolean(result?.approvals.length) && result!.approvals.every((item) => Boolean(decisions[item.id])),
    [result, decisions],
  );

  const runAsk = async () => {
    const message = prompt.trim();
    if (!message || pending) return;
    try {
      const data = await ask.mutateAsync({ message });
      setResult(data as BridgeResult);
      setDecisions({});
    } catch {
      // tRPC error is rendered below.
    }
  };

  const submitDecisions = async () => {
    if (!result?.continuation || !allDecided || pending) return;
    try {
      const data = await decide.mutateAsync({
        continuation: result.continuation,
        decisions: result.approvals.map((item) => ({
          approvalRequestId: item.id,
          approve: decisions[item.id] === "approve",
        })),
      });
      setResult(data as BridgeResult);
      setDecisions({});
    } catch {
      // tRPC error is rendered below.
    }
  };

  const error = ask.error?.message ?? decide.error?.message;
  const configured = status.data?.configured ?? false;
  const modelLabel = status.data?.model === "gpt-5.6" || status.data?.model === "gpt-5.6-sol"
    ? "GPT-5.6 Sol"
    : status.data?.model ?? "GPT-5.6 Sol";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          zIndex: 80,
          right: 18,
          bottom: 86,
          minHeight: 48,
          borderRadius: 999,
          padding: "0 18px",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          boxShadow: "0 12px 36px rgba(0,0,0,.18)",
          fontWeight: 700,
        }}
        aria-label="開啟 GPT 直接操作 AI-OS"
      >
        <Icon name="Sparkles" size={17} />
        GPT 直接做
      </button>
    );
  }

  return (
    <aside
      aria-label="GPT 直接操作 AI-OS"
      style={{
        position: "fixed",
        zIndex: 90,
        right: 12,
        bottom: 76,
        width: "min(430px, calc(100vw - 24px))",
        maxHeight: "min(720px, calc(100vh - 104px))",
        overflow: "auto",
        border: "1px solid var(--border)",
        borderRadius: 20,
        background: "var(--card)",
        boxShadow: "0 22px 70px rgba(0,0,0,.24)",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
            <Icon name="Sparkles" size={18} />
            {modelLabel} 直接操作
          </div>
          <div style={{ fontSize: "var(--fs-12)", color: "var(--muted)", marginTop: 4 }}>
            先讀真實資料；寫入前逐項問你一次
          </div>
        </div>
        <button type="button" onClick={() => setOpen(false)} style={{ padding: "5px 10px", fontSize: "var(--fs-12)" }}>
          關閉
        </button>
      </div>

      {!status.isLoading && !configured && (
        <Card style={{ marginTop: 12, borderLeft: "3px solid var(--gold-ink)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Icon name="TriangleAlert" size={17} />
            <div style={{ fontSize: "var(--fs-13)", lineHeight: 1.7 }}>
              <b>後端還缺 OPENAI_API_KEY。</b><br />
              到 Zeabur 服務環境變數加入後重新部署即可；模型預設就是 GPT-5.6 Sol。
            </div>
          </div>
        </Card>
      )}

      <div style={{ marginTop: 12 }}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：幫我看現在專案狀態，把缺的待辦建立起來。先查清楚再做。"
          rows={4}
          maxLength={8000}
          disabled={!configured || pending}
          style={{ width: "100%", resize: "vertical", minHeight: 96 }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void runAsk();
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: "var(--fs-11)", color: "var(--muted)" }}>Ctrl/⌘ + Enter 送出</span>
          <button type="button" onClick={() => void runAsk()} disabled={!configured || pending || !prompt.trim()}>
            {pending ? "正在讀取與執行…" : "直接處理"}
          </button>
        </div>
      </div>

      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}

      {result && (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {result.calls.length > 0 && (
            <Card variant="quiet" style={{ padding: 12 }}>
              <div style={{ fontSize: "var(--fs-12)", fontWeight: 700, marginBottom: 7 }}>實際工具活動</div>
              <div style={{ display: "grid", gap: 6 }}>
                {result.calls.map((call) => (
                  <div key={call.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "var(--fs-12)" }}>
                    <Icon name="Check" size={13} />
                    <span>{toolTitle(call.name)}</span>
                    {call.status && <Pill>{call.status}</Pill>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {result.text && (
            <Card style={{ padding: 13, whiteSpace: "pre-wrap", lineHeight: 1.75, fontSize: "var(--fs-14)" }}>
              {result.text}
            </Card>
          )}

          {result.approvals.length > 0 && (
            <Card style={{ padding: 13, borderLeft: "3px solid var(--gold-ink)" }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>需要你確認才會真的寫入</div>
              <div style={{ fontSize: "var(--fs-12)", color: "var(--muted)", marginBottom: 10 }}>
                這些現在都還沒執行。你可以逐項允許或拒絕。
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {result.approvals.map((approval) => {
                  const choice = decisions[approval.id];
                  return (
                    <div key={approval.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: "var(--fs-13)" }}>{toolTitle(approval.name)}</div>
                      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "11px", maxHeight: 180, overflow: "auto", margin: "7px 0" }}>
                        {prettyArguments(approval.arguments)}
                      </pre>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => setDecisions((prev) => ({ ...prev, [approval.id]: "approve" }))}
                          aria-pressed={choice === "approve"}
                          style={{ fontWeight: choice === "approve" ? 800 : 500 }}
                        >
                          允許一次
                        </button>
                        <button
                          type="button"
                          onClick={() => setDecisions((prev) => ({ ...prev, [approval.id]: "reject" }))}
                          aria-pressed={choice === "reject"}
                          style={{ fontWeight: choice === "reject" ? 800 : 500 }}
                        >
                          拒絕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void submitDecisions()}
                disabled={!allDecided || pending}
                style={{ width: "100%", marginTop: 10 }}
              >
                {pending ? "正在執行…" : "送出這一輪決定"}
              </button>
            </Card>
          )}

          {result.usage?.totalTokens != null && (
            <div style={{ fontSize: "var(--fs-11)", color: "var(--muted)", textAlign: "right" }}>
              {modelLabel}・本輪約 {result.usage.totalTokens.toLocaleString()} tokens
            </div>
          )}
        </div>
      )}

      {status.data?.billing && (
        <div style={{ marginTop: 10, fontSize: "var(--fs-11)", color: "var(--muted)", lineHeight: 1.6 }}>
          {status.data.billing}
        </div>
      )}
    </aside>
  );
}

export function McpHubPage() {
  return (
    <>
      <McpPage />
      <OpenAiMcpDock />
    </>
  );
}
