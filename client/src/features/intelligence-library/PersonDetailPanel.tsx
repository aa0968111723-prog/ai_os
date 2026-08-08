import { useState } from "react";
import { trpc } from "../../api";
import { Badge, Button, Card, Meta } from "../../components/ui";

export function PersonDetailPanel({ personId, onClose }: { personId: string; onClose: () => void }) {
  const detail = trpc.intelligence.personDetail.useQuery({ id: personId });
  const data = detail.data;
  return (
    <section className="person-detail" aria-label="人物資料頁">
      <div className="asset-inspector__heading"><strong>Person Knowledge Entity</strong><Button size="sm" onClick={onClose}>返回</Button></div>
      {detail.isLoading || !data ? <Meta>讀取人物關聯中…</Meta> : (
        <>
          <h2>{data.person.name}</h2>
          <div className="person-detail__counts">
            <Badge>{data.counts.photos} Photos</Badge><Badge>{data.counts.videos} Videos</Badge>
            <Badge>{data.counts.documents} Documents</Badge><Badge>{data.counts.projects} Projects</Badge>
          </div>
          <h3>Appearances</h3>
          <div className="person-results__grid">
            {data.appearances.map((item) => <Card key={item.intelligence.id}><a href={item.resource.href}>{item.resource.title}</a><Meta>{item.intelligence.category}</Meta></Card>)}
          </div>
          {!data.appearances.length && <Meta>尚無可見的相關素材</Meta>}
        </>
      )}
    </section>
  );
}

export function PersonClusterReview({ clusterId, label, projectId, onDone }: {
  clusterId: string; label: string; projectId?: string | null; onDone: () => void;
}) {
  const [name, setName] = useState("");
  const resolve = trpc.intelligence.resolveFaceCluster.useMutation({ onSuccess: onDone });
  return (
    <Card className="person-cluster-review">
      <strong>{label}</strong><Meta>AI 不會猜真實身份，請由你命名。</Meta>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="這個人物是誰？" aria-label="人物名稱" />
      <div className="review-queue__actions">
        <Button variant="primary" disabled={!name.trim() || resolve.isPending} onClick={() => resolve.mutate({ clusterId, action: "create", name: name.trim() })}>建立人物</Button>
        <Button disabled={resolve.isPending} onClick={() => resolve.mutate({ clusterId, action: "ignore" })}>忽略</Button>
      </div>
      <Meta>{projectId ? "命名後會連結至目前專案" : "命名後會成為團隊人物實體"}</Meta>
    </Card>
  );
}
