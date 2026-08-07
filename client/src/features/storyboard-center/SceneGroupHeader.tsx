/**
 * 場標頭（Scene；PE 計畫 §07）：一場戲的狀態列——場名、地點（場景卡）、環境（天氣/時間/氛圍）。
 * Shot 生成時會繼承這裡的環境狀態（Project Style → Scene State → Shot Override 的中層）。
 */
import { useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { ConfirmButton } from "../../components/interactions";
import { Button, Chip, Meta } from "../../components/ui";
import { formatEnvironmentState, type EnvironmentState } from "@shared/story";

export interface StorySceneRow {
  id: string;
  title: string;
  summary: string | null;
  locationId: string | null;
  environment: EnvironmentState | null;
}

export function SceneGroupHeader({
  projectId,
  scene,
  index,
  shotCount,
  canEdit,
  locations,
}: {
  projectId: string;
  scene: StorySceneRow;
  index: number;
  shotCount: number;
  canEdit: boolean;
  /** 場景卡清單（地點選擇；與設定頁共用快取） */
  locations: Array<{ id: string; name: string }>;
}) {
  const utils = trpc.useUtils();
  const [editingEnv, setEditingEnv] = useState(false);
  const update = trpc.story.sceneUpdate.useMutation({
    onSuccess: () => utils.story.scenesList.invalidate({ projectId }),
  });
  const remove = trpc.story.sceneRemove.useMutation({
    onSuccess: () => {
      utils.story.scenesList.invalidate({ projectId });
      utils.scenes.listByProject.invalidate({ projectId });
    },
  });
  const envText = formatEnvironmentState(scene.environment);
  const locationName = scene.locationId ? locations.find((l) => l.id === scene.locationId)?.name : null;

  const saveEnvField = (field: keyof EnvironmentState, value: string) => {
    const next: EnvironmentState = { ...(scene.environment ?? {}), [field]: value.trim() || undefined };
    update.mutate({ id: scene.id, environment: next });
  };

  return (
    <header className="board-scene-head" data-fb="場標頭">
      <span className="board-scene-head__num">場 {index + 1}</span>
      <input
        key={`scene-title-${scene.id}-${scene.title}`}
        className="board-scene-head__title"
        aria-label={`場 ${index + 1} 名稱`}
        defaultValue={scene.title}
        readOnly={!canEdit}
        maxLength={60}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (canEdit && v && v !== scene.title) update.mutate({ id: scene.id, title: v });
        }}
      />
      <Meta as="span">{shotCount} 鏡</Meta>
      {canEdit ? (
        <select
          aria-label="這場戲的地點"
          className="board-scene-head__loc"
          value={scene.locationId ?? ""}
          onChange={(e) => update.mutate({ id: scene.id, locationId: e.target.value || null })}
        >
          <option value="">（未定地點）</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      ) : (
        locationName && <Chip>{locationName}</Chip>
      )}
      {envText && !editingEnv && (
        <Chip className="on" title="環境狀態：這場戲底下的鏡生成時會自動帶上">
          {envText}
        </Chip>
      )}
      {canEdit && (
        <Button size="sm" variant="ghost" aria-expanded={editingEnv} onClick={() => setEditingEnv((v) => !v)}>
          <Icon name="Sun" size={13} /> 環境
        </Button>
      )}
      <span style={{ flex: "1 1 auto" }} />
      {canEdit && (
        <ConfirmButton
          triggerClassName="btn-sm btn-ghost"
          message={`刪除「${scene.title || `場 ${index + 1}`}」這一場？底下的鏡不會被刪，只會變成「未分場」。`}
          confirmLabel="刪除場"
          disabled={remove.isPending}
          onConfirm={() => remove.mutate({ id: scene.id })}
        >
          <Icon name="Trash2" size={13} />
        </ConfirmButton>
      )}
      {editingEnv && (
        <div className="board-scene-env" role="group" aria-label="環境狀態">
          <label>
            天氣
            <input
              key={`w-${scene.id}-${scene.environment?.weather ?? ""}`}
              defaultValue={scene.environment?.weather ?? ""}
              placeholder="雨天"
              maxLength={40}
              onBlur={(e) => saveEnvField("weather", e.target.value)}
            />
          </label>
          <label>
            時間
            <input
              key={`t-${scene.id}-${scene.environment?.timeOfDay ?? ""}`}
              defaultValue={scene.environment?.timeOfDay ?? ""}
              placeholder="清晨"
              maxLength={40}
              onBlur={(e) => saveEnvField("timeOfDay", e.target.value)}
            />
          </label>
          <label>
            氛圍
            <input
              key={`m-${scene.id}-${scene.environment?.mood ?? ""}`}
              defaultValue={scene.environment?.mood ?? ""}
              placeholder="平靜"
              maxLength={60}
              onBlur={(e) => saveEnvField("mood", e.target.value)}
            />
          </label>
          {update.error && <span className="error">{update.error.message}</span>}
        </div>
      )}
    </header>
  );
}
