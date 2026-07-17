import { useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";

/**
 * MCP 個人連線金鑰卡（每位登入者自助）：建立／複製／撤銷「自己的」金鑰。
 * 重點語意：金鑰＝你本人的身分。外部 AI 客戶端（Claude 等）帶你的金鑰連進來時，
 * 只能做「你在系統裡本來就能做的事」——你的組、你的專案權限、你的點數額度都照算。
 * 原文只在建立當下回一次（之後只存雜湊），所以建立後立刻複製收好。
 */

/** 複製鈕：成功顯示「已複製」約 2 秒；剪貼簿不可用時退回 prompt 手動複製 */
function CopyButton({ text, label = "複製" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (
    <button
      type="button"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 12px", fontSize: "var(--fs-12)", flex: "none" }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("自動複製失敗，請手動複製：", text);
        }
      }}
    >
      {copied ? <><Icon name="Check" size={12} />已複製</> : label}
    </button>
  );
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function McpTokensCard() {
  const utils = trpc.useUtils();
  const tokens = trpc.mcpTokens.list.useQuery();
  const [label, setLabel] = useState("");
  // 剛建立的金鑰原文（只此一次）——建立成功後暫存於前端顯示，重新整理即消失
  const [fresh, setFresh] = useState<{ id: string; label: string; token: string } | null>(null);

  const create = trpc.mcpTokens.create.useMutation({
    onSuccess: (data) => {
      setFresh(data);
      setLabel("");
      utils.mcpTokens.list.invalidate();
    },
  });
  const revoke = trpc.mcpTokens.revoke.useMutation({
    onSuccess: (_data, vars) => {
      if (fresh?.id === vars.id) setFresh(null); // 撤掉剛建立的就別再顯示原文
      utils.mcpTokens.list.invalidate();
    },
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "https://你的網域";
  const endpoint = `${origin}/api/mcp`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const l = label.trim();
    if (!l || create.isPending) return;
    create.mutate({ label: l });
  };

  const list = tokens.data ?? [];
  const activeCount = list.filter((t) => !t.revokedAt).length;

  return (
    <div className="card" data-fb="MCP金鑰卡">
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="Sparkles" size={18} />接上外部 AI（MCP）
      </h2>
      <p className="hint" style={{ marginTop: 4, lineHeight: 1.8 }}>
        建立「你自己的」連線金鑰，就能讓 Claude 等外部 AI 客戶端連進系統，
        以<b>你本人的權限</b>操作——只看得到你有份的組與專案、扣的是你的點數額度、
        受同樣的審批門檻限制。金鑰請當密碼保管，別人拿到就等同用你的身分操作。
      </p>

      {/* 連線資訊 */}
      <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface-2, rgba(0,0,0,0.03))", borderRadius: 8, fontSize: "var(--fs-13)", lineHeight: 1.9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>端點：<code>POST {endpoint}</code></span>
          <CopyButton text={endpoint} />
        </div>
        <div>驗證：HTTP 標頭 <code>x-api-key: 你的金鑰</code></div>
      </div>

      {/* 建立表單 */}
      <form onSubmit={submit} style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          aria-label="金鑰用途名稱"
          placeholder="金鑰用途（如：我的筆電 Claude）"
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          style={{ flex: "1 1 220px", minWidth: 160 }}
        />
        <button type="submit" disabled={!label.trim() || create.isPending} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="Plus" size={14} />建立金鑰
        </button>
      </form>
      {create.error && <p className="error" role="alert">{create.error.message}</p>}

      {/* 剛建立的金鑰原文（只顯示這一次） */}
      {fresh && (
        <div style={{ marginTop: 12, padding: "12px 14px", border: "1px solid var(--accent, #3b82f6)", borderRadius: 8 }} role="status">
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="Lock" size={15} />「{fresh.label}」的金鑰已建立
          </div>
          <p className="hint" style={{ margin: "6px 0 8px", color: "var(--warn, #b45309)" }}>
            ⚠️ 金鑰只會顯示這一次，請立刻複製收好；關掉後就再也拿不回（只能撤銷後重建）。
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <code style={{ flex: "1 1 260px", wordBreak: "break-all", fontSize: "var(--fs-13)" }}>{fresh.token}</code>
            <CopyButton text={fresh.token} label="複製金鑰" />
          </div>
        </div>
      )}

      {/* 既有金鑰列表 */}
      <div style={{ marginTop: 14 }}>
        <div className="hint" style={{ fontSize: 13, marginBottom: 4 }}>
          我的金鑰（{activeCount} 把使用中）
        </div>
        {tokens.isLoading ? (
          <div className="skeleton" style={{ height: 32 }} />
        ) : list.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>還沒有金鑰。建立一把即可開始連線。</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {list.map((t) => (
              <li
                key={t.id}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap", opacity: t.revokedAt ? 0.55 : 1 }}
              >
                <span style={{ flex: "1 1 auto", minWidth: 140 }}>
                  <b style={{ textDecoration: t.revokedAt ? "line-through" : undefined }}>{t.label}</b>
                  <span className="hint" style={{ display: "block", fontSize: 12 }}>
                    建立於 {fmtDate(t.createdAt)}
                    {t.lastUsedAt ? `・最近使用 ${fmtDate(t.lastUsedAt)}` : "・尚未使用"}
                    {t.revokedAt ? `・已撤銷 ${fmtDate(t.revokedAt)}` : ""}
                  </span>
                </span>
                {t.revokedAt ? (
                  <span className="hint" style={{ flex: "none" }}>已撤銷</span>
                ) : (
                  <button
                    type="button"
                    style={{ padding: "3px 12px", fontSize: "var(--fs-12)", flex: "none" }}
                    disabled={revoke.isPending}
                    onClick={() => {
                      if (window.confirm(`撤銷「${t.label}」？帶這把金鑰連線會立即失效，此動作無法復原。`)) {
                        revoke.mutate({ id: t.id });
                      }
                    }}
                  >
                    撤銷
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {revoke.error && <p className="error" role="alert">{revoke.error.message}</p>}
      </div>
    </div>
  );
}
