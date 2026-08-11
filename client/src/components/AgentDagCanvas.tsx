/**
 * Interactive agent step DAG (PR-3).
 *
 * Uses shared/agentDag pure validation + layout — no second graph solver.
 * Status patches only re-render node chrome; topologyKey gates layout recompute.
 * Invalid graphs fail-closed to a text list (never a white screen).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AGENT_DAG_LARGE_STEP_THRESHOLD,
  dagStepId,
  layoutAgentDag,
  validateAgentDag,
  type AgentDagLayout,
  type AgentDagStep,
  type AgentDagValidationResult,
} from "../../../shared/agentDag";
import { Icon, type IconName } from "./Icon";
import { Button, Chip, Meta, Pill } from "./ui";

export type AgentDagCanvasStep = AgentDagStep & {
  title?: string;
  kind?: string;
  rationale?: string;
  detail?: string;
  actorType?: "ai" | "human" | "system";
  sourceRefs?: Array<{ type: string; id: string; label?: string }>;
  outputRefs?: Array<{ type: string; id: string; label?: string }>;
  points?: number;
  estimatedMinutes?: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "排隊",
  running: "進行中",
  waiting: "等待中",
  done: "完成",
  failed: "失敗",
  stopped: "已停",
};

const STATUS_ICON: Record<string, IconName> = {
  pending: "Clock",
  running: "Loader",
  waiting: "Pause",
  done: "CheckCircle2",
  failed: "XCircle",
  stopped: "CircleStop",
};

/** UI flag: set VITE_AGENT_DAG_CANVAS=0 to force list-only (rollback). */
export function isAgentDagCanvasEnabled(): boolean {
  const v = (import.meta as { env?: Record<string, string> }).env?.VITE_AGENT_DAG_CANVAS;
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? `未知(${status})`;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AgentDagListFallback({
  steps,
  validation,
  selectedId,
  onSelect,
}: {
  steps: AgentDagCanvasStep[];
  validation?: AgentDagValidationResult;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="agent-dag-list" role="list" aria-label="代理步驟文字流程">
      {validation && !validation.ok && (
        <div className="agent-dag-list__alert" role="alert">
          <strong>計畫結構有問題</strong>
          <Meta as="p" style={{ margin: "4px 0 0" }}>
            {validation.issues.map((i) => i.message).join("；")}
          </Meta>
          <Meta as="p" style={{ margin: "4px 0 0" }}>
            無法安全繪製依賴圖。請用下方文字列表檢視，或重新規劃。
          </Meta>
        </div>
      )}
      <ol className="agent-dag-list__items">
        {steps.map((step, index) => {
          const id = dagStepId(step, index);
          const label = step.title?.trim() || step.note || id;
          const deps = step.dependsOn?.length ? step.dependsOn.join("、") : "無";
          const selected = selectedId === id;
          return (
            <li key={`${id}-${index}`} role="listitem">
              <button
                type="button"
                className={`agent-dag-list__row${selected ? " is-selected" : ""}`}
                aria-current={selected ? "true" : undefined}
                aria-label={`${label}，${statusLabel(step.status)}，前置 ${step.dependsOn?.length ?? 0} 項`}
                onClick={() => onSelect?.(id)}
              >
                <Icon
                  name={STATUS_ICON[step.status] ?? "Clock"}
                  size={14}
                  className={step.status === "running" ? "spin" : undefined}
                />
                <span className="agent-dag-list__title">{label}</span>
                <Chip>{statusLabel(step.status)}</Chip>
                <Meta as="span">前置：{deps}</Meta>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepDetailPanel({
  step,
  stepId,
  onClose,
}: {
  step: AgentDagCanvasStep;
  stepId: string;
  onClose: () => void;
}) {
  const label = step.title?.trim() || step.note || stepId;
  return (
    <div className="agent-dag-detail" role="region" aria-label={`步驟詳情：${label}`}>
      <div className="agent-dag-detail__head">
        <strong>{label}</strong>
        <Pill status={step.status === "done" ? "done" : step.status === "failed" ? "failed" : step.status === "running" ? "running" : "queued"}>
          {statusLabel(step.status)}
        </Pill>
        <Button size="sm" variant="ghost" type="button" onClick={onClose} aria-label="關閉詳情">
          關閉
        </Button>
      </div>
      <Meta as="p">代號：{stepId}{step.kind ? `・種類：${step.kind}` : ""}</Meta>
      {step.actorType && (
        <Meta as="p">執行者：{step.actorType === "human" ? "人員" : step.actorType === "system" ? "系統" : "AI"}</Meta>
      )}
      {step.rationale && (
        <section>
          <strong>理由</strong>
          <Meta as="p">{step.rationale}</Meta>
        </section>
      )}
      {step.detail && (
        <section>
          <strong>狀態說明</strong>
          <Meta as="p">{step.detail}</Meta>
        </section>
      )}
      {(step.dependsOn?.length ?? 0) > 0 && (
        <section>
          <strong>前置步驟</strong>
          <Meta as="p">{step.dependsOn!.join("、")}</Meta>
        </section>
      )}
      {(step.sourceRefs?.length ?? 0) > 0 && (
        <section>
          <strong>來源</strong>
          <ul>
            {step.sourceRefs!.map((ref) => (
              <li key={`${ref.type}-${ref.id}`}>
                <Meta as="span">{ref.label ?? ref.id}（{ref.type}）</Meta>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(step.outputRefs?.length ?? 0) > 0 && (
        <section>
          <strong>產出</strong>
          <ul>
            {step.outputRefs!.map((ref) => (
              <li key={`${ref.type}-${ref.id}`}>
                <Meta as="span">{ref.label ?? ref.id}（{ref.type}）</Meta>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(step.points != null || step.estimatedMinutes != null) && (
        <Meta as="p">
          {step.points != null ? `約 ${step.points} 點` : ""}
          {step.points != null && step.estimatedMinutes != null ? "・" : ""}
          {step.estimatedMinutes != null ? `約 ${step.estimatedMinutes} 分` : ""}
        </Meta>
      )}
    </div>
  );
}

export function AgentDagCanvas({
  steps,
  defaultMode,
}: {
  steps: AgentDagCanvasStep[];
  /** When canvas disabled or user prefers list */
  defaultMode?: "canvas" | "list";
}) {
  const reactId = useId();
  const canvasEnabled = isAgentDagCanvasEnabled();
  const [mode, setMode] = useState<"canvas" | "list">(
    defaultMode ?? (canvasEnabled ? "canvas" : "list"),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const validation = useMemo(() => validateAgentDag(steps), [steps]);

  // Topology-gated layout: recompute only when edges/ids change
  const topologyKey = useMemo(
    () => steps.map((s, i) => `${dagStepId(s, i)}>${(s.dependsOn ?? []).join(",")}`).join("|"),
    [steps],
  );
  const layoutRef = useRef<AgentDagLayout | null>(null);
  const layout = useMemo(() => {
    if (!validation.ok && validation.code !== "unsupported_status") {
      layoutRef.current = null;
      return null;
    }
    if (layoutRef.current?.topologyKey === topologyKey) {
      // Patch labels/status onto cached positions
      const cached = layoutRef.current;
      const byId = new Map(steps.map((s, i) => [dagStepId(s, i), { step: s, i }]));
      return {
        ...cached,
        nodes: cached.nodes.map((n) => {
          const hit = byId.get(n.id);
          if (!hit) return n;
          return {
            ...n,
            status: hit.step.status,
            label: hit.step.title?.trim() || hit.step.note || n.id,
            dependsOn: hit.step.dependsOn ?? n.dependsOn,
            depCount: (hit.step.dependsOn ?? n.dependsOn).length,
          };
        }),
      };
    }
    const next = layoutAgentDag(steps);
    layoutRef.current = next;
    return next;
  }, [steps, topologyKey, validation.ok, validation.code]);

  const large = steps.length >= AGENT_DAG_LARGE_STEP_THRESHOLD;
  const selectedStep = useMemo(() => {
    if (!selectedId) return null;
    const index = steps.findIndex((s, i) => dagStepId(s, i) === selectedId);
    if (index < 0) return null;
    return { step: steps[index]!, id: selectedId };
  }, [selectedId, steps]);

  const forceList = !canvasEnabled || !validation.ok || mode === "list" || !layout;

  const onSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const orderedIds = layout?.nodes.map((n) => n.id) ?? steps.map((s, i) => dagStepId(s, i));

  const moveFocus = useCallback((delta: number) => {
    if (!orderedIds.length) return;
    setFocusIndex((i) => {
      const next = (i + delta + orderedIds.length) % orderedIds.length;
      const id = orderedIds[next]!;
      requestAnimationFrame(() => nodeRefs.current.get(id)?.focus());
      return next;
    });
  }, [orderedIds]);

  useEffect(() => {
    if (forceList && mode === "canvas" && (!validation.ok || !canvasEnabled)) {
      setMode("list");
    }
  }, [forceList, mode, validation.ok, canvasEnabled]);

  return (
    <div className="agent-dag" data-testid="agent-dag" id={reactId}>
      <div className="agent-dag__toolbar">
        <Meta as="span">
          {validation.ok
            ? `步驟依賴${large ? "（大型）" : ""}`
            : "步驟列表（結構異常）"}
        </Meta>
        {canvasEnabled && validation.ok && (
          <div className="agent-dag__modes" role="group" aria-label="顯示模式">
            <Button
              size="sm"
              variant={mode === "canvas" ? "primary" : "ghost"}
              type="button"
              onClick={() => setMode("canvas")}
            >
              依賴圖
            </Button>
            <Button
              size="sm"
              variant={mode === "list" ? "primary" : "ghost"}
              type="button"
              onClick={() => setMode("list")}
            >
              文字流程
            </Button>
          </div>
        )}
      </div>

      {forceList || !layout ? (
        <AgentDagListFallback
          steps={steps}
          validation={validation.ok ? undefined : validation}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ) : (
        <div
          className={`agent-dag-canvas${large ? " is-large" : ""}${prefersReducedMotion() ? " is-reduced-motion" : ""}`}
          role="group"
          aria-label="代理步驟依賴圖"
        >
          <div className="agent-dag-canvas__scroll">
            <svg
              className="agent-dag-canvas__edges"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              {layout.edges.map((edge) => {
                const from = layout.nodes.find((n) => n.id === edge.fromId);
                const to = layout.nodes.find((n) => n.id === edge.toId);
                if (!from || !to) return null;
                return (
                  <line
                    key={`${edge.fromId}->${edge.toId}`}
                    x1={from.x + 36}
                    y1={from.y}
                    x2={to.x - 36}
                    y2={to.y}
                    className="agent-dag-canvas__edge"
                  />
                );
              })}
            </svg>
            <div
              className="agent-dag-canvas__nodes"
              style={{ width: layout.width, height: layout.height }}
            >
              {layout.nodes.map((node, ni) => {
                const rawStatus = node.status;
                const known = STATUS_LABEL[rawStatus] != null;
                return (
                  <button
                    key={node.id}
                    type="button"
                    ref={(el) => {
                      if (el) nodeRefs.current.set(node.id, el);
                      else nodeRefs.current.delete(node.id);
                    }}
                    className={`agent-dag-node status-${known ? rawStatus : "unknown"}${selectedId === node.id ? " is-selected" : ""}`}
                    style={{ left: node.x - 36, top: node.y - 20 }}
                    aria-label={`${node.label}，${statusLabel(rawStatus)}，前置 ${node.depCount} 項`}
                    aria-pressed={selectedId === node.id}
                    tabIndex={focusIndex === ni ? 0 : -1}
                    onFocus={() => setFocusIndex(ni)}
                    onClick={() => onSelect(node.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(node.id);
                      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                        e.preventDefault();
                        moveFocus(1);
                      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                        e.preventDefault();
                        moveFocus(-1);
                      }
                    }}
                  >
                    <Icon
                      name={STATUS_ICON[rawStatus] ?? "Clock"}
                      size={12}
                      className={rawStatus === "running" ? "spin" : undefined}
                    />
                    <span className="agent-dag-node__label">
                      {large ? node.label.slice(0, 18) : node.label.slice(0, 28)}
                      {node.label.length > (large ? 18 : 28) ? "…" : ""}
                    </span>
                    <span className="agent-dag-node__status">{statusLabel(rawStatus)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {large && (
            <Meta as="p" className="agent-dag-canvas__hint">
              共 {steps.length} 步（大型計畫）：詳情點擊後才載入，橫向捲動可看完整依賴。
            </Meta>
          )}
        </div>
      )}

      {selectedStep && (
        <StepDetailPanel
          step={selectedStep.step}
          stepId={selectedStep.id}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
