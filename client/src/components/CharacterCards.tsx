import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CHAR_APPEARANCE_MAX,
  CHAR_NAME_MAX,
  CHAR_NOTES_MAX,
  MAX_GENERATE_CHARACTERS,
  MAX_PROJECT_CHARACTERS,
} from "@shared/cardLimits";
import { characterHasLiveSheet, selectableBringInIds } from "@shared/studioReferenceImage";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { CharCount, ConfirmButton } from "./interactions";
import { ReferenceImagePicker, type ReferenceImage } from "./ReferenceImagePicker";
import { AssetImg } from "./MediaFallback";
import { Button, Card, EmptyState, Hint, Meta, Skeleton } from "./ui";
import { EntityImpactHint } from "./EntityImpactHint";

export { MAX_GENERATE_CHARACTERS };

/**
 * 角色定裝卡（提案核心「角色一致性」）：
 * 角色外觀設定一次鎖定，生成時勾選 → 自動注入錨點，跨鏡頭不走樣。
 * readOnly（檢視者）：隱藏新增／刪除／編輯／設參考圖。
 */
export function CharacterCards({
  projectId,
  selectedIds,
  onToggle,
  readOnly = false,
  maxSelect = MAX_GENERATE_CHARACTERS,
  onCreated,
}: {
  projectId: string;
  selectedIds: string[];
  onToggle: (id: string) => void;
  readOnly?: boolean;
  /** 生成時最多帶入幾張（與後端 max 對齊） */
  maxSelect?: number;
  /** 新建成功回呼（父層可自動勾選） */
  onCreated?: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.characters.list.useQuery({ projectId });
  // Phase C：角色卡一鍵發布到靈感頻道
  const publish = trpc.community.publishFromSource.useMutation({
    onSuccess: () => utils.community.invalidate(),
  });
  const [publishState, setPublishState] = useState<{ id: string; ok: boolean; msg?: string } | null>(null);
  const flashPublish = (id: string, ok: boolean, msg?: string) => {
    setPublishState({ id, ok, msg });
    setTimeout(() => setPublishState((s) => (s && s.id === id ? null : s)), 2000);
  };
  // 冪等鍵（QA-003）：同一張「還沒建成功」的卡重試沿用同鍵——timeout 後再按不會建出重複卡
  const requestId = useRef<string>(crypto.randomUUID());
  const add = trpc.characters.add.useMutation({
    onSuccess: (row) => {
      requestId.current = crypto.randomUUID();
      utils.characters.list.invalidate({ projectId });
      setName("");
      setAppearance("");
      setNotes("");
      setRefImg(null);
      setOpen(false);
      if (row?.id && characterHasLiveSheet(row)) onCreated?.(row.id);
    },
  });
  const remove = trpc.characters.remove.useMutation({
    onSuccess: () => utils.characters.list.invalidate({ projectId }),
  });
  const update = trpc.characters.update.useMutation({
    onSuccess: () => {
      utils.characters.list.invalidate({ projectId });
      setRefEditId(null);
      setTextEditId(null);
    },
  });
  const generateSheet = trpc.characters.generateSheet.useMutation();
  const honorSheet = trpc.characters.honorGeneratedSheet.useMutation({
    onSuccess: () => utils.characters.list.invalidate({ projectId }),
  });
  const [pendingSheet, setPendingSheet] = useState<{ characterId: string; generationId: string } | null>(null);
  const honoringSheet = useRef(false);
  const sheetStatus = trpc.generation.status.useQuery(
    { id: pendingSheet?.generationId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(pendingSheet), refetchInterval: pendingSheet ? 3_000 : false },
  );
  useEffect(() => {
    if (!pendingSheet || sheetStatus.data?.status !== "done" || honoringSheet.current) return;
    honoringSheet.current = true;
    honorSheet.mutate(pendingSheet, {
      onSettled: () => {
        honoringSheet.current = false;
      },
      onSuccess: () => setPendingSheet(null),
    });
  }, [honorSheet, pendingSheet, sheetStatus.data?.status]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [appearance, setAppearance] = useState("");
  const [notes, setNotes] = useState("");
  const [refImg, setRefImg] = useState<ReferenceImage | null>(null);
  const [refEditId, setRefEditId] = useState<string | null>(null);
  /** 正在就地編輯文字欄的卡 id */
  const [textEditId, setTextEditId] = useState<string | null>(null);
  const bringInIds = useMemo(
    () => (list.data ? selectableBringInIds(list.data, selectedIds, maxSelect) : selectedIds.slice(0, maxSelect)),
    [list.data, selectedIds, maxSelect],
  );
  const atSelectMax = bringInIds.length >= maxSelect;
  const cardCount = list.data?.length ?? 0;
  const atProjectMax = cardCount >= MAX_PROJECT_CHARACTERS;

  return (
    <Card as="section" data-fb="角色定裝卡">
      <h2>角色定裝卡（跨鏡一致）</h2>
      <Hint>
        設定角色外觀一次鎖定；生成時勾選（需有該角色自己的定裝參考圖），AI 自動帶入外觀，跨鏡頭不走樣。可綁定裝參考圖。未設參考圖只靠文字錨點，已選保持 0/6。
        外觀前段會注入畫面生成（過長會自動截短）；個性只給導演／助手，不會畫進畫面。
        {list.data && list.data.length > 0 && (
          <>
            {" "}
            · 已選 {bringInIds.length}/{maxSelect}
            {atSelectMax ? "（已達上限）" : ""}
            {" · "}共 {cardCount}/{MAX_PROJECT_CHARACTERS} 張
          </>
        )}
      </Hint>

      {list.isLoading ? (
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          <Skeleton style={{ height: 104 }} />
          <Skeleton style={{ height: 104 }} />
        </div>
      ) : list.isError ? (
        <p className="error" role="alert" style={{ marginTop: 8 }}>
          角色清單暫時載入不了（不是資料不見了）——
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => list.refetch()}>
            再試一次
          </Button>
        </p>
      ) : list.data && list.data.length > 0 ? (
        <div className="asset-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {list.data.map((c) => {
            const hasOwnSheet = characterHasLiveSheet(c);
            const on = bringInIds.includes(c.id);
            const selectDisabled = !on && (atSelectMax || !hasOwnSheet);
            const refTrashed = Boolean(c.referenceAssetId && !c.referenceUrl);
            const editingText = textEditId === c.id;
            return (
              <div
                key={c.id}
                className="asset-cell"
                style={{
                  padding: "var(--sp-12)",
                  boxShadow: on ? "inset 0 0 0 2px var(--primary)" : undefined,
                  transition: "box-shadow var(--dur-fast)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>
                    {c.name}
                  </strong>
                  <label
                    style={{
                      fontSize: "var(--fs-12)",
                      display: "flex",
                      gap: 4,
                      alignItems: "center",
                      flexShrink: 0,
                      cursor: selectDisabled ? "not-allowed" : "pointer",
                      opacity: selectDisabled ? 0.55 : 1,
                    }}
                    title={
                      !hasOwnSheet
                        ? "沒有定裝參考圖——先設參考圖。未設則只靠文字錨點（粉橘短髮女孩、白帽T）"
                        : selectDisabled
                          ? `最多帶入 ${maxSelect} 個角色定裝——先取消其他勾選`
                          : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={selectDisabled}
                      onChange={() => {
                        if (selectDisabled || !hasOwnSheet) return;
                        onToggle(c.id);
                      }}
                    />{" "}
                    生成時帶入
                  </label>
                </div>

                {c.referenceUrl && (
                  <AssetImg
                    src={c.referenceUrl}
                    alt={`${c.name} 的定裝參考圖`}
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
                  <Meta as="div" role="status" style={{ fontSize: "var(--fs-11)", marginTop: 6, color: "var(--danger-ink)" }}>
                    參考圖已在回收桶（綁定仍在）——可清除綁定，或先還原素材
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        style={{ marginLeft: 6, fontSize: "var(--fs-11)" }}
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: c.id, referenceAssetId: null })}
                      >
                        清除綁定
                      </Button>
                    )}
                  </Meta>
                )}

                {editingText && !readOnly ? (
                  <CardTextEditor
                    name={c.name}
                    appearance={c.appearance}
                    notes={c.notes ?? ""}
                    projectId={projectId}
                    entityId={c.id}
                    reference={
                      c.referenceAssetId && c.referenceUrl
                        ? { id: c.referenceAssetId, url: c.referenceUrl, title: "定裝參考圖" }
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
                        id: c.id,
                        name: next.name,
                        appearance: next.appearance,
                        notes: next.notes || null,
                        referenceAssetId: next.referenceAssetId,
                      })
                    }
                  />
                ) : (
                  <>
                    <Meta
                      as="div"
                      title={c.appearance}
                      style={{
                        fontSize: "var(--fs-12)",
                        marginTop: "var(--sp-4)",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      <Icon name="User" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                      {c.appearance}
                    </Meta>
                    {c.notes && (
                      <Meta
                        as="div"
                        title={c.notes}
                        style={{
                          fontSize: "var(--fs-11)",
                          marginTop: 3,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        <Icon name="FileText" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                        {c.notes}
                      </Meta>
                    )}
                  </>
                )}

                {!readOnly && !editingText && (
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <Button
                      variant="ghost"
                      style={{ fontSize: "var(--fs-11)" }}
                      onClick={() => {
                        setTextEditId(c.id);
                        setRefEditId(null);
                      }}
                    >
                      <Icon name="Pencil" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      編輯
                    </Button>
                    {refEditId === c.id ? (
                      <div style={{ flexBasis: "100%" }}>
                        <ReferenceImagePicker
                          projectId={projectId}
                          value={
                            c.referenceAssetId && c.referenceUrl
                              ? { id: c.referenceAssetId, url: c.referenceUrl, title: "定裝參考圖" }
                              : null
                          }
                          onChange={(next) => update.mutate({ id: c.id, referenceAssetId: next?.id ?? null })}
                          disabled={update.isPending}
                        />
                        <Button variant="ghost" style={{ marginTop: 4, fontSize: "var(--fs-11)" }} onClick={() => setRefEditId(null)}>
                          收起
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        style={{ fontSize: "var(--fs-11)" }}
                        title="綁一張定裝參考圖：上傳或從素材庫選。跨鏡比對有依據；選「圖生圖／參考圖」類模型又沒挑來源時，會自動拿它當來源圖"
                        onClick={() => {
                          setRefEditId(c.id);
                          setTextEditId(null);
                        }}
                      >
                        <Icon name="Image" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                        {c.referenceUrl ? "換參考圖" : refTrashed ? "重設參考圖" : "設參考圖"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      style={{ fontSize: "var(--fs-11)" }}
                      title="用便宜生圖做一張定裝參考圖（FLUX schnell，不用 Veo）。完成後才能勾成 1/6。"
                      disabled={generateSheet.isPending || pendingSheet?.characterId === c.id}
                      onClick={() =>
                        generateSheet.mutate(
                          { characterId: c.id, clientRequestId: crypto.randomUUID() },
                          {
                            onSuccess: (row) =>
                              setPendingSheet({ characterId: row.characterId, generationId: row.generationId }),
                          },
                        )
                      }
                    >
                      <Icon name="Sparkles" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      {pendingSheet?.characterId === c.id ? "定裝生成中…" : "生成定裝"}
                    </Button>
                    <Button
                      variant="ghost"
                      style={{ fontSize: "var(--fs-11)" }}
                      title="發布到全站靈感頻道"
                      disabled={publish.isPending}
                      onClick={() => {
                        publish.mutate(
                          { sourceType: "character", sourceId: c.id },
                          {
                            onSuccess: () => flashPublish(c.id, true),
                            onError: (e) => flashPublish(c.id, false, e.message),
                          },
                        );
                      }}
                    >
                      {publishState?.id === c.id
                        ? publishState.ok
                          ? "已發布 ✓"
                          : "發布失敗"
                        : "發布"}
                    </Button>
                    <ConfirmButton
                      onConfirm={() => remove.mutate({ id: c.id })}
                      message={`刪除角色「${c.name}」？刪後生成勾選會自動清掉。`}
                      triggerClassName="btn-ghost"
                      triggerStyle={{ color: "var(--danger-ink)", fontSize: "var(--fs-11)" }}
                      disabled={remove.isPending}
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
        <EmptyState
          title="還沒有角色"
          description="加一張定裝卡（例：安倢＝紅傘、米白外套、帆布包、溫柔回望）。"
          /* 範例本來只寫在說明裡、要自己打一次。EmptyState 收 action 就是為了
             「不要死路」——直接建出這張範例卡，建完再改比從零想快得多。 */
          action={
            readOnly ? undefined : (
              <Button
                variant="tonal"
                disabled={add.isPending || atProjectMax}
                onClick={() =>
                  add.mutate({
                    projectId,
                    name: "安倢",
                    appearance: "紅色雨傘、米白外套、帆布包、無眼鏡、溫柔回望",
                    notes: "由範例建立，可再改",
                    clientRequestId: requestId.current,
                  })
                }
              >
                {add.isPending ? "建立中…" : "帶入這張範例卡"}
              </Button>
            )
          }
        />
      )}

      {!readOnly &&
        (open ? (
          <div style={{ marginTop: "var(--sp-12)", borderTop: "1px solid var(--border-soft)", paddingTop: "var(--sp-12)" }}>
            <label htmlFor="char-name">角色名</label>
            <input
              id="char-name"
              value={name}
              maxLength={CHAR_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：安倢"
              autoComplete="off"
            />
            <CharCount value={name} max={CHAR_NAME_MAX} />
            <label htmlFor="char-appearance">外觀（會注入生成，越具體越一致）</label>
            <textarea
              id="char-appearance"
              value={appearance}
              maxLength={CHAR_APPEARANCE_MAX}
              onChange={(e) => setAppearance(e.target.value)}
              rows={3}
              placeholder="例：紅色雨傘、米白外套、帆布包、無眼鏡、溫柔回望"
            />
            <CharCount value={appearance} max={CHAR_APPEARANCE_MAX} />
            <label htmlFor="char-notes">個性・語氣・關係（選填，供 AI 導演參考，不畫進畫面）</label>
            <textarea
              id="char-notes"
              value={notes}
              maxLength={CHAR_NOTES_MAX}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="例：安靜溫柔，與慕恩是同社團學姐"
            />
            <CharCount value={notes} max={CHAR_NOTES_MAX} />
            <label style={{ marginTop: 8 }}>定裝參考圖（選填：上傳或從素材庫選）</label>
            <ReferenceImagePicker projectId={projectId} value={refImg} onChange={setRefImg} disabled={add.isPending} />
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="primary"
                disabled={!name.trim() || !appearance.trim() || add.isPending || atProjectMax}
                onClick={() =>
                  add.mutate({
                    projectId,
                    name: name.trim(),
                    appearance: appearance.trim(),
                    notes: notes.trim() || undefined,
                    referenceAssetId: refImg?.id,
                    clientRequestId: requestId.current,
                  })
                }
              >
                {add.isPending ? "建立中…" : "建立角色"}
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
              marginTop: "var(--sp-12)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: atProjectMax ? 0.55 : 1,
              cursor: atProjectMax ? "not-allowed" : undefined,
            }}
            disabled={atProjectMax}
            title={atProjectMax ? `已達每專案 ${MAX_PROJECT_CHARACTERS} 張上限` : undefined}
            onClick={() => {
              if (atProjectMax) return;
              setOpen(true);
            }}
          >
            <Icon name="Plus" size={14} />
            {atProjectMax ? `已達上限（${MAX_PROJECT_CHARACTERS}）` : "新增角色定裝"}
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
      {generateSheet.error && (
        <p className="error" role="alert">
          定裝生成失敗：{generateSheet.error.message}
        </p>
      )}
      {publishState && !publishState.ok && publishState.msg && (
        <p className="error" role="alert" style={{ fontSize: "var(--fs-12)" }}>
          {publishState.msg}
        </p>
      )}
    </Card>
  );
}

/** 就地編輯：名稱／外觀／個性，失焦不自動存——明確按儲存，避免半打字就送出 */
function CardTextEditor({
  name,
  appearance,
  notes,
  projectId,
  entityId,
  reference,
  pending,
  error,
  onSave,
  onCancel,
}: {
  name: string;
  appearance: string;
  notes: string;
  /** 參考圖挑選器要用（上傳／從本專案素材庫挑） */
  projectId: string;
  /** 這張卡的 id：查「改了會影響哪幾鏡」；新增中的卡還沒有 id，就不顯示影響 */
  entityId?: string;
  /** 目前綁定的參考圖；null＝還沒綁 */
  reference: ReferenceImage | null;
  pending: boolean;
  error?: string;
  onSave: (next: { name: string; appearance: string; notes: string; referenceAssetId: string | null }) => void;
  onCancel: () => void;
}) {
  const [n, setN] = useState(name);
  const [a, setA] = useState(appearance);
  const [note, setNote] = useState(notes);
  /**
   * 參考圖在編輯表單裡就能改（QA 2026-08-01 回報）：先前這張表單只有三個文字欄位，
   * 使用者以為這張卡不能配素材——參考圖得先取消編輯、再去按另一顆「設參考圖」才找得到。
   * 新增卡片的表單本來就有這一欄，兩邊不一致本身就是誤導。
   */
  const [ref, setRef] = useState<ReferenceImage | null>(reference);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const canSave = n.trim().length > 0 && a.trim().length > 0 && !pending;

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={editLabel}>角色名</label>
      <input ref={firstRef} value={n} maxLength={CHAR_NAME_MAX} disabled={pending} onChange={(e) => setN(e.target.value)} />
      <label style={editLabel}>外觀</label>
      <textarea value={a} maxLength={CHAR_APPEARANCE_MAX} disabled={pending} rows={3} onChange={(e) => setA(e.target.value)} />
      <CharCount value={a} max={CHAR_APPEARANCE_MAX} />
      <label style={editLabel}>個性・備註（選填）</label>
      <textarea value={note} maxLength={CHAR_NOTES_MAX} disabled={pending} rows={2} onChange={(e) => setNote(e.target.value)} />
      <label style={editLabel}>定裝參考圖（選填：上傳或從素材庫選）</label>
      <ReferenceImagePicker projectId={projectId} value={ref} onChange={setRef} disabled={pending} />
      {entityId && <EntityImpactHint projectId={projectId} kind="character" entityId={entityId} />}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          type="button"
          className="primary"
          disabled={!canSave}
          onClick={() =>
            onSave({ name: n.trim(), appearance: a.trim(), notes: note.trim(), referenceAssetId: ref?.id ?? null })
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

const editLabel: CSSProperties = { fontSize: "var(--fs-11)", margin: 0 };
