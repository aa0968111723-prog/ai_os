import { useState } from "react";
import { trpc } from "../api";
import { worldviewSchema, TONE_OPTIONS, THEME_OPTIONS, type Worldview } from "@shared/worldview";
import { GenerationList } from "../components/GenerationList";
import { SceneList } from "../components/SceneList";
import { DirectorCard } from "../components/DirectorCard";
import { MessagePanel } from "../components/MessagePanel";
import { ModelPicker, type PickedModel } from "../components/ModelPicker";
import { WorkflowCard } from "../components/WorkflowCard";
import { AssetLibrary } from "../components/AssetLibrary";

/** 專案工作區（F4 簡化版）：世界觀＋生成台＋留言 */
export function ProjectPage({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const project = trpc.projects.get.useQuery({ id });
  const me = trpc.auth.me.useQuery();
  const updateWv = trpc.projects.updateWorldview.useMutation({
    // 樂觀更新：patch 先合併進本地快取，快速連點兩個 chips 時第二下才讀得到第一下的結果
    //（否則第二下用 stale 快取算出「整條陣列」，後端合併後把第一下剛存的值蓋掉）
    onMutate: async ({ worldview }) => {
      await utils.projects.get.cancel({ id });
      utils.projects.get.setData({ id }, (old) =>
        old ? { ...old, worldview: { ...worldviewSchema.parse(old.worldview ?? {}), ...worldview } } : old,
      );
    },
    // 失敗或成功都以伺服器現值對齊（失敗時等同回滾樂觀值）
    onError: () => utils.projects.get.invalidate({ id }),
    onSuccess: () => utils.projects.get.invalidate({ id }),
  });

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<PickedModel | null>(null);
  /** 來源：優先素材庫（伺服器簽名網址，永久有效）；也可貼外部網址 */
  const [sourceAsset, setSourceAsset] = useState<{ id: string; title: string; kind: string } | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const assets = trpc.projects.assets.useQuery({ projectId: id });
  const submit = trpc.generation.submit.useMutation({
    onSuccess: () => {
      setPrompt("");
      utils.generation.listByProject.invalidate({ projectId: id });
      utils.quota.my.invalidate();
    },
  });

  if (project.isLoading) return <p className="hint">載入中…</p>;
  if (project.error || !project.data) return <p className="error">載入失敗：{project.error?.message}</p>;

  const p = project.data;
  const myRole = me.data?.groups.find((g) => g.groupId === p.groupId)?.role;
  const isLeader = myRole === "leader" || myRole === "admin";
  const wv: Worldview = worldviewSchema.parse(p.worldview ?? {});

  const toggle = (field: "tones" | "themes", value: string) => {
    const current = wv[field];
    const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
    // 只送有改的欄位；伺服器與現值合併（避免整包覆蓋造成的資料遺失）
    updateWv.mutate({ id, worldview: { [field]: next } });
  };

  return (
    <div>
      <h1>{p.title}</h1>
      <p className="sub">
        {p.format}・{p.platform}
        {wv.logline ? `・${wv.logline}` : ""}
      </p>

      <div className="cols">
        <div className="stack">
          {/* 世界觀（快速層） */}
          <section className="card">
            <h2>世界觀（專案定盤星）</h2>
            <label>一句話故事（logline）</label>
            <input
              defaultValue={wv.logline}
              placeholder="例：陳師姐從憂鬱低谷透過印心佛法走出重生"
              onBlur={(e) => e.target.value !== wv.logline && updateWv.mutate({ id, worldview: { logline: e.target.value } })}
            />
            <label>一句關鍵訊息（一片一訊息）</label>
            <input
              defaultValue={wv.message}
              placeholder="例：把心交給佛，煩惱就交給了光"
              onBlur={(e) => e.target.value !== wv.message && updateWv.mutate({ id, worldview: { message: e.target.value } })}
            />
            <label>訊息主軸</label>
            <div>
              {THEME_OPTIONS.map((t) => (
                <span key={t} className={`chip pick ${wv.themes.includes(t) ? "on" : ""}`} onClick={() => toggle("themes", t)}>
                  {t}
                </span>
              ))}
            </div>
            <label>調性（生成時自動注入）</label>
            <div>
              {TONE_OPTIONS.map((t) => (
                <span key={t} className={`chip pick ${wv.tones.includes(t) ? "on" : ""}`} onClick={() => toggle("tones", t)}>
                  {t}
                </span>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>禁忌事項已內建（醫療宣稱禁語等）；進階設定之後開放。</p>
            {updateWv.error && <p className="error">世界觀儲存失敗：{updateWv.error.message}</p>}
          </section>

          {/* AI 導演建議 */}
          <DirectorCard projectId={id} onUse={(text) => setPrompt(text)} />

          {/* 素材庫：上傳參考素材（提案核心「把素材丟進去」的入口）＋生成成品自動入庫 */}
          <AssetLibrary projectId={id} onPickSource={(a) => { setSourceAsset(a); setSourceUrl(""); }} />

          {/* 生成台（11 類 × 旗艦/經濟/最低成本） */}
          <section className="card">
            <h2>創作生成</h2>
            <ModelPicker onChange={setModel} />
            {model?.needs && (
              <>
                <label>{model.sourceHint ?? "來源素材"}</label>
                {(assets.data?.length ?? 0) > 0 && (
                  <select
                    value={sourceAsset?.id ?? ""}
                    onChange={(e) => {
                      const picked = assets.data!.find((a) => a.id === e.target.value);
                      setSourceAsset(picked ? { id: picked.id, title: picked.title, kind: picked.kind } : null);
                      if (picked) setSourceUrl("");
                    }}
                  >
                    <option value="">從本專案素材庫選…</option>
                    {assets.data!.map((a) => (
                      <option key={a.id} value={a.id}>
                        [{a.kind}] {a.title}
                      </option>
                    ))}
                  </select>
                )}
                {sourceAsset ? (
                  <p className="hint">
                    來源：{sourceAsset.title}（素材庫）
                    <button style={{ marginLeft: 8, padding: "1px 8px", fontSize: 11 }} onClick={() => setSourceAsset(null)}>
                      改用網址
                    </button>
                  </p>
                ) : (
                  <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…（或從上方素材庫選）" />
                )}
              </>
            )}
            <label>{model?.kind === "audio" && model.needs == null ? "要唸的文字/音樂描述" : "提示詞（世界觀會自動帶入，不必重講背景）"}</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例：清晨禪堂，柔和光線灑落，一炷香的靜謐" />
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="primary"
                disabled={!prompt.trim() || !model || (model.needs != null && !sourceAsset && !sourceUrl.trim()) || submit.isPending}
                onClick={() =>
                  model &&
                  submit.mutate({
                    projectId: id,
                    modelId: model.id,
                    prompt: prompt.trim(),
                    sourceAssetId: model.needs && sourceAsset ? sourceAsset.id : undefined,
                    sourceUrl: model.needs && !sourceAsset && sourceUrl.trim() ? sourceUrl.trim() : undefined,
                  })
                }
              >
                {submit.isPending ? "送出中…" : `生成（−${model?.points ?? 0} 點）`}
              </button>
              <span className="hint">失敗自動退點・額度由組長調整</span>
            </div>
            {submit.error && <p className="error">{submit.error.message}</p>}
            <GenerationList projectId={id} />
          </section>

          {/* 工作流（一鍵串鏈） */}
          <WorkflowCard projectId={id} />

          {/* 分鏡與交付 */}
          <SceneList projectId={id} isLeader={isLeader} />
        </div>

        {/* 組內留言 */}
        <MessagePanel projectId={id} />
      </div>
    </div>
  );
}
