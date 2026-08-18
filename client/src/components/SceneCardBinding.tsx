import { useState } from "react";
import {
  MAX_GENERATE_CHARACTERS,
  MAX_GENERATE_PROPS,
  MAX_GENERATE_SCENE_PRESETS,
} from "@shared/cardLimits";
import { formatPropDisplayName } from "@shared/propOwnership";
import { hasSceneCardBinding } from "@shared/sceneCards";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Chip, Hint, Meta } from "./ui";

type Binding = {
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
};

/**
 * 逐鏡卡片綁定（分鏡表每格一列）：這一鏡要用哪些角色／場景／素材卡。
 *
 * 沒綁＝沿用生成台當下的勾選；一旦綁了任何一種，這一鏡就整組以自己的為準——
 * 「這鏡不要人」（紅傘特寫）必須表達得出來，否則全域勾選會硬塞一個角色進畫面。
 * 卡片清單走既有 list query（與專案頁同快取鍵，不會多打 API）。
 */
export function SceneCardBinding({
  projectId,
  scene,
  canEdit,
  onSaved,
}: {
  projectId: string;
  scene: Binding & { id: string };
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const characters = trpc.characters.list.useQuery({ projectId }, { enabled: open });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId }, { enabled: open });
  const props = trpc.props.list.useQuery({ projectId }, { enabled: open });
  // 每勾一下就存，但**不關面板**——三排是同一個多選編輯器，關掉會逼使用者重開再等 refetch
  const setCards = trpc.scenes.setCards.useMutation({ onSuccess: () => onSaved() });

  const bound = hasSceneCardBinding(scene);
  const charIds = scene.characterIds ?? [];
  const sceneIds = scene.scenePresetIds ?? [];
  const propIds = scene.propIds ?? [];

  const toggle = (list: string[], id: string, max: number): string[] => {
    if (list.includes(id)) return list.filter((x) => x !== id);
    if (list.length >= max) return list;
    return [...list, id];
  };

  // 只送真的動到的那一排（setCards 對沒送的欄位維持原值）。
  // 拿 scene props 把另外兩排補齊送出＝讀-改-寫：那份快照最舊是 10 秒前的（listByProject 的
  // refetchInterval），夥伴剛在同一格綁上的卡會被這一次覆寫靜默清掉，兩邊都沒有提示。
  const save = (next: Partial<Record<"characterIds" | "scenePresetIds" | "propIds" | "lookIds", string[]>>) =>
    setCards.mutate({ sceneId: scene.id, ...next });

  return (
    <div style={{ marginTop: 6 }}>
      <Meta as="div" style={{ fontSize: "var(--fs-11)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Icon name="Package" size={11} style={{ verticalAlign: "-1px" }} />
        {bound ? (
          <BoundSummary
            projectId={projectId}
            charIds={charIds}
            sceneIds={sceneIds}
            propIds={propIds}
          />
        ) : (
          <span title="這一鏡沒指定卡片，出圖時沿用生成台當下的勾選">這一鏡：沿用生成台勾選</span>
        )}
        {canEdit && (
          <Button variant="ghost" size="sm" style={{ fontSize: "var(--fs-11)" }} onClick={() => setOpen((v) => !v)}>
            {open ? "收起" : bound ? "改" : "指定"}
          </Button>
        )}
      </Meta>

      {open && canEdit && (
        <div style={{ marginTop: 4, padding: 8, border: "1px solid var(--border-soft)", borderRadius: 8 }}>
          <PickRow
            label="角色"
            rows={characters.data?.map((c) => ({ id: c.id, label: c.name })) ?? []}
            selected={charIds}
            max={MAX_GENERATE_CHARACTERS}
            loading={characters.isLoading}
            disabled={setCards.isPending}
            onToggle={(id) => save({ characterIds: toggle(charIds, id, MAX_GENERATE_CHARACTERS) })}
          />
          <PickRow
            label="場景"
            rows={scenePresets.data?.map((s) => ({ id: s.id, label: s.name })) ?? []}
            selected={sceneIds}
            max={MAX_GENERATE_SCENE_PRESETS}
            loading={scenePresets.isLoading}
            disabled={setCards.isPending}
            onToggle={(id) => save({ scenePresetIds: toggle(sceneIds, id, MAX_GENERATE_SCENE_PRESETS) })}
          />
          <PickRow
            label="素材"
            rows={props.data?.map((p) => ({ id: p.id, label: formatPropDisplayName(p.name, p.ownerName) })) ?? []}
            selected={propIds}
            max={MAX_GENERATE_PROPS}
            loading={props.isLoading}
            disabled={setCards.isPending}
            onToggle={(id) => save({ propIds: toggle(propIds, id, MAX_GENERATE_PROPS) })}
          />
          <Hint style={{ marginTop: 4 }}>
            全部取消＝這一鏡回到「沿用生成台勾選」。掛了歸屬的素材，勾角色／場景時會自動一起帶入。
          </Hint>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <Button variant="ghost" size="sm" style={{ fontSize: "var(--fs-11)" }} onClick={() => setOpen(false)}>
              完成
            </Button>
            {bound && (
              <Button
                variant="ghost"
                size="sm"
                style={{ fontSize: "var(--fs-11)" }}
                disabled={setCards.isPending}
                onClick={() => save({ characterIds: [], scenePresetIds: [], propIds: [], lookIds: [] })}
              >
                清除這一鏡的指定
              </Button>
            )}
          </div>
          {setCards.error && (
            <p className="error" role="alert" style={{ margin: "4px 0 0", fontSize: "var(--fs-11)" }}>
              {setCards.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** 已綁定時的一行摘要：直接寫出名字，看得到才知道這鏡會出什麼 */
function BoundSummary({
  projectId,
  charIds,
  sceneIds,
  propIds,
}: {
  projectId: string;
  charIds: string[];
  sceneIds: string[];
  propIds: string[];
}) {
  // 摘要要顯示名字就得讀清單；面板收合時也要（否則只看得到數量）——與專案頁同快取鍵，不額外打 API
  const characters = trpc.characters.list.useQuery({ projectId });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId });
  const props = trpc.props.list.useQuery({ projectId });
  const names = [
    ...charIds.map((id) => characters.data?.find((c) => c.id === id)?.name),
    ...sceneIds.map((id) => scenePresets.data?.find((s) => s.id === id)?.name),
    ...propIds.map((id) => {
      const row = props.data?.find((p) => p.id === id);
      return row ? formatPropDisplayName(row.name, row.ownerName) : undefined;
    }),
  ].filter((n): n is string => !!n);
  const total = charIds.length + sceneIds.length + propIds.length;
  // 名字還沒載到就先顯示張數，不要空白一片
  return <span title="這一鏡指定的設定卡（出圖時只用這些）">這一鏡：{names.join("・") || `${total} 張卡`}</span>;
}

function PickRow({
  label,
  rows,
  selected,
  max,
  loading,
  disabled,
  onToggle,
}: {
  label: string;
  rows: Array<{ id: string; label: string }>;
  selected: string[];
  max: number;
  loading: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", marginTop: 4 }}>
      <Meta as="span" style={{ fontSize: "var(--fs-11)", minWidth: 30 }}>
        {label}
      </Meta>
      {loading ? (
        <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>載入中…</Meta>
      ) : rows.length === 0 ? (
        <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>（還沒有卡）</Meta>
      ) : (
        rows.map((row) => {
          const on = selected.includes(row.id);
          // Chip 是 span，沒有原生 disabled——用 aria-disabled ＋ 點擊守衛表達停用
          const off = disabled || (!on && selected.length >= max);
          return (
            <Chip
              key={row.id}
              selected={on}
              aria-disabled={off || undefined}
              style={off ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
              title={!on && selected.length >= max ? `最多 ${max} 張——先取消其他` : undefined}
              onClick={() => !off && onToggle(row.id)}
            >
              {row.label}
            </Chip>
          );
        })
      )}
    </div>
  );
}
