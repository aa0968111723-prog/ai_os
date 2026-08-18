/**
 * Shot Inspector：右欄不再是「教學文＋一大塊聊天框」，而是**這一鏡的屬性面板**。
 *
 * 六個分頁對應拍片時真的要決定的六件事：畫面、角色、攝影、聲音、AI、備註。
 * 分頁而不是一路往下捲，是因為這些欄位屬於不同工序——寫旁白的時候不需要看焦段。
 *
 * 全部欄位都接既有的 `scenes.update`／`scenes.setCards`，**沒有新的資料格式**：
 * camera／performance／lookIds／storySceneId 是 Story-first 那批既有欄位。
 * 存檔一律帶 `expectedRev`＋`baseline`（樂觀併發，見 shared/revision.ts），
 * 撞版本時顯示衝突卡而不是靜默覆蓋夥伴的字。
 */
import { useEffect, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import type { IconName } from "../../components/Icon";
import { Button, Chip, Hint, Meta } from "../../components/ui";
import { ConflictNotice, conflictFromError } from "../../components/ConflictNotice";
import type { RevisionConflict } from "@shared/revision";
import { SCRIPT_AMBIENCE_MAX, SCRIPT_TITLE_MAX, SCRIPT_VOICEOVER_MAX } from "@shared/storyboardScript";
import {
  SHOT_ANGLE_OPTIONS,
  SHOT_MOVEMENT_OPTIONS,
  SHOT_SIZE_OPTIONS,
  formatEnvironmentState,
  type ShotCamera,
  type ShotPerformance,
} from "@shared/story";
import type { StudioShot } from "./ShotStrip";
import { AiCopilotActions, type AiCopilotProps } from "./AiCopilotActions";

export type InspectorTab = "frame" | "cast" | "camera" | "sound" | "ai" | "notes";

const TABS: ReadonlyArray<{ id: InspectorTab; label: string; icon: IconName }> = [
  { id: "frame", label: "畫面", icon: "Image" },
  { id: "cast", label: "角色", icon: "Users" },
  { id: "camera", label: "攝影", icon: "Camera" },
  { id: "sound", label: "聲音", icon: "Volume2" },
  { id: "ai", label: "AI", icon: "Sparkles" },
  { id: "notes", label: "備註", icon: "FileText" },
];

/** listByProject 回來的那一列（比 StudioShot 多了 Inspector 要用的欄位） */
export interface InspectorShot extends StudioShot {
  action?: string | null;
  dialogue?: string | null;
  music?: string | null;
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
  storySceneId?: string | null;
  camera?: ShotCamera | null;
  performance?: ShotPerformance | null;
  lookIds?: string[] | null;
  rev?: number;
}

export interface ShotInspectorProps {
  projectId: string;
  projectFormat: string | null | undefined;
  shot: InspectorShot | null;
  shotNumber: number | null;
  canEdit: boolean;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  ai: AiCopilotProps;
}

export function ShotInspector({
  projectId,
  projectFormat,
  shot,
  shotNumber,
  canEdit,
  tab,
  onTabChange,
  collapsed,
  onToggleCollapsed,
  ai,
}: ShotInspectorProps) {
  if (collapsed) {
    return (
      <aside className="studio-inspector is-collapsed" aria-label="Shot Inspector（已收合）">
        <button type="button" className="studio-iconbtn" aria-label="展開 Shot Inspector" title="展開 Inspector" onClick={onToggleCollapsed}>
          <Icon name="ChevronRight" size={16} style={{ transform: "rotate(180deg)" }} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="studio-inspector" aria-label="Shot Inspector">
      <header className="studio-inspector__head">
        <strong className="studio-inspector__title">
          {shotNumber ? `Shot ${String(shotNumber).padStart(2, "0")}` : "未選分鏡"}
        </strong>
        {shot && <Meta as="span" className="studio-inspector__subtitle">{shot.title}</Meta>}
        <span style={{ flex: "1 1 auto" }} />
        <button type="button" className="studio-iconbtn" aria-label="收合 Shot Inspector" title="收合（畫布拿回空間）" onClick={onToggleCollapsed}>
          <Icon name="ChevronRight" size={16} />
        </button>
      </header>

      <div className="studio-inspector__tabs" role="tablist" aria-label="Shot 屬性分頁">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`studio-inspector__tab${tab === t.id ? " is-active" : ""}`}
            title={t.label}
            onClick={() => onTabChange(t.id)}
          >
            <Icon name={t.icon} size={14} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="studio-inspector__body" role="tabpanel">
        {tab === "ai" ? (
          <AiCopilotActions {...ai} />
        ) : !shot ? (
          <Hint>
            還沒選分鏡。白板上畫的東西會存成「自由塗鴉」——到下面的時間軸選一鏡，
            這裡就會變成那一鏡的屬性。
          </Hint>
        ) : (
          <ShotFields
            key={shot.id}
            projectId={projectId}
            projectFormat={projectFormat}
            shot={shot}
            canEdit={canEdit}
            tab={tab}
          />
        )}
      </div>
    </aside>
  );
}

/* ══ 欄位本體 ═══════════════════════════════════════════
 * key={shot.id} 讓切鏡時整塊重建：本地編輯中的草稿隨之丟棄。
 * 這是刻意的（沿用 StudioAiPanel 的既有決定）——保留它會讓人在第 3 鏡
 * 看到第 2 鏡沒存的字，比丟掉更難解釋。 */

function ShotFields({
  projectId,
  projectFormat,
  shot,
  canEdit,
  tab,
}: {
  projectId: string;
  projectFormat: string | null | undefined;
  shot: InspectorShot;
  canEdit: boolean;
  tab: InspectorTab;
}) {
  const utils = trpc.useUtils();
  const [conflict, setConflict] = useState<RevisionConflict | null>(null);
  const invalidate = () => { void utils.scenes.listByProject.invalidate({ projectId }); };

  const update = trpc.scenes.update.useMutation({
    onSuccess: () => { setConflict(null); invalidate(); },
    onError: (err) => setConflict(conflictFromError(err)),
  });
  const setCards = trpc.scenes.setCards.useMutation({ onSuccess: invalidate });

  /**
   * 存一個欄位。expectedRev＋baseline 讓伺服器分得出「我們改了同一欄」（問人）
   * 與「各改各的」（自動合併）——見 shared/revision.ts。
   */
  const saveField = (patch: Record<string, unknown>) => {
    const field = Object.keys(patch)[0]!;
    update.mutate({
      sceneId: shot.id,
      ...patch,
      expectedRev: shot.rev,
      baseline: { [field]: (shot as unknown as Record<string, unknown>)[field] ?? null },
    } as Parameters<typeof update.mutate>[0]);
  };

  const saveCamera = (field: keyof ShotCamera, value: string) => {
    const next: ShotCamera = { ...(shot.camera ?? {}), [field]: value.trim() || undefined };
    saveField({ camera: Object.values(next).some((v) => v) ? next : null });
  };
  const savePerformance = (field: keyof ShotPerformance, value: string) => {
    const next: ShotPerformance = { ...(shot.performance ?? {}), [field]: value.trim() || undefined };
    saveField({ performance: Object.values(next).some((v) => v) ? next : null });
  };

  const ro = !canEdit;

  return (
    <>
      {conflict && (
        <ConflictNotice
          conflict={conflict}
          onViewLatest={() => { setConflict(null); invalidate(); }}
        />
      )}
      {update.error && !conflict && <p className="error" role="alert">儲存失敗：{update.error.message}</p>}

      {tab === "frame" && <FrameTab shot={shot} projectId={projectId} projectFormat={projectFormat} ro={ro} saveField={saveField} saveCamera={saveCamera} />}
      {tab === "cast" && <CastTab shot={shot} projectId={projectId} ro={ro} setCards={setCards} saveField={saveField} />}
      {tab === "camera" && <CameraTab shot={shot} ro={ro} saveCamera={saveCamera} />}
      {tab === "sound" && <SoundTab shot={shot} ro={ro} saveField={saveField} />}
      {tab === "notes" && <NotesTab shot={shot} ro={ro} saveField={saveField} savePerformance={savePerformance} />}
    </>
  );
}

/* ── 畫面 ─────────────────────────────────────────────── */
function FrameTab({
  shot,
  projectId,
  projectFormat,
  ro,
  saveField,
  saveCamera,
}: {
  shot: InspectorShot;
  projectId: string;
  projectFormat: string | null | undefined;
  ro: boolean;
  saveField: (patch: Record<string, unknown>) => void;
  saveCamera: (field: keyof ShotCamera, value: string) => void;
}) {
  // 場（story_scenes）：這一鏡在哪一場戲；環境狀態由場繼承下來，這裡唯讀顯示
  const scenes = trpc.story.scenesList.useQuery({ projectId });
  const scene = shot.storySceneId ? scenes.data?.find((s) => s.id === shot.storySceneId) : null;
  const envText = scene ? formatEnvironmentState(scene.environment) : "";

  return (
    <div className="studio-fields">
      <Field label="標題">
        <input
          key={`title-${shot.id}-${shot.title}`}
          defaultValue={shot.title}
          maxLength={SCRIPT_TITLE_MAX}
          readOnly={ro}
          onBlur={(e) => { const v = e.target.value.trim(); if (!ro && v && v !== shot.title) saveField({ title: v }); }}
        />
      </Field>

      <div className="studio-fields__row">
        <Field label="秒數" compact>
          <input
            key={`dur-${shot.id}-${shot.durationSec}`}
            type="number"
            min={1}
            max={60}
            defaultValue={shot.durationSec}
            readOnly={ro}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (!ro && Number.isInteger(v) && v >= 1 && v <= 60 && v !== shot.durationSec) saveField({ durationSec: v });
            }}
          />
        </Field>
        <Field label="景別" compact>
          <select value={shot.camera?.shotSize ?? ""} disabled={ro} onChange={(e) => saveCamera("shotSize", e.target.value)}>
            <option value="">（未定）</option>
            {SHOT_SIZE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="比例" compact>
          <output className="studio-fields__readonly">{projectFormat ?? "—"}</output>
        </Field>
      </div>

      <Field label="場景">
        {scene ? (
          <output className="studio-fields__readonly">
            {scene.title || "（未命名的場）"}
            {envText && <Meta as="span" style={{ marginLeft: 6 }}>{envText}</Meta>}
          </output>
        ) : (
          <output className="studio-fields__readonly studio-fields__readonly--muted">
            未分場——到專案頁的「② 分鏡」可以把這一鏡歸到某一場
          </output>
        )}
      </Field>

      <Field label="畫面描述（生成提示詞）" hint="這一鏡要看到什麼：主體、構圖、光線、氣氛。動作走位寫在「備註」。">
        <textarea
          key={`prompt-${shot.id}-${shot.prompt ?? ""}`}
          rows={6}
          defaultValue={shot.prompt ?? ""}
          readOnly={ro}
          placeholder="例：清晨的禪堂空景，柔和晨光斜射，留白構圖"
          onBlur={(e) => { if (!ro && e.target.value !== (shot.prompt ?? "")) saveField({ prompt: e.target.value }); }}
        />
      </Field>
    </div>
  );
}

/* ── 角色 ─────────────────────────────────────────────── */
function CastTab({
  shot,
  projectId,
  ro,
  setCards,
  saveField,
}: {
  shot: InspectorShot;
  projectId: string;
  ro: boolean;
  setCards: ReturnType<typeof trpc.scenes.setCards.useMutation>;
  saveField: (patch: Record<string, unknown>) => void;
}) {
  const characters = trpc.characters.list.useQuery({ projectId });
  const looks = trpc.characterLooks.list.useQuery({ projectId });
  const bound = shot.characterIds ?? [];
  const boundLooks = shot.lookIds ?? [];

  const toggleChar = (id: string) => {
    const next = bound.includes(id) ? bound.filter((x) => x !== id) : [...bound, id];
    // 伺服器會再清一次孤兒造型；這裡一併送 lookIds，避免分頁關掉時只寫到角色列。
    const nextLooks = boundLooks.filter((lookId) => {
      const look = (looks.data ?? []).find((row: { id: string; characterId: string }) => row.id === lookId);
      return look ? next.includes(look.characterId) : false;
    });
    setCards.mutate({ sceneId: shot.id, characterIds: next, lookIds: nextLooks });
  };
  const toggleLook = (id: string) => {
    const next = boundLooks.includes(id) ? boundLooks.filter((x) => x !== id) : [...boundLooks, id];
    saveField({ lookIds: next });
  };

  const availableLooks = (looks.data ?? []).filter((l: { characterId: string }) => bound.includes(l.characterId));

  return (
    <div className="studio-fields">
      <Field label="這一鏡有誰" hint="勾了角色，生成時會自動帶上他的外觀錨點——跨鏡不走樣。">
        {characters.isLoading && <Meta>載入中…</Meta>}
        {characters.data?.length === 0 && (
          <Hint>這個專案還沒有角色卡。到專案頁的「專案設定 → 角色與定裝」建一張，或讓 AI 解析故事自動建立。</Hint>
        )}
        <div className="studio-chips">
          {(characters.data ?? []).map((c: { id: string; name: string }) => (
            <Chip key={c.id} selected={bound.includes(c.id)} onClick={ro ? undefined : () => toggleChar(c.id)}>
              {c.name}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="造型" hint="同一個角色在不同時期的樣子（例：短髮時期）。沒勾＝用角色的預設外觀。">
        {bound.length === 0 ? (
          <Meta>先勾角色，才會列出他的造型。</Meta>
        ) : availableLooks.length === 0 ? (
          <Meta>這些角色還沒有造型卡。</Meta>
        ) : (
          <div className="studio-chips">
            {availableLooks.map((l: { id: string; name: string }) => (
              <Chip key={l.id} selected={boundLooks.includes(l.id)} onClick={ro ? undefined : () => toggleLook(l.id)}>
                {l.name}
              </Chip>
            ))}
          </div>
        )}
      </Field>

      {setCards.error && <p className="error" role="alert">{setCards.error.message}</p>}
    </div>
  );
}

/* ── 攝影 ─────────────────────────────────────────────── */
function CameraTab({
  shot,
  ro,
  saveCamera,
}: {
  shot: InspectorShot;
  ro: boolean;
  saveCamera: (field: keyof ShotCamera, value: string) => void;
}) {
  const cam = shot.camera ?? {};
  return (
    <div className="studio-fields">
      <div className="studio-fields__row">
        <Field label="景別" compact>
          <select value={cam.shotSize ?? ""} disabled={ro} onChange={(e) => saveCamera("shotSize", e.target.value)}>
            <option value="">（未定）</option>
            {SHOT_SIZE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="角度" compact>
          <select value={cam.angle ?? ""} disabled={ro} onChange={(e) => saveCamera("angle", e.target.value)}>
            <option value="">（未定）</option>
            {SHOT_ANGLE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      </div>
      <div className="studio-fields__row">
        <Field label="運鏡" compact>
          <select value={cam.movement ?? ""} disabled={ro} onChange={(e) => saveCamera("movement", e.target.value)}>
            <option value="">（未定）</option>
            {SHOT_MOVEMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="焦段" compact>
          <input
            key={`focal-${shot.id}-${cam.focalLength ?? ""}`}
            defaultValue={cam.focalLength ?? ""}
            placeholder="35mm"
            maxLength={20}
            readOnly={ro}
            onBlur={(e) => saveCamera("focalLength", e.target.value)}
          />
        </Field>
      </div>
      <Field label="光線">
        <input
          key={`light-${shot.id}-${cam.lighting ?? ""}`}
          defaultValue={cam.lighting ?? ""}
          placeholder="逆光、柔光、燭光…"
          maxLength={60}
          readOnly={ro}
          onBlur={(e) => saveCamera("lighting", e.target.value)}
        />
      </Field>
      <Field label="構圖">
        <input
          key={`comp-${shot.id}-${cam.composition ?? ""}`}
          defaultValue={cam.composition ?? ""}
          placeholder="三分法、中心對稱、留白…"
          maxLength={60}
          readOnly={ro}
          onBlur={(e) => saveCamera("composition", e.target.value)}
        />
      </Field>
      <Hint>這些會在生成時一起送進模型（見分鏡的 Shot Context）。填了才有效果，留白就不影響。</Hint>
    </div>
  );
}

/* ── 聲音 ─────────────────────────────────────────────── */
function SoundTab({
  shot,
  ro,
  saveField,
}: {
  shot: InspectorShot;
  ro: boolean;
  saveField: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="studio-fields">
      <Field label="對白" hint="「@角色名：台詞」一行一句；旁白用 @旁白。">
        <textarea
          key={`dialogue-${shot.id}-${shot.dialogue ?? ""}`}
          rows={3}
          defaultValue={shot.dialogue ?? ""}
          readOnly={ro}
          placeholder="@師父：坐吧。"
          onBlur={(e) => { if (!ro && e.target.value !== (shot.dialogue ?? "")) saveField({ dialogue: e.target.value }); }}
        />
      </Field>
      <Field label="旁白">
        <textarea
          key={`vo-${shot.id}-${shot.voiceover ?? ""}`}
          rows={3}
          defaultValue={shot.voiceover ?? ""}
          maxLength={SCRIPT_VOICEOVER_MAX}
          readOnly={ro}
          onBlur={(e) => { if (!ro && e.target.value !== (shot.voiceover ?? "")) saveField({ voiceover: e.target.value }); }}
        />
      </Field>
      <Field label="環境音" hint="寫的是聲音本身、不是台詞。要生成音效請到分鏡的單格工作室。">
        <textarea
          key={`amb-${shot.id}-${shot.ambience ?? ""}`}
          rows={2}
          defaultValue={shot.ambience ?? ""}
          maxLength={SCRIPT_AMBIENCE_MAX}
          readOnly={ro}
          placeholder="遠處鐘聲，細微鳥鳴"
          onBlur={(e) => { if (!ro && e.target.value !== (shot.ambience ?? "")) saveField({ ambience: e.target.value }); }}
        />
      </Field>
      <Field label="配樂標記" hint="「起｜描述」開始一段配樂，「止」結束——區間由相鄰鏡自動推導。">
        <input
          key={`music-${shot.id}-${shot.music ?? ""}`}
          defaultValue={shot.music ?? ""}
          readOnly={ro}
          placeholder="起｜溫暖的鋼琴"
          onBlur={(e) => { if (!ro && e.target.value !== (shot.music ?? "")) saveField({ music: e.target.value }); }}
        />
      </Field>
    </div>
  );
}

/* ── 備註（走位與表演）────────────────────────────────── */
function NotesTab({
  shot,
  ro,
  saveField,
  savePerformance,
}: {
  shot: InspectorShot;
  ro: boolean;
  saveField: (patch: Record<string, unknown>) => void;
  savePerformance: (field: keyof ShotPerformance, value: string) => void;
}) {
  return (
    <div className="studio-fields">
      <Field label="動作走位" hint="誰做了什麼、從哪走到哪。與畫面描述分開——單張圖畫不出「走過去」。">
        <textarea
          key={`action-${shot.id}-${shot.action ?? ""}`}
          rows={3}
          defaultValue={shot.action ?? ""}
          readOnly={ro}
          placeholder="安倢從門口走到窗邊，停下"
          onBlur={(e) => { if (!ro && e.target.value !== (shot.action ?? "")) saveField({ action: e.target.value }); }}
        />
      </Field>
      <div className="studio-fields__row">
        <Field label="表情" compact>
          <input
            key={`emo-${shot.id}-${shot.performance?.emotion ?? ""}`}
            defaultValue={shot.performance?.emotion ?? ""}
            placeholder="若有所思"
            maxLength={60}
            readOnly={ro}
            onBlur={(e) => savePerformance("emotion", e.target.value)}
          />
        </Field>
        <Field label="視線" compact>
          <input
            key={`gaze-${shot.id}-${shot.performance?.gaze ?? ""}`}
            defaultValue={shot.performance?.gaze ?? ""}
            placeholder="看向遠方"
            maxLength={60}
            readOnly={ro}
            onBlur={(e) => savePerformance("gaze", e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

/* ── 欄位外框：Property Label / Property Value 的字級層級在這裡定調 ── */
function Field({
  label,
  hint,
  compact,
  children,
}: {
  label: string;
  hint?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`studio-field${compact ? " is-compact" : ""}`}>
      <span className="studio-field__label">{label}</span>
      {children}
      {hint && <Meta as="small" className="studio-field__hint">{hint}</Meta>}
    </label>
  );
}
