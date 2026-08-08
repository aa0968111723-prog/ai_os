import { Icon } from "../../components/Icon";
import { Badge, Card, Meta } from "../../components/ui";

const STAGE_LABEL: Record<string, string> = {
  extract_metadata: "讀取檔案資訊",
  classification: "理解與分類",
  embedding: "建立語意索引",
  dedupe: "尋找重複項目",
  relationship_detection: "尋找專案關聯",
};

export function ProcessingPanel({ data }: {
  data?: { active: number; failed: number; progress: number; stages: Array<{ stage: string; status: string; count: number }> };
}) {
  if (!data || (data.active === 0 && data.failed === 0)) return null;
  return (
    <Card className="processing-panel" data-fb="AI 整理進度">
      <div className="processing-panel__heading">
        <span><Icon name="Sparkles" size={17} /> <strong>AI 整理進度</strong></span>
        <strong>{data.progress}%</strong>
      </div>
      <div className="processing-panel__bar" aria-label={`AI 整理進度 ${data.progress}%`}>
        <span style={{ width: `${Math.max(2, data.progress)}%` }} />
      </div>
      <Meta as="p">正在理解 {data.active} 個處理步驟</Meta>
      <div className="processing-panel__stages">
        {data.stages.slice(0, 5).map((stage) => (
          <Badge key={`${stage.stage}:${stage.status}`}>{STAGE_LABEL[stage.stage] ?? stage.stage} {stage.count}</Badge>
        ))}
        {data.failed > 0 && <Badge>{data.failed} 項可重新分析</Badge>}
      </div>
    </Card>
  );
}
