import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon, type IconName } from "../components/Icon";
import { ModelUsageCard } from "../components/ModelUsageCard";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { Button, Card, Chip, EmptyState, Hint, Meta, Pill, Skeleton } from "../components/ui";
import { ModelArena } from "../features/model-guide/ModelArena";
import { ModelBaseChip, ModelBaseDetail } from "../features/model-guide/ModelBaseInfo";
import { ModelHeatmap } from "../features/model-guide/ModelHeatmap";
import { modelBaseSpecFor, WEIGHTS_LABEL } from "@shared/modelBase";
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

/**
 * 模型指南:全模型目錄總覽＋決策中心,挑選器的百科版。
 *
 * 決策中心五種方式:看情境／比風格／三題篩選(規格層),再加上實際動手的兩種——
 * **實測競技場**(拿自己的題目讓 2–4 顆模型真的各跑一輪,看成品、點數與耗時)與
 * **分析熱力圖**(整類攤成「模型 × 指標」,規格欄＋我自己的實測欄)。
 * 每顆模型都標示**底層模型**(基座權重):同基座的兩個端點換過去風格不會變,換基座才會。
 */

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
/** 級別 pill 的三色(旗艦=品牌赤陶/經濟=療癒紫/最低=金);比較表、清單、決策中心共用。
 *  色值寫在 styles.css 的 .pill--tier-* ——顏色是設計語言的一部分,不該散在 TSX 的物件裡。 */
const TIER_CLASS: Record<string, string> = {
  flagship: "pill--tier-flagship",
  economy: "pill--tier-economy",
  budget: "pill--tier-budget",
};

/** 契約健康（與 shared/modelContract 對齊；指南顯示中文） */
type HealthKey =
  | "live_ok"
  | "live_timeout"
  | "live_fail"
  | "openapi_404"
  | "needs_source"
  | "nim_no_key"
  | "never_probed"
  | "unknown";

const HEALTH_META: Record<
  HealthKey,
  { label: string; short: string; hint: string; tone: "ok" | "warn" | "bad" | "mute" | "info" }
> = {
  live_ok: { label: "已實測成功", short: "實測✓", hint: "站內曾合法生成並取回成品", tone: "ok" },
  live_timeout: { label: "曾逾時", short: "逾時", hint: "已送出但輪詢超時（可能已計點，勿連點重跑）", tone: "warn" },
  live_fail: { label: "實測失敗", short: "失敗", hint: "最近 live 失敗（契約／輸入問題）", tone: "bad" },
  openapi_404: { label: "端點異常", short: "404", hint: "OpenAPI 端點不存在，建議換同類模型", tone: "bad" },
  needs_source: { label: "需素材", short: "需素材", hint: "要圖／音／影／zip，無法空提示詞開工", tone: "info" },
  nim_no_key: { label: "NIM", short: "NIM", hint: "走 NVIDIA NIM，非 fal 佇列", tone: "mute" },
  never_probed: { label: "未實測", short: "未測", hint: "尚無合法生成紀錄（可能因預算）", tone: "mute" },
  unknown: { label: "未知", short: "—", hint: "尚無契約快照", tone: "mute" },
};

const HEALTH_FILTERS: Array<{ id: HealthKey | ""; label: string }> = [
  { id: "", label: "全部健康" },
  { id: "live_ok", label: "已實測" },
  { id: "needs_source", label: "需素材" },
  { id: "never_probed", label: "未實測" },
  { id: "live_timeout", label: "曾逾時" },
  { id: "live_fail", label: "實測失敗" },
  { id: "openapi_404", label: "端點異常" },
];

function normalizeHealth(h: string | null | undefined): HealthKey {
  if (h && h in HEALTH_META) return h as HealthKey;
  return "unknown";
}

/** 精靈結果排序：實測成功 > 已驗證 > 推薦 > 來源相容；端點 404 沉底 */
function wizScore(
  m: ModelEntry,
  source: "" | "yes" | "no",
  health: string | null | undefined,
): number {
  const h = normalizeHealth(health);
  let s = (m.verified ? 10 : 0) + (m.recommended ? 2 : 0) + (source === "yes" && m.needs ? 1 : 0);
  if (h === "live_ok") s += 8;
  if (h === "openapi_404") s -= 30;
  if (h === "live_fail") s -= 5;
  return s;
}

/* ── 決策中心(看情境/比風格/三題篩選/實測競技場/分析熱力圖)的共用定義 ── */
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
type DecisionMode = "scenario" | "style" | "quiz" | "arena" | "heatmap";
const DECISION_MODES: ReadonlyArray<{ id: DecisionMode; label: string; hint: string; icon: IconName }> = [
  { id: "scenario", label: "看情境", hint: "我要做什麼 → 該用哪個模型", icon: "Lightbulb" },
  { id: "style", label: "比風格", hint: "同類不同風格,哪個模型更強", icon: "Scale" },
  { id: "quiz", label: "三題篩選", hint: "類別＋預算＋素材,快速縮範圍", icon: "SlidersHorizontal" },
  { id: "arena", label: "實測競技場", hint: "拿你的題目讓 2–4 顆模型真的跑一次", icon: "FlaskConical" },
  { id: "heatmap", label: "分析熱力圖", hint: "整類攤開,一眼看出誰強在哪一格", icon: "LayoutGrid" },
];

export function ModelsPage({ groupId = "" }: { groupId?: string }) {
  const categories = trpc.models.categories.useQuery();
  const moneyMeta = trpc.models.moneyMeta.useQuery();
  const contractSummary = trpc.models.contractSummary.useQuery(undefined, {
    staleTime: 60_000,
  });
  const healthById = contractSummary.data?.byId ?? {};
  const [category, setCategory] = useState("text-to-image");
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "">("");
  const [healthFilter, setHealthFilter] = useState<HealthKey | "">("");
  // 250ms 防抖:逐字打字時不必每個字都發一次搜尋請求
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  // keepPreviousData:搜尋逐字打時保留上一批結果,畫面不會每個字閃一次「沒有符合」
  const models = trpc.models.search.useQuery(
    {
      q: debouncedQ || undefined,
      category: debouncedQ ? undefined : category,
      tier: tier || undefined,
      health: healthFilter || undefined,
    },
    { placeholderData: (prev) => prev },
  );
  const workflows = trpc.models.workflows.useQuery();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  useEffect(() => setCatalogExpanded(false), [category, healthFilter]);
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
    {
      label: "預覽",
      render: (m) => (
        <ModelThumb
          label={m.label}
          category={m.category}
          src={healthById[m.id]?.thumbnailUrl ?? null}
          size={56}
        />
      ),
    },
    { label: "級別", render: (m) => <Pill className={TIER_CLASS[m.tier]}>{tierLabel(m.tier)}</Pill> },
    // 底層模型擺在最上面幾列：兩個端點若是同一顆基座，換過去風格不會變——
    // 這是比較表最該先回答、卻最容易被「特性」那行文案蓋掉的一件事。
    { label: "底層模型", render: (m) => <ModelBaseChip modelId={m.id} category={m.category} size="md" /> },
    { label: "出品方", render: (m) => modelBaseSpecFor(m.id, m.category).developer },
    { label: "骨幹架構", render: (m) => modelBaseSpecFor(m.id, m.category).arch },
    { label: "權重", render: (m) => WEIGHTS_LABEL[modelBaseSpecFor(m.id, m.category).weights] },
    { label: "點數", render: (m) => <span className="mono model-workflow-card__points">{m.points} 點/次</span> },
    {
      label: "健康",
      render: (m) => <HealthBadge health={healthById[m.id]?.health} note={healthById[m.id]?.healthNote} />,
    },
    { label: "官方約略價", render: (m) => <span className="mono" style={{ fontSize: 11 }}>{m.cost}</span> },
    { label: "特性", render: (m) => m.strengths },
    { label: "擅長", render: (m) => m.bestFor },
    { label: "需要來源", render: (m) => (m.needs ? (m.sourceHint ?? NEEDS_LABEL[m.needs]) : "不用,打字就能開工") },
    {
      label: "文字塔",
      render: (m) => {
        const c = healthById[m.id];
        if (!c?.textEncoderLabel) return <Meta>—</Meta>;
        return (
          <span style={{ fontSize: 12 }}>
            {c.textEncoderLabel}
            {c.textEncoderLimit != null ? ` · ${c.textEncoderLimit} tok` : " · 窗口未公開"}
          </span>
        );
      },
    },
    {
      label: "負向提示",
      render: (m) => {
        const v = healthById[m.id]?.supportsNegativePrompt;
        if (v == null) return <Meta>—</Meta>;
        return v ? "支援 negative_prompt" : "不送（schema 無欄位）";
      },
    },
    {
      label: "固定種子",
      render: (m) => {
        const v = healthById[m.id]?.supportsSeed;
        if (v == null) return <Meta>—</Meta>;
        return v ? "可 seed（消融）" : "無 seed 欄位";
      },
    },
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

  // ── 決策中心狀態(看情境/比風格/三題篩選/實測競技場/分析熱力圖) ──
  const [decisionMode, setDecisionMode] = useState<DecisionMode>("scenario");
  const [scenarioGroup, setScenarioGroup] = useState<ScenarioGroup>("image");
  // 熱力圖自己的類別：與下方完整目錄分開，看熱力圖時不會把目錄捲位置也一起換掉
  const [heatmapCategory, setHeatmapCategory] = useState<string>("text-to-image");
  // 「在目錄看同類」:切到該類別、清掉搜尋/檔次,並捲到下方完整目錄
  const catalogRef = useRef<HTMLDivElement>(null);
  // 從比較表跳到競技場時要把決策中心捲回視野內，不然按了像沒反應
  const decisionRef = useRef<HTMLElement>(null);
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
  // category+tier 過濾;「沒有來源」濾掉 needs；端點 404 不進推薦
  const wizardResults = wizardReady
    ? MODELS.filter((m) => {
        if (m.category !== wizCategory || m.tier !== wizTier) return false;
        if (wizSource === "no" && m.needs) return false;
        if (healthById[m.id]?.health === "openapi_404") return false;
        return true;
      }).sort(
        (a, b) =>
          wizScore(b, wizSource, healthById[b.id]?.health) - wizScore(a, wizSource, healthById[a.id]?.health),
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
  /** 點數長條的共同基準:目前這批模型裡最貴的一顆。換一批就換基準——這是同批相對比較,不是絕對評分。 */
  const maxCatalogPoints = Math.max(1, ...catalogItems.map((m) => m.points));

  return (
    <div className="page-shell secondary-page models-page" data-fb="模型指南頁">
      <SecondaryPageHeader
        eyebrow="創作決策"
        title="模型指南"
        icon="Sparkles"
        // 目錄規模是這頁最量化的兩個事實,用全站的統計條(襯線數字)呈現,不是壓成一顆灰色膠囊
        badge={
          <div className="model-head-stats" role="group" aria-label="目錄規模">
            <span><strong>{MODEL_CATEGORY_COUNT}</strong><small>類別</small></span>
            <span><strong>{MODELS.length}</strong><small>個模型</small></span>
          </div>
        }
        description={
          <>
            不用先懂所有模型。從情境、風格或三題開始挑；挑不定就<strong>拿自己的題目讓它們同題並跑</strong>，或用熱力圖把整類攤開比。
            每顆都標示<strong>底層模型</strong>、實測健康、素材需求與文字塔能力，和創作台／MCP 同一份契約。
            {moneyMeta.data?.fxNote ? (
              <Meta as="span" style={{ display: "block", marginTop: 6 }}>{moneyMeta.data.fxNote}</Meta>
            ) : null}
          </>
        }
      />

      {/* ── 頂欄：我的使用量（取代站內契約健康——404／逾時／NIM 是站務指標，不是創作者要看的） ── */}
      <ModelUsageCard />

      {/* ── 需求 #1:並排比較——勾 2–4 個模型,這張卡置頂(sticky)浮出 ── */}
      {compareList.length === 1 && (
        <Hint style={{ margin: "0 0 var(--sp-16)" }}>
          已勾 1 個模型——再勾 1 個就會浮出並排比較表(最多 {COMPARE_MAX} 個)。
        </Hint>
      )}
      {compareList.length >= 2 && (
        <Card as="section" className="model-compare-card" data-fb="模型並排比較">
          <div className="model-compare-card__head">
            <Icon name="Scale" size={16} />
            <b>並排比較({compareList.length}/{COMPARE_MAX})</b>
            <span className="spacer" />
            {/* 規格比完之後真正的下一步：拿自己的題目讓這幾顆實際跑一次 */}
            <Button
              size="sm"
              onClick={() => {
                setDecisionMode("arena");
                requestAnimationFrame(() => decisionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }}
            >
              <Icon name="FlaskConical" size={12} />拿同一題實際跑跑看
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCompareIds([])}>清空比較</Button>
          </div>
          {/* 小螢幕:表格保住最小寬,由外層雙向捲動;列標題欄凍結在左緣,橫捲時才知道在看哪一列 */}
          <div className="model-compare-card__scroll">
            <table className="model-compare-table" style={{ minWidth: 100 + compareList.length * 180 }}>
              <thead>
                <tr>
                  <th className="model-compare-table__corner" />
                  {compareList.map((m) => (
                    <th key={m.id} scope="col">
                      <span className="model-compare-table__col">
                        {m.label}
                        <Button variant="ghost"
                          className="model-compare-table__drop"
                          aria-label={`把 ${m.label} 移出比較`}
                          title="移出比較"
                          onClick={() => toggleCompare(m.id)}>
                          <Icon name="X" size={12} />
                        </Button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="hint">{row.label}</th>
                    {compareList.map((m) => (
                      <td key={m.id}>{row.render(m)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── 決策中心——五種方式回答「怎麼選模型」:看情境／比風格／三題篩選／實測競技場／分析熱力圖 ── */}
      <Card as="section" ref={decisionRef} variant="primary" data-fb="模型決策中心" className="model-decision-card">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <h2 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="Sparkles" size={18} />怎麼選模型?
          </h2>
          <Hint as="span">先想「我要做什麼」,再看該用哪個——不必先懂 11 類分法。</Hint>
        </div>

        {/* 決策模式(segmented) */}
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
                  <Chip
                    key={g.id}
                    selected={on}
                    title={g.hint}
                    style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                    onClick={() => setScenarioGroup(g.id)}
                  >
                    <Icon name={GROUP_ICON[g.id]} size={12} />{g.label}
                  </Chip>
                );
              })}
            </div>
            <div className="model-scenario-grid">
              {scenariosInGroup.map((r) => (
                <ScenarioCard
                  key={r.id}
                  recipe={r}
                  copiedId={copiedId}
                  onCopy={copyModelId}
                  onJump={jumpToCatalog}
                  healthById={healthById}
                />
              ))}
            </div>
          </div>
        )}

        {/* 模式二:比風格 */}
        {decisionMode === "style" && (
          <div className="stack">
            {STYLE_SHOWDOWNS.map((s) => (
              <ShowdownCard
                key={s.id}
                showdown={s}
                copiedId={copiedId}
                onCopy={copyModelId}
                onJump={jumpToCatalog}
                healthById={healthById}
              />
            ))}
          </div>
        )}

        {/* 模式四:實測競技場——把上面勾的 2–4 顆模型拿同一題真的跑一次 */}
        {decisionMode === "arena" && (
          <ModelArena
            groupId={groupId}
            modelIds={compareIds}
            onRemove={toggleCompare}
            onClear={() => setCompareIds([])}
          />
        )}

        {/* 模式五:分析熱力圖——整類攤開,規格欄＋我自己的實測欄 */}
        {decisionMode === "heatmap" && (
          <ModelHeatmap
            category={heatmapCategory}
            categories={(categories.data ?? CATEGORIES).filter((c) => c.id !== "workflow")}
            onCategoryChange={setHeatmapCategory}
            onCompare={toggleCompare}
            comparedIds={compareIds}
            compareFull={compareFull}
          />
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
            <p className="model-quiz__q">1. 你要做什麼?</p>
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
            <p className="model-quiz__q">2. 預算傾向?</p>
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
            <p className="model-quiz__q">3. 有沒有來源素材?</p>
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
                  <div key={m.id} className="model-wizard-result" style={{ padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <ModelThumb
                        label={m.label}
                        category={m.category}
                        src={healthById[m.id]?.thumbnailUrl}
                        size={48}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                      <b>{m.label}</b>
                      <HealthBadge health={healthById[m.id]?.health} note={healthById[m.id]?.healthNote} />
                      {m.recommended && (
                        <Chip
                          style={{ margin: 0, background: "var(--primary-tint)", borderColor: "var(--primary-border)", color: "var(--primary-ink)", fontWeight: 600 }}>
                          推薦
                        </Chip>
                      )}
                      <span className="mono model-workflow-card__points">{m.points} 點/次</span>
                      <Button variant="ghost" size="sm" onClick={() => copyModelId(m.id)}>
                        {copiedId === m.id ? <><Icon name="Check" size={12} />已複製</> : "複製模型 ID"}
                      </Button>
                    </div>
                    <Meta as="p" style={{ margin: "4px 0 0" }}>
                      {m.strengths}
                      {wizSource === "yes" && m.needs ? `|需要來源:${m.sourceHint ?? NEEDS_LABEL[m.needs]}` : ""}
                    </Meta>
                      </div>
                    </div>
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
      <div ref={catalogRef} className="model-section">
        <div className="model-section-head">
          <p className="eyebrow">目錄</p>
          <div className="model-section-head__line">
            <h2>完整目錄</h2>
            <span className="model-section-head__rule" aria-hidden="true" />
            <span className="model-section-head__count">{visibleCatalogItems.length}/{catalogItems.length}</span>
          </div>
          <Meta as="p" className="model-section-head__deck">
            搜尋、按類別或檔次瀏覽全部 {MODELS.length} 個模型。
          </Meta>
        </div>

        {/* 篩選列:三組條件各自成列,標籤在左、選項在右。手機上每一組是自己的橫向捲軌,
            不再讓 21 顆 chip 擠成一坨換行——那會在 390px 吃掉大半屏才看得到第一個模型。 */}
        <div className="model-filter-bar">
          <div className="model-filter-bar__row model-filter-bar__row--search">
            <span className="model-filter-bar__search">
              <input
                aria-label="搜尋模型"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜尋(例:中文、對嘴、金句)"
              />
              {q && (
                <Button variant="ghost"
                  className="model-filter-bar__clear"
                  aria-label="清除搜尋"
                  onClick={() => setQ("")}>
                  <Icon name="X" size={16} />
                </Button>
              )}
            </span>
            {q && <Meta>搜尋涵蓋全部類別</Meta>}
          </div>
          {!q && (
            <div className="model-filter-bar__row">
              <span className="eyebrow cjk">類別</span>
              <div className="model-filter-bar__rail" role="group" aria-label="依類別篩選">
                {(categories.data ?? []).filter((c) => c.id !== "workflow").map((c) => (
                  <Chip
                    key={c.id}
                    selected={category === c.id}
                    title={c.hint}
                    onClick={() => setCategory(c.id)}
                    style={{ cursor: "pointer" }}
                  >
                    {c.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <div className="model-filter-bar__row">
            <span className="eyebrow cjk">檔次</span>
            <div className="model-filter-bar__rail" role="group" aria-label="依檔次篩選">
              {TIERS.map((t) => {
                const on = tier === t.id;
                return (
                  <Chip
                    key={t.id}
                    selected={on}
                    title={`只看${t.label}模型;再按一次取消`}
                    onClick={() => setTier(on ? "" : t.id)}
                    style={{ cursor: "pointer" }}
                  >
                    {t.label}
                  </Chip>
                );
              })}
            </div>
          </div>
          <div className="model-filter-bar__row">
            <span className="eyebrow cjk">健康</span>
            <div className="model-filter-bar__rail" role="group" aria-label="依實測健康篩選">
              {HEALTH_FILTERS.map((h) => {
                const on = healthFilter === h.id;
                return (
                  <Chip
                    key={h.id || "all"}
                    selected={on}
                    title={h.id ? HEALTH_META[h.id].hint : "顯示全部健康狀態"}
                    onClick={() => setHealthFilter(on && h.id ? "" : h.id)}
                    style={{ cursor: "pointer" }}
                  >
                    {h.label}
                  </Chip>
                );
              })}
            </div>
          </div>
          <CatalogTierMix items={catalogItems} />
        </div>

        <div className="model-catalog-list">
          {models.isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={`sk-${i}`} className="card" height={96} />
            ))}
          {models.isError && (
            <p className="error">
              模型目錄載入失敗——
              <Button size="sm" onClick={() => models.refetch()}>重試</Button>
            </p>
          )}
          {visibleCatalogItems.map((m) => {
            const health = m.health ?? healthById[m.id]?.health;
            const healthNote = m.healthNote ?? healthById[m.id]?.healthNote;
            const enc = m.textEncoderLabel ?? healthById[m.id]?.textEncoderLabel;
            const encLimit = m.textEncoderLimit ?? healthById[m.id]?.textEncoderLimit;
            const neg = m.supportsNegativePrompt ?? healthById[m.id]?.supportsNegativePrompt;
            return (
            <Card as="section" key={m.id} className="model-catalog-card">
              <div className="model-catalog-card__row">
                <ModelThumb
                  label={m.label}
                  category={m.category}
                  src={m.thumbnailUrl ?? healthById[m.id]?.thumbnailUrl ?? null}
                />
                <div className="model-catalog-card__body">
                  {/* 標題列是網格不是換行:比較勾選框固定在右上角一格,不會在手機上被擠成孤兒列 */}
                  <div className="model-catalog-card__head">
                    <b>{m.label}</b>
                    {/* 需求 #1:勾選加入並排比較;滿 4 個時其餘停用 */}
                    <label
                      className={`model-catalog-card__compare${compareFull && !compareIds.includes(m.id) ? " is-disabled" : ""}`}
                      title={compareFull && !compareIds.includes(m.id) ? `一次最多比較 ${COMPARE_MAX} 個——先移掉一個再勾` : "勾 2 個以上:頁面頂部浮出並排比較表,也可以直接送進實測競技場同題並跑"}
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
                  {/* 徽章群:全部同一字級同一基線,不再是五種大小混在一列 */}
                  <div className="model-catalog-card__badges">
                    <Pill className={TIER_CLASS[m.tier]}>{m.tierLabel}</Pill>
                    <HealthBadge health={health} note={healthNote} />
                    {m.recommended && <Chip className="chip--recommended">推薦</Chip>}
                    {!m.verified && (
                      <Meta className="model-catalog-card__warn"><Icon name="TriangleAlert" size={12} />待正式模式首跑確認</Meta>
                    )}
                  </div>
                  <PointsBar points={m.points} max={maxCatalogPoints} estTwd={m.estTwd} cost={m.cost} />
                  <p className="model-catalog-card__lead">{m.strengths}</p>
                  <Meta as="p" className="model-catalog-card__fit">適合:{m.bestFor}{m.needs ? `|需要來源:${m.sourceHint ?? m.needs}` : ""}</Meta>
                  {/* 底層模型：同基座的兩個端點換過去風格不會變，這件事清單上就要看得到 */}
                  <details className="model-catalog-card__base">
                    <summary>
                      <ModelBaseChip modelId={m.id} category={m.category} />
                      <Meta style={{ fontSize: "var(--fs-11)" }}>看底層</Meta>
                    </summary>
                    <ModelBaseDetail modelId={m.id} category={m.category} />
                  </details>
                  {(enc || neg != null) && (
                    <Meta as="p" className="model-catalog-card__spec">
                      {enc ? `文字塔：${enc}${encLimit != null ? `（${encLimit} tok）` : ""}` : null}
                      {enc && neg != null ? " · " : null}
                      {neg != null ? (neg ? "支援負向提示" : "無負向提示欄") : null}
                    </Meta>
                  )}
                  {healthNote && normalizeHealth(health) !== "live_ok" && normalizeHealth(health) !== "unknown" && (
                    <Hint style={{ margin: "6px 0 0" }}>{healthNote}</Hint>
                  )}
                  <div className="model-catalog-card__ids">
                    <code className="mono">{m.id}</code>
                    <Button variant="ghost" size="sm" onClick={() => copyModelId(m.id)}>
                      {copiedId === m.id ? <><Icon name="Check" size={12} />已複製</> : "複製"}
                    </Button>
                    <Link href="/dashboard" className="model-use-cta">
                      到工作台使用 <Icon name="ArrowRight" size={12} />
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
            );
          })}
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
            <EmptyState icon={<Icon name="Search" />} title={<>沒有符合的模型</>} description={<>{debouncedQ
                  ? `沒有符合「${debouncedQ}」的模型——換個關鍵字試試。`
                  : tier
                    ? "這個組合暫無模型——試試取消檔次篩選。"
                    : "這個類別暫無模型。"}</>} />
          )}
        </div>
      </div>

      {(!debouncedQ || matchedWorkflows.length > 0) && (
        <div className="model-section">
          <div className="model-section-head">
            <p className="eyebrow">串鏈</p>
            <div className="model-section-head__line">
              <h2>製作範本(一鍵串鏈)</h2>
              <span className="model-section-head__rule" aria-hidden="true" />
              <span className="model-section-head__count">{matchedWorkflows.length}</span>
            </div>
          </div>
          {/* 「每步各自扣點」是實際代價：不知道範本逐步計費就可能誤啟動 → 不可收 */}
        <Hint layer="always">在<Link href="/dashboard">今日工作台</Link>開啟專案後,於「製作範本」卡使用;每步各自扣點。</Hint>
          {workflows.isLoading && (
            <div className="stack">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={`wf-sk-${i}`} className="card" height={88} />
              ))}
            </div>
          )}
          {workflows.isError && (
            <p className="error">
              製作範本載入失敗——
              <Button size="sm" onClick={() => workflows.refetch()}>重試</Button>
            </p>
          )}
          <div className="stack">
            {matchedWorkflows.map((w) => (
              <Card as="section" key={w.id} className="model-workflow-card">
                <div className="model-workflow-card__head">
                  <b>{w.label}</b>
                  <Pill className={TIER_CLASS[w.tier]}>{w.tierLabel}</Pill>
                  <span className="mono model-workflow-card__points">約 {w.points} 點</span>
                </div>
                <p className="model-catalog-card__lead">{w.strengths}</p>
                <Meta as="p" style={{ margin: 0 }}>
                  適合:{w.bestFor}|步驟:{w.steps.map((s) => s.note).join(" → ")}
                </Meta>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 點數:掃讀一整頁時,「貴不貴」要用長度看得出來,不能只有一行小字。
 *
 * 長條的基準是**目前這批**模型裡最貴的一顆(同批相對比較),所以換類別、換篩選,
 * 長度就會重算——這點必須寫在篩選列的說明裡,免得被當成絕對評分。
 * 單一色階(主色)因為這裡編碼的是大小不是身分;數字本身仍以文字呈現。
 */
function PointsBar({ points, max, estTwd, cost }: { points: number; max: number; estTwd?: number | null; cost?: string }) {
  const pct = Math.max(2, Math.round((points / Math.max(max, 1)) * 100));
  return (
    <div className="model-points" title={cost ? `官方約略價:${cost}` : undefined}>
      <span className="model-points__figure mono">
        {points} 點/次{estTwd != null ? ` · 約 NT$${estTwd}` : ""}
      </span>
      <span className="model-points__track" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      {cost ? <Meta className="model-points__cost mono">{cost}</Meta> : null}
    </div>
  );
}

/**
 * 目前這批模型的檔次組成:一條堆疊條回答「這一類是旗艦多還是經濟多」。
 * 顏色與檔次 pill 同一套(旗艦=赤陶／經濟=紫／最低=金),文字標籤永遠在旁邊,不靠顏色單獨表意。
 */
function CatalogTierMix({ items }: { items: ReadonlyArray<{ tier: string }> }) {
  const total = items.length;
  if (total === 0) return null;
  const counts = TIERS.map((t) => ({ ...t, n: items.filter((m) => m.tier === t.id).length })).filter((t) => t.n > 0);
  if (counts.length < 2) return null;
  return (
    <div className="model-catalog-mix">
      <span className="model-catalog-mix__bar" aria-hidden="true">
        {counts.map((t) => (
          <i key={t.id} className={`is-${t.id}`} style={{ width: `${(t.n / total) * 100}%` }} />
        ))}
      </span>
      <ul className="model-catalog-mix__legend">
        {counts.map((t) => (
          <li key={t.id} className={`is-${t.id}`}>
            <i aria-hidden="true" />
            {t.label}
            <b>{t.n}</b>
          </li>
        ))}
        <li className="model-catalog-mix__note">
          <Meta>長條＝點數在這批裡的相對高低</Meta>
        </li>
      </ul>
    </div>
  );
}

/** 精靈選項 chip:視覺與鍵盤操作(Enter/空白切換)由 <Chip> 提供;再點一次取消由 onToggle 決定 */
function WizardChip({ on, label, title, onToggle }: { on: boolean; label: string; title?: string; onToggle: () => void }) {
  return (
    <Chip
      selected={on}
      title={title}
      onClick={onToggle}
      style={{ cursor: "pointer" }}
    >
      {label}
    </Chip>
  );
}

/** 類別 → 占位圖示（無 Fal 縮圖時） */
const CATEGORY_ICON: Partial<Record<ModelCategory, IconName>> = {
  "text-to-image": "Image",
  "image-to-image": "Palette",
  "text-to-video": "Clapperboard",
  "image-to-video": "Film",
  "video-to-video": "Film",
  llm: "MessageCircle",
  vision: "Camera",
  "speech-to-text": "Mic",
  "text-to-speech": "Volume2",
  "text-to-audio": "Music",
  training: "Package",
};

/** 模型縮圖：優先 Fal 官方 thumbnail；失敗／無圖時類別色塊 */
function ModelThumb({
  label,
  category,
  src,
  size,
}: {
  label: string;
  category: ModelCategory | string;
  src?: string | null;
  /** 省略時由 CSS 的 --thumb 決定(目錄卡在手機上會縮到 56px);給了就是固定尺寸 */
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const showImg = !!src && !broken;
  const icon = CATEGORY_ICON[category as ModelCategory] ?? "Sparkles";
  return (
    <div
      className={`model-thumb${showImg ? "" : " is-placeholder"}`}
      style={size ? { width: size, height: size } : undefined}
      aria-hidden
    >
      {showImg ? (
        <img
          src={src!}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="model-thumb__fallback" title={label}>
          {/* 佔位圖示跟著格子縮放；沒指定尺寸時用 CSS 的預設格子(64px)推算 */}
          <Icon name={icon} size={Math.round((size ?? 64) * 0.36)} />
        </span>
      )}
    </div>
  );
}

/** 契約健康徽章 */
function HealthBadge({ health, note }: { health?: string | null; note?: string | null }) {
  const key = normalizeHealth(health);
  const meta = HEALTH_META[key];
  const icon: IconName =
    key === "live_ok"
      ? "CheckCircle2"
      : key === "openapi_404" || key === "live_fail"
        ? "XCircle"
        : key === "live_timeout"
          ? "Clock"
          : key === "needs_source"
            ? "Package"
            : "Info";
  return (
    <span
      className={`model-health-badge tone-${meta.tone}`}
      title={note || meta.hint}
    >
      <Icon name={icon} size={12} />
      {meta.short}
    </span>
  );
}

/** 決策中心共用:把一顆模型渲染成「名稱＋級別＋點數＋複製 ID」的小標籤 */
function ModelInline({
  id,
  lead,
  copiedId,
  onCopy,
  health,
  healthNote,
  thumbnailUrl,
}: {
  id: string;
  lead?: string;
  copiedId: string | null;
  onCopy: (id: string) => void;
  health?: string | null;
  healthNote?: string | null;
  thumbnailUrl?: string | null;
}) {
  const m = MODEL_BY_ID.get(id);
  if (!m) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", lineHeight: 1.6 }}>
      <ModelThumb label={m.label} category={m.category} src={thumbnailUrl} size={36} />
      {lead && <span className="eyebrow cjk" style={{ fontWeight: 700, color: "var(--primary-ink)" }}>{lead}</span>}
      <b style={{ fontSize: "var(--fs-14)" }}>{m.label}</b>
      <Pill className={TIER_CLASS[m.tier]}>{tierLabel(m.tier)}</Pill>
      {health != null && <HealthBadge health={health} note={healthNote} />}
      <span className="mono" style={{ fontSize: 11 }}>{m.points} 點</span>
      <Button variant="ghost" size="sm"
        title={`複製模型 ID:${m.id}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
        onClick={() => onCopy(m.id)}>
        {copiedId === m.id ? <><Icon name="Check" size={12} />已複製</> : "複製 ID"}
      </Button>
    </span>
  );
}

/** 看情境:一張情境卡——情境標題＋一句話＋首選(附理由)＋替代(可複製)＋去目錄看同類 */
function ScenarioCard({
  recipe,
  copiedId,
  onCopy,
  onJump,
  healthById,
}: {
  recipe: ScenarioRecipe;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onJump: (cat: ModelCategory) => void;
  healthById: Record<string, { health: string; healthNote: string; thumbnailUrl?: string | null } | undefined>;
}) {
  const primary = MODEL_BY_ID.get(recipe.pickIds[0]);
  const alts = recipe.pickIds.slice(1).map((id) => MODEL_BY_ID.get(id)).filter((m): m is ModelEntry => !!m);
  return (
    <Card variant="std" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div>
        <b style={{ fontSize: "var(--fs-15)" }}>{recipe.scene}</b>
        <Meta as="p" style={{ margin: "2px 0 0" }}>{recipe.intent}</Meta>
      </div>
      {primary && (
        <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 6 }}>
          <ModelInline
            id={primary.id}
            lead="首選"
            copiedId={copiedId}
            onCopy={onCopy}
            health={healthById[primary.id]?.health}
            healthNote={healthById[primary.id]?.healthNote}
            thumbnailUrl={healthById[primary.id]?.thumbnailUrl}
          />
          <Meta as="p" style={{ margin: "3px 0 0" }}>{recipe.why}</Meta>
        </div>
      )}
      {alts.length > 0 && (
        <Meta as="div" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: 0 }}>
          <span>替代:</span>
          {alts.map((m) => (
            // 這顆是「複製 ID」的一次性動作、不是切換態，所以蓋掉 Chip 預設補的 aria-pressed
            <Chip
              key={m.id}
              style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 3 }}
              title={`${m.strengths}｜點一下複製 ID`}
              onClick={() => onCopy(m.id)}
            >
              {copiedId === m.id ? <>已複製<Icon name="Check" size={11} /></> : m.label}
            </Chip>
          ))}
        </Meta>
      )}
      {primary && (
        <Button variant="ghost" size="sm"
          style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 4 }}
          onClick={() => onJump(primary.category)}>
          在目錄看同類<Icon name="ArrowRight" size={12} />
        </Button>
      )}
    </Card>
  );
}

/** 比風格:一張 PK 表——每列一個風格/需求維度,給首選與次選 */
function ShowdownCard({
  showdown,
  copiedId,
  onCopy,
  onJump,
  healthById,
}: {
  showdown: StyleShowdown;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onJump: (cat: ModelCategory) => void;
  healthById: Record<string, { health: string; healthNote: string; thumbnailUrl?: string | null } | undefined>;
}) {
  return (
    <Card variant="std" style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: "var(--fs-15)" }}>{showdown.title}</b>
        <Button variant="ghost" size="sm"
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}
          onClick={() => onJump(showdown.category)}>
          在目錄看同類<Icon name="ArrowRight" size={12} />
        </Button>
      </div>
      <Meta as="p" style={{ margin: "2px 0 0" }}>{showdown.subtitle}</Meta>
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: "var(--fs-13)", lineHeight: 1.5 }}>
          <thead>
            <tr>
              <th scope="col" className="hint model-showdown-table__lead">風格 / 需求</th>
              <th scope="col" className="hint">首選</th>
              <th scope="col" className="hint">次選</th>
            </tr>
          </thead>
          <tbody>
            {showdown.axes.map((a) => (
              <tr key={a.axis}>
                <th scope="row">
                  {a.axis}
                  <Meta style={{ display: "block", fontWeight: 400 }}>{a.note}</Meta>
                </th>
                <td>
                  <ModelInline
                    id={a.winnerId}
                    copiedId={copiedId}
                    onCopy={onCopy}
                    health={healthById[a.winnerId]?.health}
                    healthNote={healthById[a.winnerId]?.healthNote}
                    thumbnailUrl={healthById[a.winnerId]?.thumbnailUrl}
                  />
                </td>
                <td>
                  {a.runnerUpId ? (
                    <ModelInline
                      id={a.runnerUpId}
                      copiedId={copiedId}
                      onCopy={onCopy}
                      health={healthById[a.runnerUpId]?.health}
                      healthNote={healthById[a.runnerUpId]?.healthNote}
                      thumbnailUrl={healthById[a.runnerUpId]?.thumbnailUrl}
                    />
                  ) : (
                    <Meta>—</Meta>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
