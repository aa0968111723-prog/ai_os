import type { AgentStep } from "./agentRunner";

/**
 * The multi-agent video-editing workflow, as an executable DAG.
 *
 * This is not a diagram: every node below is a real `AgentStep` the existing
 * agent runner schedules, with real `dependsOn` edges that
 * `shared/agentDag.ts` resolves. Independent branches (speakers / topics /
 * semantic index) become genuinely concurrent; the approval gate is a real
 * `request_approval` step that the destructive edit depends on, so
 * `cutosStepRunner.approvalSatisfied` can only pass once a human has acted.
 *
 * The shape mirrors the user goal it exists for:
 *
 *   「把這支 45 分鐘的訪談剪成一支 8 分鐘精華，再找三段最適合短影音的地方。」
 *
 *   ensure transcript
 *     ├─ ensure speakers
 *     ├─ ensure topics
 *     └─ ensure semantic index
 *           ↓
 *      semantic analyst
 *           ↓
 *      find highlights
 *           ↓
 *   long-form planner ──┬─ verify
 *                       └─ short candidates
 *           ↓
 *      approval gate
 *           ↓
 *      CUTOS apply
 *           ↓
 *      instant preview
 *           ↓
 *         export
 */

export interface VideoWorkflowInput {
  /** The user's own words; kept for the plan summary and the planner step. */
  goal: string;
  /** Target length of the long-form cut. */
  targetDurationMs: number;
  /** How many short-form candidates to look for. */
  shortCandidateCount: number;
  /** Length each short candidate aims for. */
  shortDurationMs?: number;
  /** Retrieval query for the analyst step; defaults to the goal. */
  query?: string;
  /** Skip the export step when the user only wants the timeline updated. */
  includeExport?: boolean;
}

const DEFAULT_SHORT_MS = 45_000;

function toolStep(
  id: string,
  title: string,
  note: string,
  toolId: string,
  toolInput: Record<string, unknown>,
  dependsOn: string[],
  rationale: string,
): AgentStep {
  return {
    id,
    kind: "tool_call",
    title,
    note,
    rationale,
    status: "pending",
    actorType: "ai",
    executionMode: "dag",
    dependsOn,
    toolId,
    toolInput,
  };
}

/**
 * Build the DAG.
 *
 * Ordering rules encoded here, not left to the model:
 *  - nothing semantic can run before the transcript exists,
 *  - planning depends on the analyst's findings, not on raw transcript,
 *  - verification and short-form planning are siblings, so a rejected
 *    verification does not silently take the shorts down with it,
 *  - the destructive apply depends on BOTH the approval gate and verification.
 */
export function buildVideoEditingWorkflow(input: VideoWorkflowInput): AgentStep[] {
  const query = input.query?.trim() || input.goal;
  const shortMs = input.shortDurationMs ?? DEFAULT_SHORT_MS;

  const steps: AgentStep[] = [
    toolStep(
      "ensure_transcript",
      "分析影片並產生逐字稿",
      "分析影片：停頓、波形、逐字稿",
      "cutos.analysis.start",
      {},
      [],
      "後續所有語意步驟都要有逐字稿才能進行",
    ),
    toolStep(
      "ensure_speakers",
      "辨識說話者",
      "分辨影片中的說話者與發言時間",
      "cutos.speakers.list",
      {},
      ["ensure_transcript"],
      "精華片段需要知道誰在說話，才能挑出完整段落",
    ),
    toolStep(
      "ensure_topics",
      "整理主題",
      "整理影片談到的主題與時間範圍",
      "cutos.topics.list",
      { limit: 12 },
      ["ensure_transcript"],
      "主題是挑選精華與短影音的依據",
    ),
    toolStep(
      "ensure_semantic_index",
      "建立語意檢索",
      "建立語意索引以便檢索相關內容",
      "cutos.semantic.search",
      { query, limit: 20 },
      ["ensure_transcript"],
      "先做檢索才能只把相關片段交給規劃，不必送整份逐字稿",
    ),
    toolStep(
      "semantic_analyst",
      "彙整相關片段",
      "彙整與目標相關的片段（受控脈絡）",
      "cutos.context.build",
      { query, maxRanges: 12, targetDurationMs: input.targetDurationMs },
      ["ensure_speakers", "ensure_topics", "ensure_semantic_index"],
      "把檢索結果收斂成有上限、可追溯的脈絡，避免整份逐字稿進入模型",
    ),
    toolStep(
      "find_highlights",
      "找出精華片段",
      "找出最適合做精華的片段",
      "cutos.highlights.find",
      { targetDurationMs: input.targetDurationMs, limit: 8, query },
      ["semantic_analyst"],
      "長版精華的候選來源",
    ),
    toolStep(
      "plan_long_cut",
      "建立長版精華剪輯計畫",
      "建立剪輯計畫",
      "cutos.edit.plan",
      { instruction: input.goal },
      ["find_highlights"],
      "把語意結論轉成經過驗證的 Edit Plan",
    ),
    toolStep(
      "verify_long_cut",
      "驗證剪輯計畫",
      "驗證剪輯計畫是否可安全套用",
      "cutos.edit.verify",
      {},
      ["plan_long_cut"],
      "套用前先確認計畫沒有過期、沒有不支援的操作",
    ),
    toolStep(
      "plan_short_candidates",
      `找出 ${input.shortCandidateCount} 段短影音候選`,
      "找出適合短影音的片段",
      "cutos.highlights.find",
      { targetDurationMs: shortMs, limit: input.shortCandidateCount },
      ["plan_long_cut"],
      "與長版共用同一份語意分析，但目標長度不同；與驗證平行，互不阻塞",
    ),
    toolStep(
      "preview_long_cut",
      "預覽剪輯結果",
      "產生剪輯後的即時預覽",
      "cutos.edit.preview",
      {},
      ["verify_long_cut"],
      "讓人在核准前先看到結果，預覽不會改動時間軸",
    ),
    {
      id: "approval_gate",
      kind: "request_approval",
      title: "等待你確認剪輯結果",
      note: "需要你的確認才會套用剪輯",
      rationale: "這是高影響的修改：套用後時間軸會改變，必須由人決定",
      status: "pending",
      actorType: "human",
      executionMode: "dag",
      dependsOn: ["preview_long_cut", "plan_short_candidates"],
      approverRole: "project_owner",
    },
    toolStep(
      "apply_long_cut",
      "套用剪輯到時間軸",
      "套用剪輯計畫",
      "cutos.edit.apply",
      {},
      ["approval_gate", "verify_long_cut"],
      "取得核准且驗證通過後才套用；帶 expectedRevision 以免覆蓋他人的修改",
    ),
    toolStep(
      "instant_preview",
      "確認即時預覽",
      "確認套用後的即時預覽",
      "cutos.preview.inspect",
      {},
      ["apply_long_cut"],
      "套用後回讀，確認結果與計畫一致",
    ),
  ];

  if (input.includeExport !== false) {
    steps.push(
      toolStep(
        "export_long_cut",
        "輸出影片",
        "輸出成品影片",
        "cutos.export",
        {},
        ["instant_preview", "approval_gate"],
        "輸出是交付動作，同樣要在核准之後",
      ),
    );
  }

  return steps;
}

/** Plan summary text for the approval screen. All zh-TW. */
export function describeVideoWorkflow(input: VideoWorkflowInput, steps: AgentStep[]): string {
  const minutes = Math.round(input.targetDurationMs / 60_000);
  return [
    `目標：${input.goal}`,
    `長版精華目標長度：約 ${minutes} 分鐘`,
    `短影音候選：${input.shortCandidateCount} 段`,
    `共 ${steps.length} 個步驟，其中 1 個需要你確認`,
  ].join("｜");
}

/**
 * The steps that may run in parallel once their dependencies are done, for a
 * given completed set. Exposed so the planner and the UI can explain the shape
 * of the run without duplicating the DAG rules.
 */
export function parallelBranches(steps: AgentStep[]): string[][] {
  const byId = new Map(steps.map((step) => [step.id!, step]));
  const layers: string[][] = [];
  const done = new Set<string>();

  while (done.size < steps.length) {
    const layer = steps
      .filter((step) => !done.has(step.id!))
      .filter((step) => (step.dependsOn ?? []).every((dependency) => done.has(dependency)))
      .map((step) => step.id!);
    if (layer.length === 0) break; // cycle or missing dependency; validator reports it
    for (const id of layer) {
      done.add(id);
      void byId.get(id);
    }
    layers.push(layer);
  }
  return layers;
}
