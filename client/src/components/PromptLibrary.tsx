import { useState } from "react";
import { trpc } from "../api";
import { getModel } from "@shared/models";
import { ConfirmButton } from "./interactions";

/** 「再用」帶回生成台的完整設定（與伺服器 prompts 列的新欄位同形狀） */
export interface PromptReuseSettings {
  modelId?: string | null;
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
}

/**
 * 提示詞庫（簡報「打過的咒語一鍵再用」）：
 * 成功生成的提示詞自動入庫，這裡可「再用」（帶入生成台，連同模型/角色/場景設定一起還原）、
 * 「工作流」（帶入工作流想法框）、「複製」、「刪除」。
 */
export function PromptLibrary({
  projectId,
  onUse,
  onUseForWorkflow,
}: {
  projectId: string;
  onUse: (text: string, settings?: PromptReuseSettings) => void;
  /** 三合一：把咒語帶進工作流「你的想法」框（不傳就不畫「工作流」鈕） */
  onUseForWorkflow?: (text: string) => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.prompts.list.useQuery({ projectId });
  const remove = trpc.prompts.remove.useMutation({ onSuccess: () => utils.prompts.list.invalidate({ projectId }) });

  // 複製給即時回饋：成功閃「已複製」、被瀏覽器擋下閃「複製失敗」，約 1.5 秒後復原。
  const [copyState, setCopyState] = useState<{ id: string; ok: boolean } | null>(null);
  const flashCopy = (id: string, ok: boolean) => {
    setCopyState({ id, ok });
    setTimeout(() => setCopyState((s) => (s && s.id === id ? null : s)), 1500);
  };
  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => flashCopy(id, true),
      () => flashCopy(id, false),
    );
  };

  if (!list.data?.length) return null; // 沒有咒語就不佔版面（生成成功後自動出現）

  return (
    <section className="card" data-fb="提示詞庫">
      <h2>提示詞庫（打過的咒語，一鍵再用）</h2>
      <p className="hint">成功生成的提示詞會自動存這裡（連同模型與角色/場景設定）；常用的排在前面。</p>
      <div style={{ marginTop: 8 }}>
        {list.data.map((p) => {
          const modelLabel = p.modelId ? getModel(p.modelId)?.label ?? p.modelId : null;
          const charN = (p.characterIds as string[] | null)?.length ?? 0;
          const sceneN = (p.scenePresetIds as string[] | null)?.length ?? 0;
          return (
            <div key={p.id} className="gen-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
              <div style={{ fontSize: "var(--fs-13)" }}>
                {p.text}
                {p.useCount > 1 && <span className="chip" style={{ marginLeft: 6 }}>用過 {p.useCount} 次</span>}
                {/* 這則咒語最近一次的完整用法：再用時會一併還原（純文字舊列沒有，不顯示） */}
                {(modelLabel || charN > 0 || sceneN > 0) && (
                  <div className="hint mono" style={{ fontSize: "var(--fs-11)", marginTop: 2 }}>
                    {[modelLabel, charN > 0 ? `角色 ${charN}` : "", sceneN > 0 ? `場景 ${sceneN}` : ""].filter(Boolean).join("・")}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  style={{ padding: "3px 12px", fontSize: "var(--fs-12)" }}
                  title={modelLabel ? "帶回生成台，並還原模型與角色/場景勾選" : "帶回生成台"}
                  onClick={() =>
                    onUse(p.text, {
                      modelId: p.modelId,
                      characterIds: p.characterIds as string[] | null,
                      scenePresetIds: p.scenePresetIds as string[] | null,
                    })
                  }
                >
                  再用
                </button>
                {onUseForWorkflow && (
                  <button
                    style={{ padding: "3px 12px", fontSize: "var(--fs-12)" }}
                    title="把這則咒語帶進工作流的想法框"
                    onClick={() => onUseForWorkflow(p.text)}
                  >
                    工作流
                  </button>
                )}
                <button style={{ padding: "3px 10px", fontSize: "var(--fs-12)" }} onClick={() => copy(p.id, p.text)}>
                  {copyState?.id === p.id ? (copyState.ok ? "已複製" : "複製失敗") : "複製"}
                </button>
                <ConfirmButton
                  onConfirm={() => remove.mutate({ id: p.id })}
                  message="刪除這則提示詞？"
                  confirmLabel="刪除"
                  triggerStyle={{ padding: "3px 10px", fontSize: "var(--fs-12)", color: "var(--danger-ink)" }}
                  disabled={remove.isPending}
                >
                  刪除
                </ConfirmButton>
              </div>
            </div>
          );
        })}
      </div>
      {remove.error && <p className="error">{remove.error.message}</p>}
    </section>
  );
}
