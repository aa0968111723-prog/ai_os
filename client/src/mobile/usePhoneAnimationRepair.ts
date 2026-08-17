import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import {
  classifyPhoneAnimationIntent,
  phoneAnimationAdoptCard,
  phoneAnimationClarifyCard,
  phoneAnimationCompareCard,
  phoneAnimationCostCard,
  phoneAnimationExplainCard,
  phoneAnimationFindingsCard,
  phoneAnimationProgressCard,
  phoneAnimationRepairCard,
  phoneAnimationResumeCard,
  phoneAnimationSummaryCard,
  type PhoneCommand,
  type PhoneCompareItem,
  type PhoneRepairProposalView,
} from "@shared/phoneAnimationProjection";
import type { PhoneCard } from "@shared/phoneAssistantProjection";
import { useAssistantContext } from "../lib/assistantContext";

/**
 * Phone Animation Production repair loop.
 *
 * This hook is an adapter, not a second assistant: it classifies production
 * language, reads phone.animation* projections (board/planner), and delegates
 * writes to the existing execute / adopt / review commands.
 */
export function usePhoneAnimationRepair(input: {
  projectId?: string;
  repairResume?: {
    state: "proposal" | "awaiting_confirmation" | "awaiting_approval" | "running" | "review_ready";
    affectedShotCount: number;
    estimatedPoints?: number;
  } | null;
}) {
  const ctx = useAssistantContext();
  const utils = trpc.useUtils();
  const executeStage = trpc.creativeContext.executeAnimationStage.useMutation();
  const adoptGeneration = trpc.creativeContext.adoptGeneration.useMutation();
  const reviewShot = trpc.scenes.review.useMutation();

  const [card, setCard] = useState<PhoneCard | null>(null);
  const [active, setActive] = useState(false);
  const proposalRef = useRef<PhoneRepairProposalView | null>(null);
  const costRevealedRef = useRef(false);
  const compareRef = useRef<PhoneCompareItem[]>([]);
  const compareIndexRef = useRef(0);
  const queueBeforeRef = useRef<number | null>(null);
  const confirmedRef = useRef(false);

  const selectedShotId = ctx.entityType === "shot" ? ctx.entityId : undefined;

  const showResume = useCallback(() => {
    if (!input.repairResume) return false;
    setCard(phoneAnimationResumeCard(input.repairResume));
    setActive(true);
    return true;
  }, [input.repairResume]);

  useEffect(() => {
    if (!card && input.repairResume) showResume();
  }, [card, input.repairResume, showResume]);

  const loadSummary = useCallback(async () => {
    if (!input.projectId) return null;
    return utils.phone.animationSummary.fetch({
      projectId: input.projectId,
      selectedShotId,
    });
  }, [input.projectId, selectedShotId, utils.phone.animationSummary]);

  const loadFindings = useCallback(async (include?: Array<"semantic" | "identity" | "look" | "scene" | "prop" | "style" | "temporal" | "physics">) => {
    if (!input.projectId) return null;
    return utils.phone.animationFindings.fetch({
      projectId: input.projectId,
      selectedShotId,
      ...(include?.length ? { include } : {}),
    });
  }, [input.projectId, selectedShotId, utils.phone.animationFindings]);

  const loadProposal = useCallback(async (command?: Extract<PhoneCommand, { type: "plan_repair" }>, text?: string) => {
    if (!input.projectId) return null;
    return utils.phone.animationRepairProposal.fetch({
      projectId: input.projectId,
      selectedShotId,
      ...(text ? { text } : {}),
      ...(command?.shotIds ? { shotIds: command.shotIds } : {}),
      ...(command?.include ? { include: command.include } : {}),
      ...(command?.exclude ? { exclude: command.exclude } : {}),
      ...(proposalRef.current?.findingKeys ? { previousFindingKeys: proposalRef.current.findingKeys } : {}),
    });
  }, [input.projectId, selectedShotId, utils.phone.animationRepairProposal]);

  const loadCompare = useCallback(async () => {
    if (!input.projectId) return null;
    return utils.phone.animationCompareQueue.fetch({ projectId: input.projectId });
  }, [input.projectId, utils.phone.animationCompareQueue]);

  const showCompareAt = useCallback((index: number) => {
    const items = compareRef.current;
    const item = items[index];
    if (!item) {
      setCard({
        kind: "result",
        title: "沒有更多候選",
        lines: ["這一輪可以比較的鏡頭都看過了。"],
        steps: [],
      });
      return;
    }
    compareIndexRef.current = index;
    setCard(phoneAnimationCompareCard(item));
    setActive(true);
  }, []);

  const runCommand = useCallback(async (command: PhoneCommand) => {
    if (!input.projectId) return;
    setActive(true);
    if (command.type === "list_findings") {
      const data = await loadFindings(command.dimension ? [command.dimension] : undefined);
      if (data) setCard(phoneAnimationFindingsCard(data.findings));
      return;
    }
    if (command.type === "explain_shot") {
      const data = await loadFindings();
      const finding = data?.findings.find((row) => row.shotId === command.shotId);
      setCard(phoneAnimationExplainCard(finding, finding?.shotLabel ?? "這一鏡"));
      return;
    }
    if (command.type === "plan_repair") {
      costRevealedRef.current = false;
      confirmedRef.current = false;
      const data = await loadProposal(command);
      if (!data) return;
      if (data.status === "clarify") {
        setCard(phoneAnimationClarifyCard(data.question, data.options));
        return;
      }
      if (data.status === "empty") {
        setCard({ kind: "answer", title: data.reason, lines: [], steps: [] });
        return;
      }
      proposalRef.current = data.proposal;
      setCard(phoneAnimationRepairCard(data.proposal));
      return;
    }
    if (command.type === "confirm_repair") {
      const proposal = proposalRef.current;
      if (!proposal) {
        await runCommand({ type: "plan_repair" });
        return;
      }
      if (!costRevealedRef.current) {
        costRevealedRef.current = true;
        setCard(phoneAnimationCostCard(proposal));
        return;
      }
      if (confirmedRef.current) return;
      confirmedRef.current = true;
      const total = proposal.shots.reduce((sum, shot) => (
        sum + shot.stages.filter((stage) => stage === "keyframe" || stage === "video").length
      ), 0);
      let done = 0;
      let failed = 0;
      const steps: Array<{ key: string; label: string; state: "done" | "active" | "failed" }> = [];
      setCard(phoneAnimationProgressCard({
        steps: proposal.shots.map((shot) => ({
          key: shot.shotId,
          label: `${shot.shotLabel} ${shot.stageLabel}`,
          state: "pending" as const,
        })),
        done: 0,
        total,
      }));
      for (const shot of proposal.shots) {
        for (const stage of shot.stages) {
          if (stage === "evaluation") continue;
          const stageKind = stage === "keyframe" ? "keyframe_generation" : "video_generation";
          const modelId = stage === "keyframe" ? proposal.keyframeModelId : proposal.videoModelId;
          const key = `${shot.shotId}:${stage}`;
          steps.push({ key, label: `${shot.shotLabel} ${stage === "keyframe" ? "關鍵影格" : "影片"}生成中`, state: "active" });
          setCard(phoneAnimationProgressCard({
            steps: steps.map((row) => ({ ...row })),
            done,
            total,
          }));
          try {
            await executeStage.mutateAsync({
              projectId: input.projectId,
              shotId: shot.shotId,
              stage: stageKind,
              modelId,
              clientRequestId: crypto.randomUUID(),
            });
            done += 1;
            const last = steps[steps.length - 1];
            if (last) {
              last.state = "done";
              last.label = `${shot.shotLabel} ${stage === "keyframe" ? "關鍵影格" : "影片"}完成`;
            }
          } catch {
            failed += 1;
            const last = steps[steps.length - 1];
            if (last) {
              last.state = "failed";
              last.label = `${shot.shotLabel} ${stage === "keyframe" ? "關鍵影格" : "影片"}失敗`;
            }
          }
          setCard(phoneAnimationProgressCard({
            steps: steps.map((row) => ({ ...row })),
            done,
            total,
          }));
        }
      }
      const compare = await loadCompare();
      compareRef.current = compare?.items ?? [];
      queueBeforeRef.current = compare?.summary.counts.needsReview ?? null;
      if (compareRef.current.length) {
        setCard({
          kind: "result",
          title: failed > 0 ? `部分完成 ${done} / ${total}` : `${done} / ${total} 已產生候選`,
          lines: compareRef.current.slice(0, 3).map((item) => `${item.shotLabel}：可比較`),
          steps: steps.map((row) => ({ ...row })),
          primaryAction: {
            id: "phone.animation.start_compare",
            label: "開始檢查",
            kind: "phone_command",
            command: { type: "next_compare" },
          },
          ...(failed > 0 ? { attention: true } : {}),
        });
      } else {
        setCard({
          kind: "result",
          title: failed > 0 ? `部分完成 ${done} / ${total}` : "修復已送出",
          lines: ["完成後仍只是候選，需要你再採用。"],
          steps: steps.map((row) => ({ ...row })),
          ...(failed > 0 ? { attention: true } : {}),
        });
      }
      return;
    }
    if (command.type === "next_compare") {
      if (!compareRef.current.length) {
        const compare = await loadCompare();
        compareRef.current = compare?.items ?? [];
        compareIndexRef.current = 0;
      }
      showCompareAt(compareIndexRef.current);
      return;
    }
    if (command.type === "adopt") {
      const before = queueBeforeRef.current;
      await adoptGeneration.mutateAsync({ generationId: command.generationId });
      const fresh = await loadCompare();
      const summary = await loadSummary();
      const after = summary?.counts.needsReview ?? fresh?.summary.counts.needsReview ?? 0;
      const item = compareRef.current[compareIndexRef.current];
      compareRef.current = fresh?.items ?? [];
      queueBeforeRef.current = after;
      setCard(phoneAnimationAdoptCard({
        shotLabel: item?.shotLabel ?? "這一鏡",
        before: before ?? after,
        after,
      }));
      return;
    }
    if (command.type === "keep") {
      const before = queueBeforeRef.current;
      await reviewShot.mutateAsync({ sceneId: command.shotId, status: "approved" });
      const fresh = await loadCompare();
      const summary = await loadSummary();
      const after = summary?.counts.needsReview ?? fresh?.summary.counts.needsReview ?? 0;
      const item = compareRef.current[compareIndexRef.current];
      compareRef.current = fresh?.items ?? [];
      queueBeforeRef.current = after;
      setCard(phoneAnimationAdoptCard({
        shotLabel: item?.shotLabel ?? "這一鏡",
        before: before ?? after,
        after,
        kept: true,
      }));
      return;
    }
    if (command.type === "resume") {
      if (input.repairResume?.state === "review_ready") {
        const compare = await loadCompare();
        compareRef.current = compare?.items ?? [];
        compareIndexRef.current = 0;
        queueBeforeRef.current = compare?.summary.counts.needsReview ?? null;
        showCompareAt(0);
        return;
      }
      if (input.repairResume?.state === "running" || input.repairResume?.state === "awaiting_approval") {
        const compare = await loadCompare();
        setCard(phoneAnimationProgressCard({
          steps: [{
            key: "resume",
            label: input.repairResume.state === "awaiting_approval" ? "等待你確認生成" : "修復進行中",
            state: input.repairResume.state === "awaiting_approval" ? "blocked" : "active",
          }],
          done: 0,
          total: input.repairResume.affectedShotCount,
        }));
        if (compare?.items.length) {
          compareRef.current = compare.items;
        }
        return;
      }
      const data = await loadProposal();
      if (data?.status === "proposal") {
        proposalRef.current = data.proposal;
        setCard(phoneAnimationRepairCard(data.proposal));
      } else {
        const summary = await loadSummary();
        if (summary) setCard(phoneAnimationSummaryCard(summary));
      }
    }
  }, [
    adoptGeneration,
    executeStage,
    input.projectId,
    input.repairResume,
    loadCompare,
    loadFindings,
    loadProposal,
    loadSummary,
    reviewShot,
    showCompareAt,
  ]);

  const tryHandle = useCallback((text: string): boolean => {
    if (!input.projectId) return false;
    const intent = classifyPhoneAnimationIntent(text);
    if (intent.kind === "none") return false;
    void (async () => {
      if (intent.kind === "summary" || intent.kind === "not_checked") {
        const summary = await loadSummary();
        if (!summary) return;
        if (intent.kind === "not_checked") {
          setCard({
            kind: "answer",
            title: `${summary.counts.notChecked} 鏡尚未檢查`,
            lines: ["尚未檢查不是通過，只是還沒跑視覺檢查。"],
            steps: [],
            primaryAction: {
              id: "phone.animation.list",
              label: "查看問題",
              kind: "phone_command",
              command: { type: "list_findings" },
            },
          });
        } else {
          setCard(phoneAnimationSummaryCard(summary));
        }
        setActive(true);
        return;
      }
      if (intent.kind === "list_findings") {
        await runCommand({
          type: "list_findings",
          ...(intent.filter.include[0] ? { dimension: intent.filter.include[0] } : {}),
        });
        return;
      }
      if (intent.kind === "explain_shot") {
        const data = await loadFindings();
        const finding = data?.findings.find((row) =>
          row.shotLabel.includes(intent.shotRef) || row.shotLabel.includes(intent.shotRef.padStart(2, "0")),
        ) ?? data?.findings[0];
        setCard(phoneAnimationExplainCard(finding, finding?.shotLabel ?? `Shot ${intent.shotRef}`));
        setActive(true);
        return;
      }
      if (intent.kind === "plan_repair") {
        await runCommand({
          type: "plan_repair",
          include: intent.filter.include,
          exclude: intent.filter.exclude,
        });
        return;
      }
      if (intent.kind === "confirm_execute") {
        await runCommand({ type: "confirm_repair" });
        return;
      }
      if (intent.kind === "compare" || intent.kind === "next") {
        await runCommand({ type: "next_compare" });
        return;
      }
      if (intent.kind === "adopt") {
        const item = compareRef.current[compareIndexRef.current];
        if (!item) {
          setCard(phoneAnimationClarifyCard("要採用哪一鏡的候選？", []));
          setActive(true);
          return;
        }
        await runCommand({ type: "adopt", generationId: item.generationId });
        return;
      }
      if (intent.kind === "keep") {
        const item = compareRef.current[compareIndexRef.current];
        if (!item) return;
        await runCommand({ type: "keep", shotId: item.shotId });
        return;
      }
      if (intent.kind === "resume") {
        await runCommand({ type: "resume" });
      }
    })();
    return true;
  }, [input.projectId, loadFindings, loadSummary, runCommand]);

  return { card: active ? card : null, tryHandle, runCommand, active };
}
