import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { EditingHandoffMode, EditingSelectionType } from "@shared/externalEditing";
import type { AgentQuestionAnswer, AgentQuestionDefinition } from "@shared/agentQuestions";
import { trpc } from "../../api";
import { AgentQuestionCard } from "../../components/AgentQuestionCard";
import { Icon } from "../../components/Icon";
import { Button, Card, Chip, Hint, Meta } from "../../components/ui";

export function EditingHandoffSheet({
  open,
  projectId,
  defaultShotIds = [],
  originConversationId,
  originAssistantRunId,
  originSurface = "delivery",
  onClose,
  onPrepared,
}: {
  open: boolean;
  projectId: string;
  defaultShotIds?: string[];
  originConversationId?: string;
  originAssistantRunId?: string;
  originSurface?: string;
  onClose: () => void;
  onPrepared?: (sessionId: string) => void;
}) {
  const utils = trpc.useUtils();
  const shotsQuery = trpc.scenes.listByProject.useQuery({ projectId }, { enabled: open });
  const storyScenesQuery = trpc.story.scenesList.useQuery({ projectId }, { enabled: open });
  const [selectionType, setSelectionType] = useState<EditingSelectionType>(defaultShotIds.length === 1 ? "shot" : defaultShotIds.length ? "shots" : "project");
  const [shotIds, setShotIds] = useState<string[]>(defaultShotIds);
  const [storySceneIds, setStorySceneIds] = useState<string[]>([]);
  const [handoffMode, setHandoffMode] = useState<EditingHandoffMode>("download");
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setSelectionType(defaultShotIds.length === 1 ? "shot" : defaultShotIds.length ? "shots" : "project");
    setShotIds(defaultShotIds);
    setOverrides({});
  }, [open, defaultShotIds.join("|")]);

  const selection = useMemo(() => ({
    projectId,
    selectionType,
    storySceneIds,
    shotIds,
    primaryAssetOverrides: overrides,
  }), [projectId, selectionType, storySceneIds, shotIds, overrides]);
  const selectionReady = selectionType === "project"
    || (selectionType === "story_scene" && storySceneIds.length === 1)
    || (selectionType === "shot" && shotIds.length === 1)
    || (selectionType === "shots" && shotIds.length > 0);
  const preview = trpc.externalEditing.preview.useQuery(selection, { enabled: open && selectionReady, retry: false });
  const prepare = trpc.externalEditing.prepare.useMutation({
    onSuccess: (result) => {
      void utils.externalEditing.list.invalidate({ projectId });
      onPrepared?.(result.session.id);
      onClose();
    },
  });

  if (!open) return null;
  const shots = shotsQuery.data ?? [];
  const storyScenes = storyScenesQuery.data ?? [];
  const questions = (preview.data?.questions ?? []) as AgentQuestionDefinition[];

  const answerQuestion = (question: AgentQuestionDefinition, answer: AgentQuestionAnswer) => {
    if (typeof answer !== "string") return;
    const option = question.options.find((candidate) => candidate.id === answer);
    const shotId = option?.metadata?.shotId;
    if (typeof shotId === "string") setOverrides((current) => ({ ...current, [shotId]: answer }));
  };

  return createPortal(
    <div className="modal-scrim" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <Card className="modal-card editing-handoff-sheet" role="dialog" aria-modal="true" aria-label="建立 LumaFusion 剪輯交接">
        <div className="editing-handoff-sheet__head">
          <div>
            <Meta as="span">External Editing Bridge</Meta>
            <h2>交給 LumaFusion 剪輯</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="關閉"><Icon name="X" /></Button>
        </div>

        <Hint>
          Aios 會建立媒體 ZIP 與 <code>aios-manifest.json</code>。這不是 LumaFusion 專案檔，也不會假裝直接控制剪輯器。
        </Hint>

        <div className="editing-handoff-sheet__section">
          <strong>1. 選擇範圍</strong>
          <div className="editing-handoff-sheet__choices">
            {([
              ["project", "整個專案"],
              ["story_scene", "一個 Scene"],
              ["shots", "多個 Shot"],
              ["shot", "一個 Shot"],
            ] as const).map(([value, label]) => (
              <Chip key={value} selected={selectionType === value} onClick={() => {
                setSelectionType(value);
                if (value === "project") { setShotIds([]); setStorySceneIds([]); }
              }}>{label}</Chip>
            ))}
          </div>
          {selectionType === "story_scene" ? (
            <div className="editing-handoff-sheet__list" role="radiogroup" aria-label="Scene">
              {storyScenes.map((scene) => (
                <button type="button" key={scene.id} className={storySceneIds[0] === scene.id ? "is-selected" : ""}
                  onClick={() => setStorySceneIds([scene.id])}>Scene {scene.orderIndex + 1} · {scene.title}</button>
              ))}
            </div>
          ) : null}
          {selectionType === "shot" || selectionType === "shots" ? (
            <div className="editing-handoff-sheet__list" role={selectionType === "shot" ? "radiogroup" : "group"} aria-label="Shot">
              {shots.map((shot) => {
                const selected = shotIds.includes(shot.id);
                return <button type="button" key={shot.id} className={selected ? "is-selected" : ""} onClick={() => {
                  setShotIds(selectionType === "shot" ? [shot.id] : selected ? shotIds.filter((id) => id !== shot.id) : [...shotIds, shot.id]);
                }}>Shot {shot.orderIndex} · {shot.title}</button>;
              })}
            </div>
          ) : null}
        </div>

        <div className="editing-handoff-sheet__section">
          <strong>2. 交接方式</strong>
          <div className="editing-handoff-sheet__choices">
            <Chip selected={handoffMode === "share"} onClick={() => setHandoffMode("share")}>手機分享</Chip>
            <Chip selected={handoffMode === "download"} onClick={() => setHandoffMode("download")}>下載 ZIP</Chip>
            <Chip selected={handoffMode === "files"} onClick={() => setHandoffMode("files")}>儲存到 Files</Chip>
          </div>
          <Meta as="p">iPhone／iPad：分享或下載後儲存到 Files；Android／Chromebook：下載並解壓，再從儲存空間加入媒體。</Meta>
        </div>

        {preview.isLoading ? <Meta as="p">正在核對素材、Context 與權限…</Meta> : null}
        {preview.data ? (
          <Hint role="status">
            已找到 {preview.data.selection.shotIds.length} 個 Shot、{preview.data.assets.length} 份可交接素材。
          </Hint>
        ) : null}
        {questions.map((question, index) => (
          <AgentQuestionCard
            key={`${question.title}-${index}`}
            question={{ ...question, id: `editing-question-${index}` }}
            projectId={projectId}
            onAnswer={(answer) => answerQuestion(question, answer)}
          />
        ))}
        {(preview.error || prepare.error) ? <p className="error" role="alert">{preview.error?.message ?? prepare.error?.message}</p> : null}

        <div className="editing-handoff-sheet__actions">
          <Button variant="ghost" onClick={onClose}>稍後再做</Button>
          <Button variant="primary" disabled={!selectionReady || !preview.data || preview.isLoading || questions.length > 0 || prepare.isPending}
            onClick={() => prepare.mutate({
              ...selection,
              editorId: "lumafusion",
              handoffMode,
              originConversationId,
              originAssistantRunId,
              originSurface,
              returnContext: {
                assistantSurface: originSurface === "global" ? "global" : "project",
                conversationId: originConversationId ?? `editing-${Date.now()}`,
                runId: originAssistantRunId,
                originRoute: window.location.pathname + window.location.search,
                originScrollY: window.scrollY,
                projectId,
              },
            })}>
            {prepare.isPending ? "正在建立…" : "建立交接工作階段"}
          </Button>
        </div>
      </Card>
    </div>,
    document.body,
  );
}
