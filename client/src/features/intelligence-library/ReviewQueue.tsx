import { Link } from "wouter";
import { trpc } from "../../api";
import { Badge, Button, Card, Meta } from "../../components/ui";

export function ReviewQueue({ projectId, onClose }: { projectId?: string | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const queue = trpc.intelligence.reviewQueue.useQuery({ projectId: projectId ?? undefined, limit: 40 });
  const resolve = trpc.intelligence.resolveReview.useMutation({
    onSuccess: () => {
      void queue.refetch();
      void utils.intelligence.summary.invalidate();
      void utils.dataHub.list.invalidate();
    },
  });
  const current = queue.data?.items[0];
  return (
    <Card className="review-queue" data-fb="AI 待確認">
      <div className="review-queue__heading">
        <div>
          <h2>AI 待確認</h2>
          <Meta>{queue.data?.total ?? 0} 項</Meta>
        </div>
        <Button size="sm" onClick={onClose}>返回資料</Button>
      </div>
      {queue.isLoading ? <Meta>正在讀取…</Meta> : !current ? (
        <div className="review-queue__done"><strong>目前都確認完成了</strong><Meta>新的不確定判斷會自動出現在這裡。</Meta></div>
      ) : (
        <div className="review-queue__current">
          <div className="review-queue__preview">
            <span className="review-queue__type">{current.resource.intelligence?.canonicalType ?? current.resource.kind}</span>
            <strong>{current.resource.title}</strong>
            {current.summary && <p>{current.summary}</p>}
            <Link href={current.resource.href}>查看原始資料</Link>
          </div>
          <div className="review-queue__question">
            <Meta>AI 問你</Meta>
            <h3>{current.prompt}</h3>
            <div className="review-queue__suggestion">
              <strong>{current.category ?? "未分類"}</strong>
              <Badge>{Math.round(current.confidence * 100)}%</Badge>
            </div>
            <div className="review-queue__actions">
              <Button variant="primary" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: current.id, action: "confirm" })}>✓ 正確</Button>
              <Button disabled={resolve.isPending} onClick={() => resolve.mutate({ id: current.id, action: "reject" })}>不是這個</Button>
              <Button disabled={resolve.isPending} onClick={() => resolve.mutate({ id: current.id, action: "ignore" })}>略過</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
