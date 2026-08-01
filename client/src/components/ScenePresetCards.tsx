import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  MAX_GENERATE_SCENE_PRESETS,
  MAX_PROJECT_SCENE_PRESETS,
  SCENE_LIGHTING_MAX,
  SCENE_NAME_MAX,
  SCENE_PALETTE_MAX,
} from "@shared/cardLimits";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { CharCount, ConfirmButton } from "./interactions";
import { ReferenceImagePicker, type ReferenceImage } from "./ReferenceImagePicker";
import { AssetImg } from "./MediaFallback";
import { Button, Card, Hint, Meta, Skeleton } from "./ui";

export { MAX_GENERATE_SCENE_PRESETS };

/**
 * 場景設定卡（提案核心「場景一致性」）：
 * 色板/光線設定一次鎖定，生成勾選 → 自動注入錨點，同場景跨鏡光影一致。
 * readOnly（檢視者）：隱藏新增／刪除／編輯／設參考圖。
 */
export function ScenePresetCards({
  projectId,
  selectedIds,
  onToggle,
  readOnly = false,
  maxSelect = MAX_GENERATE_SCENE_PRESETS,
  onCreated,
}: {
  projectId: string;
  selectedIds: string[];
  onToggle: (id: string) => void;
  readOnly?: boolean;
  maxSelect?: number;
  onCreated?: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.scenePresets.list.useQuery({ projectId });
  const requestId = useRef<string>(crypto.randomUUID());
  const add = trpc.scenePresets.add.useMutation({
    onSuccess: (row) => {
      requestId.current = crypto.randomUUID();
      utils.scenePresets.list.invalidate({ projectId });
      setName("");
      setPalette("");
      setLighting("");
      setRefImg(null);
      setOpen(false);
      if (row?.id) onCreated?.(row.id);
    },
  });
  const remove = trpc.scenePresets.remove.useMutation({
    onSuccess: () => utils.scenePresets.list.invalidate({ projectId }),
  });
  const update = trpc.scenePresets.update.useMutation({
    onSuccess: () => {
      utils.scenePresets.list.invalidate({ projectId });
      setRefEditId(null);
      setTextEditId(null);
    },
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [palette, setPalette] = useState("");
  const [lighting, setLighting] = useState("");
  const [refImg, setRefImg] = useState<ReferenceImage | null>(null);
  const [refEditId, setRefEditId] = useState<string | null>(null);
  const [textEditId, setTextEditId] = useState<string | null>(null);
  const atSelectMax = selectedIds.length >= maxSelect;
  const cardCount = list.data?.length ?? 0;
  const atProjectMax = cardCount >= MAX_PROJECT_SCENE_PRESETS;

  return (
    <Card as="section" data-fb="場景設定卡">
      <h2>場景設定卡（色板・光線一致）</h2>
      <Hint>
        設定場景色板/光線一次鎖定；生成時勾選，AI 自動帶入，同場景跨鏡光影不跳。可綁場景參考圖。
        {list.data && list.data.length > 0 && (
          <>
            {" "}
            · 已選 {selectedIds.length}/{maxSelect}
            {atSelectMax ? "（已達上限）" : ""}
            {" · "}共 {cardCount}/{MAX_PROJECT_SCENE_PRESETS} 張
          </>
        )}
      </Hint>

      {list.isLoading ? (
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }} aria-hidden="true">
          <Skeleton style={{ height: 104 }} />
          <Skeleton style={{ height: 104 }} />
        </div>
      ) : list.isError ? (
        <p className="error" role="alert" style={{ marginTop: 8 }}>
          場景清單暫時載入不了（不是資料不見了）——
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => list.refetch()}>
            再試一次
          </Button>
        </p>
      ) : list.data && list.data.length > 0 ? (
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {list.data.map((s) => {
            const on = selectedIds.includes(s.id);
            const selectDisabled = !on && atSelectMax;
            const refTrashed = Boolean(s.referenceAssetId && !s.referenceUrl);
            const editingText = textEditId === s.id;
            return (
              <div key={s.id} className="asset-cell" style={{ padding: 12, border: on ? "2px solid var(--primary)" : undefined }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.name}>
                    {s.name}
                  </strong>
                  <label
                    style={{
                      fontSize: 12,
                      display: "flex",
                      gap: 4,
                      alignItems: "center",
                      flexShrink: 0,
                      cursor: selectDisabled ? "not-allowed" : "pointer",
                      opacity: selectDisabled ? 0.55 : 1,
                    }}
                    title={selectDisabled ? `最多帶入 ${maxSelect} 個場景設定——先取消其他勾選` : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={selectDisabled}
                      onChange={() => {
                        if (selectDisabled) return;
                        onToggle(s.id);
                      }}
                    />{" "}
                    生成時帶入
                  </label>
                </div>

                {s.referenceUrl && (
                  <AssetImg
                    src={s.referenceUrl}
                    alt={`${s.name} 的場景參考圖`}
                    loading="lazy"
                    style={{
                      width: "100%",
                      height: 96,
                      objectFit: "cover",
                      borderRadius: 8,
                      marginTop: 6,
                      border: "1px solid var(--border-soft)",
                    }}
                    fallbackLabel="參考圖遺失——可重新綁定"
                    fallbackHeight={96}
                    fallbackStyle={{ marginTop: 6 }}
                  />
                )}
                {refTrashed && (
                  <Meta as="div" role="status" style={{ fontSize: 11, marginTop: 6, color: "var(--danger-ink)" }}>
                    參考圖已在回收桶（綁定仍在）——可清除綁定，或先還原素材
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        style={{ marginLeft: 6, fontSize: 11 }}
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: s.id, referenceAssetId: null })}
                      >
                        清除綁定
                      </Button>
                    )}
                  </Meta>
                )}

                {editingText && !readOnly ? (
                  <SceneTextEditor
                    name={s.name}
                    palette={s.palette}
                    lighting={s.lighting ?? ""}
                    projectId={projectId}
                    reference={
                      s.referenceAssetId && s.referenceUrl
                        ? { id: s.referenceAssetId, url: s.referenceUrl, title: "場景參考圖" }
                        : null
                    }
                    pending={update.isPending}
                    error={update.error?.message}
                    onCancel={() => {
                      setTextEditId(null);
                      update.reset();
                    }}
                    onSave={(next) =>
                      update.mutate({
                        id: s.id,
                        name: next.name,
                        palette: next.palette,
                        lighting: next.lighting || null,
                        referenceAssetId: next.referenceAssetId,
                      })
                    }
                  />
                ) : (
                  <>
                    <Meta
                      as="div"
                      title={s.palette}
                      style={{
                        fontSize: 12,
                        marginTop: 4,
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      <Icon name="Palette" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                      {s.palette}
                    </Meta>
                    {s.lighting && (
                      <Meta
                        as="div"
                        title={s.lighting}
                        style={{
                          fontSize: 11,
                          marginTop: 3,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        <Icon name="Lightbulb" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                        {s.lighting}
                      </Meta>
                    )}
                  </>
                )}

                {!readOnly && !editingText && (
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <Button
                      variant="ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => {
                        setTextEditId(s.id);
                        setRefEditId(null);
                      }}
                    >
                      <Icon name="Pencil" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      編輯
                    </Button>
                    {refEditId === s.id ? (
                      <div style={{ flexBasis: "100%" }}>
                        <ReferenceImagePicker
                          projectId={projectId}
                          value={
                            s.referenceAssetId && s.referenceUrl
                              ? { id: s.referenceAssetId, url: s.referenceUrl, title: "場景參考圖" }
                              : null
                          }
                          onChange={(next) => update.mutate({ id: s.id, referenceAssetId: next?.id ?? null })}
                          disabled={update.isPending}
                        />
                        <Button variant="ghost" style={{ marginTop: 4, fontSize: 11 }} onClick={() => setRefEditId(null)}>
                          收起
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        style={{ fontSize: 11 }}
                        title="綁一張場景參考圖：上傳或從素材庫選。選「圖生圖／參考圖」類模型又沒挑來源時，會自動拿它當來源圖（角色卡優先）"
                        onClick={() => {
                          setRefEditId(s.id);
                          setTextEditId(null);
                        }}
                      >
                        <Icon name="Image" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                        {s.referenceUrl ? "換參考圖" : refTrashed ? "重設參考圖" : "設參考圖"}
                      </Button>
                    )}
                    <ConfirmButton
                      triggerStyle={{ padding: "2px 10px", fontSize: 11, color: "var(--danger-ink)" }}
                      disabled={remove.isPending}
                      onConfirm={() => remove.mutate({ id: s.id })}
                      message={`刪除場景「${s.name}」？刪後生成勾選會自動清掉。`}
                      confirmLabel="刪除"
                    >
                      刪除
                    </ConfirmButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Hint layer="always" style={{ marginTop: 8 }}>
          還沒有場景——加一張（例：城市清晨＝暖色調、35mm 淺景深、柔和晨光斜射）。
        </Hint>
      )}

      {!readOnly &&
        (open ? (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
            <label htmlFor="preset-name">場景名</label>
            <input
              id="preset-name"
              value={name}
              maxLength={SCENE_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：城市清晨"
              autoComplete="off"
            />
            <CharCount value={name} max={SCENE_NAME_MAX} />
            <label htmlFor="preset-palette">色板（主色調／配色，會注入生成）</label>
            <textarea
              id="preset-palette"
              value={palette}
              maxLength={SCENE_PALETTE_MAX}
              onChange={(e) => setPalette(e.target.value)}
              rows={2}
              placeholder="例：暖色調、米白與淡橘、低飽和"
            />
            <CharCount value={palette} max={SCENE_PALETTE_MAX} />
            <label htmlFor="preset-lighting">光線（選填）</label>
            <textarea
              id="preset-lighting"
              value={lighting}
              maxLength={SCENE_LIGHTING_MAX}
              onChange={(e) => setLighting(e.target.value)}
              rows={2}
              placeholder="例：柔和晨光斜射、淺景深、35mm"
            />
            <CharCount value={lighting} max={SCENE_LIGHTING_MAX} />
            <label style={{ marginTop: 8 }}>場景參考圖（選填：上傳或從素材庫選）</label>
            <ReferenceImagePicker projectId={projectId} value={refImg} onChange={setRefImg} disabled={add.isPending} />
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="primary"
                disabled={!name.trim() || !palette.trim() || add.isPending || atProjectMax}
                onClick={() =>
                  add.mutate({
                    projectId,
                    name: name.trim(),
                    palette: palette.trim(),
                    lighting: lighting.trim() || undefined,
                    referenceAssetId: refImg?.id,
                    clientRequestId: requestId.current,
                  })
                }
              >
                {add.isPending ? "建立中…" : "建立場景"}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                取消
              </button>
            </div>
            {add.error && (
              <p className="error" role="alert">
                {add.error.message}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            style={{
              marginTop: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: atProjectMax ? 0.55 : 1,
              cursor: atProjectMax ? "not-allowed" : undefined,
            }}
            disabled={atProjectMax}
            title={atProjectMax ? `已達每專案 ${MAX_PROJECT_SCENE_PRESETS} 張上限` : undefined}
            onClick={() => {
              if (atProjectMax) return;
              setOpen(true);
            }}
          >
            <Icon name="Plus" />
            {atProjectMax ? `已達上限（${MAX_PROJECT_SCENE_PRESETS}）` : "新增場景設定"}
          </button>
        ))}
      {remove.error && (
        <p className="error" role="alert">
          {remove.error.message}
        </p>
      )}
      {update.error && !textEditId && (
        <p className="error" role="alert">
          更新失敗：{update.error.message}
        </p>
      )}
    </Card>
  );
}

function SceneTextEditor({
  name,
  palette,
  lighting,
  projectId,
  reference,
  pending,
  error,
  onSave,
  onCancel,
}: {
  name: string;
  palette: string;
  lighting: string;
  /** 參考圖挑選器要用（上傳／從本專案素材庫挑） */
  projectId: string;
  /** 目前綁定的參考圖；null＝還沒綁 */
  reference: ReferenceImage | null;
  pending: boolean;
  error?: string;
  onSave: (next: { name: string; palette: string; lighting: string; referenceAssetId: string | null }) => void;
  onCancel: () => void;
}) {
  const [n, setN] = useState(name);
  const [p, setP] = useState(palette);
  const [l, setL] = useState(lighting);
  /** 與角色卡同理（QA 2026-08-01 回報）：編輯表單先前沒有參考圖欄，看起來像這張卡不能配素材。 */
  const [ref, setRef] = useState<ReferenceImage | null>(reference);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const canSave = n.trim().length > 0 && p.trim().length > 0 && !pending;

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={editLabel}>場景名</label>
      <input ref={firstRef} value={n} maxLength={SCENE_NAME_MAX} disabled={pending} onChange={(e) => setN(e.target.value)} />
      <label style={editLabel}>色板</label>
      <textarea value={p} maxLength={SCENE_PALETTE_MAX} disabled={pending} rows={2} onChange={(e) => setP(e.target.value)} />
      <CharCount value={p} max={SCENE_PALETTE_MAX} />
      <label style={editLabel}>光線（選填）</label>
      <textarea value={l} maxLength={SCENE_LIGHTING_MAX} disabled={pending} rows={2} onChange={(e) => setL(e.target.value)} />
      <label style={editLabel}>場景參考圖（選填：上傳或從素材庫選）</label>
      <ReferenceImagePicker projectId={projectId} value={ref} onChange={setRef} disabled={pending} />
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          type="button"
          className="primary"
          disabled={!canSave}
          onClick={() =>
            onSave({ name: n.trim(), palette: p.trim(), lighting: l.trim(), referenceAssetId: ref?.id ?? null })
          }
        >
          {pending ? "儲存中…" : "儲存"}
        </button>
        <button type="button" disabled={pending} onClick={onCancel}>
          取消
        </button>
      </div>
      {error && (
        <p className="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}

const editLabel: CSSProperties = { fontSize: 11, margin: 0 };
