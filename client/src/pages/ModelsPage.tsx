import { useEffect, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { CATEGORIES, MODELS } from "@shared/models";

/** 模型指南:全模型目錄總覽(副標的類別數與模型總數由 @shared/models 即時計算),挑選器的百科版 */

const TIERS = [
  { id: "flagship", label: "旗艦" },
  { id: "economy", label: "經濟" },
  { id: "budget", label: "最低成本" },
] as const;
type Tier = (typeof TIERS)[number]["id"];

const MODEL_CATEGORY_COUNT = CATEGORIES.filter((c) => c.id !== "workflow").length;

export function ModelsPage() {
  const categories = trpc.models.categories.useQuery();
  const [category, setCategory] = useState("text-to-image");
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "">("");
  // 250ms 防抖:逐字打字時不必每個字都發一次搜尋請求
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  // keepPreviousData:搜尋逐字打時保留上一批結果,畫面不會每個字閃一次「沒有符合」
  const models = trpc.models.search.useQuery(
    { q: debouncedQ || undefined, category: debouncedQ ? undefined : category, tier: tier || undefined },
    { placeholderData: (prev) => prev },
  );
  const workflows = trpc.models.workflows.useQuery();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyModelId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
  };

  const tierColor: Record<string, string> = {
    flagship: "var(--primary)",
    economy: "var(--healing, #9E86C4)",
    budget: "var(--gold, #B58A3E)",
  };

  const wfQ = debouncedQ.trim().toLowerCase();
  const matchedWorkflows = (workflows.data ?? []).filter(
    (w) => !wfQ || [w.label, w.strengths, w.bestFor].some((s) => s.toLowerCase().includes(wfQ)),
  );

  return (
    <div data-fb="模型指南頁">
      <h1>模型指南</h1>
      <p className="sub">
        {MODEL_CATEGORY_COUNT} 種創作類別、共 {MODELS.length} 個模型(旗艦/經濟/最低成本三檔)。搜尋或按類別瀏覽;「適合」欄告訴你什麼時候用它。
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <span style={{ position: "relative", display: "inline-flex", width: "100%", maxWidth: 260 }}>
          <input
            aria-label="搜尋模型"
            style={{ paddingRight: 32 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋(例:中文、對嘴、金句)"
          />
          {q && (
            <button
              aria-label="清除搜尋"
              onClick={() => setQ("")}
              style={{
                position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                border: "none", background: "transparent", padding: "0 8px",
                fontSize: 16, lineHeight: 1, color: "var(--muted-fg)",
              }}
            >
              ×
            </button>
          )}
        </span>
        {q && <span className="hint">搜尋涵蓋全部類別</span>}
        {!q &&
          (categories.data ?? []).filter((c) => c.id !== "workflow").map((c) => {
            const on = category === c.id;
            return (
              <span
                key={c.id}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                title={c.hint}
                className={`chip pick ${on ? "on" : ""}`}
                onClick={() => setCategory(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCategory(c.id); }
                }}
                style={{ cursor: "pointer" }}
              >
                {c.label}
              </span>
            );
          })}
        {TIERS.map((t) => {
          const on = tier === t.id;
          return (
            <span
              key={t.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              title={`只看${t.label}模型;再按一次取消`}
              className={`chip pick ${on ? "on" : ""}`}
              onClick={() => setTier(on ? "" : t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTier(on ? "" : t.id); }
              }}
              style={{ cursor: "pointer" }}
            >
              {t.label}
            </span>
          );
        })}
      </div>

      <div className="stack">
        {models.isLoading && <p className="hint">載入模型目錄中…</p>}
        {models.isError && (
          <p className="error">
            模型目錄載入失敗——
            <button style={{ padding: "2px 12px", marginLeft: 4 }} onClick={() => models.refetch()}>重試</button>
          </p>
        )}
        {(models.data ?? []).map((m) => (
          <section key={m.id} className="card" style={{ padding: "14px 18px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <b>{m.label}</b>
              <span className="pill" style={{ color: tierColor[m.tier], borderColor: tierColor[m.tier] }}>{m.tierLabel}</span>
              <span className="mono" style={{ fontSize: 12 }}>{m.points} 點/次</span>
              <span className="hint mono" style={{ fontSize: 11 }}>{m.cost}</span>
              {!m.verified && <span className="hint" style={{ fontSize: 11 }}>⚠︎ 待真實模式首跑確認</span>}
            </div>
            <p style={{ margin: "6px 0 2px", fontSize: 13.5 }}>{m.strengths}</p>
            <p className="hint" style={{ margin: 0 }}>適合:{m.bestFor}{m.needs ? `|需要來源:${m.sourceHint ?? m.needs}` : ""}</p>
            <p className="hint mono" style={{ margin: "4px 0 0", fontSize: 11, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {m.id}
              <button
                style={{ padding: "0 10px", fontSize: 10, fontFamily: "var(--sans)" }}
                onClick={() => copyModelId(m.id)}
              >
                {copiedId === m.id ? "已複製 ✓" : "複製"}
              </button>
            </p>
          </section>
        ))}
        {!models.isLoading && !models.isError && !models.data?.length && (
          <p className="hint">
            {debouncedQ
              ? `沒有符合「${debouncedQ}」的模型——換個關鍵字試試。`
              : tier
                ? "這個組合暫無模型——試試取消檔次篩選。"
                : "這個類別暫無模型。"}
          </p>
        )}
      </div>

      {(!debouncedQ || matchedWorkflows.length > 0) && (
        <>
          <h2 style={{ marginTop: 28 }}>工作流(一鍵串鏈)</h2>
          <p className="hint">在<Link href="/">作業台</Link>開啟專案後,於「工作流」卡使用;每步各自扣點。</p>
          {workflows.isLoading && <p className="hint">載入中…</p>}
          {workflows.isError && (
            <p className="error">
              工作流載入失敗——
              <button style={{ padding: "2px 12px", marginLeft: 4 }} onClick={() => workflows.refetch()}>重試</button>
            </p>
          )}
          <div className="stack">
            {matchedWorkflows.map((w) => (
              <section key={w.id} className="card" style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <b>{w.label}</b>
                  <span className="pill">{w.tierLabel}</span>
                  <span className="mono" style={{ fontSize: 12 }}>約 {w.points} 點</span>
                </div>
                <p style={{ margin: "6px 0 2px", fontSize: 13.5 }}>{w.strengths}</p>
                <p className="hint" style={{ margin: 0 }}>
                  適合:{w.bestFor}|步驟:{w.steps.map((s) => s.note).join(" → ")}
                </p>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
