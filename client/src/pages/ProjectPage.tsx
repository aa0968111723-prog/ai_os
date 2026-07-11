import { useState } from "react";
import { trpc } from "../api";
import { MODELS } from "@shared/models";
import { worldviewSchema, TONE_OPTIONS, THEME_OPTIONS, type Worldview } from "@shared/worldview";
import { GenerationList } from "../components/GenerationList";
import { SceneList } from "../components/SceneList";
import { MessagePanel } from "../components/MessagePanel";

/** 專案工作區（F4 簡化版）：世界觀＋生成台＋留言 */
export function ProjectPage({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const project = trpc.projects.get.useQuery({ id });
  const updateWv = trpc.projects.updateWorldview.useMutation({
    onSuccess: () => utils.projects.get.invalidate({ id }),
  });

  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(MODELS[0].id);
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
  const wv: Worldview = worldviewSchema.parse(p.worldview ?? {});
  const model = MODELS.find((m) => m.id === modelId)!;

  const toggle = (field: "tones" | "themes", value: string) => {
    const current = wv[field];
    const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
    updateWv.mutate({ id, worldview: { ...wv, [field]: next } });
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
              onBlur={(e) => e.target.value !== wv.logline && updateWv.mutate({ id, worldview: { ...wv, logline: e.target.value } })}
            />
            <label>一句關鍵訊息（一片一訊息）</label>
            <input
              defaultValue={wv.message}
              placeholder="例：把心交給佛，煩惱就交給了光"
              onBlur={(e) => e.target.value !== wv.message && updateWv.mutate({ id, worldview: { ...wv, message: e.target.value } })}
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
          </section>

          {/* 生成台 */}
          <section className="card">
            <h2>創作生成</h2>
            <label>提示詞（世界觀會自動帶入，不必重講背景）</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例：清晨禪堂，柔和光線灑落，一炷香的靜謐" />
            <label>模型（點數透明）</label>
            <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.points} 點
                </option>
              ))}
            </select>
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="primary"
                disabled={!prompt.trim() || submit.isPending}
                onClick={() => submit.mutate({ projectId: id, modelId, prompt: prompt.trim() })}
              >
                {submit.isPending ? "送出中…" : `生成（−${model.points} 點）`}
              </button>
              <span className="hint">失敗自動退點・額度由組長調整</span>
            </div>
            {submit.error && <p className="error">{submit.error.message}</p>}
            <GenerationList projectId={id} />
          </section>

          {/* 分鏡與交付 */}
          <SceneList projectId={id} />
        </div>

        {/* 組內留言 */}
        <MessagePanel projectId={id} />
      </div>
    </div>
  );
}
