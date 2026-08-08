import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { Badge, Button, Card, EmptyState, Hint, Meta } from "./ui";
import {
  dataHubAiAccessLabel,
  dataHubConnectionLabel,
  dataHubConnectionState,
  dataHubKindLabel,
  dataHubScopeLabel,
  dataHubSourceLabel,
  dataHubSummarySentence,
  type DataHubKind,
  type DataHubResource,
} from "@shared/dataHub";
import { currentReturnTo, withReturnTo } from "@shared/returnTo";
import {
  SmartCategories,
  resourceMatchesSmartCategory,
  type SmartCategoryId,
} from "../features/intelligence-library/SmartCategories";
import { ReviewSummary, type IntelligenceSummaryView } from "../features/intelligence-library/ReviewSummary";
import { ProcessingPanel } from "../features/intelligence-library/ProcessingPanel";
import { ReviewQueue } from "../features/intelligence-library/ReviewQueue";
import { AssetInspector } from "../features/intelligence-library/AssetInspector";
import { DuplicateReview } from "../features/intelligence-library/DuplicateReview";
import { PersonClusterReview, PersonDetailPanel } from "../features/intelligence-library/PersonDetailPanel";

const KIND_ICON: Record<DataHubKind, IconName> = {
  knowledge: "FileText",
  table: "Database",
  document: "Paperclip",
  asset: "Image",
};

const SOURCE_ICON: Record<string, IconName> = {
  "google-drive": "HardDrive",
  notion: "FileText",
  api: "Waypoints",
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const min = Math.floor((Date.now() - then) / 60_000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(then).toLocaleDateString("zh-TW");
}

function confidenceLabel(confidence: number | null | undefined): string | null {
  if (confidence == null) return null;
  return `AI ${Math.round(confidence * 100)}%`;
}

function ResourceList({ resources, title, searchScores, onInspect }: {
  resources: DataHubResource[];
  title: string;
  searchScores?: Map<string, number>;
  onInspect?: (intelligenceId: string) => void;
}) {
  if (!resources.length) return null;
  return (
    <section className="hub-resource-section">
      <p className="hub-list__title">{title}</p>
      <ul className="hub-list">
        {resources.map((resource) => {
          const intelligence = resource.intelligence;
          return (
            <li key={resource.id}>
              <Link href={resource.href} className="hub-item">
                <span className="hub-item__icon"><Icon name={KIND_ICON[resource.kind]} size={16} /></span>
                <span className="hub-item__copy">
                  <strong>{resource.title}</strong>
                  {intelligence?.summary && <span className="hub-item__summary">{intelligence.summary}</span>}
                  <small>
                    {intelligence?.category ?? dataHubKindLabel(resource.kind)}
                    ・{resource.projectTitle ?? dataHubScopeLabel(resource.scope)}
                    ・{dataHubSourceLabel(resource.source)}
                    {resource.sizeLabel ? `・${resource.sizeLabel}` : ""}
                    {resource.syncedLabel ? `・${resource.syncedLabel}` : ""}
                  </small>
                  {!!intelligence?.tags.length && (
                    <span className="hub-item__tags">
                      {intelligence.tags.slice(0, 4).map((tag) => <Badge key={tag}>{tag.split(":").at(-1)?.replace(/-/g, " ")}</Badge>)}
                    </span>
                  )}
                </span>
                <span className="hub-item__state">
                  {searchScores?.has(resource.id) && <Badge>相關度 {Math.round((searchScores.get(resource.id) ?? 0) * 100)}%</Badge>}
                  {confidenceLabel(intelligence?.confidence) && <Badge>{confidenceLabel(intelligence?.confidence)}</Badge>}
                  {!intelligence && <Badge title={resource.ai.reason}>{dataHubAiAccessLabel(resource.ai.access)}</Badge>}
                  {intelligence?.analysisStatus === "needs_review" && <Badge>AI 建議</Badge>}
                  {resource.status !== "ready" && <Badge>{resource.statusLabel}</Badge>}
                  {resource.sourceHasUpdate && <Badge>來源有更新</Badge>}
                  <Meta>{relativeTime(resource.updatedAt)}</Meta>
                </span>
              </Link>
              {intelligence && <Button size="sm" className="hub-item__inspect" onClick={() => onInspect?.(intelligence.id)}>AI 詳情</Button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DataHubOverview({ projectId, projectTitle, onAddData }: {
  projectId?: string | null;
  projectTitle?: string | null;
  onAddData: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SmartCategoryId>("all");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedIntelligenceId, setSelectedIntelligenceId] = useState<string | null>(null);
  const debouncedQuery = useDebounced(query, 250);
  const searching = !!debouncedQuery.trim();

  const listQuery = trpc.dataHub.list.useQuery(
    { projectId: projectId ?? undefined, perKindLimit: 200 },
    { staleTime: 15_000, placeholderData: (previous) => previous },
  );
  const semanticSearch = trpc.intelligence.search.useQuery(
    { q: debouncedQuery.trim() || "_", projectId: projectId ?? undefined, limit: 60 },
    { enabled: searching, staleTime: 15_000, placeholderData: (previous) => previous },
  );
  const intelligence = trpc.intelligence.summary.useQuery({ projectId: projectId ?? undefined }, { staleTime: 10_000 });
  const processing = trpc.intelligence.processing.useQuery(
    { projectId: projectId ?? undefined },
    { staleTime: 4_000, refetchInterval: (query) => query.state.data?.active ? 4_000 : false },
  );
  const people = trpc.intelligence.people.useQuery(
    { projectId: projectId ?? undefined },
    { enabled: category === "people" || searching, staleTime: 20_000 },
  );
  const sources = trpc.dataHub.sources.useQuery(undefined, { staleTime: 60_000 });

  const baseResources: DataHubResource[] = searching
    ? (semanticSearch.data?.results ?? []).map((result) => ({ ...result.resource, intelligence: result.intelligence }))
    : (listQuery.data?.resources ?? []);
  const resources = useMemo(
    () => baseResources.filter((resource) => resourceMatchesSmartCategory(resource, category)),
    [baseResources, category],
  );
  const searchScores = useMemo(
    () => new Map((semanticSearch.data?.results ?? []).map((result) => [result.resource.id, result.score])),
    [semanticSearch.data?.results],
  );
  const matchingPeople = (people.data?.people ?? []).filter((person) =>
    !searching || person.name.toLocaleLowerCase("zh-TW").includes(debouncedQuery.trim().toLocaleLowerCase("zh-TW")),
  );
  const unnamedClusters = people.data?.clusters.filter((cluster) => cluster.status === "unconfirmed") ?? [];
  const counts = listQuery.data?.counts;
  const summarySentence = useMemo(
    () => counts ? dataHubSummarySentence(counts) : "正在理解你的專案資料…",
    [counts],
  );
  const reviewSummary: IntelligenceSummaryView = intelligence.data ?? {
    aiReview: 0, unnamedPeople: 0, possibleDuplicates: 0, unassignedProject: 0,
  };
  const isLoading = searching ? semanticSearch.isLoading : listQuery.isLoading;
  const error = searching ? semanticSearch.error : listQuery.error;

  const selectAttention = (key: keyof IntelligenceSummaryView) => {
    if (key === "aiReview") setReviewOpen(true);
    if (key === "unnamedPeople") setCategory("people");
    if (key === "unassignedProject") setCategory("projects");
    if (key === "possibleDuplicates") setDuplicateOpen(true);
  };

  return (
    <section className="hub-overview intelligence-library" aria-label="AI 智慧資料中心">
      <div className="library-intro">
        <span><Icon name="Sparkles" size={16} /></span>
        <div><strong>AI 已理解你的專案資料</strong><Meta>{summarySentence}</Meta></div>
      </div>

      <div className="hub-overview__bar">
        <label className="hub-search">
          <span className="sr-only">搜尋人物、場景、腳本、素材、專案</span>
          <Icon name="Search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋人物、場景、腳本、素材、專案…"
            maxLength={240}
          />
        </label>
      </div>

      <SmartCategories value={category} onChange={(value) => { setCategory(value); setReviewOpen(false); }} />
      <ProcessingPanel data={processing.data} />

      {reviewOpen ? <ReviewQueue projectId={projectId} onClose={() => setReviewOpen(false)} />
        : duplicateOpen ? <DuplicateReview projectId={projectId} onClose={() => setDuplicateOpen(false)} />
          : selectedPersonId ? <PersonDetailPanel personId={selectedPersonId} onClose={() => setSelectedPersonId(null)} />
            : selectedClusterId ? (() => {
              const cluster = unnamedClusters.find((item) => item.id === selectedClusterId);
              return cluster ? <PersonClusterReview
                clusterId={cluster.id}
                label={cluster.label}
                projectId={cluster.projectId}
                onDone={() => { setSelectedClusterId(null); void people.refetch(); void intelligence.refetch(); }}
              /> : null;
            })() : (
        <div className="library-layout">
          <aside className="library-layout__attention">
            <ReviewSummary summary={reviewSummary} onSelect={selectAttention} />
          </aside>
          <main className="library-layout__content">
            {error && <p className="error" role="alert">搜尋資料失敗：{error.message}</p>}
            {isLoading ? <Meta as="p" role="status">AI 正在搜尋你的資料…</Meta> : (
              <>
                {(category === "people" || (searching && matchingPeople.length > 0)) && (
                  <section className="person-results">
                    <p className="hub-list__title">人物</p>
                    <div className="person-results__grid">
                      {matchingPeople.map((person) => (
                        <Card key={person.id} className="person-result" role="button" tabIndex={0} onClick={() => setSelectedPersonId(person.id)} onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedPersonId(person.id); }
                        }}>
                          <span className="person-result__avatar"><Icon name="User" size={20} /></span>
                          <span><strong>{person.name}</strong><Meta>Person Knowledge Entity</Meta></span>
                          <Icon name="ChevronRight" size={16} />
                        </Card>
                      ))}
                      {category === "people" && unnamedClusters.map((cluster) => (
                        <Card key={cluster.id} className="person-result person-result--unconfirmed" role="button" tabIndex={0} onClick={() => setSelectedClusterId(cluster.id)} onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedClusterId(cluster.id); }
                        }}>
                          <span className="person-result__avatar"><Icon name="User" size={20} /></span>
                          <span><strong>{cluster.label}</strong><Meta>{cluster.faceCount} 個臉部出現・待確認</Meta></span>
                          <Badge>{cluster.confidence ? `${Math.round(cluster.confidence * 100)}%` : "待命名"}</Badge>
                        </Card>
                      ))}
                    </div>
                  </section>
                )}

                {resources.length > 0 ? (
                  searching ? <ResourceList resources={resources} title="相關素材與資料" searchScores={searchScores} onInspect={setSelectedIntelligenceId} /> : (
                    <>
                      <ResourceList resources={resources.slice(0, 6)} title="最近使用" onInspect={setSelectedIntelligenceId} />
                      <ResourceList resources={resources.slice(6, 14)} title="最近加入" onInspect={setSelectedIntelligenceId} />
                    </>
                  )
                ) : category !== "people" && (
                  searching ? <Meta as="p">找不到「{debouncedQuery.trim()}」——可以換一種說法，或清除智慧分類。</Meta> : (
                    <EmptyState
                      icon={<Icon name="Database" />}
                      title={<>還沒有資料</>}
                      description={<>把文件、素材與工作資料放進來，AI 會自動理解、分類並建立關聯。</>}
                      action={<Button variant="primary" onClick={onAddData}><Icon name="Plus" size={15} /> 加入第一份資料</Button>}
                    />
                  )
                )}
                {searching && semanticSearch.data?.retrievalDebug && (
                  <Hint className="retrieval-debug">已用 metadata、全文與語意索引搜尋，且先套用你的資料權限。</Hint>
                )}
                {!searching && listQuery.data?.truncated && <Hint>還有更多資料——使用搜尋或智慧分類縮小範圍。</Hint>}
              </>
            )}
          </main>
        </div>
      )}

      {selectedIntelligenceId && <AssetInspector intelligenceId={selectedIntelligenceId} onClose={() => setSelectedIntelligenceId(null)} />}

      <Card as="details" variant="quiet" className="hub-sources" data-fb="來源與同步">
        <summary>
          <Icon name="Waypoints" size={14} /> 來源與同步
          <Meta style={{ marginLeft: 8 }}>
            {sources.data ? `${sources.data.filter((source) => source.connected).length} / ${sources.data.length} 已連接` : "讀取中…"}
          </Meta>
        </summary>
        <ul className="hub-source-list">
          {(sources.data ?? []).map((source) => {
            const state = dataHubConnectionState({ configured: source.configured, connected: source.connected, status: source.status });
            return (
              <li key={source.id} className="hub-source">
                <span className="hub-source__icon"><Icon name={SOURCE_ICON[source.id] ?? "Waypoints"} size={16} /></span>
                <span className="hub-source__copy"><strong>{source.label}</strong><small>{dataHubConnectionLabel(state)}{source.detail ? `・${source.detail}` : ""}</small></span>
                <Link href={withReturnTo("/integrations", currentReturnTo())} className="btn-sm">管理 <Icon name="ArrowRight" size={13} /></Link>
              </li>
            );
          })}
        </ul>
        <Hint>連接只是讓你可以去自己的雲端挑檔案；AI 只讀得到你選中並加入站內的內容。中斷連接不會刪掉已加入的資料。</Hint>
      </Card>
    </section>
  );
}
