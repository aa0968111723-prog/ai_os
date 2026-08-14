/**
 * Aios Visible Creative Workspace（正式版）。
 *
 * 為什麼存在：底層做了 #707 / #710 / #722 / #723 / v4 這麼多輪，但使用者打開 Aios
 * 的第一眼仍是「聊天＋AI 處理卡＋文字工作紀錄＋輸入框」。實測過的版面預算是
 * ——助手介面 1928 行裡沒有任何一個影像元素，AI 的自我記錄佔的畫素比它給的答案還多，
 * 而作品佔 0%。這個表面把版面反過來：作品最大，Aios 退到旁邊，自然語言變成情境命令列。
 *
 * 真相全部是投影，這裡不持有任何 candidate/version/current 狀態：
 *   - 分鏡列與縮圖      → trpc.scenes.listByProject（單一查詢，逐鏡不再各自發查詢）
 *   - 版本／方向／候選   → trpc.scenes.versions（見 docs/product/visible-workspace-handoff-contract.md）
 *   - 批次分群          → groupVisualVariantBatches（純函式，不是第二套 candidate store）
 *   - 採用              → trpc.scenes.setVisualFromAsset（唯一會動 current 指標的路徑）
 *   - 過時              → trpc.story.continuityCheck
 * reload 後狀態一致，因為沒有任何一格畫面是靠元件記憶體撐著的。
 */
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Chip, EmptyState, Hint, Meta, Pill, Skeleton } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { trpc } from "../../api";
import { groupVisualVariantBatches, type SceneVersion, type SceneVersionState } from "@shared/sceneVersions";
import { CREATIVE_KEEP_LABEL, type CreativeKeepFamily } from "@shared/creativeDirections";
import { composeToAssistant } from "../../lib/assistantCompose";
import { registerAssistantFocus } from "../../lib/assistantContext";
import "./workspace.css";

/** 狀態語彙沿用 sceneVersions 的 SceneVersionState，不另外發明第五種 */
const SHOT_PILL: Record<string, { status: "done" | "running" | "failed" | "queued" | "neutral"; text: string }> = {
  current: { status: "done", text: "已完成" },
  generating: { status: "running", text: "生成中" },
  awaiting_approval: { status: "queued", text: "待核准" },
  failed: { status: "failed", text: "失敗" },
  empty: { status: "neutral", text: "未開始" },
};

const VERSION_PILL: Record<SceneVersionState, { status: "done" | "running" | "failed" | "queued"; text: string }> = {
  current: { status: "done", text: "現用" },
  candidate: { status: "done", text: "可採用" },
  generating: { status: "running", text: "生成中" },
  awaiting_approval: { status: "queued", text: "待核准" },
  failed: { status: "failed", text: "失敗" },
};

type BoardShot = {
  id: string;
  title: string | null;
  orderIndex: number;
  assetUrl: string | null;
  assetKind: string | null;
  narrationUrl?: string | null;
  reviewStatus?: string | null;
  generatingVisual?: boolean | null;
};

/** 情境命令列：placeholder 由選取決定，不是由對話長度決定 */
function commandPlaceholder(shotNo: number | null, hasProject: boolean): string {
  if (!hasProject) return "接下來想讓 Aios 完成什麼？";
  if (shotNo === null) return "告訴 Aios 接下來這一幕要怎麼收…";
  return `告訴 Aios 想怎麼修改 Shot ${String(shotNo).padStart(2, "0")}…`;
}

function shotStateOf(shot: BoardShot): keyof typeof SHOT_PILL {
  if (shot.generatingVisual) return "generating";
  if (shot.assetUrl) return "current";
  return "empty";
}

export function VisibleCreativeWorkspace({
  projectId,
  canEdit,
  onOpenStudio,
}: {
  projectId: string;
  canEdit: boolean;
  /** 交給既有的單格工作室——這裡不重做生成台 */
  onOpenStudio?: (sceneId: string) => void;
}) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [command, setCommand] = useState("");

  const board = trpc.scenes.listByProject.useQuery({ projectId });
  const shots = useMemo<BoardShot[]>(
    () => ((board.data ?? []) as BoardShot[]).slice().sort((a, b) => a.orderIndex - b.orderIndex),
    [board.data],
  );
  const focusShot = useMemo(
    () => shots.find((s) => s.id === focusId) ?? shots.find((s) => !!s.assetUrl) ?? shots[0],
    [shots, focusId],
  );
  const shotNo = focusShot ? shots.findIndex((s) => s.id === focusShot.id) + 1 : null;

  const continuity = trpc.story.continuityCheck.useQuery({ projectId });
  const outdatedById = useMemo(
    () => new Map(((continuity.data?.outdated ?? []) as Array<{ shotId: string; reason: string }>).map((o) => [o.shotId, o.reason])),
    [continuity.data],
  );

  // 版本／方向／候選：唯一來源。generating 時加快輪詢，settled 就慢下來——
  // 刻意不用「批次有沒有自動開過比較」當條件（那會讓卡在待核的批次無限期高頻輪詢）。
  const versions = trpc.scenes.versions.useQuery(
    { sceneId: focusShot?.id ?? "" },
    {
      enabled: !!focusShot?.id,
      refetchInterval: (q) => (q.state.data?.summary?.generating ? 4_000 : 20_000),
    },
  );
  const visualVersions = useMemo(
    () => ((versions.data?.versions ?? []) as SceneVersion[]).filter((v) => v.role === "visual"),
    [versions.data],
  );
  const currentVersion = visualVersions.find((v) => v.isCurrent);
  const latestBatch = useMemo(() => groupVisualVariantBatches(visualVersions)[0], [visualVersions]);

  const utils = trpc.useUtils();
  const adopt = trpc.scenes.setVisualFromAsset.useMutation({
    onSuccess: () => {
      void utils.scenes.versions.invalidate({ sceneId: focusShot?.id ?? "" });
      void utils.scenes.listByProject.invalidate({ projectId });
      void utils.story.continuityCheck.invalidate({ projectId });
    },
  });

  /*
   * 焦點走既有的 registerAssistantFocus（只放指標、不放資料），不新建 selection store。
   * 命令列送出的那句話因此自帶「使用者正在看第幾鏡」，助手不必猜。
   */
  const focusShotId = focusShot?.id;
  useEffect(() => {
    if (!focusShotId) return;
    return registerAssistantFocus({
      pageType: "storyboard",
      entityType: "shot",
      entityId: focusShotId,
      entityLabel: shotNo ? `第 ${shotNo} 鏡` : undefined,
      selectedEntityIds: [focusShotId],
    });
  }, [focusShotId, shotNo]);

  function sendToAios() {
    if (!command.trim()) return;
    // 不在這裡另建 agent runtime：文字交給既有的全站助手，走完全同一條
    // 意圖判定與確認流程。聚焦中的 Shot 由 registerAssistantFocus 那一層負責傳達。
    composeToAssistant(command);
    setCommand("");
  }

  if (board.isLoading) {
    return (
      <div className="vcw">
        <Skeleton style={{ height: 320 }} />
        <Skeleton style={{ height: 120 }} />
      </div>
    );
  }
  if (!shots.length) {
    return (
      <div className="vcw">
        <EmptyState
          icon={<Icon name="Film" size={28} />}
          title="這個專案還沒有分鏡"
          description="先讓 Aios 把腳本拆成分鏡，這裡就會變成你的創作台。"
        />
      </div>
    );
  }

  const outdatedReason = focusShot ? outdatedById.get(focusShot.id) : undefined;

  return (
    <div className="vcw" data-testid="visible-creative-workspace">
      <header className="vcw-top">
        <div className="vcw-crumb">
          <span className="vcw-crumb__part">
            分鏡中心
            <Icon name="ChevronRight" size={13} />
          </span>
          {focusShot && (
            <strong className="vcw-crumb__now">
              Shot {String(shotNo).padStart(2, "0")}
              {focusShot.title ? `・${focusShot.title}` : ""}
            </strong>
          )}
        </div>
        <span className="vcw-spacer" />
        <Meta as="span">
          畫面 {shots.filter((s) => !!s.assetUrl).length}/{shots.length}
          {continuity.data?.total ? `・${continuity.data.total} 鏡畫面過時` : ""}
        </Meta>
      </header>

      <div className="vcw-body">
        <main className="vcw-main">
          {focusShot?.assetUrl ? (
            <figure className="vcw-stage">
              {focusShot.assetKind === "video" ? (
                <video className="vcw-stage__art" src={focusShot.assetUrl} controls preload="metadata" />
              ) : (
                <img
                  className="vcw-stage__art"
                  src={focusShot.assetUrl}
                  alt={`Shot ${shotNo}${focusShot.title ? ` ${focusShot.title}` : ""} 的現用畫面`}
                />
              )}
              <figcaption className="vcw-stage__bar">
                <Badge>現用</Badge>
                {focusShot.reviewStatus === "approved" && <Badge>已通過</Badge>}
                {outdatedReason && <Pill status="failed">畫面過時・{outdatedReason}</Pill>}
                {currentVersion && <Meta as="span">第 {currentVersion.index} 版</Meta>}
                <span className="vcw-spacer" />
                {onOpenStudio && focusShot && (
                  <Button size="sm" variant="tonal" onClick={() => onOpenStudio(focusShot.id)}>
                    <Icon name="LayoutGrid" size={14} /> 開啟單格工作室
                  </Button>
                )}
              </figcaption>
            </figure>
          ) : (
            <div className="vcw-stage vcw-stage--empty">
              <div className="vcw-stage__placeholder">
                <Icon name="Image" size={28} />
                <Meta as="p">這一鏡還沒有畫面</Meta>
                {onOpenStudio && focusShot && (
                  <Button variant="primary" size="sm" onClick={() => onOpenStudio(focusShot.id)}>
                    <Icon name="Sparkles" size={14} /> 開始這一鏡
                  </Button>
                )}
              </div>
            </div>
          )}

          {latestBatch && (
            <section className="vcw-candidates" aria-label="候選">
              <div className="vcw-candidates__head">
                <strong>候選</strong>
                <Meta as="span">
                  {latestBatch.successes.length}/{latestBatch.requested} 可採用
                  {latestBatch.failed.length ? `・失敗 ${latestBatch.failed.length}` : ""}
                  {latestBatch.awaitingApproval.length ? `・待核准 ${latestBatch.awaitingApproval.length}` : ""}
                  {latestBatch.missing ? `・未建立 ${latestBatch.missing}` : ""}
                  ・已結算 {latestBatch.actualPoints} 點
                </Meta>
              </div>
              <ul className="vcw-candidates__list">
                {latestBatch.versions.map((v) => {
                  const pill = VERSION_PILL[v.state];
                  return (
                    <li key={v.generationId ?? v.index} className="vcw-candidate" data-state={v.state}>
                      <div className="vcw-candidate__frame">
                        {v.assetUrl ? (
                          <img src={v.assetUrl} alt={v.creative?.directionLabel ?? `第 ${v.index} 版`} loading="lazy" />
                        ) : (
                          <div className="vcw-candidate__pending" aria-hidden="true">
                            <Icon name={v.state === "failed" ? "X" : v.state === "awaiting_approval" ? "Clock" : "Sparkles"} size={20} />
                          </div>
                        )}
                        <span className="vcw-candidate__slot">{v.index}</span>
                      </div>
                      <div className="vcw-candidate__meta">
                        <strong>{v.creative?.directionLabel ?? `第 ${v.index} 版`}</strong>
                        <Pill status={pill.status}>{pill.text}</Pill>
                      </div>
                      {v.creative?.keep?.length ? (
                        <span className="vcw-direction__keep">
                          <Icon name="Lock" size={11} /> 保持 {v.creative.keep.map((k) => CREATIVE_KEEP_LABEL[k as CreativeKeepFamily] ?? k).join("／")}
                        </span>
                      ) : null}
                      {v.parentIndex !== null && <Meta as="span">延伸自第 {v.parentIndex} 版</Meta>}
                      {v.error && <Meta as="p" className="vcw-candidate__err">{v.error}</Meta>}
                      {canEdit && v.canSetCurrent && v.assetId && (
                        <div className="vcw-candidate__actions">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={adopt.isPending}
                            onClick={() => adopt.mutate({
                              sceneId: focusShot!.id,
                              assetId: v.assetId!,
                              acknowledgeApproved: true,
                              syncShotDirection: true,
                            })}
                          >
                            採用
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {adopt.error && <Hint>{adopt.error.message}</Hint>}
            </section>
          )}
        </main>

        <aside className="vcw-rail">
          <Card variant="quiet" className="vcw-aios">
            <header className="vcw-aios__head">
              <span className="vcw-aios__mark" data-busy={versions.data?.summary?.generating ? "true" : "false"}>
                <Icon name="Sparkles" size={14} />
              </span>
              <strong>Aios</strong>
              {latestBatch && !latestBatch.settled && (
                <Pill status="running">
                  候選 {latestBatch.successes.length}/{latestBatch.requested}
                </Pill>
              )}
            </header>
            {latestBatch?.versions[0]?.creative?.keep?.length ? (
              <Hint>
                這一輪保持 {latestBatch.versions[0].creative.keep.map((k) => CREATIVE_KEEP_LABEL[k as CreativeKeepFamily] ?? k).join("／")}
                ；只改鏡頭與光線。
              </Hint>
            ) : (
              <Hint>選一鏡，然後用下面的命令列告訴 Aios 你想怎麼改。</Hint>
            )}
          </Card>
        </aside>
      </div>

      <section className="vcw-strip" aria-label="這一幕的每一鏡">
        <ul className="vcw-strip__list">
          {shots.map((s, i) => {
            const pill = SHOT_PILL[shotStateOf(s)]!;
            return (
              <li key={s.id}>
                <Chip
                  as="div"
                  selected={s.id === focusShot?.id}
                  onClick={() => setFocusId(s.id)}
                  className="vcw-strip__cell"
                  aria-label={`Shot ${i + 1}${s.title ? ` ${s.title}` : ""}，${pill.text}`}
                >
                  <span className="vcw-strip__frame">
                    {s.assetUrl ? <img src={s.assetUrl} alt="" loading="lazy" /> : <Icon name="Image" size={16} />}
                    <span className="vcw-strip__no">{String(i + 1).padStart(2, "0")}</span>
                  </span>
                  <span className="vcw-strip__meta">
                    <Pill status={pill.status}>{pill.text}</Pill>
                    <span className="vcw-strip__tracks" aria-hidden="true">
                      <Icon name="Image" size={11} className={s.assetUrl ? "on" : "off"} />
                      <Icon name="Mic" size={11} className={s.narrationUrl ? "on" : "off"} />
                    </span>
                  </span>
                </Chip>
              </li>
            );
          })}
        </ul>
      </section>

      <form
        className="vcw-command"
        onSubmit={(e) => {
          e.preventDefault();
          sendToAios();
        }}
      >
        <Icon name="Sparkles" size={16} />
        <input
          className="vcw-command__input"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={commandPlaceholder(shotNo, shots.length > 0)}
          aria-label="告訴 Aios 你想怎麼修改"
        />
        <Button size="sm" variant="primary" type="submit" aria-label="送出" disabled={!command.trim()}>
          <Icon name="Send" size={15} />
        </Button>
      </form>
    </div>
  );
}
