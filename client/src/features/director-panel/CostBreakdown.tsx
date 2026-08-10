/**
 * 成本確認區（§6 / §9.1「costEstimate.totalPoints + 每步明細」）。
 *
 * 顯示總估點 + 每步子任務明細（類型 / 模型 / 估點 / 拆解說明），
 * 供「核准並開始執行」前的最後確認。
 */
import type { CostEstimate } from "./dispatchTypes";
import { DISPATCH_TYPE_LABEL } from "./dispatchTypes";
import { Card } from "../../components/ui";
import { Meta } from "../../components/ui";

export function CostBreakdown({ estimate, provider }: { estimate: CostEstimate; provider?: string }) {
  return (
    <Card variant="std" className="director-cost" data-testid="cost-breakdown">
      <div className="director-cost__head">
        <div>
          <span className="director-cost__label">預估成本</span>
          {provider ? <Meta as="span" className="director-cost__provider">拆解來源 {provider}</Meta> : null}
        </div>
        <div className="director-cost__total" data-testid="cost-total">
          <strong>{estimate.totalPoints}</strong>
          <Meta as="span">pt</Meta>
        </div>
      </div>
      <Meta as="p" className="director-cost__breakdown">
        {estimate.breakdown}
      </Meta>
      <ul className="director-cost__rows">
        {estimate.perSubtask.map((row) => (
          <li key={row.id} className="director-cost__row">
            <span className="director-cost__row-label">
              <span className="director-cost__row-type">{row.id}</span>
              {DISPATCH_TYPE_LABEL[row.type as keyof typeof DISPATCH_TYPE_LABEL] ?? row.type}
              <Meta as="span"> · {row.model}</Meta>
            </span>
            <span className="director-cost__row-detail">
              <Meta as="span">{row.breakdown}</Meta>
              <span className="director-cost__row-points">{row.estPoints}pt</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
