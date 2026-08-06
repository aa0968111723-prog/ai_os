import { modelBaseSpecFor, WEIGHTS_HINT, WEIGHTS_LABEL } from "@shared/modelBase";
import { modelMechanicsFor } from "@shared/modelMechanics";
import { textEncoderProfileFor } from "@shared/textEncoders";
import { Icon } from "../../components/Icon";
import { Meta } from "../../components/ui";

/**
 * 底層模型（基座）的顯示層。
 *
 * 目錄上的 id 是端點不是模型：`fal-ai/flux/dev`、`fal-ai/flux-lora`、`fal-ai/flux/dev/image-to-image`
 * 背後是同一顆 FLUX.1 [dev]，換過去風格不會變；換基座才會。使用者要比較與分析時，
 * 這件事比「特性」那行文案重要得多，所以清單、比較表、熱力圖都要看得到。
 *
 * 資料一律來自 shared/modelBase（公開資料整理），不確定的地方那邊已標「未公開」——
 * 這裡只負責顯示，不補、不猜。
 */

const WEIGHTS_TONE: Record<string, { color: string; borderColor: string; background: string }> = {
  open: { color: "var(--healing-ink)", borderColor: "var(--healing)", background: "var(--healing-soft)" },
  closed: { color: "var(--fg-secondary)", borderColor: "var(--border-soft)", background: "var(--card2)" },
  unknown: { color: "var(--fg-secondary)", borderColor: "var(--border-soft)", background: "transparent" },
};

/** 一行式：清單卡、比較表、熱力圖列都掛得上 */
export function ModelBaseChip({
  modelId,
  category,
  size = "sm",
}: {
  modelId: string;
  category?: string;
  size?: "sm" | "md";
}) {
  const spec = modelBaseSpecFor(modelId, category);
  const tone = WEIGHTS_TONE[spec.weights] ?? WEIGHTS_TONE.unknown;
  return (
    <span
      className="model-base-chip"
      title={`底層模型：${spec.baseModel}（${spec.developer}）\n${spec.arch}\n${WEIGHTS_LABEL[spec.weights]}——${WEIGHTS_HINT[spec.weights]}`}
      style={{ fontSize: size === "md" ? "var(--fs-12)" : "var(--fs-11)", ...tone }}
    >
      <Icon name="Cpu" size={11} />
      {spec.baseModel}
      {spec.params ? <span className="mono">・{spec.params}</span> : null}
    </span>
  );
}

/** 展開版：底層模型的完整身分＋文字塔＋這家族怎麼跑 */
export function ModelBaseDetail({ modelId, category }: { modelId: string; category?: string }) {
  const spec = modelBaseSpecFor(modelId, category);
  const encoder = textEncoderProfileFor(modelId);
  const mechanics = modelMechanicsFor(modelId, category);
  const rows: Array<{ label: string; value: string }> = [
    { label: "底層模型", value: spec.baseModel },
    { label: "出品方", value: spec.developer },
    { label: "骨幹架構", value: spec.arch },
    ...(spec.params ? [{ label: "參數量", value: spec.params }] : []),
    { label: "權重", value: `${WEIGHTS_LABEL[spec.weights]}——${WEIGHTS_HINT[spec.weights]}` },
    {
      label: "文字塔",
      value: `${encoder.label}${encoder.limitTokens != null ? `（窗口 ${encoder.limitTokens} tok）` : "（窗口未公開）"}`,
    },
    { label: "條件注入", value: mechanics.conditioning },
  ];
  return (
    <div className="model-base-detail">
      <dl>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <Meta as="p" style={{ margin: "6px 0 0" }}>{spec.note}</Meta>
      {mechanics.caveat ? <Meta as="p" style={{ margin: "4px 0 0" }}>{mechanics.caveat}</Meta> : null}
      <Meta as="p" style={{ margin: "4px 0 0", fontSize: 11 }}>
        整理自公開資料（官方模型卡／fal 頁面）；官方沒公開的一律標「未公開」，站內不猜。
      </Meta>
    </div>
  );
}
