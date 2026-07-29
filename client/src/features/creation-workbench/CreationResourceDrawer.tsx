import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { GenerationList } from "../../components/GenerationList";
import { Icon, type IconName } from "../../components/Icon";
import { useFocusTrap } from "../../components/interactions";
import { PromptLibrary, type PromptReuseSettings } from "../../components/PromptLibrary";
import type { CreationAction } from "./creationActions";
import { CREATION_MODES, type CreationMode } from "./creationDraft";
import { useAgentRunBadges } from "./useAgentRunBadges";
import {
  WORKBENCH_REVEAL_EVENT,
  requestWorkbenchMode,
  type WorkbenchRevealDetail,
} from "./workbenchNav";

export type ResourceDrawerTab = "prompts" | "generations" | "trail" | "templates";

export type ReuseGenerateFn = (
  text: string,
  settings?: {
    modelId?: string | null;
    characterIds?: string[] | null;
    scenePresetIds?: string[] | null;
    sourceAssetId?: string | null;
  },
) => boolean | void;

const TABS: ReadonlyArray<{
  id: ResourceDrawerTab;
  label: string;
  icon: IconName;
  anchor: string;
}> = [
  { id: "prompts", label: "提示詞庫", icon: "FileText", anchor: "sec-prompts" },
  { id: "generations", label: "生成紀錄", icon: "Image", anchor: "sec-generations" },
  { id: "trail", label: "執行軌跡", icon: "Film", anchor: "sec-trail" },
  { id: "templates", label: "範本收藏", icon: "Star", anchor: "sec-templates-fav" },
];

const RUN_STATUS_LABEL: Record<string, string> = {
  awaiting_approval: "待核准",
  running: "執行中",
  waiting: "等待人員",
  done: "已完成",
  failed: "失敗",
  stopped: "已停止",
};

function modeLabel(mode: CreationMode): string {
  return CREATION_MODES.find((m) => m.id === mode)?.label ?? mode;
}

function tabFromAnchor(anchor: string | undefined): ResourceDrawerTab | null {
  if (!anchor) return null;
  const id = anchor.replace(/^#/, "");
  switch (id) {
    case "sec-prompts":
      return "prompts";
    case "sec-generations":
      return "generations";
    case "sec-trail":
      return "trail";
    case "sec-templates-fav":
      return "templates";
    default:
      return null;
  }
}

/** Parent path returns false only when overwrite confirm is cancelled. */
function reuseSucceeded(result: boolean | void): boolean {
  return result !== false;
}

/**
 * WB-05: unified resource drawer for 提示詞庫 / 生成紀錄 / 執行軌跡 (+ 範本收藏 stub).
 * Embeds PromptLibrary + GenerationList (no rewrites). Bring-in uses CreationAction.apply_prompt
 * for any mode without auto-submit. GenerationList reuse still goes through onReuseGenerate.
 */
export function CreationResourceDrawer({
  projectId,
  canEdit = true,
  currentMode,
  onCreationAction,
  onReuseGenerate,
  onUseForWorkflow,
  open: openProp,
  onClose: onCloseProp,
  initialTab = "prompts",
}: {
  projectId: string;
  canEdit?: boolean;
  /** Active workbench mode —「帶入目前模式」target. */
  currentMode: CreationMode;
  onCreationAction?: (action: CreationAction) => void;
  /**
   * GenerationList「再用此設定」/ generate 帶入 → parent applyPrompt.
   * Return `false` when user cancels overwrite so drawer stays open.
   */
  onReuseGenerate?: ReuseGenerateFn;
  /** PromptLibrary「製作範本」→ WorkflowCard idea box. */
  onUseForWorkflow?: (text: string) => void;
  /** Controlled open (optional). */
  open?: boolean;
  onClose?: () => void;
  initialTab?: ResourceDrawerTab;
}) {
  const reactId = useId();
  const prefix = `crd-${reactId.replace(/:/g, "")}`;
  const [internalOpen, setInternalOpen] = useState(false);
  const [tab, setTab] = useState<ResourceDrawerTab>(initialTab);
  /** Entry-row status (visible when drawer closed after successful apply). */
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const controlled = openProp !== undefined;
  const open = controlled ? !!openProp : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      if (!next) onCloseProp?.();
    },
    [controlled, onCloseProp],
  );

  const close = useCallback(() => setOpen(false), [setOpen]);

  useFocusTrap(dialogRef, open, close);

  const { runs, awaiting, running, waiting } = useAgentRunBadges(projectId);
  const runList = runs.data ?? [];

  // Deep-link / external reveal → open drawer on resource anchors.
  useEffect(() => {
    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchRevealDetail>).detail;
      if (!detail) return;
      if (detail.projectId && detail.projectId !== projectId) return;
      const nextTab = tabFromAnchor(detail.anchor);
      if (!nextTab) return;
      setTab(nextTab);
      if (!controlled) setInternalOpen(true);
    };
    window.addEventListener(WORKBENCH_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(WORKBENCH_REVEAL_EVENT, onReveal);
  }, [projectId, controlled]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const openTab = (next: ResourceDrawerTab) => {
    setTab(next);
    setOpen(true);
  };

  /** Successful bring-in only: toast on entry row + close drawer. */
  const finishSuccessfulApply = useCallback(
    (message: string) => {
      setNotice(message);
      close();
    },
    [close],
  );

  const onDrawerTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      const count = TABS.length;
      let next = index;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        next = (index + 1) % count;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        next = (index - 1 + count) % count;
      } else if (event.key === "Home") {
        event.preventDefault();
        next = 0;
      } else if (event.key === "End") {
        event.preventDefault();
        next = count - 1;
      } else {
        return;
      }
      const nextId = TABS[next]!.id;
      setTab(nextId);
      tabRefs.current[next]?.focus();
    },
    [],
  );

  /** 帶入目前模式 via apply_prompt — never auto-submit / charge. */
  const applyPromptToCurrentMode = useCallback(
    (text: string, settings?: PromptReuseSettings) => {
      const promptId = settings?.promptId ?? "library";
      const trimmed = text.trim();
      if (!trimmed) return;

      // Generate + parent path: sole channel for overwrite-confirm + char/scene parent state.
      // Do not also fire apply_prompt (would bypass confirm and double-fill).
      if (currentMode === "generate" && onReuseGenerate) {
        const ok = reuseSucceeded(
          onReuseGenerate(text, {
            modelId: settings?.modelId,
            characterIds: settings?.characterIds,
            scenePresetIds: settings?.scenePresetIds,
          }),
        );
        if (!ok) return; // user cancelled overwrite — keep drawer open, no success toast
        finishSuccessfulApply(`已帶入「${modeLabel(currentMode)}」（未送出）`);
        return;
      }

      onCreationAction?.({
        type: "apply_prompt",
        promptId,
        targetMode: currentMode,
        promptText: trimmed,
        modelId: settings?.modelId,
        characterIds: settings?.characterIds,
        scenePresetIds: settings?.scenePresetIds,
      });

      // Template: also fill idea box (goal alone does not auto-start or fill idea).
      if (currentMode === "template" && onUseForWorkflow) {
        onUseForWorkflow(trimmed);
      }

      finishSuccessfulApply(`已帶入「${modeLabel(currentMode)}」（未送出）`);
    },
    [currentMode, finishSuccessfulApply, onCreationAction, onReuseGenerate, onUseForWorkflow],
  );

  const goToPlanMode = () => {
    close();
    requestWorkbenchMode(projectId, "plan", { openPlan: true, anchor: "sec-agent", scroll: true });
  };

  const reuseLabel = `帶入目前模式（${modeLabel(currentMode)}）`;

  const generationListEl = (
    <GenerationList
      projectId={projectId}
      canEdit={canEdit}
      onReuse={(text, settings) => {
        if (!onReuseGenerate) return;
        const ok = reuseSucceeded(onReuseGenerate(text, settings));
        if (!ok) return; // cancel: stay open
        finishSuccessfulApply("已帶回直接生成（未送出）");
      }}
    />
  );

  return (
    <div className="creation-resource-drawer-root" style={{ marginTop: 16 }}>
      {/* Always-present anchors for TocNav / deep links / chips */}
      <div id="sec-prompts" className="creation-resource-entry">
        <div className="section-heading-row" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: "var(--fs-14)", display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="FileText" size={14} /> 資源與結果
          </h3>
          <span className="spacer" />
          {(running > 0 || waiting > 0 || awaiting > 0) && (
            <span className="hint" style={{ fontSize: "var(--fs-12)" }}>
              {running > 0 ? `執行中 ${running}` : ""}
              {waiting > 0 ? ` 等待 ${waiting}` : ""}
              {awaiting > 0 ? ` 待核 ${awaiting}` : ""}
            </span>
          )}
        </div>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          提示詞庫、生成紀錄與執行軌跡收在抽屜裡——手機不必再捲過好幾張長卡。
        </p>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
          role="group"
          aria-label="開啟資源抽屜"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn-ghost btn-sm"
              aria-haspopup="dialog"
              aria-expanded={open && tab === t.id}
              data-resource-tab={t.id}
              onClick={() => openTab(t.id)}
            >
              <Icon name={t.icon} size={13} /> {t.label}
            </button>
          ))}
        </div>
        {/* Success feedback lives on the entry row so it remains visible after close. */}
        {notice ? (
          <p className="hint" role="status" aria-live="polite" style={{ margin: "8px 0 0" }}>
            {notice}
          </p>
        ) : null}
        {/* Hidden anchors so revealWorkbenchAnchor / scroll still find them */}
        <span id="sec-generations" hidden aria-hidden="true" />
        <span id="sec-trail" hidden aria-hidden="true" />
        <span id="sec-templates-fav" hidden aria-hidden="true" />
      </div>

      {open && (
        <div
          className="modal-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={dialogRef}
            className="card modal-card creation-resource-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="資源與結果"
            tabIndex={-1}
            style={{
              width: "min(720px, 100%)",
              maxHeight: "min(88dvh, 100%)",
              display: "flex",
              flexDirection: "column",
              padding: 0,
              overflow: "hidden",
            }}
          >
            <header
              className="section-heading-row"
              style={{ padding: "12px 14px 8px", borderBottom: "1px solid var(--border-soft)", flexShrink: 0 }}
            >
              <h2 style={{ margin: 0, fontSize: "var(--fs-16)" }}>資源與結果</h2>
              <span className="spacer" />
              <button type="button" className="btn-ghost btn-sm" aria-label="關閉資源抽屜" onClick={close}>
                <Icon name="X" size={14} /> 關閉
              </button>
            </header>

            <div
              role="tablist"
              aria-label="資源分類"
              style={{
                display: "flex",
                gap: 4,
                padding: "8px 12px",
                overflowX: "auto",
                flexShrink: 0,
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              {TABS.map((t, index) => {
                const selected = tab === t.id;
                return (
                  <button
                    key={t.id}
                    ref={(el) => {
                      tabRefs.current[index] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`${prefix}-tab-${t.id}`}
                    aria-selected={selected}
                    aria-controls={`${prefix}-panel-${t.id}`}
                    tabIndex={selected ? 0 : -1}
                    className="btn-ghost btn-sm"
                    onClick={() => setTab(t.id)}
                    onKeyDown={(e) => onDrawerTabKeyDown(e, index)}
                    style={{
                      whiteSpace: "nowrap",
                      border: selected ? "1px solid var(--primary-border)" : "1px solid transparent",
                      background: selected ? "var(--primary-tint)" : undefined,
                    }}
                  >
                    <Icon name={t.icon} size={12} /> {t.label}
                  </button>
                );
              })}
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "10px 14px 16px", WebkitOverflowScrolling: "touch" }}>
              <div
                role="tabpanel"
                id={`${prefix}-panel-prompts`}
                aria-labelledby={`${prefix}-tab-prompts`}
                hidden={tab !== "prompts"}
              >
                {tab === "prompts" && (
                  <PromptLibrary
                    projectId={projectId}
                    embedded
                    showEmpty
                    reuseLabel={reuseLabel}
                    onUse={applyPromptToCurrentMode}
                    onUseForWorkflow={
                      onUseForWorkflow
                        ? (text) => {
                            onUseForWorkflow(text);
                            finishSuccessfulApply("已帶入製作範本想法框（未啟動）");
                          }
                        : undefined
                    }
                  />
                )}
              </div>

              <div
                role="tabpanel"
                id={`${prefix}-panel-generations`}
                aria-labelledby={`${prefix}-tab-generations`}
                hidden={tab !== "generations"}
              >
                {tab === "generations" ? generationListEl : null}
              </div>

              <div
                role="tabpanel"
                id={`${prefix}-panel-trail`}
                aria-labelledby={`${prefix}-tab-trail`}
                hidden={tab !== "trail"}
              >
                {tab === "trail" && (
                  <div data-fb="執行軌跡">
                    <p className="hint" style={{ marginTop: 0 }}>
                      最近的執行計畫摘要。完整步驟、核准與停止請到「執行計畫」模式。
                    </p>
                    {runs.isLoading && <p className="hint">載入執行軌跡…</p>}
                    {!runs.isLoading && runList.length === 0 && (
                      <div className="empty-state" style={{ marginTop: 8 }}>
                        <h3>還沒有執行軌跡——</h3>
                        <p>在「執行計畫」或「製作範本」跑一次就會出現在這裡。</p>
                      </div>
                    )}
                    {runList.length > 0 && (
                      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                        {runList.slice(0, 12).map((r) => {
                          const status = RUN_STATUS_LABEL[r.status] ?? r.status;
                          const title = (r.goal ?? "").trim() || "未命名計畫";
                          return (
                            <li
                              key={r.id}
                              className="gen-row"
                              style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}
                            >
                              <div style={{ fontSize: "var(--fs-13)" }}>
                                <div>
                                  {title.slice(0, 100)}
                                  {title.length > 100 ? "…" : ""}
                                </div>
                                <div className="hint mono" style={{ fontSize: "var(--fs-11)", marginTop: 2 }}>
                                  <span
                                    className={`pill ${
                                      r.status === "running"
                                        ? "running"
                                        : r.status === "failed"
                                          ? "failed"
                                          : r.status === "done"
                                            ? "done"
                                            : "queued"
                                    }`}
                                  >
                                    {status}
                                  </span>
                                </div>
                              </div>
                              <button type="button" className="btn-sm" onClick={goToPlanMode}>
                                開啟計畫
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div style={{ marginTop: 12 }}>
                      <button type="button" className="btn-ghost" onClick={goToPlanMode}>
                        <Icon name="Film" size={13} /> 前往執行計畫模式
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div
                role="tabpanel"
                id={`${prefix}-panel-templates`}
                aria-labelledby={`${prefix}-tab-templates`}
                hidden={tab !== "templates"}
              >
                {tab === "templates" && (
                  <div className="empty-state" style={{ marginTop: 8 }} data-fb="範本收藏">
                    <h3>範本收藏（即將推出）</h3>
                    <p>常用製作範本會收藏在這裡。目前請到「製作範本」模式挑選與執行。</p>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        close();
                        requestWorkbenchMode(projectId, "template", {
                          anchor: "sec-workflow",
                          scroll: true,
                        });
                      }}
                    >
                      <Icon name="Clapperboard" size={13} /> 前往製作範本
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
        Keep GenerationList mounted when drawer is closed or on another tab so status
        pollers keep advancing in-flight jobs (same role it had under DirectGenerateMode).
        Only one instance: visible path is the generations tabpanel above.
      */}
      {!(open && tab === "generations") ? (
        <div hidden aria-hidden="true" data-testid="generation-list-poller">
          {generationListEl}
        </div>
      ) : null}
    </div>
  );
}
