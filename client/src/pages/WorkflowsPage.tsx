import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { SeriesTemplatePanel } from "../components/SeriesTemplatePanel";
import { Button, Card, Chip, EmptyState, Hint, Meta, Skeleton } from "../components/ui";
import { listSeriesTemplates, type SeriesTemplate } from "@shared/seriesTemplate";
import { WORKFLOW_PRESETS, tierLabel, type WorkflowPreset, type ModelTier } from "@shared/models";

/**
 * 自動化工作流頁面（/workflows）
 * 集中管理短影音母版系列（固定 5 段骨架＋4 格變數）與多模態串鏈管線（LLM 腳本 → 圖像 → 影片 → 配音 → 合成），
 * 讓日常團隊不必在首頁堆疊繁瑣面板，享有清晰、專業且一站式的自動化操作中心。
 */

type WorkflowFilterTab = "all" | "series" | "pipelines" | "sop";

const tierBadgeTone: Record<ModelTier, "accent" | "info" | "neutral"> = {
  flagship: "accent",
  economy: "info",
  budget: "neutral",
};

export function WorkflowsPage({ groupId, isLeader }: { groupId: string; isLeader: boolean }) {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<WorkflowFilterTab>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedWorkflowForProject, setSelectedWorkflowForProject] = useState<WorkflowPreset | null>(null);

  // 取得後端工作流清單（以 WORKFLOW_PRESETS 為底）
  const workflowsQuery = trpc.models.workflows.useQuery();
  const workflows = workflowsQuery.data ?? WORKFLOW_PRESETS;

  // 取得專案清單以供快速套用工作流
  const projectsQuery = trpc.projects.list.useQuery(
    { groupId: groupId || undefined },
    { enabled: !!groupId },
  );
  // 封存以 status 表示（專案表沒有 archivedAt 欄位）；原本比對的 p.archivedAt 永遠是 undefined，
  // 等於這個篩選從來沒有生效過——封存專案照樣列在「選一個專案套用工作流」裡。
  const projects = (projectsQuery.data ?? []).filter((p) => p.status !== "archived");

  // 取得短影音母版定義
  const seriesTemplates = useMemo(() => listSeriesTemplates(), []);
  const primarySeries = seriesTemplates[0];

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((w) => {
      if (tierFilter !== "all" && w.tier !== tierFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchLabel = w.label.toLowerCase().includes(q);
        const matchBest = w.bestFor.toLowerCase().includes(q);
        const matchStrengths = w.strengths.toLowerCase().includes(q);
        if (!matchLabel && !matchBest && !matchStrengths) return false;
      }
      return true;
    });
  }, [workflows, tierFilter, search]);

  return (
    <div className="page-shell secondary-page workflows-page">
      <SecondaryPageHeader
        eyebrow="管線與母版"
        title="自動化工作流"
        icon="Workflow"
        badge="標準化骨架 · 多模態串鏈"
        description={
          <>
            集中管理短影音母版系列與多模態自動化管線，免去每集重複設定的繁瑣步驟，一鍵串聯腳本潤飾、圖像定調、影片動態與旁白配音。
          </>
        }
      />

      {/* 頂部切換頁籤 */}
      <div
        className="workflows-tab-bar"
        role="tablist"
        aria-label="工作流分類"
        style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}
      >
        <Button
          variant={tab === "all" ? "primary" : "ghost"}
          size="sm"
          role="tab"
          aria-selected={tab === "all"}
          onClick={() => setTab("all")}
        >
          <Icon name="Workflow" size={14} /> 全部自動化 ({seriesTemplates.length + workflows.length})
        </Button>
        <Button
          variant={tab === "series" ? "primary" : "ghost"}
          size="sm"
          role="tab"
          aria-selected={tab === "series"}
          onClick={() => setTab("series")}
        >
          <Icon name="Clapperboard" size={14} /> 短影音母版系列 ({seriesTemplates.length})
        </Button>
        <Button
          variant={tab === "pipelines" ? "primary" : "ghost"}
          size="sm"
          role="tab"
          aria-selected={tab === "pipelines"}
          onClick={() => setTab("pipelines")}
        >
          <Icon name="Sparkles" size={14} /> 多模態預設管線 ({workflows.length})
        </Button>
        <Button
          variant={tab === "sop" ? "primary" : "ghost"}
          size="sm"
          role="tab"
          aria-selected={tab === "sop"}
          onClick={() => setTab("sop")}
        >
          <Icon name="FileText" size={14} /> SOP 與作業規範
        </Button>
      </div>

      <div className="stack" style={{ gap: 24 }}>
        {/* ── 區塊一：短影音母版系列 ── */}
        {(tab === "all" || tab === "series") && (
          <section aria-labelledby="section-series-title" className="workflows-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <h2 id="section-series-title" style={{ margin: 0, fontSize: "var(--fs-18)", display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="Clapperboard" size={20} style={{ color: "var(--primary-ink)" }} />
                  短影音母版系列
                </h2>
                <Meta as="p" style={{ marginTop: 4 }}>
                  相同結構的短影音（如週更開示 60 秒）走「複製母版骨架 → 每集填 4 格變數」，全自動拆解 5 段分鏡。
                </Meta>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Chip>{primarySeries?.totalSec} 秒規格</Chip>
                <Chip>{primarySeries?.aspect} 直式</Chip>
                <Chip>5 段固定分鏡</Chip>
              </div>
            </div>

            {groupId ? (
              <SeriesTemplatePanel groupId={groupId} isLeader={isLeader} />
            ) : (
              <Card>
                <Hint>請先於頂欄選擇或加入一個組別，即可開始建立與執行母版系列。</Hint>
              </Card>
            )}

            {/* 5 段骨架與規則展示卡 */}
            {primarySeries && (
              <Card style={{ marginTop: 12, background: "color-mix(in srgb, var(--card) 60%, var(--bg) 40%)" }}>
                <strong style={{ fontSize: "var(--fs-14)", display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="Info" size={15} />
                  母版 5 段骨架結構標準（{primarySeries.seriesName}）
                </strong>
                <Meta as="p" style={{ marginTop: 4, marginBottom: 12 }}>
                  系統在開集時會自動依此骨架為新專案建立 5 個對應的分鏡鏡號與秒數範圍，組員無需逐鏡手動排版。
                </Meta>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: 10,
                  }}
                >
                  {primarySeries.segments.map((seg) => (
                    <div
                      key={seg.no}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "var(--r-8)",
                        border: "1px solid var(--border-soft)",
                        background: "var(--card)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontWeight: 650, fontSize: "var(--fs-13)" }}>鏡 {seg.no}</span>
                        <Chip>{seg.startSec}–{seg.endSec} 秒</Chip>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: "var(--fs-13)", color: "var(--primary-ink)", marginBottom: 4 }}>
                        {seg.title}
                      </div>
                      <Meta as="p" style={{ margin: 0, fontSize: "var(--fs-11)", lineHeight: 1.4 }}>
                        {seg.intent}
                      </Meta>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </section>
        )}

        {/* ── 區塊二：多模態預設自動化工作流 ── */}
        {(tab === "all" || tab === "pipelines") && (
          <section aria-labelledby="section-pipelines-title" className="workflows-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h2 id="section-pipelines-title" style={{ margin: 0, fontSize: "var(--fs-18)", display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="Sparkles" size={20} style={{ color: "var(--primary-ink)" }} />
                  多模態自動化管線
                </h2>
                <Meta as="p" style={{ marginTop: 4 }}>
                  已驗證的多步 AI 鏈結管線（腳本潤飾 → 文生圖 → 圖生影 → 語音旁白 → 字幕合成），一鍵批次生成。
                </Meta>
              </div>

              {/* 篩選與搜尋列 */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="search"
                  placeholder="搜尋工作流名稱或情境…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ minWidth: 200, padding: "5px 10px", fontSize: "var(--fs-13)" }}
                  aria-label="搜尋工作流"
                />
                <select
                  value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value)}
                  style={{ padding: "5px 10px", fontSize: "var(--fs-13)" }}
                  aria-label="篩選模型等級"
                >
                  <option value="all">全部等級</option>
                  <option value="flagship">旗艦級</option>
                  <option value="economy">經濟級</option>
                  <option value="budget">最低成本</option>
                </select>
              </div>
            </div>

            {filteredWorkflows.length === 0 ? (
              <EmptyState
                title="找不到符合條件的工作流"
                description="請嘗試清除搜尋關鍵字或調整等級篩選條件。"
              />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  gap: 14,
                }}
              >
                {filteredWorkflows.map((wf) => (
                  <Card
                    key={wf.id}
                    as="article"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      position: "relative",
                      transition: "transform 0.15s ease, border-color 0.15s ease",
                    }}
                  >
                    <div>
                      {/* 卡片標頭 */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                        <strong style={{ fontSize: "var(--fs-15)", color: "var(--fg)" }}>
                          {wf.label}
                        </strong>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <Chip>{tierLabel(wf.tier)}</Chip>
                          <Chip>約 {wf.points} 點</Chip>
                        </div>
                      </div>

                      {/* 適合情境與亮點 */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: "var(--fs-12)", fontWeight: 650, color: "var(--primary-ink)", marginBottom: 2 }}>
                          適合情境：{wf.bestFor}
                        </div>
                        <Meta as="p" style={{ margin: 0, fontSize: "var(--fs-12)", lineHeight: 1.45 }}>
                          {wf.strengths}
                        </Meta>
                      </div>

                      {/* 步驟管線展示 */}
                      <div
                        style={{
                          background: "color-mix(in srgb, var(--card) 40%, var(--bg) 60%)",
                          padding: "8px 10px",
                          borderRadius: "var(--r-8)",
                          border: "1px solid var(--border-soft)",
                          marginBottom: 12,
                        }}
                      >
                        <div style={{ fontSize: "var(--fs-11)", fontWeight: 650, color: "var(--fg-secondary)", marginBottom: 6 }}>
                          管線步驟 ({wf.steps.length} 步)
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {wf.steps.map((st, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "20px 1fr auto",
                                alignItems: "center",
                                gap: 6,
                                fontSize: "var(--fs-11)",
                              }}
                            >
                              <span style={{ color: "var(--fg-secondary)", fontWeight: 600 }}>{idx + 1}.</span>
                              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {st.note ?? `步驟 ${idx + 1}`}
                              </span>
                              <code
                                style={{
                                  fontSize: "10px",
                                  padding: "1px 4px",
                                  background: "var(--card)",
                                  borderRadius: 4,
                                  color: "var(--fg-secondary)",
                                  maxWidth: 130,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={st.modelId}
                              >
                                {st.modelId.split("/").pop()?.split("#").pop()}
                              </code>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 卡片動作區 */}
                    <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}>
                      <Button
                        variant="primary"
                        size="sm"
                        style={{ flex: 1 }}
                        onClick={() => setSelectedWorkflowForProject(wf)}
                      >
                        <Icon name="Play" size={13} />
                        在專案中套用
                      </Button>
                      <Link
                        href="/models"
                        className="button button--ghost button--sm"
                        title="前往模型指南了解各步驟端點定價與特性"
                      >
                        <Icon name="Info" size={13} />
                      </Link>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── 區塊三：SOP 與作業規範 ── */}
        {(tab === "all" || tab === "sop") && (
          <section aria-labelledby="section-sop-title" className="workflows-section">
            <h2 id="section-sop-title" style={{ margin: "0 0 12px", fontSize: "var(--fs-18)", display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="FileText" size={20} style={{ color: "var(--primary-ink)" }} />
              自動化工作流 SOP 與人工守門原則
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 12,
              }}
            >
              <Card>
                <strong style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg)" }}>
                  <Icon name="SlidersHorizontal" size={16} style={{ color: "var(--primary-ink)" }} />
                  1. 規格固定、變數分離
                </strong>
                <Meta as="p" style={{ marginTop: 6, lineHeight: 1.5 }}>
                  母版確立時長、9:16 直式比例與 5 段標準骨架。日常開集只需填入「主題、原句出處、禁忌、截止日期」四格變數，避免每集流程漂移。
                </Meta>
              </Card>

              <Card>
                <strong style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg)" }}>
                  <Icon name="Sparkles" size={16} style={{ color: "var(--primary-ink)" }} />
                  2. 多模態自動化串聯
                </strong>
                <Meta as="p" style={{ marginTop: 6, lineHeight: 1.5 }}>
                  自動將前一步成果（如腳本文案）注入下一步模型（文生圖、圖生影、語音配音、FFmpeg 合成），免除人工手動跨軟體搬運檔案。
                </Meta>
              </Card>

              <Card>
                <strong style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg)" }}>
                  <Icon name="Scale" size={16} style={{ color: "var(--primary-ink)" }} />
                  3. 成本防護與透明估點
                </strong>
                <Meta as="p" style={{ marginTop: 6, lineHeight: 1.5 }}>
                  每條管線預先精準計算所需點數。執行前提供預估，若遇到高耗點或超過權限門檻，自動引導送審，杜絕點數意外超支。
                </Meta>
              </Card>

              <Card>
                <strong style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg)" }}>
                  <Icon name="CheckCircle2" size={16} style={{ color: "var(--primary-ink)" }} />
                  4. 人工過片與剪輯交付
                </strong>
                <Meta as="p" style={{ marginTop: 6, lineHeight: 1.5 }}>
                  自動化負責高效備料與初稿生成；開示合規、成片品質一律由人工過片確認。確認後支援直接匯出並銜接剪映、Premiere 與 Final Cut Pro。
                </Meta>
              </Card>
            </div>
          </section>
        )}
      </div>

      {/* ── 彈窗：選擇要執行工作流的專案 ── */}
      {selectedWorkflowForProject && (
        <div
          className="new-project-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedWorkflowForProject(null);
          }}
        >
          <Card
            as="section"
            className="new-project-modal-card"
            style={{ maxWidth: 520, width: "90vw" }}
            aria-label={`套用工作流：${selectedWorkflowForProject.label}`}
          >
            <button
              type="button"
              className="new-project-modal__close"
              aria-label="關閉"
              onClick={() => setSelectedWorkflowForProject(null)}
            >
              <Icon name="X" size={18} />
            </button>

            <h3 style={{ margin: 0, fontSize: "var(--fs-18)", display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="Workflow" size={20} style={{ color: "var(--primary-ink)" }} />
              套用「{selectedWorkflowForProject.label}」
            </h3>
            <Meta as="p" style={{ marginTop: 4, marginBottom: 16 }}>
              請選擇要在哪一個專案中執行此工作流（預估消耗約 {selectedWorkflowForProject.points} 點）：
            </Meta>

            {projects.length === 0 ? (
              <EmptyState
                title="目前沒有進行中的專案"
                description="請先前往今日工作台建立新專案，再套用自動化工作流。"
                action={
                  <Button variant="primary" onClick={() => navigate("/dashboard")}>
                    前往今日工作台
                  </Button>
                }
              />
            ) : (
              <div style={{ display: "grid", gap: 8, maxHeight: 300, overflowY: "auto", marginBottom: 16 }}>
                {projects.map((proj) => (
                  <button
                    key={proj.id}
                    type="button"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      borderRadius: "var(--r-8)",
                      border: "1px solid var(--border-soft)",
                      background: "var(--card)",
                      textAlign: "left",
                      cursor: "pointer",
                      gap: 8,
                    }}
                    onClick={() => {
                      setSelectedWorkflowForProject(null);
                      navigate(`/p/${proj.id}`);
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 650, fontSize: "var(--fs-13)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {proj.title}
                      </div>
                      <Meta as="div" style={{ fontSize: "var(--fs-11)", marginTop: 2 }}>
                        {proj.kind || "未指定類型"} · 更新於 {new Date(proj.updatedAt).toLocaleDateString("zh-TW")}
                      </Meta>
                    </div>
                    <Icon name="ArrowRight" size={16} style={{ color: "var(--primary-ink)", flex: "none" }} />
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" onClick={() => setSelectedWorkflowForProject(null)}>
                取消
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
