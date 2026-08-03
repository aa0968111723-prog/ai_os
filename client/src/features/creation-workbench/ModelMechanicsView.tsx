import { useState } from "react";
import { modelMechanicsFor } from "@shared/modelMechanics";
import { Hint, Meta } from "../../components/ui";
import { MechanicsDiagram } from "./MechanicsDiagram";

/**
 * 模型運作圖解：這顆模型收到提示詞之後，實際上一關一關發生了什麼。
 *
 * 這是**架構說明**，不是本次生成的實測資料——界線寫在畫面上。
 * 把通用架構圖說成「這次模型真的這樣想」，跟假造注意力熱圖是同一種謊。
 * 要逐次量測影響力，用下方的消融實測。
 */
export function ModelMechanicsView({ modelId, category }: { modelId?: string; category?: string }) {
  const mechanics = modelMechanicsFor(modelId, category);
  const [openStage, setOpenStage] = useState<string | null>(null);

  return (
    <details data-testid="model-mechanics" style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>這顆模型怎麼運作</summary>
      <Hint layer="always" style={{ marginTop: 6 }}>
        下圖是這類模型的架構示意（整理自公開資料），不是本次生成的中間結果——
        模型不回傳中間潛變數。要知道某一段設定這次有沒有真的起作用，請用下方的影響力實測。
      </Hint>

      <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", marginTop: 8 }}>
        <strong style={{ fontSize: 13 }}>{mechanics.label}</strong>
        <Meta>{mechanics.conditioning}</Meta>
      </div>

      <MechanicsDiagram stages={mechanics.stages} activeKey={openStage} onPick={(key) => setOpenStage(openStage === key ? null : key)} />

      <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 5 }}>
        {mechanics.stages.map((stage, index) => {
          const open = openStage === stage.key;
          return (
            <li key={stage.key}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenStage(open ? null : stage.key)}
                style={{
                  // 標題與摘要疊放而不是並排：窄螢幕上並排會把「交叉注意力」折成兩行三個字
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "1.4em 1fr",
                  columnGap: 8,
                  textAlign: "left",
                  padding: "7px 9px",
                  borderRadius: 8,
                  border: `1px solid ${open ? "var(--primary-border)" : "var(--border-soft)"}`,
                  background: open ? "var(--primary-tint)" : "var(--card2)",
                  color: "var(--fg)",
                  font: "inherit",
                  cursor: "pointer",
                }}
              >
                <span aria-hidden style={{ fontSize: 11, color: "var(--fg-secondary)", lineHeight: 1.6 }}>{index + 1}</span>
                <span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{stage.title}</span>
                  <span style={{ display: "block", fontSize: 12, lineHeight: 1.55, color: "var(--fg-secondary)" }}>{stage.summary}</span>
                </span>
              </button>
              {open ? (
                <p style={{ margin: "4px 0 0", padding: "0 9px", fontSize: 12.5, lineHeight: 1.7, color: "var(--fg-secondary)" }}>
                  {stage.detail}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {mechanics.caveat ? <Meta as="p" style={{ margin: "8px 0 0" }}>{mechanics.caveat}</Meta> : null}
    </details>
  );
}
