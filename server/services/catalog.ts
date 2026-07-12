/**
 * 模型目錄同步:啟動時把 shared/models.ts(單一真相)寫進 model_catalog 表,
 * 讓使用者/代理能用 SQL、tRPC、MCP 快速找到「哪個模型適合這個任務」。
 * 工作流預設也入表(category=workflow),points 為各步合計估點。
 */
import { db, schema } from "../db";
import { MODELS, WORKFLOW_PRESETS, endpointOf } from "../../shared/models";

export async function syncCatalog(): Promise<number> {
  const rows = [
    ...MODELS.map((m) => ({
      id: m.id,
      endpoint: endpointOf(m),
      category: m.category,
      tier: m.tier,
      kind: m.kind,
      needs: m.needs ?? null,
      points: m.points,
      strengths: m.strengths,
      bestFor: m.bestFor,
      cost: m.cost,
      verified: m.verified,
      updatedAt: new Date(),
    })),
    ...WORKFLOW_PRESETS.map((w) => ({
      id: w.id,
      endpoint: "internal/workflow",
      category: "workflow" as const,
      tier: w.tier,
      kind: "text" as const,
      needs: null,
      points: w.points,
      strengths: w.strengths,
      bestFor: w.bestFor,
      cost: `${w.steps.length} 步合計約 ${w.points} 點`,
      verified: true,
      updatedAt: new Date(),
    })),
  ];
  await db.delete(schema.modelCatalog);
  await db.insert(schema.modelCatalog).values(rows);
  console.log(`[catalog] ✓ 模型目錄已同步(${rows.length} 條:模型 ${MODELS.length}+工作流 ${WORKFLOW_PRESETS.length})`);
  return rows.length;
}
