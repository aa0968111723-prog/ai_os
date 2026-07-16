import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { CATEGORIES, MODELS, tierLabel, type ModelCategory, type ModelEntry } from "@shared/models";

/** 模型指南:全模型目錄總覽(副標的類別數與模型總數由 @shared/models 即時計算),挑選器的百科版 */

const TIERS = [
  { id: "flagship", label: "旗艦", hint: "品質優先" },
  { id: "economy", label: "經濟", hint: "日常主力" },
  { id: "budget", label: "最低成本", hint: "快速試方向" },
] as const;
type Tier = (typeof TIERS)[number]["id"];

const MODEL_CATEGORY_COUNT = CATEGORIES.filter((c) => c.id !== "workflow").length;

/* ── 需求 #1+6.8:並排比較與三題挑模型精靈的共用定義 ── */
/** 精靈第 1 題的創作類別(排除工作流:那是串鏈預設,不是單一模型) */
const WIZARD_CATEGORIES = CATEGORIES.filter((c) => c.id !== "workflow");
/** 精靈第 3 題:有沒有來源素材 */
const WIZARD_SOURCES = [
  { id: "yes", label: "有(我要用一張圖/一段音訊加工)" },
  { id: "no", label: "沒有(從文字開始)" },
] as const;
/** 並排比較上限:超過 4 欄小螢幕表格就讀不動了 */
const COMPARE_MAX = 4;
/** needs(來源輸入)的中文說法,比較表與精靈共用 */
const NEEDS_LABEL: Record<string, string> = { image: "一張圖", audio: "一段音訊", video: "一支影片", zip: "素材包 zip" };
/** 比較表儲存格共用樣式(頁面原無表格樣式,沿用髮絲線/左對齊的既有視覺) */
const compareCell: CSSProperties = {
  borderBottom: "1px solid var(--border-soft)",
  padding: "6px 10px",
  textAlign: "left",
  verticalAlign: "top",
};
/** 精靈結果排序分:recommended 排最前;「有來源」時 needs 有值者次優先(sort 穩定,其餘保持目錄順序) */
function wizScore(m: ModelEntry, source: "" | "yes" | "no"): number {
  return (m.recommended ? 2 : 0) + (source === "yes" && m.needs ? 1 : 0);
}

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

  const tierStyle: Record<string, { color: string; borderColor: string; background: string }> = {
    flagship: { color: "var(--primary-ink)", borderColor: "var(--primary)", background: "var(--primary-tint)" },
    economy: { color: "var(--healing-ink)", borderColor: "var(--healing)", background: "var(--healing-soft)" },
    budget: { color: "var(--gold-ink)", borderColor: "var(--gold)", background: "var(--gold-soft)" },
  };

  // ── 需求 #1:並排比較(每卡一個「比較」checkbox,勾 2–4 個時頁頂浮出比較表) ──
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const toggleCompare = (id: string) =>
    setCompareIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= COMPARE_MAX ? cur : [...cur, id],
    );
  // 用共享目錄解析所選模型:之後切類別/搜尋,已勾但不在當前列表的模型仍留在比較表
  const compareList = compareIds.map((id) => MODELS.find((m) => m.id === id)).filter((m): m is ModelEntry => !!m);
  const compareFull = compareIds.length >= COMPARE_MAX;
  // 比較表的列定義(欄=所選模型)
  const compareRows: Array<{ label: string; render: (m: ModelEntry) => ReactNode }> = [
    { label: "級別", render: (m) => <span className="pill" style={tierStyle[m.tier]}>{tierLabel(m.tier)}</span> },
    { label: "點數", render: (m) => <span className="mono" style={{ fontSize: 12 }}>{m.points} 點/次</span> },
    { label: "官方約略價", render: (m) => <span className="mono" style={{ fontSize: 11 }}>{m.cost}</span> },
    { label: "特性", render: (m) => m.strengths },
    { label: "擅長", render: (m) => m.bestFor },
    { label: "需要來源", render: (m) => (m.needs ? (m.sourceHint ?? NEEDS_LABEL[m.needs]) : "不用,打字就能開工") },
    {
      label: "已驗證",
      render: (m) =>
        m.verified ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--success-ink)" }}>
            <Icon name="Check" size={12} />已驗證
          </span>
        ) : (
          <span className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="TriangleAlert" size={12} />待首跑確認
          </span>
        ),
    },
  ];

  // ── 需求 #1+6.8:三題挑模型精靈(答齊即時算推薦,不用送出鈕) ──
  const [wizCategory, setWizCategory] = useState<ModelCategory | "">("");
  const [wizTier, setWizTier] = useState<Tier | "">("");
  const [wizSource, setWizSource] = useState<(typeof WIZARD_SOURCES)[number]["id"] | "">("");
  const wizardReady = !!(wizCategory && wizTier && wizSource);
  // category+tier 過濾;「沒有來源」濾掉 needs 有值的模型(沒素材根本跑不動)
  const wizardResults = wizardReady
    ? MODELS.filter((m) => m.category === wizCategory && m.tier === wizTier && !(wizSource === "no" && m.needs)).sort(
        (a, b) => wizScore(b, wizSource) - wizScore(a, wizSource),
      )
    : [];

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

      {/* ── 需求 #1:並排比較——勾 2–4 個模型,這張卡置頂(sticky)浮出 ── */}
      {compareList.length === 1 && (
        <p className="hint" style={{ margin: "0 0 var(--sp-16)" }}>
          已勾 1 個模型——再勾 1 個就會浮出並排比較表(最多 {COMPARE_MAX} 個)。
        </p>
      )}
      {compareList.length >= 2 && (
        <section
          className="card"
          data-fb="模型並排比較"
          style={{ position: "sticky", top: "var(--sp-8)", zIndex: 30, marginBottom: "var(--sp-16)", padding: "14px 18px", boxShadow: "var(--e3)" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Icon name="Scale" size={16} />
            <b>並排比較({compareList.length}/{COMPARE_MAX})</b>
            <span className="spacer" />
            <button className="btn-ghost btn-sm" onClick={() => setCompareIds([])}>清空比較</button>
          </div>
          {/* 小螢幕:表格保住最小寬,由外層橫向捲動 */}
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 100 + compareList.length * 180, fontSize: "var(--fs-13)", lineHeight: 1.5 }}>
              <thead>
                <tr>
                  <th style={{ ...compareCell, width: 100 }} />
                  {compareList.map((m) => (
                    <th key={m.id} scope="col" style={{ ...compareCell, fontWeight: 600, fontSize: "var(--fs-14)" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                        {m.label}
                        <button
                          className="btn-ghost"
                          aria-label={`把 ${m.label} 移出比較`}
                          title="移出比較"
                          style={{ padding: "0 6px", display: "inline-flex", alignItems: "center" }}
                          onClick={() => toggleCompare(m.id)}
                        >
                          <Icon name="X" size={12} />
                        </button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="hint" style={{ ...compareCell, fontWeight: 500, whiteSpace: "nowrap" }}>{row.label}</th>
                    {compareList.map((m) => (
                      <td key={m.id} style={compareCell}>{row.render(m)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 需求 #1+6.8:三題挑模型精靈——答三題即時給推薦,不用送出鈕 ── */}
      <details className="card card--quiet" data-fb="挑模型精靈" style={{ marginBottom: "var(--sp-16)" }}>
        <summary style={{ flexWrap: "wrap" }}>
          <Icon name="Sparkles" size={16} />
          <b>幫我挑模型</b>
          <span className="hint">三題直達推薦——不知道從哪個模型下手時用</span>
        </summary>
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: "0 0 2px", fontSize: "var(--fs-14)", fontWeight: 600 }}>1. 你要做什麼?</p>
          <div>
            {WIZARD_CATEGORIES.map((c) => (
              <WizardChip
                key={c.id}
                on={wizCategory === c.id}
                label={c.label}
                title={c.hint}
                onToggle={() => setWizCategory(wizCategory === c.id ? "" : c.id)}
              />
            ))}
          </div>
          <p style={{ margin: "10px 0 2px", fontSize: "var(--fs-14)", fontWeight: 600 }}>2. 預算傾向?</p>
          <div>
            {TIERS.map((t) => (
              <WizardChip
                key={t.id}
                on={wizTier === t.id}
                label={`${t.label}(${t.hint})`}
                onToggle={() => setWizTier(wizTier === t.id ? "" : t.id)}
              />
            ))}
          </div>
          <p style={{ margin: "10px 0 2px", fontSize: "var(--fs-14)", fontWeight: 600 }}>3. 有沒有來源素材?</p>
          <div>
            {WIZARD_SOURCES.map((s) => (
              <WizardChip
                key={s.id}
                on={wizSource === s.id}
                label={s.label}
                onToggle={() => setWizSource(wizSource === s.id ? "" : s.id)}
              />
            ))}
          </div>

          {!wizardReady ? (
            <p className="hint" style={{ margin: "12px 0 0" }}>
              {!wizCategory
                ? "先答第 1 題:點一個創作類別。"
                : !wizTier
                  ? `已選「${WIZARD_CATEGORIES.find((c) => c.id === wizCategory)?.label ?? ""}」——接著答第 2 題,挑個預算傾向。`
                  : "最後一題:有沒有來源素材?答完推薦立刻出現。"}
            </p>
          ) : (
            <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)" }}>
              {wizardResults.map((m) => (
                <div key={m.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <b>{m.label}</b>
                    {m.recommended && (
                      <span
                        className="chip"
                        style={{ margin: 0, background: "var(--primary-tint)", borderColor: "var(--primary-border)", color: "var(--primary-ink)", fontWeight: 600 }}
                      >
                        推薦
                      </span>
                    )}
                    <span className="mono" style={{ fontSize: 12 }}>{m.points} 點/次</span>
                    <button
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 12px", fontSize: "var(--fs-11)", fontFamily: "var(--sans)" }}
                      onClick={() => copyModelId(m.id)}
                    >
                      {copiedId === m.id ? <><Icon name="Check" size={12} />已複製</> : "複製模型 ID"}
                    </button>
                  </div>
                  <p className="hint" style={{ margin: "4px 0 0" }}>
                    {m.strengths}
                    {wizSource === "yes" && m.needs ? `|需要來源:${m.sourceHint ?? NEEDS_LABEL[m.needs]}` : ""}
                  </p>
                </div>
              ))}
              {wizardResults.length === 0 && (
                <p className="hint" style={{ margin: "12px 0 0" }}>這個組合目前沒有模型——換個預算檔試試。</p>
              )}
            </div>
          )}
        </div>
      </details>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: "var(--sp-16)" }}>
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
              className="btn-ghost"
              onClick={() => setQ("")}
              style={{
                position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                display: "flex", alignItems: "center",
                padding: "0 8px", fontSize: 16, lineHeight: 1,
              }}
            >
              <Icon name="X" size={16} />
            </button>
          )}
        </span>
        {q && <span className="hint">搜尋涵蓋全部類別</span>}
        {!q && <span className="eyebrow cjk">類別</span>}
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
        <span className="eyebrow cjk">檔次</span>
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
        {models.isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={`sk-${i}`} className="card skeleton" style={{ height: 96 }} aria-hidden />
          ))}
        {models.isError && (
          <p className="error">
            模型目錄載入失敗——
            <button style={{ padding: "4px 12px", marginLeft: 4 }} onClick={() => models.refetch()}>重試</button>
          </p>
        )}
        {(models.data ?? []).map((m) => (
          <section key={m.id} className="card" style={{ padding: "14px 18px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <b>{m.label}</b>
              <span className="pill" style={tierStyle[m.tier]}>{m.tierLabel}</span>
              <span className="mono" style={{ fontSize: 12 }}>{m.points} 點/次</span>
              <span className="hint mono" style={{ fontSize: 11 }}>{m.cost}</span>
              {!m.verified && <span className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}><Icon name="TriangleAlert" size={12} />待真實模式首跑確認</span>}
              {/* 需求 #1:勾選加入並排比較;滿 4 個時其餘停用 */}
              <label
                className="hint"
                title={compareFull && !compareIds.includes(m.id) ? `一次最多比較 ${COMPARE_MAX} 個——先移掉一個再勾` : "勾 2 個以上,頁面頂部會浮出並排比較表"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, margin: "0 0 0 auto", whiteSpace: "nowrap",
                  cursor: compareFull && !compareIds.includes(m.id) ? "not-allowed" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={compareIds.includes(m.id)}
                  disabled={compareFull && !compareIds.includes(m.id)}
                  onChange={() => toggleCompare(m.id)}
                />
                比較
              </label>
            </div>
            <p style={{ margin: "6px 0 2px", fontSize: "var(--fs-14)" }}>{m.strengths}</p>
            <p className="hint" style={{ margin: 0 }}>適合:{m.bestFor}{m.needs ? `|需要來源:${m.sourceHint ?? m.needs}` : ""}</p>
            <p className="hint mono" style={{ margin: "4px 0 0", fontSize: 11, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {m.id}
              <button
                style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 12px", fontSize: "var(--fs-11)", fontFamily: "var(--sans)" }}
                onClick={() => copyModelId(m.id)}
              >
                {copiedId === m.id ? <><Icon name="Check" size={12} />已複製</> : "複製"}
              </button>
            </p>
          </section>
        ))}
        {!models.isLoading && !models.isError && !models.data?.length && (
          <div className="empty-state">
            <h3>沒有符合的模型</h3>
            <p>
              {debouncedQ
                ? `沒有符合「${debouncedQ}」的模型——換個關鍵字試試。`
                : tier
                  ? "這個組合暫無模型——試試取消檔次篩選。"
                  : "這個類別暫無模型。"}
            </p>
          </div>
        )}
      </div>

      {(!debouncedQ || matchedWorkflows.length > 0) && (
        <>
          <h2 style={{ marginTop: 28 }}>工作流(一鍵串鏈)</h2>
          <p className="hint">在<Link href="/">作業台</Link>開啟專案後,於「工作流」卡使用;每步各自扣點。</p>
          {workflows.isLoading && (
            <div className="stack">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={`wf-sk-${i}`} className="card skeleton" style={{ height: 88 }} aria-hidden />
              ))}
            </div>
          )}
          {workflows.isError && (
            <p className="error">
              工作流載入失敗——
              <button style={{ padding: "4px 12px", marginLeft: 4 }} onClick={() => workflows.refetch()}>重試</button>
            </p>
          )}
          <div className="stack">
            {matchedWorkflows.map((w) => (
              <section key={w.id} className="card" style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <b>{w.label}</b>
                  <span className="pill" style={tierStyle[w.tier]}>{w.tierLabel}</span>
                  <span className="mono" style={{ fontSize: 12 }}>約 {w.points} 點</span>
                </div>
                <p style={{ margin: "6px 0 2px", fontSize: "var(--fs-14)" }}>{w.strengths}</p>
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

/** 精靈選項 chip:沿用 .chip.pick 視覺與頁內既有的鍵盤操作模式(Enter/空白切換;再點一次取消) */
function WizardChip({ on, label, title, onToggle }: { on: boolean; label: string; title?: string; onToggle: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-pressed={on}
      title={title}
      className={`chip pick ${on ? "on" : ""}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
      }}
      style={{ cursor: "pointer" }}
    >
      {label}
    </span>
  );
}
