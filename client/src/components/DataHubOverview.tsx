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

/**
 * 資料中心總覽：一份跨 domain 的資料清單 + 搜尋 + 來源狀態。
 *
 * 這一層對使用者只講三件事：
 *   這是什麼資料 → 屬於誰／哪個專案 → AI 可不可以用
 * 不露出 UUID、不露出 table/row/embedding/binding 這些底層詞。
 *
 * 資料一律來自 dataHub facade（server 端逐 domain 套原本的 ACL）；
 * 這裡沒有任何前端過濾式的「權限」——看得到就是後端允許看到。
 */

const KIND_ICON: Record<DataHubKind, IconName> = {
  knowledge: "FileText",
  table: "Database",
  document: "Paperclip",
  asset: "Image",
};

const KIND_FILTERS: Array<{ id: DataHubKind | "all"; label: string }> = [
  { id: "all", label: "全部" },
  { id: "knowledge", label: "文字資料" },
  { id: "asset", label: "圖影素材" },
  { id: "document", label: "文件" },
  { id: "table", label: "資料表" },
];

const SOURCE_ICON: Record<string, IconName> = {
  "google-drive": "HardDrive",
  notion: "FileText",
  api: "Waypoints",
};

/** 停手 250ms 才送出搜尋：逐字打字不要每個鍵都打一次 server */
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
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(then).toLocaleDateString("zh-TW");
}

export function DataHubOverview({ projectId, projectTitle, onAddData }: {
  /** 有專案上下文時，預設就只看這個專案的資料——不要把人丟回全站清單 */
  projectId?: string | null;
  projectTitle?: string | null;
  onAddData: () => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<DataHubKind | "all">("all");
  const debouncedQuery = useDebounced(query, 250);

  const listQuery = trpc.dataHub.list.useQuery(
    {
      q: debouncedQuery.trim() || undefined,
      kinds: kind === "all" ? undefined : [kind],
      projectId: projectId ?? undefined,
    },
    // placeholderData：換關鍵字時保留上一批結果，畫面不閃空清單；
    // react-query 也負責把過期回應丟掉（stale response 不會蓋掉新的）
    { staleTime: 15_000, placeholderData: (prev) => prev },
  );
  const sources = trpc.dataHub.sources.useQuery(undefined, { staleTime: 60_000 });

  const resources: DataHubResource[] = listQuery.data?.resources ?? [];
  const counts = listQuery.data?.counts;
  const searching = !!debouncedQuery.trim();

  const summarySentence = useMemo(
    () => (counts ? dataHubSummarySentence(counts) : "正在整理你的資料…"),
    [counts],
  );

  return (
    <section className="hub-overview" aria-label="資料中心總覽">
      <div className="hub-overview__bar">
        <label className="hub-search">
          <span className="sr-only">搜尋所有資料</span>
          <Icon name="Search" size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={projectTitle ? `搜尋「${projectTitle}」的資料…` : "搜尋所有資料…"}
            maxLength={120}
          />
        </label>
        <Meta as="p" className="hub-overview__summary" role="status">{summarySentence}</Meta>
      </div>

      <div className="hub-filters" role="group" aria-label="資料類型">
        {KIND_FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={kind === f.id ? "primary" : undefined}
            aria-pressed={kind === f.id}
            onClick={() => setKind(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {listQuery.error && (
        <p className="error" role="alert">
          載入資料失敗：{listQuery.error.message}
          <Button size="sm" onClick={() => listQuery.refetch()}>重試</Button>
        </p>
      )}

      {listQuery.isLoading ? (
        <Meta as="p" role="status">正在讀取你的資料…</Meta>
      ) : resources.length === 0 ? (
        searching ? (
          <Meta as="p">找不到「{debouncedQuery.trim()}」——換個關鍵字，或改看其他類型。</Meta>
        ) : (
          /* §39 空狀態：不要顯示 0 資料庫 / 0 資料列 / 0 AI 可用 */
          <EmptyState
            icon={<Icon name="Database" />}
            title={<>還沒有資料</>}
            description={<>把文件、素材與工作資料放進來，之後專案與 AI 就能依你的設定使用。</>}
            action={
              <Button variant="primary" onClick={onAddData}>
                <Icon name="Plus" size={15} /> 加入第一份資料
              </Button>
            }
          />
        )
      ) : (
        <>
          <p className="hub-list__title">{searching ? "搜尋結果" : "最近使用"}</p>
          <ul className="hub-list">
            {resources.map((r) => (
              <li key={r.id}>
                <Link href={r.href} className="hub-item">
                  <span className="hub-item__icon"><Icon name={KIND_ICON[r.kind]} size={16} /></span>
                  <span className="hub-item__copy">
                    <strong>{r.title}</strong>
                    <small>
                      {dataHubKindLabel(r.kind)}
                      ・{r.projectTitle ?? dataHubScopeLabel(r.scope)}
                      ・{dataHubSourceLabel(r.source)}
                      {r.sizeLabel ? `・${r.sizeLabel}` : ""}
                    </small>
                  </span>
                  <span className="hub-item__state">
                    <Badge title={r.ai.reason}>{dataHubAiAccessLabel(r.ai.access)}</Badge>
                    {r.status !== "ready" && <Badge>{r.statusLabel}</Badge>}
                    <Meta>{relativeTime(r.updatedAt)}</Meta>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {listQuery.data?.truncated && (
            /* 靜默截斷會讓人以為「就這些了」——講出來，並給下一步 */
            <Hint style={{ margin: 0 }}>還有更多資料沒列出來——用上面的搜尋或類型篩選縮小範圍。</Hint>
          )}
        </>
      )}

      {/* 來源與同步：屬於進階管理，所以預設收合，不跟「加入資料」搶首屏 */}
      <Card as="details" variant="quiet" className="hub-sources" data-fb="來源與同步">
        <summary>
          <Icon name="Waypoints" size={14} /> 來源與同步
          <Meta style={{ marginLeft: 8 }}>
            {sources.data
              ? `${sources.data.filter((s) => s.connected).length} / ${sources.data.length} 已連接`
              : "讀取中…"}
          </Meta>
        </summary>
        {/* 手機用直式清單而不是水平大卡——水平卡在 390px 一定被裁掉 */}
        <ul className="hub-source-list">
          {(sources.data ?? []).map((s) => {
            const state = dataHubConnectionState({ configured: s.configured, connected: s.connected, status: s.status });
            return (
              <li key={s.id} className="hub-source">
                <span className="hub-source__icon"><Icon name={SOURCE_ICON[s.id] ?? "Waypoints"} size={16} /></span>
                <span className="hub-source__copy">
                  <strong>{s.label}</strong>
                  <small>{dataHubConnectionLabel(state)}{s.detail ? `・${s.detail}` : ""}</small>
                </span>
                <Link
                  href={withReturnTo("/integrations", currentReturnTo())}
                  className="btn-sm"
                  style={{ textDecoration: "none" }}
                >
                  管理 <Icon name="ArrowRight" size={13} />
                </Link>
              </li>
            );
          })}
        </ul>
        {/* ★ 不變量 I1：連接只代表「你可以去挑」，不代表 AI 讀得到那邊的東西 */}
        <Hint style={{ margin: 0 }}>
          連接只是讓你可以去自己的雲端挑檔案；AI 只讀得到你選中並加入站內的內容。
          中斷連接不會刪掉已經加入的資料。
        </Hint>
      </Card>
    </section>
  );
}
