import type { CSSProperties, ReactNode } from "react";
import type { AiWarning } from "@shared/aiTrace";
import {
  analyzePromptBudget,
  textEncoderProfileFor,
  type BudgetStatus,
  type BudgetSegmentResult,
  type PromptBudget,
} from "@shared/textEncoders";
import { Card, Chip, Meta } from "../../components/ui";
import { ModelMechanicsView } from "./ModelMechanicsView";
import {
  buildPromptFlow,
  distributePromptWarnings,
  parseNegativeItems,
  type PromptFlowField,
  type PromptFlowNode,
  type PromptFlowNodeKey,
  visualWidth,
} from "./promptFlow";

/**
 * 提示詞組裝地圖：把「送出去的那一大段字」畫成一條由上而下的流程。
 *
 * 為什麼不是直接印字串：使用者要判斷的其實是**結構問題**——哪一段是我寫的、
 * 哪一段是系統自動接上的、哪些外觀被鎖住了、什麼被擋掉、最後送給誰。
 * 純文字把這些全壓成同一個視覺層級，手機上尤其只剩「一牆字」。
 * 節點＋連接線把疊加順序畫出來，欄位拆成小格，警告掛在它描述的那一段旁邊。
 *
 * 版面刻意是**單欄直向**（不是左右分支的心智圖）：主要使用場景是手機，
 * 橫向分支在窄螢幕只會變成橫向捲動或字被擠成一行一字。
 */

interface NodeAccent {
  /** 節點圓點的字（單字比 emoji 更好認，也不受字型 fallback 影響） */
  glyph: string;
  ink: string;
  soft: string;
  line: string;
}

const ACCENTS: Record<PromptFlowNodeKey, NodeAccent> = {
  instruction: { glyph: "你", ink: "var(--primary-ink)", soft: "var(--primary-tint)", line: "var(--primary-border)" },
  background: { glyph: "世", ink: "var(--healing-ink)", soft: "var(--healing-soft)", line: "var(--healing)" },
  character: { glyph: "角", ink: "var(--collab-ink)", soft: "var(--collab-soft)", line: "var(--collab)" },
  scene: { glyph: "場", ink: "var(--gold-ink)", soft: "var(--gold-soft)", line: "var(--gold)" },
  prop: { glyph: "物", ink: "var(--success-ink)", soft: "var(--success-soft)", line: "var(--success)" },
  negative: { glyph: "禁", ink: "var(--danger-ink)", soft: "var(--danger-soft)", line: "var(--danger)" },
  model: { glyph: "送", ink: "var(--primary-ink)", soft: "var(--primary-tint)", line: "var(--primary-border)" },
};

/** 視覺寬度超過這麼多全形字的值改佔滿整列（約等於一個 130px 欄位放得下的量） */
const WIDE_VALUE_WIDTH = 10;

const nodeCardStyle: CSSProperties = { padding: "10px 12px", borderRadius: 12 };

function FieldGrid({ fields }: { fields: PromptFlowField[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
        gap: 6,
        marginTop: 8,
      }}
    >
      {fields.map((field, index) => (
        <div
          key={`${field.label ?? "value"}-${index}`}
          style={{
            gridColumn: !field.label || visualWidth(field.value) > WIDE_VALUE_WIDTH ? "1 / -1" : undefined,
            padding: "6px 9px",
            borderRadius: 8,
            background: "var(--card2)",
            border: "1px solid var(--border-soft)",
          }}
        >
          {field.label ? (
            <div style={{ fontSize: 11, color: "var(--fg-secondary)", marginBottom: 2 }}>{field.label}</div>
          ) : null}
          <div style={{ fontSize: 13, lineHeight: 1.55, overflowWrap: "anywhere" }}>{field.value}</div>
        </div>
      ))}
    </div>
  );
}

function NodeWarnings({ warnings }: { warnings: AiWarning[] }) {
  return (
    <>
      {warnings.map((warning) => (
        <div
          key={warning.code}
          style={{
            marginTop: 8,
            padding: "7px 10px",
            borderRadius: 8,
            borderLeft: `3px solid ${warning.severity === "warning" ? "var(--gold)" : "var(--border-strong)"}`,
            background: warning.severity === "warning" ? "var(--gold-soft)" : "var(--card2)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <b style={{ color: warning.severity === "warning" ? "var(--gold-ink)" : undefined }}>
            {warning.severity === "warning" ? "⚠ " : "· "}
            {warning.title}
          </b>
          <div style={{ color: "var(--fg-secondary)" }}>
            {warning.detail}
            {warning.suggestion ? ` ${warning.suggestion}` : ""}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * 注意力預算狀態 → 給人看的說法。
 * 用詞刻意分「確定」與「可能」：估算跨在邊界上時說「可能」，
 * 只有連樂觀下界都超標才敢說「沒進模型」——誤報會害使用者刪掉其實有效的設定。
 */
const BUDGET_STATUS: Record<BudgetStatus, { label: string; ink: string; soft: string } | null> = {
  inside: null,
  at_risk: { label: "可能超出窗口", ink: "var(--gold-ink)", soft: "var(--gold-soft)" },
  truncated: { label: "有一部分沒進模型", ink: "var(--danger-ink)", soft: "var(--danger-soft)" },
  dropped: { label: "整段沒進模型", ink: "var(--danger-ink)", soft: "var(--danger-soft)" },
  unknown: null,
};

function BudgetBadge({ budget }: { budget: BudgetSegmentResult<PromptFlowNodeKey> }) {
  const state = BUDGET_STATUS[budget.status];
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "var(--fg-secondary)" }}>
        約 {budget.tokens.min}–{budget.tokens.max} token
      </span>
      {state ? (
        <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 999, color: state.ink, background: state.soft }}>
          {state.label}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 文字窗口總覽：這顆模型讀得下多少、這次組裝用掉多少。
 *
 * 這是「注意力」在 hosted API 下唯一能誠實談的部分——不是內部權重，而是
 * **模型到底讀到了哪幾個字**。窗口未公開時只報用量、不報結論。
 */
function EncoderWindow({ budget }: { budget: PromptBudget<PromptFlowNodeKey> }) {
  const { profile, total, overflows } = budget;
  const limit = profile.limitTokens;
  // 進度條用保守上界填色（先讓人看到風險），超出的部分夾在 100%
  const usedPercent = limit ? Math.min(100, Math.round((total.max / limit) * 100)) : 0;
  const safePercent = limit ? Math.min(100, Math.round((total.min / limit) * 100)) : 0;

  return (
    <Card
      variant="quiet"
      data-testid="prompt-encoder-window"
      style={{ padding: "9px 12px", borderRadius: 12, marginTop: 8, borderLeft: `3px solid ${overflows ? "var(--danger)" : "var(--border-strong)"}` }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>文字窗口</strong>
        <span style={{ fontSize: 12, color: "var(--fg-secondary)" }}>{profile.label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12 }}>
          約 {total.min}–{total.max}
          {limit ? ` / ${limit}` : ""} token
        </span>
      </div>
      {limit ? (
        <div
          aria-hidden
          style={{ position: "relative", height: 6, marginTop: 7, borderRadius: 999, background: "var(--surface-sunken)", overflow: "hidden" }}
        >
          <div style={{ position: "absolute", inset: 0, width: `${usedPercent}%`, background: overflows ? "var(--danger-soft)" : "var(--gold-soft)" }} />
          <div style={{ position: "absolute", inset: 0, width: `${safePercent}%`, background: overflows ? "var(--danger)" : "var(--success)" }} />
        </div>
      ) : null}
      <Meta as="p" style={{ margin: "6px 0 0", fontSize: 12 }}>
        {profile.note}
        {limit ? "　估算為區間；只有連最低估計都超過窗口，才會標成「沒進模型」。" : ""}
      </Meta>
    </Card>
  );
}

function FlowNode({
  accent,
  title,
  roleLabel,
  hint,
  last,
  testId,
  meta,
  children,
}: {
  accent: NodeAccent;
  title: string;
  /** 節點副標：這一段負責什麼（「自動帶入」「外觀鎖定」…） */
  roleLabel?: string;
  hint?: string;
  last: boolean;
  testId: string;
  /** 標題列右側的附註（注意力預算徽章） */
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "26px 1fr", columnGap: 10, paddingBottom: last ? 0 : 10 }}>
      {/* 圓點與連接線純屬版面語意，讀屏念節點標題就夠了 */}
      <div aria-hidden style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            width: 26,
            height: 26,
            flex: "0 0 auto",
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            fontWeight: 700,
            color: accent.ink,
            background: accent.soft,
            border: `1px solid ${accent.line}`,
          }}
        >
          {accent.glyph}
        </div>
        {last ? null : (
          <div style={{ flex: 1, width: 2, minHeight: 12, marginTop: 4, borderRadius: 1, background: "var(--border-strong)" }} />
        )}
      </div>
      <Card variant="quiet" style={{ ...nodeCardStyle, borderLeft: `3px solid ${accent.line}` }} data-testid={testId}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          {roleLabel ? <span style={{ fontSize: 11, color: accent.ink }}>{roleLabel}</span> : null}
          {meta ? <><span style={{ flex: 1 }} />{meta}</> : null}
        </div>
        {hint ? <Meta as="p" style={{ margin: "3px 0 0", fontSize: 12 }}>{hint}</Meta> : null}
        {children}
      </Card>
    </li>
  );
}

export function PromptFlowMap({
  positivePrompt,
  negativePrompt,
  parameters,
  provider,
  model,
  modelId,
  estimatedPoints,
  warnings = [],
}: {
  positivePrompt: string;
  negativePrompt?: string;
  parameters: Array<{ key: string; label: string; value: string }>;
  provider?: string;
  model?: string;
  /** 模型目錄 id：查文字編碼器窗口用（label 查不到，家族比對要吃 id） */
  modelId?: string;
  estimatedPoints?: number;
  warnings?: AiWarning[];
}) {
  const promptNodes = buildPromptFlow(positivePrompt);
  // 注意力預算：依實際疊加順序算，截斷從尾端發生，所以最後疊上去的素材設定最先被犧牲
  const encoder = textEncoderProfileFor(modelId);
  const budget = analyzePromptBudget(
    promptNodes.map((node) => ({ id: node.key, text: node.raw })),
    encoder,
  );
  const budgetByKey = new Map(budget.segments.map((segment) => [segment.id, segment]));
  const negativeItems = negativePrompt ? parseNegativeItems(negativePrompt) : [];
  const hasModelNode = Boolean(provider || model || parameters.length || estimatedPoints != null);

  const presentKeys = new Set<PromptFlowNodeKey>(promptNodes.map((node) => node.key));
  if (negativeItems.length) presentKeys.add("negative");
  if (hasModelNode) presentKeys.add("model");
  const distributed = distributePromptWarnings(warnings, presentKeys);

  const total = promptNodes.length + (negativeItems.length ? 1 : 0) + (hasModelNode ? 1 : 0);
  const isLast = (index: number) => index === total - 1;

  if (!total) {
    return <Meta as="p" data-testid="prompt-flow-map-empty">這次請求沒有創作提示詞。</Meta>;
  }

  const nodeBody = (node: PromptFlowNode) =>
    node.fields.length ? (
      <FieldGrid fields={node.fields} />
    ) : (
      <div
        style={{
          marginTop: 8,
          padding: "7px 9px",
          borderRadius: 8,
          background: "var(--card2)",
          border: "1px solid var(--border-soft)",
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {node.text}
      </div>
    );

  return (
    <>
      <EncoderWindow budget={budget} />
      <ol data-testid="prompt-flow-map" style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
      {promptNodes.map((node, index) => (
        <FlowNode
          key={node.key}
          accent={ACCENTS[node.key]}
          title={node.title}
          roleLabel={node.role}
          hint={node.hint}
          last={isLast(index)}
          testId={`prompt-flow-node-${node.key}`}
          meta={(() => {
            const segment = budgetByKey.get(node.key);
            return segment ? <BudgetBadge budget={segment} /> : null;
          })()}
        >
          {nodeBody(node)}
          <NodeWarnings warnings={distributed.byNode[node.key] ?? []} />
        </FlowNode>
      ))}

      {negativeItems.length ? (
        <FlowNode
          accent={ACCENTS.negative}
          title="限制與避免"
          roleLabel="送出前擋掉"
          hint="專案禁忌走負向提示詞，模型會盡量不畫出這些內容。"
          last={isLast(promptNodes.length)}
          testId="prompt-flow-node-negative"
        >
          <div style={{ marginTop: 6 }}>
            {negativeItems.map((item, index) => (
              <Chip key={`${item}-${index}`}>{item}</Chip>
            ))}
          </div>
          <NodeWarnings warnings={distributed.byNode.negative ?? []} />
        </FlowNode>
      ) : null}

      {hasModelNode ? (
        <FlowNode
          accent={ACCENTS.model}
          title="送給模型"
          roleLabel={provider}
          last
          testId="prompt-flow-node-model"
        >
          {model ? <div style={{ marginTop: 6, fontSize: 13, overflowWrap: "anywhere" }}>{model}</div> : null}
          {parameters.length || estimatedPoints != null ? (
            <FieldGrid
              fields={[
                ...parameters.map((parameter) => ({ label: parameter.label, value: parameter.value })),
                ...(estimatedPoints != null ? [{ label: "預估點數", value: `${estimatedPoints} 點` }] : []),
              ]}
            />
          ) : null}
          <NodeWarnings warnings={distributed.byNode.model ?? []} />
          <ModelMechanicsView modelId={modelId} />
        </FlowNode>
      ) : null}

      {distributed.general.length ? (
        <li style={{ listStyle: "none", marginTop: 4 }}>
          {/* 對不上任何節點的警告仍要完整顯示，並保留原本的 role="status" 播報 */}
          <div role="status">
            <NodeWarnings warnings={distributed.general} />
          </div>
        </li>
      ) : null}
      </ol>
    </>
  );
}
