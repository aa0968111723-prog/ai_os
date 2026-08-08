import { trpc } from "../../api";
import { Badge, Button, Card, Meta } from "../../components/ui";

export function AssetInspector({ intelligenceId, onClose }: { intelligenceId: string; onClose: () => void }) {
  const detail = trpc.intelligence.assetDetail.useQuery({ intelligenceId });
  const reprocess = trpc.intelligence.reprocess.useMutation({ onSuccess: () => void detail.refetch() });
  const data = detail.data;
  return (
    <aside className="asset-inspector" aria-label="素材 AI 詳情">
      <div className="asset-inspector__heading">
        <strong>素材理解</strong>
        <Button size="sm" onClick={onClose}>關閉</Button>
      </div>
      {detail.isLoading || !data ? <Meta>讀取中…</Meta> : (
        <>
          <Card variant="quiet">
            <Meta>{data.intelligence.canonicalType}</Meta>
            <h3>{data.resource.title}</h3>
            <p>{data.intelligence.summary ?? "尚無 AI 摘要"}</p>
            <div className="hub-item__tags">
              {(data.intelligence.dynamicTags ?? []).map((tag) => <Badge key={tag}>{tag}</Badge>)}
            </div>
          </Card>
          <section><strong>AI Confidence</strong><Meta>{data.intelligence.categoryConfidence == null ? "待分析" : `${Math.round(data.intelligence.categoryConfidence * 100)}%`}</Meta></section>
          <section><strong>Relationships</strong><Meta>{data.relationships.length} 個關聯</Meta></section>
          <section><strong>Extraction</strong><Meta>{data.chunks.length} chunks・{data.segments.length} segments・{data.faces.length} faces</Meta></section>
          <section><strong>Source</strong><Meta>{data.sources[0]?.sourceType ?? data.intelligence.sourceType}</Meta>{data.sources[0]?.sourceUrl && <a href={data.sources[0].sourceUrl} target="_blank" rel="noreferrer">查看來源</a>}</section>
          <section><strong>Versions</strong><Meta>{data.versions.length} 個版本關聯</Meta></section>
          <Button
            disabled={reprocess.isPending}
            onClick={() => reprocess.mutate({
              resourceKind: data.intelligence.resourceKind as "asset" | "knowledge" | "document",
              resourceId: data.intelligence.resourceId,
            })}
          >重新分析</Button>
        </>
      )}
    </aside>
  );
}
