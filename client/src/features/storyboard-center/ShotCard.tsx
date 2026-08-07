/**
 * 分鏡卡（Shot Card；PE 計畫 §10）：創作、資料引用與生成行為在同一個上下文完成。
 * 區塊：Preview（現用畫面）｜Narrative（畫面/台詞/旁白）｜World Refs（角色/場景/道具/造型）｜
 * Direction（鏡別…專業模式全開）｜Performance（表情/視線）｜Generation 入口（單格工作室）。
 * Shot 只存自己獨有的 Override——共用資料一律引用（卡片綁定），不複製。
 */
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { ConfirmButton } from "../../components/interactions";
import { SceneCardBinding } from "../../components/SceneCardBinding";
import { AssetImg } from "../../components/MediaFallback";
import { Button, Card, Chip, Meta, Pill } from "../../components/ui";
import {
  SHOT_ANGLE_OPTIONS,
  SHOT_MOVEMENT_OPTIONS,
  SHOT_SIZE_OPTIONS,
  type ShotCamera,
  type ShotPerformance,
} from "@shared/story";
import type { BoardMode } from "./boardPrefs";

export interface ShotRow {
  id: string;
  title: string;
  orderIndex: number;
  durationSec: number;
  status: string;
  prompt: string | null;
  action: string | null;
  dialogue: string | null;
  voiceover: string | null;
  assetUrl: string | null;
  assetKind: string | null;
  characterIds: string[] | null;
  scenePresetIds: string[] | null;
  propIds: string[] | null;
  storySceneId: string | null;
  camera: ShotCamera | null;
  performance: ShotPerformance | null;
  lookIds: string[] | null;
  pendingGenStatus: "queued" | "running" | "awaiting_approval" | null;
}

export interface LookRow {
  id: string;
  characterId: string;
  name: string;
}

export function ShotCard({
  projectId,
  shot,
  shotNumber,
  canEdit,
  mode,
  looks,
  characterNames,
  outdatedReason,
  onOpenStudio,
}: {
  projectId: string;
  shot: ShotRow;
  /** 全片第幾鏡（1 起算；與交付區同一套序號） */
  shotNumber: number;
  canEdit: boolean;
  mode: BoardMode;
  /** 專案全部造型（依 characterId 過濾出本鏡可選的） */
  looks: LookRow[];
  characterNames: Map<string, string>;
  /** 這一鏡的畫面已經跟卡片對不上的原因（§23）；空＝沒過時 */
  outdatedReason?: string;
  onOpenStudio: (sceneId: string) => void;
}) {
  const utils = trpc.useUtils();
  const update = trpc.scenes.update.useMutation({
    onSuccess: () => utils.scenes.listByProject.invalidate({ projectId }),
  });
  const removeShot = trpc.scenes.remove.useMutation({
    onSuccess: () => utils.scenes.listByProject.invalidate({ projectId }),
  });

  const saveField = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch);
  const saveCamera = (field: keyof ShotCamera, value: string) => {
    const next: ShotCamera = { ...(shot.camera ?? {}), [field]: value.trim() || undefined };
    update.mutate({ sceneId: shot.id, camera: next });
  };
  const savePerformance = (field: keyof ShotPerformance, value: string) => {
    const next: ShotPerformance = { ...(shot.performance ?? {}), [field]: value.trim() || undefined };
    update.mutate({ sceneId: shot.id, performance: next });
  };

  /** 本鏡可選造型＝綁定角色名下的造型；沒綁角色就沒得選（造型跟人走） */
  const availableLooks = looks.filter((l) => (shot.characterIds ?? []).includes(l.characterId));
  const toggleLook = (lookId: string) => {
    const cur = shot.lookIds ?? [];
    const next = cur.includes(lookId) ? cur.filter((x) => x !== lookId) : [...cur, lookId];
    update.mutate({ sceneId: shot.id, lookIds: next });
  };

  const generating = shot.pendingGenStatus === "queued" || shot.pendingGenStatus === "running";

  /**
   * §13 相關素材：只在專業模式查（簡單模式不顯示，就不必打這支）。
   * 這不是語意檢索——是拿這一鏡綁定的角色／場景／道具名字比對素材標題與標籤，
   * 所以文案寫「名稱或標籤對得上」，不寫「AI 已為你分析」。
   */
  const assetSuggest = trpc.story.shotAssetSuggestions.useQuery(
    { sceneId: shot.id },
    { enabled: mode === "pro", staleTime: 60_000 },
  );
  const assetHints = assetSuggest.data?.items ?? [];

  return (
    <Card as="article" className="shot-card" id={`board-shot-${shot.id}`} data-fb="分鏡卡">
      <div className="shot-card__head">
        <span className="shot-card__num">#{shotNumber}</span>
        <input
          key={`title-${shot.id}-${shot.title}`}
          className="shot-card__title"
          aria-label={`第 ${shotNumber} 鏡標題`}
          defaultValue={shot.title}
          readOnly={!canEdit}
          maxLength={60}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (canEdit && v && v !== shot.title) saveField({ sceneId: shot.id, title: v });
          }}
        />
        <label className="shot-card__dur">
          <input
            key={`dur-${shot.id}-${shot.durationSec}`}
            type="number"
            min={1}
            max={60}
            defaultValue={shot.durationSec}
            readOnly={!canEdit}
            aria-label="秒數"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (canEdit && Number.isInteger(v) && v >= 1 && v <= 60 && v !== shot.durationSec) {
                saveField({ sceneId: shot.id, durationSec: v });
              }
            }}
          />
          秒
        </label>
        {generating && <Pill status="running">生成中</Pill>}
        {shot.pendingGenStatus === "awaiting_approval" && <Pill status="queued">待核價</Pill>}
        {outdatedReason && <Pill status="failed">畫面過時</Pill>}
      </div>

      {/* §23：卡片改過、這張圖還是舊的。不自動重畫——講清楚原因，讓使用者決定要不要花點數重生成 */}
      {outdatedReason && (
        <Meta as="p" role="status" className="shot-card__outdated">
          <Icon name="TriangleAlert" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
          這張圖是舊設定畫的（{outdatedReason}後來改過）——要更新請打開單格工作室重畫。
        </Meta>
      )}

      <button
        type="button"
        className="shot-card__preview"
        onClick={() => onOpenStudio(shot.id)}
        title={shot.assetUrl ? "打開單格工作室（重畫／修正／配音／版本）" : "還沒有畫面——打開單格工作室生成"}
      >
        {shot.assetUrl ? (
          <AssetImg src={shot.assetUrl} alt={`第 ${shotNumber} 鏡畫面`} loading="lazy" fallbackLabel="畫面素材遺失" />
        ) : (
          <span className="shot-card__preview-empty">
            <Icon name="Image" size={18} />
            <Meta as="span">{canEdit ? "點擊生成畫面" : "尚無畫面"}</Meta>
          </span>
        )}
      </button>

      <textarea
        key={`prompt-${shot.id}-${shot.prompt ?? ""}`}
        className="shot-card__prompt"
        aria-label="畫面描述"
        placeholder="這一鏡的靜態畫面（構圖、光線、氣氛）…"
        defaultValue={shot.prompt ?? ""}
        readOnly={!canEdit}
        rows={2}
        onBlur={(e) => {
          const v = e.target.value;
          if (canEdit && v !== (shot.prompt ?? "")) saveField({ sceneId: shot.id, prompt: v });
        }}
      />

      {/* World Refs：引用共用資料（卡片綁定既有元件）＋造型 chips */}
      <div className="shot-card__refs">
        <SceneCardBinding
          projectId={projectId}
          scene={{ id: shot.id, characterIds: shot.characterIds, scenePresetIds: shot.scenePresetIds, propIds: shot.propIds }}
          canEdit={canEdit}
          onSaved={() => utils.scenes.listByProject.invalidate({ projectId })}
        />
        {availableLooks.length > 0 && (
          <span className="shot-card__looks" role="group" aria-label="造型">
            {availableLooks.map((l) => {
              const onIt = (shot.lookIds ?? []).includes(l.id);
              const owner = characterNames.get(l.characterId);
              return (
                <Chip
                  key={l.id}
                  selected={onIt}
                  onClick={canEdit ? () => toggleLook(l.id) : undefined}
                  title={`${owner ? `${owner}的` : ""}造型：勾選後生成鎖定此造型`}
                >
                  {l.name}
                </Chip>
              );
            })}
          </span>
        )}
      </div>

      {/* §13 相關素材：專業模式才出現，避免第一層被塞滿（漸進揭露） */}
      {mode === "pro" && assetHints.length > 0 && (
        <div className="shot-card__assets">
          <Meta as="span">
            <Icon name="Paperclip" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            專案素材裡名稱或標籤對得上的：
          </Meta>
          {assetHints.map((a) => (
            <Chip key={a.id} title={`符合：${a.matched.join("、")}（點擊在素材庫開啟）`}>
              {a.title.slice(0, 14)}
            </Chip>
          ))}
        </div>
      )}

      {/* Direction＋Performance：簡單模式只留鏡別；專業模式全開 */}
      <div className="shot-card__direction" role="group" aria-label="鏡頭語言">
        <label>
          鏡別
          <select
            aria-label="鏡別"
            value={shot.camera?.shotSize ?? ""}
            disabled={!canEdit}
            onChange={(e) => saveCamera("shotSize", e.target.value)}
          >
            <option value="">（未定）</option>
            {SHOT_SIZE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        {mode === "pro" && (
          <>
            <label>
              角度
              <select aria-label="角度" value={shot.camera?.angle ?? ""} disabled={!canEdit} onChange={(e) => saveCamera("angle", e.target.value)}>
                <option value="">（未定）</option>
                {SHOT_ANGLE_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              運鏡
              <select aria-label="運鏡" value={shot.camera?.movement ?? ""} disabled={!canEdit} onChange={(e) => saveCamera("movement", e.target.value)}>
                <option value="">（未定）</option>
                {SHOT_MOVEMENT_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              焦段
              <input
                key={`focal-${shot.id}-${shot.camera?.focalLength ?? ""}`}
                defaultValue={shot.camera?.focalLength ?? ""}
                placeholder="50mm"
                maxLength={20}
                readOnly={!canEdit}
                onBlur={(e) => saveCamera("focalLength", e.target.value)}
              />
            </label>
            <label>
              光線
              <input
                key={`light-${shot.id}-${shot.camera?.lighting ?? ""}`}
                defaultValue={shot.camera?.lighting ?? ""}
                placeholder="逆光、柔光…"
                maxLength={60}
                readOnly={!canEdit}
                onBlur={(e) => saveCamera("lighting", e.target.value)}
              />
            </label>
            <label>
              構圖
              <input
                key={`comp-${shot.id}-${shot.camera?.composition ?? ""}`}
                defaultValue={shot.camera?.composition ?? ""}
                placeholder="三分法、留白…"
                maxLength={60}
                readOnly={!canEdit}
                onBlur={(e) => saveCamera("composition", e.target.value)}
              />
            </label>
            <label>
              表情
              <input
                key={`emo-${shot.id}-${shot.performance?.emotion ?? ""}`}
                defaultValue={shot.performance?.emotion ?? ""}
                placeholder="平靜、若有所思…"
                maxLength={60}
                readOnly={!canEdit}
                onBlur={(e) => savePerformance("emotion", e.target.value)}
              />
            </label>
            <label>
              視線
              <input
                key={`gaze-${shot.id}-${shot.performance?.gaze ?? ""}`}
                defaultValue={shot.performance?.gaze ?? ""}
                placeholder="看向遠方…"
                maxLength={60}
                readOnly={!canEdit}
                onBlur={(e) => savePerformance("gaze", e.target.value)}
              />
            </label>
          </>
        )}
      </div>

      {mode === "pro" && (
        <textarea
          key={`action-${shot.id}-${shot.action ?? ""}`}
          className="shot-card__action"
          aria-label="動作走位"
          placeholder="動作走位：誰做了什麼、從哪到哪（只注入影片模型）"
          defaultValue={shot.action ?? ""}
          readOnly={!canEdit}
          rows={1}
          onBlur={(e) => {
            const v = e.target.value;
            if (canEdit && v !== (shot.action ?? "")) saveField({ sceneId: shot.id, action: v });
          }}
        />
      )}

      <div className="shot-card__foot">
        <Button size="sm" variant="primary" onClick={() => onOpenStudio(shot.id)}>
          <Icon name="Sparkles" size={13} /> {shot.assetUrl ? "重畫／修正" : "生成畫面"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onOpenStudio(shot.id)} title="配音、環境音、版本都在單格工作室">
          <Icon name="Volume2" size={13} /> 聲音
        </Button>
        <span style={{ flex: "1 1 auto" }} />
        {canEdit && (
          <ConfirmButton
            triggerClassName="btn-sm btn-ghost"
            // 只有垃圾桶圖示，沒有可讀名稱＝讀螢幕軟體只會唸「按鈕」（實測抓到）
            triggerAriaLabel={`刪除第 ${shotNumber} 鏡`}
            message={`刪除第 ${shotNumber} 鏡？會移到回收桶，可還原。`}
            confirmLabel="刪除"
            disabled={removeShot.isPending}
            onConfirm={() => removeShot.mutate({ sceneId: shot.id })}
          >
            <Icon name="Trash2" size={13} />
          </ConfirmButton>
        )}
      </div>
      {update.error && <p className="error">{update.error.message}</p>}
    </Card>
  );
}
