import { useState } from "react";
import { trpc } from "../api";

/** 模型指南:77 個模型的完整目錄(11 類 × 旗艦/經濟/最低成本),挑選器的百科版 */
export function ModelsPage() {
  const categories = trpc.models.categories.useQuery();
  const [category, setCategory] = useState("text-to-image");
  const [q, setQ] = useState("");
  const models = trpc.models.search.useQuery({ q: q || undefined, category: q ? undefined : category });
  const workflows = trpc.models.workflows.useQuery();

  const tierColor: Record<string, string> = {
    flagship: "var(--primary)",
    economy: "var(--healing, #9E86C4)",
    budget: "var(--gold, #B58A3E)",
  };

  return (
    <div>
      <h1>模型指南</h1>
      <p className="sub">11 種創作類別,每類 旗艦3+經濟3+最低成本1。搜尋或按類別瀏覽;「適合」欄告訴你什麼時候用它。</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input style={{ maxWidth: 260 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋(例:中文、對嘴、金句)" />
        {!q &&
          (categories.data ?? []).filter((c) => c.id !== "workflow").map((c) => (
            <span
              key={c.id}
              className={`chip pick ${category === c.id ? "on" : ""}`}
              onClick={() => setCategory(c.id)}
              style={{ cursor: "pointer" }}
            >
              {c.label}
            </span>
          ))}
      </div>

      <div className="stack">
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
            <p className="hint mono" style={{ margin: "4px 0 0", fontSize: 11 }}>{m.id}</p>
          </section>
        ))}
        {!models.data?.length && <p className="hint">沒有符合的模型。</p>}
      </div>

      {!q && (
        <>
          <h2 style={{ marginTop: 28 }}>工作流(一鍵串鏈)</h2>
          <p className="hint">在專案頁的「工作流」卡使用;每步各自扣點。</p>
          <div className="stack">
            {(workflows.data ?? []).map((w) => (
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
