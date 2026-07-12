import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { worldviewSchema, TONE_OPTIONS, THEME_OPTIONS, type Worldview } from "@shared/worldview";
import { GenerationList } from "../components/GenerationList";
import { SceneList } from "../components/SceneList";
import { DirectorCard } from "../components/DirectorCard";
import { MessagePanel } from "../components/MessagePanel";
import { ModelPicker, type PickedModel } from "../components/ModelPicker";
import { WorkflowCard } from "../components/WorkflowCard";
import { AssetLibrary } from "../components/AssetLibrary";
import { KnowledgeBase } from "../components/KnowledgeBase";
import { ScriptSplitCard } from "../components/ScriptSplitCard";
import { CharacterCards } from "../components/CharacterCards";
import { ScenePresetCards } from "../components/ScenePresetCards";
import { PromptLibrary } from "../components/PromptLibrary";

/** 專案工作區（F4 簡化版）：世界觀＋生成台＋留言 */
export function ProjectPage({ id }: { id: string }) {
  const utils = trpc.useUtils();
  // 不重試 FORBIDDEN/NOT_FOUND：成員點到他組或已刪專案的舊連結時，直接顯示訊息，不要卡在「載入中…」重試
  const project = trpc.projects.get.useQuery(
    { id },
    {
      retry: (count, err) => {
        const code = err.data?.code;
        return code !== "FORBIDDEN" && code !== "NOT_FOUND" && count < 2;
      },
    },
  );
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
  /** 生成時要帶入的角色定裝卡（跨鏡一致） */
  const [charIds, setCharIds] = useState<string[]>([]);
  const toggleChar = (cid: string) => setCharIds((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));
  /** 生成時要帶入的場景設定卡（色板/光線一致） */
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const toggleScene = (sid: string) => setSceneIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  const assets = trpc.projects.assets.useQuery({ projectId: id });
  /** 生成確認彈窗：先估點數、使用者點頭才真的送出、扣點 */
  const [confirming, setConfirming] = useState(false);
  // 帶 groupId（本專案的組）才算得出週/日額度——不帶時 quota.my 的 weeklyQuota 恆為 null，彈窗週用量變死碼
  const quota = trpc.quota.my.useQuery({ groupId: project.data?.groupId }, { enabled: confirming && !!project.data });
  const savePrompt = trpc.prompts.save.useMutation({ onSuccess: () => utils.prompts.list.invalidate({ projectId: id }) });
  const archiveProject = trpc.projects.setArchived.useMutation({
    onSuccess: () => { utils.projects.get.invalidate({ id }); utils.projects.list.invalidate(); },
  });
  const submit = trpc.generation.submit.useMutation({
    onSuccess: (_data, vars) => {
      // 成功生成的提示詞自動入庫（簡報「打過的咒語自動存起來」）
      savePrompt.mutate({ projectId: id, text: vars.prompt });
      setPrompt("");
      setConfirming(false);
      utils.generation.listByProject.invalidate({ projectId: id });
      utils.quota.my.invalidate();
    },
  });

  if (project.isLoading) return <p className="hint">載入中…</p>;
  if (project.error || !project.data) {
    const code = project.error?.data?.code;
    const msg =
      code === "FORBIDDEN" ? "這個專案不屬於你的組，看不到內容。"
      : code === "NOT_FOUND" ? "找不到這個專案（可能已被刪除）。"
      : `載入失敗：${project.error?.message ?? "未知錯誤"}`;
    return (
      <p className="error">
        {msg} <Link href="/">回作業台</Link>
      </p>
    );
  }

  const p = project.data;
  const myRole = me.data?.groups.find((g) => g.groupId === p.groupId)?.role;
  const isLeader = myRole === "leader" || myRole === "admin";
  const wv: Worldview = worldviewSchema.parse(p.worldview ?? {});

  const isOwner = me.data?.user.id === p.ownerId;
  const canArchive = isOwner || isLeader;

  const toggle = (field: "tones" | "themes", value: string) => {
    const current = wv[field];
    const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
    // 只送有改的欄位；伺服器與現值合併（避免整包覆蓋造成的資料遺失）
    updateWv.mutate({ id, worldview: { [field]: next } });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ flex: "1 1 auto" }}>{p.title}{p.status === "archived" && <span className="chip" style={{ marginLeft: 10 }}>已封存</span>}</h1>
        {canArchive && (
          <button
            style={{ padding: "4px 12px", fontSize: 12 }}
            disabled={archiveProject.isPending}
            onClick={() => {
              const to = p.status === "archived";
              if (to || window.confirm(`封存「${p.title}」？封存後會從作業台隱藏，需要時可還原（不會刪除內容）。`)) {
                archiveProject.mutate({ id, archived: !to });
              }
            }}
          >
            {p.status === "archived" ? "還原專案" : "封存專案"}
          </button>
        )}
      </div>
      <p className="sub">
        {p.format}・{p.platform}
        {wv.logline ? `・${wv.logline}` : ""}
      </p>
      {archiveProject.error && <p className="error">{archiveProject.error.message}</p>}

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
            <label id="wv-themes">訊息主軸</label>
            <div role="group" aria-labelledby="wv-themes">
              {THEME_OPTIONS.map((t) => {
                const on = wv.themes.includes(t);
                return (
                  <span
                    key={t}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    className={`chip pick ${on ? "on" : ""}`}
                    onClick={() => toggle("themes", t)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle("themes", t); } }}
                  >
                    {t}
                  </span>
                );
              })}
            </div>
            <label id="wv-tones">調性（生成時自動注入）</label>
            <div role="group" aria-labelledby="wv-tones">
              {TONE_OPTIONS.map((t) => {
                const on = wv.tones.includes(t);
                return (
                  <span
                    key={t}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    className={`chip pick ${on ? "on" : ""}`}
                    onClick={() => toggle("tones", t)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle("tones", t); } }}
                  >
                    {t}
                  </span>
                );
              })}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>禁忌事項已內建（醫療宣稱禁語等）；進階設定之後開放。</p>
            {updateWv.error && <p className="error">世界觀儲存失敗：{updateWv.error.message}</p>}
          </section>

          {/* 專案知識庫：AI 讀得懂上傳的開示/見證/腳本（願景核心「真的懂我們」） */}
          <KnowledgeBase projectId={id} />

          {/* AI 導演建議（會讀取上方知識庫） */}
          <DirectorCard projectId={id} onUse={(text) => setPrompt(text)} />

          {/* AI 拆分鏡：貼腳本 → 自動建分鏡草稿 */}
          <ScriptSplitCard projectId={id} />

          {/* 角色定裝卡：勾選後生成自動注入外觀錨點 */}
          <CharacterCards projectId={id} selectedIds={charIds} onToggle={toggleChar} />

          {/* 場景設定卡：勾選後生成自動注入色板/光線錨點 */}
          <ScenePresetCards projectId={id} selectedIds={sceneIds} onToggle={toggleScene} />

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
                onClick={() => setConfirming(true)}
              >
                {submit.isPending ? "送出中…" : `生成（−${model?.points ?? 0} 點）`}
              </button>
              <span className="hint">失敗自動退點・額度由組長調整</span>
            </div>

            {/* 生成前確認彈窗（簡報「花錢前先讓你看價，你點頭才做」） */}
            {confirming && model && (
              <div className="confirm-panel">
                <h3 style={{ margin: "0 0 8px" }}>即將生成</h3>
                <p style={{ margin: "4px 0" }}>
                  <b>{model.label}</b>・{p.format}
                  {charIds.length > 0 && <>・帶入 {charIds.length} 個角色定裝</>}
                  {sceneIds.length > 0 && <>・{sceneIds.length} 個場景設定</>}
                </p>
                <p style={{ margin: "4px 0", fontSize: 13 }}>提示詞：{prompt.trim().slice(0, 80)}{prompt.trim().length > 80 ? "…" : ""}</p>
                <p style={{ margin: "8px 0" }}>
                  預估 <b style={{ color: "var(--primary)", fontSize: 18 }}>約 {model.points} 點</b>
                  {quota.data && (
                    <span className="hint" style={{ marginLeft: 8 }}>
                      {quota.data.totalRemaining != null ? `目前剩 ${quota.data.totalRemaining.toLocaleString()} 點` : "額度不限"}
                      {quota.data.weeklyQuota != null ? `・本週 ${quota.data.weeklyUsed}/${quota.data.weeklyQuota}` : ""}
                      {quota.data.dailyQuota != null ? `・今日 ${quota.data.dailyUsed}/${quota.data.dailyQuota}` : ""}
                    </span>
                  )}
                </p>
                <p className="hint" style={{ fontSize: 12 }}>失敗全額退點。真實模式會實際呼叫 AI 生成。</p>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button
                    className="primary"
                    disabled={submit.isPending}
                    onClick={() =>
                      model &&
                      submit.mutate({
                        projectId: id,
                        modelId: model.id,
                        prompt: prompt.trim(),
                        sourceAssetId: model.needs && sourceAsset ? sourceAsset.id : undefined,
                        sourceUrl: model.needs && !sourceAsset && sourceUrl.trim() ? sourceUrl.trim() : undefined,
                        characterIds: charIds.length ? charIds : undefined,
                        scenePresetIds: sceneIds.length ? sceneIds : undefined,
                      })
                    }
                  >
                    {submit.isPending ? "生成中…" : "確認生成"}
                  </button>
                  <button disabled={submit.isPending} onClick={() => setConfirming(false)}>再想想</button>
                </div>
              </div>
            )}
            {submit.error && <p className="error">{submit.error.message}</p>}
            <GenerationList projectId={id} />
          </section>

          {/* 提示詞庫：成功生成的咒語一鍵再用 */}
          <PromptLibrary projectId={id} onUse={(text) => setPrompt(text)} />

          {/* 工作流（一鍵串鏈） */}
          <WorkflowCard projectId={id} />

          {/* 分鏡與交付 */}
          <SceneList projectId={id} isLeader={isLeader} onUsePrompt={(text) => setPrompt(text)} />
        </div>

        {/* 組內留言 */}
        <MessagePanel projectId={id} />
      </div>
    </div>
  );
}
