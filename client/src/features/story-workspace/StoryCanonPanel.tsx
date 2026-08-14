/**
 * Team Canon 面板（PR-C，master plan §4／§14）。
 *
 * Invisible Complexity：不開新的頂層「Canon 管理中心」——這個面板活在專案設定第二層，
 * 只講人話：哪些設定來自團隊、有沒有新版、升級會影響幾鏡、訓練成果要不要採用。
 * 所有狀態都來自 server（canon router／workspace projection），這裡不自算一致性。
 * 按鈕一律 tonal/ghost——頁面唯一的 visually-primary CTA 在 StoryReadinessBar。
 */
import { useState } from "react";
import { trpc } from "../../api";
import { Button, Card, Chip, EmptyState, Hint, Meta } from "../../components/ui";

const KIND_LABELS: Record<string, string> = {
  character: "角色",
  character_look: "造型",
  scene: "場景",
  prop: "道具",
  style: "風格",
  voice: "聲線",
  sound_world: "聲音世界",
};

function kindLabel(kind: string | null): string {
  return (kind && KIND_LABELS[kind]) || "設定";
}

/** 單一 pin 的展開內容：版本歷史＋升級／採用動作（點開才 fetch，避免面板初載膨脹） */
function CanonPinDetail({
  projectId,
  pinId,
  canonId,
  updateAvailable,
  canEdit,
}: {
  projectId: string;
  pinId: string;
  canonId: string;
  updateAvailable: boolean;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.canon.get.useQuery({ canonId });
  const impact = trpc.canon.upgradeImpact.useQuery(
    { projectId, canonId },
    { enabled: updateAvailable },
  );
  const [error, setError] = useState<string | null>(null);
  const invalidateAll = async () => {
    setError(null); // 成功後清掉舊錯誤——403 過的訊息不該黏在下一次成功的動作上
    await Promise.all([
      utils.canon.projectPins.invalidate(),
      utils.canon.get.invalidate({ canonId }),
      utils.creativeContext.workspace.invalidate(),
      utils.characters.list.invalidate(),
      utils.scenePresets.list.invalidate(),
      utils.props.list.invalidate(),
    ]);
  };
  const applyUpgrade = trpc.canon.applyUpgrade.useMutation({
    onSuccess: invalidateAll,
    onError: (err) => setError(err.message),
  });
  const promote = trpc.canon.promoteVersion.useMutation({
    onSuccess: invalidateAll,
    onError: (err) => setError(err.message),
  });
  const saveVersion = trpc.canon.addVersionFromPin.useMutation({
    onSuccess: invalidateAll,
    onError: (err) => setError(err.message),
  });

  if (detail.isLoading) return <Meta as="p">載入版本中…</Meta>;
  if (!detail.data) return <Hint as="p">讀不到這個團隊設定的版本。</Hint>;
  const production = detail.data.canon.productionVersionId;

  return (
    <div className="canon-pin-detail">
      {updateAvailable && (
        <div className="canon-pin-detail__upgrade">
          <Meta as="p">
            {impact.data
              ? impact.data.affectedShotIds.length > 0
                ? `升級會讓 ${impact.data.affectedShotIds.length} 鏡需要重新生成（其中 ${impact.data.currentMediaCount} 鏡已有畫面，會保留到你採用新結果）`
                : "升級不影響任何現有鏡頭"
              : "計算影響範圍中…"}
          </Meta>
          {canEdit && (
            <Button
              variant="tonal"
              size="sm"
              type="button"
              disabled={applyUpgrade.isPending || !impact.data}
              onClick={() => applyUpgrade.mutate({ pinId })}
            >
              {applyUpgrade.isPending ? "升級中…" : "升級到最新版"}
            </Button>
          )}
        </div>
      )}
      <ul className="canon-pin-detail__versions">
        {detail.data.versions.map((version) => (
          <li key={version.id} className="canon-pin-detail__version">
            <span>
              V{version.versionNumber}
              {version.id === production ? "（team production）" : version.archived ? "（已封存）" : "（候選）"}
              {version.hasTraining ? " · 含訓練成果" : ""}
            </span>
            {canEdit && version.id !== production && !version.archived && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={promote.isPending}
                onClick={() => promote.mutate({ versionId: version.id })}
              >
                採用為 production
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={saveVersion.isPending}
          onClick={() => saveVersion.mutate({ pinId })}
        >
          {saveVersion.isPending ? "儲存中…" : "把目前卡片存成新版本"}
        </Button>
      )}
      {error && <Hint as="p" className="canon-pin-detail__error">{error}</Hint>}
    </div>
  );
}

export function StoryCanonPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const workspace = trpc.creativeContext.workspace.useQuery({ projectId });
  const characters = trpc.characters.list.useQuery({ projectId });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId });
  const propCards = trpc.props.list.useQuery({ projectId });
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createCanon = trpc.canon.createFromEntity.useMutation({
    onSuccess: async () => {
      setError(null);
      await Promise.all([
        utils.canon.projectPins.invalidate(),
        utils.creativeContext.workspace.invalidate(),
      ]);
    },
    onError: (err) => setError(err.message),
  });

  const pins = workspace.data?.canonPins ?? [];
  const pinnedEntityIds = new Set(pins.map((pin) => pin.localEntityId).filter(Boolean));
  const candidates = [
    ...(characters.data ?? []).map((row) => ({ id: row.id, name: row.name, entityKind: "character" as const })),
    ...(scenePresets.data ?? []).map((row) => ({ id: row.id, name: row.name, entityKind: "scene_preset" as const })),
    ...(propCards.data ?? []).map((row) => ({ id: row.id, name: row.name, entityKind: "prop" as const })),
  ].filter((row) => !pinnedEntityIds.has(row.id));

  return (
    <Card as="section" className="story-canon-panel" data-fb="團隊設定引用">
      <h3 className="story-canon-panel__title">團隊設定</h3>
      <Meta as="p">
        引用團隊共用的角色、場景與道具——同一批設定跨腳本不走樣；團隊出新版時由你決定何時升級。
      </Meta>
      {pins.length === 0 ? (
        <EmptyState
          title="這個專案還沒有引用團隊設定"
          description="把下面的卡片升為團隊設定，之後每個新腳本都能直接引用。"
        />
      ) : (
        <ul className="story-canon-panel__pins">
          {pins.map((pin) => (
            <li key={pin.pinId} className="story-canon-panel__pin">
              <button
                type="button"
                className="story-canon-panel__pin-row"
                aria-expanded={openPinId === pin.pinId}
                onClick={() => setOpenPinId(openPinId === pin.pinId ? null : pin.pinId)}
              >
                <span>{kindLabel(pin.kind)}・{pin.name}</span>
                <span className="story-canon-panel__pin-state">
                  V{pin.pinnedVersionNumber ?? "?"}
                  {pin.state === "UPDATE_AVAILABLE" && <Chip>有新版 V{pin.productionVersionNumber ?? "?"}</Chip>}
                </span>
              </button>
              {openPinId === pin.pinId && (
                <CanonPinDetail
                  projectId={projectId}
                  pinId={pin.pinId}
                  canonId={pin.canonId}
                  updateAvailable={pin.state === "UPDATE_AVAILABLE"}
                  canEdit={canEdit}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && candidates.length > 0 && (
        <div className="story-canon-panel__candidates">
          <Meta as="p">可升為團隊設定的卡片（升級時即確認素材授權可供整組使用）：</Meta>
          <div className="story-canon-panel__candidate-list">
            {candidates.slice(0, 12).map((row) => (
              <Button
                key={row.id}
                variant="ghost"
                size="sm"
                type="button"
                disabled={createCanon.isPending}
                onClick={() => createCanon.mutate({
                  projectId,
                  entityKind: row.entityKind,
                  entityId: row.id,
                  confirmRights: true,
                })}
              >
                升級「{row.name}」
              </Button>
            ))}
          </div>
        </div>
      )}
      {error && <Hint as="p" className="story-canon-panel__error">{error}</Hint>}
    </Card>
  );
}
