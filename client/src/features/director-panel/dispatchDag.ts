/**
 * 導演拆解草稿的 DAG 純函式：分層排版、拓撲序、示範推進。
 *
 * 後端 dispatch runner（M1–M6）尚未落地，這裡只做「依賴 → 幾層 / 誰能跑」
 * 的前端投影，供 DispatchPlanView 畫出分層時間軸與示範資料推進用；
 * 正式執行規則以 server/services/agentRunner.ts（tick 式）為準。
 */
import type { DispatchSubtask, DispatchSubtaskRuntime, DispatchSubtaskStatus } from "./dispatchTypes";

/**
 * 最長路徑分層：無依賴的步在第 0 層，其餘 = 1 + max(依賴層數)。
 * 同一層內彼此平行（可並排顯示）。
 */
export function layoutDispatchLayers(subtasks: DispatchSubtask[]): DispatchSubtask[][] {
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const layerOf = new Map<string, number>();

  const compute = (id: string, visiting: Set<string>): number => {
    const known = layerOf.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // 循環防呆：設計契約保證無循環
    visiting.add(id);
    const step = byId.get(id);
    const deps = (step?.dependsOn ?? []).filter((d) => byId.has(d));
    const value = deps.length ? 1 + Math.max(...deps.map((d) => compute(d, visiting))) : 0;
    visiting.delete(id);
    layerOf.set(id, value);
    return value;
  };

  for (const s of subtasks) compute(s.id, new Set());

  const groups = new Map<number, DispatchSubtask[]>();
  for (const s of subtasks) {
    const l = layerOf.get(s.id) ?? 0;
    const bucket = groups.get(l);
    if (bucket) bucket.push(s);
    else groups.set(l, [s]);
  }
  return [...groups.keys()]
    .sort((a, b) => a - b)
    .map((l) => groups.get(l)!);
}

/**
 * 依賴先行拓撲序（Kahn 精神、純函式）。
 * 用來決定示範資料「誰先跑完」的順序。
 */
export function topologicalOrder(subtasks: DispatchSubtask[]): string[] {
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const remainingDeps = new Map<string, number>(
    subtasks.map((s) => [s.id, (s.dependsOn ?? []).filter((d) => byId.has(d)).length]),
  );
  const order: string[] = [];
  const queue = subtasks.filter((s) => (remainingDeps.get(s.id) ?? 0) === 0).map((s) => s.id);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of subtasks) {
      if ((s.dependsOn ?? []).includes(id)) {
        const left = (remainingDeps.get(s.id) ?? 0) - 1;
        remainingDeps.set(s.id, left);
        if (left === 0) queue.push(s.id);
      }
    }
  }
  // 循環防呆：排不進去的補在最後
  for (const s of subtasks) {
    if (!order.includes(s.id)) order.push(s.id);
  }
  return order;
}

/**
 * 示範資料的執行推進：依拓撲序，前 `step` 個完成、第 `step` 個執行中。
 * `step` 越過總數時全部完成。純函式、零副作用，供 demoDirectorApi 與測試共用。
 */
export function advanceDemoSubtasks(
  subtasks: DispatchSubtask[],
  step: number,
): DispatchSubtaskRuntime[] {
  const order = topologicalOrder(subtasks);
  const indexOf = new Map(order.map((id, i) => [id, i]));
  return subtasks.map((s) => {
    const idx = indexOf.get(s.id) ?? 0;
    let status: DispatchSubtaskStatus = "pending";
    if (step > 0 && idx < step) status = "done";
    else if (step > 0 && idx === step) status = "running";
    if (step >= subtasks.length) status = "done";
    return { ...s, status, retryCount: 0 };
  });
}
