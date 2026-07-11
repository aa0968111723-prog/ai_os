import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../api";
import { PROJECT_KINDS, PLATFORMS } from "@shared/models";

/** 首頁作業台：繼續你的專案＋快速開始（設計規格 F2 簡化版） */
export function Launchpad() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const projects = trpc.projects.list.useQuery();
  const create = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      utils.projects.list.invalidate();
      navigate(`/p/${project.id}`);
    },
  });

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>(PROJECT_KINDS[0].id);
  const [platform, setPlatform] = useState<string>(PLATFORMS[0].id);

  return (
    <div>
      <h1>
        今天想<span className="accent">創作</span>什麼？
      </h1>
      <p className="sub">接續你的專案，或開一個新的。</p>

      <div className="cols">
        <section>
          <h2>繼續你的專案</h2>
          {projects.isLoading && <p className="hint">載入中…</p>}
          {projects.error && <p className="error">載入失敗：{projects.error.message}（DB 連線了嗎？）</p>}
          {projects.data?.length === 0 && <p className="hint">還沒有專案——右邊建立第一個吧 🙌</p>}
          <div className="grid">
            {projects.data?.map((p) => (
              <div key={p.id} className="card proj-card" onClick={() => navigate(`/p/${p.id}`)}>
                <h3>{p.title}</h3>
                <div className="meta">
                  <span className="chip">{PROJECT_KINDS.find((k) => k.id === p.kind)?.label ?? p.kind}</span>
                  <span className="chip">{p.format}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="card">
          <h2>＋ 新專案</h2>
          <label>專案名稱</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：見證故事 · 走出低谷" />
          <label>內容類型</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {PROJECT_KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <label>發布平台（格式自動帶入）</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <div style={{ marginTop: 16 }}>
            <button
              className="primary"
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate({ title: title.trim(), kind, platform })}
            >
              {create.isPending ? "建立中…" : "建立專案"}
            </button>
          </div>
          {create.error && <p className="error">{create.error.message}</p>}
        </aside>
      </div>
    </div>
  );
}
