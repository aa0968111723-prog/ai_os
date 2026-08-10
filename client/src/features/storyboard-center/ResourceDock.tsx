/**
 * 分鏡資源 Dock（PR-4a + PR-4b）：
 * - 4a：就近取用素材／定裝／知識
 * - 4b：勾選多鏡後，點定裝 chip 批次 merge 進各鏡的 setCards
 *
 * 不取代專案設定；只負責「創作當下的就近取用」。
 */
import { useMemo, useState, type DragEvent } from "react";
import {
  MAX_GENERATE_CHARACTERS,
  MAX_GENERATE_PROPS,
  MAX_GENERATE_SCENE_PRESETS,
} from "@shared/cardLimits";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { AssetImg, AssetVideo } from "../../components/MediaFallback";
import { Button, Chip, Hint, Meta } from "../../components/ui";
import { revealProjectContext } from "../project-nav/projectContextNav";

type DockTab = "assets" | "costume" | "knowledge";
type CardKind = "characterIds" | "scenePresetIds" | "propIds";

const TAB_LABEL: Record<DockTab, string> = {
  assets: "素材",
  costume: "定裝",
  knowledge: "知識",
};

const CARD_MAX: Record<CardKind, number> = {
  characterIds: MAX_GENERATE_CHARACTERS,
  scenePresetIds: MAX_GENERATE_SCENE_PRESETS,
  propIds: MAX_GENERATE_PROPS,
};

export function ResourceDock({
  projectId,
  canEdit,
  pickedShotIds,
  characterNames,
}: {
  projectId: string;
  canEdit: boolean;
  /** 分鏡多選：套用素材／定裝時的目標鏡 */
  pickedShotIds: string[];
  characterNames: Map<string, string>;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<DockTab>("assets");
  const [status, setStatus] = useState("");
  const utils = trpc.useUtils();

  const assets = trpc.projects.assets.useQuery(
    { projectId },
    { enabled: open && tab === "assets", staleTime: 30_000 },
  );
  const characters = trpc.characters.list.useQuery(
    { projectId },
    { enabled: open && tab === "costume", staleTime: 60_000 },
  );
  const scenePresets = trpc.scenePresets.list.useQuery(
    { projectId },
    { enabled: open && tab === "costume", staleTime: 60_000 },
  );
  const props = trpc.props.list.useQuery(
    { projectId },
    { enabled: open && tab === "costume", staleTime: 60_000 },
  );
  const knowledge = trpc.knowledge.list.useQuery(
    { projectId },
    { enabled: open && tab === "knowledge", staleTime: 60_000 },
  );
  // 批次套用定裝需要各鏡現有綁定，才能 merge 而不是整排覆寫
  const shots = trpc.scenes.listByProject.useQuery(
    { projectId },
    { enabled: open && tab === "costume" && pickedShotIds.length > 0, staleTime: 15_000 },
  );

  const setVisual = trpc.scenes.setVisualFromAsset.useMutation({
    onSuccess: () => {
      void utils.scenes.listByProject.invalidate({ projectId });
      setStatus("✓ 已套用到選中鏡");
    },
    onError: (err) => setStatus(err.message),
  });

  const setCards = trpc.scenes.setCards.useMutation({
    onSuccess: () => {
      void utils.scenes.listByProject.invalidate({ projectId });
    },
    onError: (err) => setStatus(err.message),
  });

  const visuals = useMemo(
    () => (assets.data ?? []).filter((a) => (a.kind === "image" || a.kind === "video") && a.url),
    [assets.data],
  );

  const shotBindings = useMemo(() => {
    const map = new Map<
      string,
      { characterIds: string[]; scenePresetIds: string[]; propIds: string[] }
    >();
    for (const s of shots.data ?? []) {
      map.set(s.id, {
        characterIds: (s.characterIds as string[] | null) ?? [],
        scenePresetIds: (s.scenePresetIds as string[] | null) ?? [],
        propIds: (s.propIds as string[] | null) ?? [],
      });
    }
    return map;
  }, [shots.data]);

  const targetLabel =
    pickedShotIds.length === 0
      ? "先勾選一鏡（或直接拖到分鏡卡）"
      : pickedShotIds.length === 1
        ? "套用到選中的 1 鏡"
        : `套用到選中的 ${pickedShotIds.length} 鏡`;

  const applyAsset = (assetId: string) => {
    if (!canEdit || pickedShotIds.length === 0 || setVisual.isPending) return;
    setStatus("");
    for (const sceneId of pickedShotIds) {
      setVisual.mutate({ sceneId, assetId });
    }
  };

  /**
   * 批次把一張定裝卡 merge 進選中鏡。
   * - 已有該 id → 跳過（不重複）
   * - 已達上限 → 跳過該鏡
   * - 只送動到的那一排，避免覆寫夥伴剛改的另外兩排
   */
  const applyCardToPicked = (kind: CardKind, cardId: string, label: string) => {
    if (!canEdit || pickedShotIds.length === 0 || setCards.isPending) return;
    setStatus("");
    const max = CARD_MAX[kind];
    let applied = 0;
    let skippedFull = 0;
    let skippedDup = 0;

    for (const sceneId of pickedShotIds) {
      const binding = shotBindings.get(sceneId) ?? {
        characterIds: [] as string[],
        scenePresetIds: [] as string[],
        propIds: [] as string[],
      };
      const current = binding[kind];
      if (current.includes(cardId)) {
        skippedDup += 1;
        continue;
      }
      if (current.length >= max) {
        skippedFull += 1;
        continue;
      }
      const next = [...current, cardId];
      setCards.mutate({ sceneId, [kind]: next });
      applied += 1;
    }

    const bits: string[] = [];
    if (applied > 0) bits.push(`✓ 「${label}」已加到 ${applied} 鏡`);
    if (skippedDup > 0) bits.push(`${skippedDup} 鏡已有`);
    if (skippedFull > 0) bits.push(`${skippedFull} 鏡已滿（上限 ${max}）`);
    if (bits.length === 0) bits.push(`沒有鏡需要更新`);
    setStatus(bits.join("・"));
  };

  const onDragStartAsset = (e: DragEvent, assetId: string, title: string) => {
    e.dataTransfer.setData("application/x-aios-asset-id", assetId);
    e.dataTransfer.setData("text/plain", title);
    e.dataTransfer.effectAllowed = "copy";
  };

  const canBatchCostume = canEdit && pickedShotIds.length > 0 && !setCards.isPending;

  return (
    <aside
      className={`resource-dock${open ? " is-open" : ""}`}
      aria-label="分鏡資源"
      data-fb="分鏡資源 Dock"
      style={{
        flex: "0 0 240px",
        position: "sticky",
        top: 72,
        maxHeight: "calc(100vh - 96px)",
        overflow: "auto",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-12, 12px)",
        background: "var(--surface, var(--card))",
        padding: 8,
        minWidth: 200,
      }}
    >
      <div className="resource-dock__head">
        <Button
          size="sm"
          variant="ghost"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title={open ? "收合資源面板" : "展開資源面板——就近取用素材／定裝／知識"}
        >
          <Icon name="PanelRight" size={14} />
          資源
          {!open && visuals.length > 0 && (
            <Meta as="span" style={{ marginLeft: 4 }}>{visuals.length}</Meta>
          )}
        </Button>
        {open && (
          <div className="resource-dock__tabs" role="tablist" aria-label="資源類型" style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {(Object.keys(TAB_LABEL) as DockTab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`resource-dock__tab${tab === t ? " is-active" : ""}`}
                onClick={() => setTab(t)}
                style={{
                  fontSize: "var(--fs-12)",
                  padding: "4px 10px",
                  border: 0,
                  borderRadius: 999,
                  background: tab === t ? "var(--primary-soft, color-mix(in srgb, var(--primary-ink) 12%, transparent))" : "transparent",
                  color: tab === t ? "var(--primary-ink)" : "inherit",
                  fontWeight: tab === t ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="resource-dock__body" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-soft, var(--border))" }}>
          {tab === "assets" && (
            <div role="tabpanel" aria-label="素材">
              <Meta as="p" style={{ margin: "0 0 8px", fontSize: "var(--fs-12)" }}>
                {targetLabel}
              </Meta>
              {!canEdit && <Hint>檢視者只能瀏覽，不能套用。</Hint>}
              {assets.isLoading ? (
                <Meta>載入素材…</Meta>
              ) : visuals.length === 0 ? (
                <Hint>
                  還沒有圖片／影片。
                  <Button size="sm" variant="ghost" type="button" onClick={() => revealProjectContext("assets", { projectId, returnTo: "scenes" })}>
                    去素材庫上傳
                  </Button>
                </Hint>
              ) : (
                <div role="listbox" aria-label="專案素材" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {visuals.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="option"
                      title={`${a.title}——${pickedShotIds.length ? "點擊套用到選中鏡" : "先勾選分鏡再套用"}`}
                      disabled={!canEdit || pickedShotIds.length === 0 || setVisual.isPending}
                      draggable={canEdit}
                      onDragStart={(e) => onDragStartAsset(e, a.id, a.title)}
                      onClick={() => applyAsset(a.id)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        padding: 0,
                        border: "1px solid var(--border)",
                        borderRadius: "var(--r-10, 10px)",
                        background: "var(--surface-2, var(--field))",
                        cursor: canEdit && pickedShotIds.length ? "pointer" : "not-allowed",
                        overflow: "hidden",
                        textAlign: "left",
                        opacity: !canEdit || pickedShotIds.length === 0 ? 0.55 : 1,
                      }}
                    >
                      {a.kind === "video" ? (
                        <AssetVideo src={a.url!} muted preload="metadata" className="resource-dock__thumb" fallbackLabel="影" />
                      ) : (
                        <AssetImg src={a.url!} alt={a.title} loading="lazy" className="resource-dock__thumb" fallbackLabel="圖" />
                      )}
                      <span style={{ fontSize: "var(--fs-11)", padding: "0 6px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.title.slice(0, 16)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <Button size="sm" variant="ghost" type="button" onClick={() => revealProjectContext("assets", { projectId, returnTo: "scenes" })}>
                  <Icon name="LayoutGrid" size={12} /> 完整素材庫
                </Button>
              </div>
            </div>
          )}

          {tab === "costume" && (
            <div role="tabpanel" aria-label="定裝">
              <Meta as="p" style={{ margin: "0 0 8px", fontSize: "var(--fs-12)" }}>
                {pickedShotIds.length > 0
                  ? `點 chip 把定裝加到選中的 ${pickedShotIds.length} 鏡（已有則跳過）`
                  : "勾選分鏡後點 chip 批次套用；未勾選時點 chip 開完整管理"}
              </Meta>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <Meta as="span" style={{ fontWeight: 600 }}>角色</Meta>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {(characters.data ?? []).length === 0 ? (
                      <Meta>尚無角色卡</Meta>
                    ) : (
                      (characters.data ?? []).slice(0, 12).map((c) => (
                        <Chip
                          key={c.id}
                          title={
                            canBatchCostume
                              ? `把「${c.name}」加到選中的 ${pickedShotIds.length} 鏡`
                              : `${c.name}——開啟定裝管理`
                          }
                          onClick={() => {
                            if (canBatchCostume) applyCardToPicked("characterIds", c.id, c.name);
                            else revealProjectContext("characters", { projectId, returnTo: "scenes" });
                          }}
                          style={canBatchCostume ? { cursor: "pointer" } : undefined}
                        >
                          {c.name}
                        </Chip>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <Meta as="span" style={{ fontWeight: 600 }}>場景</Meta>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {(scenePresets.data ?? []).length === 0 ? (
                      <Meta>尚無場景卡</Meta>
                    ) : (
                      (scenePresets.data ?? []).slice(0, 12).map((s) => (
                        <Chip
                          key={s.id}
                          title={
                            canBatchCostume
                              ? `把「${s.name}」加到選中的 ${pickedShotIds.length} 鏡`
                              : `${s.name}——開啟定裝管理`
                          }
                          onClick={() => {
                            if (canBatchCostume) applyCardToPicked("scenePresetIds", s.id, s.name);
                            else revealProjectContext("scenes", { projectId, returnTo: "scenes" });
                          }}
                          style={canBatchCostume ? { cursor: "pointer" } : undefined}
                        >
                          {s.name}
                        </Chip>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <Meta as="span" style={{ fontWeight: 600 }}>道具</Meta>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {(props.data ?? []).length === 0 ? (
                      <Meta>尚無道具卡</Meta>
                    ) : (
                      (props.data ?? []).slice(0, 12).map((p) => (
                        <Chip
                          key={p.id}
                          title={
                            canBatchCostume
                              ? `把「${p.name}」加到選中的 ${pickedShotIds.length} 鏡`
                              : `${p.name}——開啟定裝管理`
                          }
                          onClick={() => {
                            if (canBatchCostume) applyCardToPicked("propIds", p.id, p.name);
                            else revealProjectContext("props", { projectId, returnTo: "scenes" });
                          }}
                          style={canBatchCostume ? { cursor: "pointer" } : undefined}
                        >
                          {p.name}
                        </Chip>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Button size="sm" variant="tonal" type="button" onClick={() => revealProjectContext("characters", { projectId, returnTo: "scenes" })}>
                  <Icon name="User" size={12} /> 管理定裝
                </Button>
              </div>
              {pickedShotIds.length === 0 && (
                <Hint style={{ marginTop: 8, fontSize: "var(--fs-11)" }}>
                  提示：勾選分鏡後再點 chip，可一次把定裝加到多鏡
                </Hint>
              )}
              {characterNames.size > 0 && pickedShotIds.length > 0 && shots.isLoading && (
                <Meta as="p" style={{ marginTop: 6, fontSize: "var(--fs-11)" }}>讀取現有綁定…</Meta>
              )}
            </div>
          )}

          {tab === "knowledge" && (
            <div role="tabpanel" aria-label="知識">
              <Meta as="p" style={{ margin: "0 0 8px", fontSize: "var(--fs-12)" }}>
                腳本、開示、參考文件——AI 導演與助手會引用。
              </Meta>
              {knowledge.isLoading ? (
                <Meta>載入知識庫…</Meta>
              ) : (knowledge.data ?? []).length === 0 ? (
                <Hint>
                  尚無知識文件。
                  <Button size="sm" variant="ghost" type="button" onClick={() => revealProjectContext("knowledge", { projectId, returnTo: "scenes" })}>
                    去知識庫
                  </Button>
                </Hint>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  {(knowledge.data ?? []).slice(0, 20).map((k) => (
                    <li key={k.id}>
                      <button
                        type="button"
                        title={k.excerpt?.slice(0, 120) || k.title}
                        onClick={() => revealProjectContext("knowledge", { projectId, returnTo: "scenes" })}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          width: "100%",
                          textAlign: "left",
                          border: 0,
                          background: "transparent",
                          padding: "6px 4px",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontSize: "var(--fs-12)",
                        }}
                      >
                        <Icon name="FileText" size={12} />
                        <span>{k.title.slice(0, 28)}</span>
                        {k.pinned ? <Meta as="span">置頂</Meta> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ marginTop: 8 }}>
                <Button size="sm" variant="ghost" type="button" onClick={() => revealProjectContext("knowledge", { projectId, returnTo: "scenes" })}>
                  <Icon name="FileText" size={12} /> 完整知識庫
                </Button>
              </div>
            </div>
          )}

          {status && (
            <Meta as="p" role="status" style={{ marginTop: 8, fontSize: "var(--fs-12)" }}>
              {status}
            </Meta>
          )}
        </div>
      )}
    </aside>
  );
}
