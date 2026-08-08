import { trpc } from "../../api";
import { Badge, Button, Card, Meta } from "../../components/ui";

export function DuplicateReview({ projectId, onClose }: { projectId?: string | null; onClose: () => void }) {
  const queue = trpc.intelligence.duplicateQueue.useQuery({ projectId: projectId ?? undefined, limit: 30 });
  const resolve = trpc.intelligence.resolveDuplicate.useMutation({ onSuccess: () => void queue.refetch() });
  const current = queue.data?.groups[0];
  return (
    <Card className="review-queue">
      <div className="review-queue__heading"><div><h2>可能重複</h2><Meta>{queue.data?.groups.length ?? 0} 組</Meta></div><Button size="sm" onClick={onClose}>返回資料</Button></div>
      {!current ? <Meta>目前沒有待處理的重複素材</Meta> : (
        <div className="review-queue__question">
          <div><Badge>{current.method}</Badge><Meta>{current.members.length} 個 instances</Meta></div>
          <p>Primary Asset：{current.members.find((member) => member.intelligenceId === current.primaryIntelligenceId)?.summary ?? current.members.find((member) => member.intelligenceId === current.primaryIntelligenceId)?.category ?? "待選擇"}</p>
          <div className="duplicate-review__members">
            {current.members.map((member) => (
              <Card key={member.id}>
                <strong>{member.summary ?? member.category ?? "未命名素材"}</strong>
                <Meta>{member.resourceKind} · 相似度 {Math.round(member.similarity * 100)}%</Meta>
              </Card>
            ))}
          </div>
          <div className="review-queue__actions">
            <Button variant="primary" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: current.id, action: "keep" })}>保留 Primary</Button>
            <Button disabled={resolve.isPending} onClick={() => resolve.mutate({ id: current.id, action: "merge" })}>合併 instances</Button>
            <Button disabled={resolve.isPending} onClick={() => resolve.mutate({ id: current.id, action: "ignore" })}>忽略</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
