import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon, type IconName } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Button, Card, Hint, Meta } from "../components/ui";
import {
  CATEGORIES,
  MODELS,
  SCENARIO_GROUPS,
  SCENARIO_RECIPES,
  STYLE_SHOWDOWNS,
  tierLabel,
  type ModelCategory,
  type ModelEntry,
  type ScenarioGroup,
  type ScenarioRecipe,
  type StyleShowdown,
} from "@shared/models";

/** 模型指南:全模型目錄總覽＋決策中心(看情境/比風格/三題篩選),挑選器的百科版 */

const TIERS = [
  { id: "flagship", label: "旗艦", hint: "品質優先" },
  { id: "economy", label: "經濟", hint: "日常主力" },
  { id: "budget", label: "最低成本", hint: "快速試方向" },
] as const;
type Tier = (typeof TIERS)[number]["id"];

const MODEL_CATEGORY_COUNT = CATEGORIES.filter((c) => c.id !== "workflow").length;

/* ── 需求 #1+6.8:並排比較與三題挑模型精靈的共用定義 ── */
/** 精靈第 1 題的創作類別(排除製作範本:那是串鏈預設,不是單一模型) */
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
/** 級別 pill 的三色(旗艦=品牌赤陶/經濟=療癒紫/最低=金);比較表、清單、決策中心共用 */
const TIER_STYLE: Record<string, { color: string; borderColor: string; background: string }> = {
  flagship: { color: "var(--primary-ink)", borderColor: "var(--primary)", background: "var(--primary-tint)" },
  economy: { color: "var(--healing-ink)", borderColor: "var(--healing)", background: "var(--healing-soft)" },
  budget: { color: "var(--gold-ink)", borderColor: "var(--gold)", background: "var(--gold-soft)" },
};
/** 精靈結果排序分：已驗證優先，再看推薦與來源相容性。 */
function wizScore(m: ModelEntry, source: "" | "yes" | "no"): number {
  return (m.verified ? 10 : 0) + (m.recommended ? 2 : 0) + (source === "yes" && m.needs ? 1 : 0);
}

/* ── 深度優化:決策中心(看情境/比風格/三題篩選)的共用定義 ── */
/** id → 模型(決策中心以字串 id 引用目錄,這裡一次建好查表;referential integrity 由 models.test 守) */
const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m] as const));
/** 情境分組的圖示 */
const GROUP_ICON: Record<ScenarioGroup, IconName> = {
  image: "Image",
  edit: "Palette",
  restore: "Sparkles",
  video: "Clapperboard",
  audio: "Music",
  text: "FileText",
};
type DecisionMode = "scenario" | "style" | "quiz";
const DECISION_MODES: ReadonlyArray<{ id: DecisionMode; label: string; hint: string; icon: IconName }> = [
  { id: "scenario", label: "看情境", hint: "我要做什麼 → 該用哪個模型", icon: "Lightbulb" },
  { id: "style", label: "比風格", hint: "同類不同風格,哪個模型更強", icon: "Scale" },
  { id: "quiz", label: "三題篩選", hint: "類別＋預算＋素材,快速縮範圍", icon: "SlidersHorizontal" },
];

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
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  useEffect(() => setCatalogExpanded(false), [category]);
  const copyModelId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
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
    { label: "級別", render: (m) => <span className="pill" style={TIER_STYLE[m.tier]}>{tierLabel(m.tier)}</span> },
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
          <Meta style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="TriangleAlert" size={12} />待首跑確認
          </Meta>
        ),
    },
  ];

  // ── 深度優化:決策中心狀態(看情境/比風格/三題篩選) ──
  const [decisionMode, setDecisionMode] = useState<DecisionMode>("scenario");
  const [scenarioGroup, setScenarioGroup] = useState<ScenarioGroup>("image");
  // 「在目錄看同類」:切到該類別、清掉搜尋/檔次,並捲到下方完整目錄
  const catalogRef = useRef<HTMLDivElement>(null);
  const jumpToCatalog = (cat: ModelCategory) => {
    setQ("");
    setTier("");
    setCategory(cat);
    requestAnimationFrame(() => catalogRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // ── 需求 #1+6.8:三題挑模型精靈(答齊即時算推薦,不用送出鈕) ──
  const [wizCategory, setWizCategory] = useState<ModelCategory | "">("");
  const [wizTier, setWizTier] = useState<Tier | "">("");
  const [wizSource, setWizSource] = useState<(typeof WIZARD_SOURCES)[number]["id"] | "">("");
  const wizardReady = !!(wizCategory && wizTier && wizSource);
  const wizardAnswered = [wizCategory, wizTier, wizSource].filter(Boolean).length;
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

  const scenariosInGroup = SCENARIO_RECIPES.filter((r) => r.group === scenarioGroup);
  const activeMode = DECISION_MODES.find((m) => m.id === decisionMode);
  const catalogItems = models.data ?? [];
  const catalogNeedsDisclosure = !debouncedQ && !tier && catalogItems.length > 8;
  const visibleCatalogItems = catalogNeedsDisclosure && !catalogExpanded ? catalogItems.slice(0, 8) : catalogItems;

  return (
    <div className="page-shell secondary-page models-page" data-fb="模型指南頁">
      <SecondaryPageHeader
        eyebrow="創作決策"
        title="模型指南"
        icon="Sparkles"
        badge={`${MODEL_CATEGORY_COUNT} 類・${MODELS.length} 個模型`}
        description={<>不用先懂所有模型。從你要完成的情境、喜歡的風格或三個簡單問題開始，系統會說明該選哪一個以及原因。</>}
      />

      {/* ── 需求 #1:並排比較——勾 2–4 個模型,這張卡置頂(sticky)浮出 ── */}
      {compareList.length === 1 && (
        <Hint style={{ margin: "0 0 var(--sp-16)" }}>
          已勾 1 個模型——再勾 1 個就會浮出並排比較表(最多 {COMPARE_MAX} 個)。
        </Hint>
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
            <Button variant="ghost" size="sm" onClick={() => setCompareIds([])}>清空比較</Button>
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

      {/* ── 深度優化:決策中心——三種模式回答「怎麼選模型」 ── */}
      <Card as="section" variant="primary" data-fb="模型決策中心" style={{ marginBottom: "var(--sp-16)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <h2 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="Sparkles" size={18} />怎麼選模型?
          </h2>
          <Hint as="span">先想「我要做什麼」,再看該用哪個——不必先懂 11 類分法。</Hint>
        </div>

        {/* 三種決策模式(segmented) */}
        <div role="tablist" aria-label="決策模式" className="model-decision-tabs">
          {DECISION_MODES.map((mode) => {
            const on = decisionMode === mode.id;
            return (
              <button
                key={mode.id}
                role="tab"
                aria-selected={on}
                className={`model-decision-tab${on ? " is-selected" : ""}`}
                onClick={() => setDecisionMode(mode.id)}
              >
                <span className="model-decision-tab__icon"><Icon name={mode.icon} size={16} /></span>
                <span><strong>{mode.label}</strong><small>{mode.hint}</small></span>
                {on && <Icon name="Check" size={14} />}
              </button>
            );
          })}
        </div>
        {activeMode && <p className="model-decision-current"><Icon name={activeMode.icon} size={13} />目前方式：{activeMode.hint}</p>}

        {/* 模式一:看情境 */}
        {decisionMode === "scenario" && (
          <div>
            <div className="model-scenario-groups">
              {SCENARIO_GROUPS.map((g) => {
                const on = scenarioGroup === g.id;
                return (
                  <span
                    key={g.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    title={g.hint}
                    className={`chip pick ${on ? "on" : ""}`}
                    style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                    onClick={() => setScenarioGroup(g.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setScenarioGroup(g.id); }
                    }}
                  >
                    <Icon name={GROUP_ICON[g.id]} size={12} />{g.label}
                  </span>
                );
              })}
            </div>
            <div className="model-scenario-grid">
              {scenariosInGroup.map((r) => (
                <ScenarioCard key={r.id} recipe={r} copiedId={copiedId} onCopy={copyModelId} onJump={jumpToCatalog} />
              ))}
            </div>
          </div>
        )}

        {/* 模式二:比風格 */}
        {decisionMode === "style" && (
          <div className="stack">
            {STYLE_SHOWDOWNS.map((s) => (
              <ShowdownCard key={s.id} showdown={s} copiedId={copiedId} onCopy={copyModelId} onJump={jumpToCatalog} />
            ))}
          </div>
        )}

        {/* 模式三:三題篩選(原「幫我挑模型」精靈) */}
        {decisionMode === "quiz" && (
          <div className="model-quiz">
            <div className="model-quiz-progress" aria-label={`三題已完成 ${wizardAnswered} 題`}>
              {[wizCategory, wizTier, wizSource].map((answer, index) => (
                <span
                  key={index}
                  className={answer ? "is-done" : index === wizardAnswered ? "is-current" : ""}
                  aria-current={!answer && index === wizardAnswered ? "step" : undefined}
                >
                  {answer ? <Icon name="Check" size={12} /> : index + 1}
                </span>
              ))}
              <small>{wizardReady ? "完成，以下是適合的模型" : `還有 ${3 - wizardAnswered} 題`}</small>
            </div>
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
              <Hint style={{ margin: "12px 0 0" }}>
                {!wizCategory
                  ? "先答第 1 題:點一個創作類別。"
                  : !wizTier
                    ? `已選「${WIZARD_CATEGORIES.find((c) => c.id === wizCategory)?.label ?? ""}」——接著答第 2 題,挑個預算傾向。`
                    : "最後一題:有沒有來源素材?答完推薦立刻出現。"}
              </Hint>
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
                    <Meta as="p" style={{ margin: "4px 0 0" }}>
                      {m.strengths}
                      {wizSource === "yes" && m.needs ? `|需要來源:${m.sourceHint ?? NEEDS_LABEL[m.needs]}` : ""}
                    </Meta>
                  </div>
                ))}
                {wizardResults.length === 0 && (
                  <Hint layer="always" style={{ margin: "12px 0 0" }}>這個組合目前沒有模型——換個預算檔試試。</Hint>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── 完整目錄:搜尋/類別/檔次篩選＋模型清單(決策中心「在目錄看同類」捲到這) ── */}
      <div ref={catalogRef} style={{ scrollMarginTop: "var(--sp-16)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 28, marginBottom: "var(--sp-8)" }}>
          <h2 style={{ margin: 0 }}>完整目錄</h2>
          <Meta>
            搜尋、按類別或檔次瀏覽全部 {MODELS.length} 個模型；目前顯示 {visibleCatalogItems.length}/{catalogItems.length}。
          </Meta>
        </div>

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
          {q && <Meta>搜尋涵蓋全部類別</Meta>}
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
          {visibleCatalogItems.map((m) => (
            <section key={m.id} className="card" style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <b>{m.label}</b>
                <span className="pill" style={TIER_STYLE[m.tier]}>{m.tierLabel}</span>
                <span className="mono" style={{ fontSize: 12 }}>{m.points} 點/次</span>
                <Meta className="mono" style={{ fontSize: 11 }}>{m.cost}</Meta>
                {!m.verified && <Meta style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}><Icon name="TriangleAlert" size={12} />待正式模式首跑確認</Meta>}
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
              <Meta as="p" style={{ margin: 0 }}>適合:{m.bestFor}{m.needs ? `|需要來源:${m.sourceHint ?? m.needs}` : ""}</Meta>
              <Meta as="p" className="mono" style={{ margin: "4px 0 0", fontSize: 11, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {m.id}
                <button
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 12px", fontSize: "var(--fs-11)", fontFamily: "var(--sans)" }}
                  onClick={() => copyModelId(m.id)}
                >
                  {copiedId === m.id ? <><Icon name="Check" size={12} />已複製</> : "複製"}
                </button>
              </Meta>
            </section>
          ))}
          {catalogNeedsDisclosure && (
            <button
              type="button"
              className="model-catalog-disclosure"
              aria-expanded={catalogExpanded}
              onClick={() => setCatalogExpanded((value) => !value)}
            >
              <Icon name={catalogExpanded ? "ChevronUp" : "ChevronDown"} size={16} />
              {catalogExpanded ? "收合模型清單" : `再顯示 ${catalogItems.length - visibleCatalogItems.length} 個同類模型`}
            </button>
          )}
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
      </div>

      {(!debouncedQ || matchedWorkflows.length > 0) && (
        <>
          <h2 style={{ marginTop: 28 }}>製作範本(一鍵串鏈)</h2>
          {/* 「每步各自扣點」是實際代價：不知道範本逐步計費就可能誤啟動 → 不可收 */}
        <Hint layer="always">在<Link href="/dashboard">今日工作台</Link>開啟專案後,於「製作範本」卡使用;每步各自扣點。</Hint>
          {workflows.isLoading && (
            <div className="stack">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={`wf-sk-${i}`} className="card skeleton" style={{ height: 88 }} aria-hidden />
              ))}
            </div>
          )}
          {workflows.isError && (
            <p className="error">
              製作範本載入失敗——
              <button style={{ padding: "4px 12px", marginLeft: 4 }} onClick={() => workflows.refetch()}>重試</button>
            </p>
          )}
          <div className="stack">
            {matchedWorkflows.map((w) => (
              <section key={w.id} className="card" style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <b>{w.label}</b>
                  <span className="pill" style={TIER_STYLE[w.tier]}>{w.tierLabel}</span>
                  <span className="mono" style={{ fontSize: 12 }}>約 {w.points} 點</span>
                </div>
                <p style={{ margin: "6px 0 2px", fontSize: "var(--fs-14)" }}>{w.strengths}</p>
                <Meta as="p" style={{ margin: 0 }}>
                  適合:{w.bestFor}|步驟:{w.steps.map((s) => s.note).join(" → ")}
                </Meta>
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

/** 決策中心共用:把一顆模型渲染成「名稱＋級別＋點數＋複製 ID」的小標籤 */
function ModelInline({
  id,
  lead,
  copiedId,
  onCopy,
}: {
  id: string;
  lead?: string;
  copiedId: string | null;
  onCopy: (id: string) => void;
}) {
  const m = MODEL_BY_ID.get(id);
  if (!m) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", lineHeight: 1.6 }}>
      {lead && <span className="eyebrow cjk" style={{ fontWeight: 700, color: "var(--primary-ink)" }}>{lead}</span>}
      <b style={{ fontSize: "var(--fs-14)" }}>{m.label}</b>
      <span className="pill" style={TIER_STYLE[m.tier]}>{tierLabel(m.tier)}</span>
      <span className="mono" style={{ fontSize: 11 }}>{m.points} 點</span>
      <button
        className="btn-ghost btn-sm"
        title={`複製模型 ID:${m.id}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
        onClick={() => onCopy(m.id)}
      >
        {copiedId === m.id ? <><Icon name="Check" size={12} />已複製</> : "複製 ID"}
      </button>
    </span>
  );
}

/** 看情境:一張情境卡——情境標題＋一句話＋首選(附理由)＋替代(可複製)＋去目錄看同類 */
function ScenarioCard({
  recipe,
  copiedId,
  onCopy,
  onJump,
}: {
  recipe: ScenarioRecipe;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onJump: (cat: ModelCategory) => void;
}) {
  const primary = MODEL_BY_ID.get(recipe.pickIds[0]);
  const alts = recipe.pickIds.slice(1).map((id) => MODEL_BY_ID.get(id)).filter((m): m is ModelEntry => !!m);
  return (
    <div className="card card--std" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div>
        <b style={{ fontSize: "var(--fs-15)" }}>{recipe.scene}</b>
        <Meta as="p" style={{ margin: "2px 0 0" }}>{recipe.intent}</Meta>
      </div>
      {primary && (
        <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 6 }}>
          <ModelInline id={primary.id} lead="首選" copiedId={copiedId} onCopy={onCopy} />
          <Meta as="p" style={{ margin: "3px 0 0" }}>{recipe.why}</Meta>
        </div>
      )}
      {alts.length > 0 && (
        <Meta as="div" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: 0 }}>
          <span>替代:</span>
          {alts.map((m) => (
            <span
              key={m.id}
              role="button"
              tabIndex={0}
              className="chip pick"
              style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 3 }}
              title={`${m.strengths}｜點一下複製 ID`}
              onClick={() => onCopy(m.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCopy(m.id); }
              }}
            >
              {copiedId === m.id ? <>已複製<Icon name="Check" size={11} /></> : m.label}
            </span>
          ))}
        </Meta>
      )}
      {primary && (
        <button
          className="btn-ghost btn-sm"
          style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 4 }}
          onClick={() => onJump(primary.category)}
        >
          在目錄看同類<Icon name="ArrowRight" size={12} />
        </button>
      )}
    </div>
  );
}

/** 比風格:一張 PK 表——每列一個風格/需求維度,給首選與次選 */
function ShowdownCard({
  showdown,
  copiedId,
  onCopy,
  onJump,
}: {
  showdown: StyleShowdown;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onJump: (cat: ModelCategory) => void;
}) {
  return (
    <div className="card card--std" style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: "var(--fs-15)" }}>{showdown.title}</b>
        <button
          className="btn-ghost btn-sm"
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}
          onClick={() => onJump(showdown.category)}
        >
          在目錄看同類<Icon name="ArrowRight" size={12} />
        </button>
      </div>
      <Meta as="p" style={{ margin: "2px 0 0" }}>{showdown.subtitle}</Meta>
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: "var(--fs-13)", lineHeight: 1.5 }}>
          <thead>
            <tr>
              <th scope="col" className="hint" style={{ ...compareCell, width: 150, fontWeight: 600 }}>風格 / 需求</th>
              <th scope="col" className="hint" style={{ ...compareCell, fontWeight: 600 }}>首選</th>
              <th scope="col" className="hint" style={{ ...compareCell, fontWeight: 600 }}>次選</th>
            </tr>
          </thead>
          <tbody>
            {showdown.axes.map((a) => (
              <tr key={a.axis}>
                <th scope="row" style={{ ...compareCell, fontWeight: 500 }}>
                  {a.axis}
                  <Meta style={{ display: "block", fontWeight: 400 }}>{a.note}</Meta>
                </th>
                <td style={compareCell}>
                  <ModelInline id={a.winnerId} copiedId={copiedId} onCopy={onCopy} />
                </td>
                <td style={compareCell}>
                  {a.runnerUpId ? (
                    <ModelInline id={a.runnerUpId} copiedId={copiedId} onCopy={onCopy} />
                  ) : (
                    <Meta>—</Meta>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
