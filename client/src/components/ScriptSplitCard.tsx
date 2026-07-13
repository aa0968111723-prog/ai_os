import { useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";

/**
 * 導演 AI 拆分鏡（願景「貼腳本→自動建分鏡卡」）：
 * 貼上腳本（或留空用知識庫的腳本）→ AI 切成一幕一幕，建立分鏡草稿（含建議提示詞、配音詞）。
 */
export function ScriptSplitCard({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const [script, setScript] = useState("");
  const [open, setOpen] = useState(false);
  const split = trpc.director.splitScript.useMutation({
    onSuccess: () => {
      utils.scenes.listByProject.invalidate({ projectId });
      utils.quota.my.invalidate();
      setScript(""); setOpen(false);
    },
  });

  return (
    <section className="card" data-fb="AI 拆分鏡">
      <h2>AI 拆分鏡（腳本 → 一幕一幕）</h2>
      <p className="hint">貼上腳本，AI 幫你切成分鏡草稿（每幕有建議畫面＋配音詞）；留空則用知識庫裡的腳本／開示稿。</p>
      {open ? (
        <>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={6}
            placeholder="把腳本貼進來…（一段一幕最理想；留空則用知識庫）"
          />
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
            <button className="primary" disabled={split.isPending} onClick={() => split.mutate({ projectId, scriptText: script.trim() || undefined })}>
              {split.isPending ? "拆分中…" : "拆成分鏡"}
            </button>
            <button onClick={() => setOpen(false)}>取消</button>
            <span className="hint">下方「分鏡・交付」會出現草稿分鏡</span>
          </div>
        </>
      ) : (
        <button onClick={() => setOpen(true)}>貼腳本自動拆分鏡</button>
      )}
      {split.data && <p className="hint" style={{ color: "var(--success)", marginTop: 8 }}><Icon name="Check" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />已建立 {split.data.count} 幕草稿{split.data.mock ? "（示範拆分）" : ""}</p>}
      {split.error && <p className="error">{split.error.message}</p>}
    </section>
  );
}
