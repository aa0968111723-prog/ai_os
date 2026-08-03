import { Button, Meta } from "./ui";
import { Icon } from "./Icon";

/** Compact next-steps bar after a generation transitions to done. */
export function GenerationNextSteps({
  generation,
  alreadyInScene,
  canEdit,
  addPending,
  onAddToScene,
  onReuse,
  onToggleFavorite,
  onDismiss,
}: {
  generation: {
    id: string;
    name?: string | null;
    prompt: string;
    modelId: string;
    favorite?: boolean | null;
    characterIds?: string[] | null;
    scenePresetIds?: string[] | null;
    propIds?: string[] | null;
    sourceUrl?: string | null;
  };
  alreadyInScene: boolean;
  canEdit: boolean;
  addPending?: boolean;
  onAddToScene: () => void;
  onReuse?: (
    text: string,
    settings?: {
      modelId?: string | null;
      characterIds?: string[] | null;
      scenePresetIds?: string[] | null;
      propIds?: string[] | null;
      sourceAssetId?: string | null;
    },
  ) => void;
  onToggleFavorite?: () => void;
  onDismiss: () => void;
}) {
  const title = (generation.name || generation.prompt).slice(0, 60);
  const truncated = (generation.name || generation.prompt).length > 60;
  return (
    <div
      data-testid="generation-next-steps"
      style={{
        marginBottom: 12,
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--border-soft)",
        background: "var(--card2)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <strong style={{ flex: "1 1 auto", fontSize: "var(--fs-13)" }}>剛完成 · 下一步</strong>
        <Button type="button" size="sm" variant="ghost" title="關閉此提示" onClick={onDismiss}>
          關閉
        </Button>
      </div>
      <Meta as="p" style={{ margin: 0 }}>
        {title}
        {truncated ? "…" : ""}
      </Meta>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="group" aria-label="生成完成後的下一步">
        {canEdit && !alreadyInScene && (
          <Button type="button" size="sm" disabled={addPending} title="把這張成品加入分鏡列表" onClick={onAddToScene}>
            <Icon name="Plus" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            加入分鏡
          </Button>
        )}
        {alreadyInScene && (
          <Meta as="span" style={{ color: "var(--success-ink)" }}>
            已在分鏡中
          </Meta>
        )}
        {canEdit && onReuse && (
          <Button
            type="button"
            size="sm"
            title="把提示詞、模型與角色/場景勾選帶回生成台"
            onClick={() =>
              onReuse(generation.prompt, {
                modelId: generation.modelId,
                characterIds: (generation.characterIds as string[] | null) ?? [],
                scenePresetIds: (generation.scenePresetIds as string[] | null) ?? [],
                propIds: (generation.propIds as string[] | null) ?? [],
                sourceAssetId:
                  generation.sourceUrl?.match(
                    /\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/file/i,
                  )?.[1] ?? null,
              })
            }
          >
            再用此設定
          </Button>
        )}
        {canEdit && onToggleFavorite && (
          <Button
            type="button"
            size="sm"
            title={generation.favorite ? "取消收藏" : "收藏此成品"}
            onClick={onToggleFavorite}
          >
            {generation.favorite ? "已收藏" : "收藏"}
          </Button>
        )}
      </div>
    </div>
  );
}
