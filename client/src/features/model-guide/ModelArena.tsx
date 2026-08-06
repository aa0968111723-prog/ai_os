import { useEffect, useState } from "react";
import { Link } from "wouter";
import { getModel, type ModelEntry } from "@shared/models";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Card, Hint, Meta, Pill } from "../../components/ui";
import { ModelArenaResults } from "./ModelArenaResults";
import { ModelBaseChip } from "./ModelBaseInfo";

/**
 * 實測競技場：拿自己的題目，讓 2–4 顆模型同場跑一次。
 *
 * 為什麼指南頁需要這個：目錄能給的只有規格與文字宣稱，回答不了「哪個適合我」。
 * 唯一能回答的方法是把自己的題材丟給它們同題並跑，然後看成品。
 *
 * 三件事必須先講清楚，講不清楚這功能就是在坑人：
 * 1. **每一顆都是真的生成，照常扣點**——送出前把總點數算出來擺在按鈕上。
 * 2. **要素材的模型沒給素材會失敗**——事前標示，不要讓人花點數換一則錯誤訊息。
 * 3. 成品落在所選專案的生成紀錄裡，不是丟進真空——退點、重試、收藏都與平常一致。
 */

/** 來源需求的中文說法（與指南頁比較表同一份用語） */
const NEEDS_LABEL: Record<string, string> = { image: "一張圖", audio: "一段音訊", video: "一支影片", zip: "素材包 zip" };

export function ModelArena({
  groupId,
  modelIds,
  onRemove,
  onClear,
}: {
  groupId: string;
  modelIds: string[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const projects = trpc.projects.list.useQuery({ groupId: groupId || undefined }, { enabled: !!groupId });
  // 只列「現在真的寫得進去」的專案：封存／暫停與唯讀成員身分都送不出生成，
  // 讓它們出現在下拉選單只會換來一則被伺服器擋下的錯誤。
  const editable = (projects.data ?? []).filter((p) => p.status === "active" && p.myProjectRole === "editor");
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const bench = trpc.generation?.bench?.useMutation?.() ?? {
    data: undefined,
    error: null,
    isPending: false,
    mutate: (_input: unknown) => undefined,
    reset: () => undefined,
  };

  // 專案載入後預選第一個（最近更新的那個）：少一次點擊，且不會誤選封存專案
  useEffect(() => {
    if (!projectId && editable.length) setProjectId(editable[0].id);
  }, [projectId, editable]);

  const models = modelIds.map((id) => getModel(id)).filter((m): m is ModelEntry => !!m);
  const needSource = models.filter((m) => m.needs);
  const totalPoints = models.reduce((sum, m) => sum + m.points, 0);
  const ready = models.length >= 2 && !!projectId && prompt.trim().length > 0;

  if (models.length === 0) {
    return (
      <Hint layer="always" style={{ margin: 0 }}>
        還沒選模型——到下方<b>完整目錄</b>勾 2–4 個「比較」，或用「比風格／看情境」找到候選後回到這裡，就能拿同一個題目讓它們實際跑一次。
      </Hint>
    );
  }

  return (
    <div className="model-arena" data-testid="model-arena">
      <Hint layer="always" style={{ marginTop: 0 }}>
        同一個提示詞、同一組設定，一次送進所選的模型各跑一輪。<b>每一顆都是真的生成，照常扣點</b>；
        成品會落在所選專案的生成紀錄裡，失敗會自動退點。
      </Hint>

      {/* 參賽名單：與下方目錄的「比較」勾選同一份 */}
      <div className="model-arena__roster">
        {models.map((m) => (
          <span key={m.id} className="model-arena__slot">
            <b>{m.label}</b>
            <ModelBaseChip modelId={m.id} category={m.category} />
            <span className="mono" style={{ fontSize: 11 }}>{m.points} 點</span>
            {m.needs ? <Pill style={{ color: "var(--gold-ink)", borderColor: "var(--gold)", background: "var(--gold-soft)" }}>需{NEEDS_LABEL[m.needs] ?? m.needs}</Pill> : null}
            <Button variant="ghost" aria-label={`把 ${m.label} 移出競技場`} title="移出" style={{ padding: "0 6px" }} onClick={() => onRemove(m.id)}>
              <Icon name="X" size={12} />
            </Button>
          </span>
        ))}
        <Button variant="ghost" size="sm" onClick={onClear}>清空</Button>
      </div>

      {models.length < 2 && (
        <Hint style={{ margin: "8px 0 0" }}>再勾 1 個模型就能開跑——同題並跑至少要兩顆才有比較的意義。</Hint>
      )}

      {/* 1. 落在哪個專案 */}
      <label className="model-arena__field">
        <span className="eyebrow cjk">成品放進哪個專案</span>
        {projects.isLoading ? (
          <Meta>載入專案中…</Meta>
        ) : editable.length ? (
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {editable.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        ) : (
          <Meta>
            還沒有可寫入的專案——<Link href="/dashboard">先到今日工作台開一個</Link>，成品才有地方落地。
          </Meta>
        )}
      </label>

      {/* 2. 題目 */}
      <label className="model-arena__field">
        <span className="eyebrow cjk">你的題目（所有模型收到同一句）</span>
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例：禪修者在晨光竹林中打坐，暖色調，安靜莊嚴"
        />
      </label>

      {/* 3. 來源素材（只有需要的模型會用到） */}
      {needSource.length > 0 && (
        <label className="model-arena__field">
          <span className="eyebrow cjk">來源素材網址（https）</span>
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…（要圖／音／影的模型才需要）"
          />
          <Hint style={{ margin: "4px 0 0" }}>
            {needSource.map((m) => `${m.label} 需${m.sourceHint ?? NEEDS_LABEL[m.needs ?? ""] ?? m.needs}`).join("、")}
            ——沒給的話這幾顆會直接失敗（不會扣點）。要用素材庫裡的檔案，請到
            <Link href="/dashboard">工作台</Link>用完整的來源選擇器。
          </Hint>
        </label>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <Button
          type="button"
          disabled={!ready || bench.isPending}
          onClick={() =>
            bench.mutate({
              projectId,
              modelIds,
              prompt: prompt.trim(),
              sourceUrl: sourceUrl.trim() || undefined,
            })
          }
        >
          {bench.isPending ? "送出中…" : `同題並跑 ${models.length} 顆・約 ${totalPoints} 點`}
        </Button>
        <Meta>每顆各扣各的；失敗的那顆會自動退點。</Meta>
      </div>

      {bench.error ? <p className="error">{bench.error.message}</p> : null}

      {bench.data ? (
        <Card variant="quiet" data-testid="arena-run" style={{ marginTop: 10, padding: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13 }}>已送出 {bench.data.runs.length} 顆</strong>
            <Meta>約 {bench.data.pointsTotal} 點・題目「{bench.data.prompt.slice(0, 24)}{bench.data.prompt.length > 24 ? "…" : ""}」</Meta>
          </div>
          {bench.data.failed.length ? (
            <Meta as="p" style={{ margin: "6px 0 0", color: "var(--gold-ink)" }}>
              {bench.data.failed.length} 顆沒送出：
              {bench.data.failed.map((row) => `${row.modelLabel}（${row.message}）`).join("；")}
            </Meta>
          ) : null}
          <ModelArenaResults projectId={projectId} runId={bench.data.runId} />
        </Card>
      ) : null}
    </div>
  );
}
