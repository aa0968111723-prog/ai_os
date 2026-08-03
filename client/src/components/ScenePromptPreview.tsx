import { useState } from "react";
import type { AiOperationPreview } from "@shared/aiTrace";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Hint, Meta } from "./ui";

/**
 * 逐鏡預覽：這一格出圖前，先看 AI 實際會收到什麼（不扣點、不送出）。
 *
 * 走的是 generation.preview——與真正送出同一支組裝器（prepareGenerationRequest），
 * 所以預覽不可能說謊：世界觀、角色／場景／素材錨點都是實際會注入的那份。
 */
export function ScenePromptPreview({
  projectId,
  modelId,
  prompt,
  characterIds,
  scenePresetIds,
  propIds,
}: {
  projectId: string;
  modelId: string;
  prompt: string;
  characterIds: string[];
  scenePresetIds: string[];
  propIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const preview = trpc.generation.preview.useMutation();

  const run = () => {
    setOpen(true);
    preview.mutate({
      projectId,
      modelId,
      prompt: prompt.trim(),
      characterIds: characterIds.length ? characterIds : undefined,
      scenePresetIds: scenePresetIds.length ? scenePresetIds : undefined,
      propIds: propIds.length ? propIds : undefined,
    });
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        title="先看這一格實際會送出的提示詞與帶入的設定（不扣點）"
        disabled={!prompt.trim() || preview.isPending}
        onClick={() => (open ? setOpen(false) : run())}
      >
        <Icon name="Search" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        {preview.isPending ? "預覽中…" : open ? "收起預覽" : "先預覽"}
      </Button>

      {open && (
        <div
          style={{
            flexBasis: "100%",
            marginTop: 6,
            padding: 8,
            border: "1px solid var(--border-soft)",
            borderRadius: 8,
          }}
        >
          {preview.isPending ? (
            <Meta as="p" style={{ margin: 0, fontSize: "var(--fs-11)" }}>組裝中…</Meta>
          ) : preview.error ? (
            <p className="error" role="alert" style={{ margin: 0, fontSize: "var(--fs-11)" }}>
              預覽失敗：{preview.error.message}
            </p>
          ) : preview.data ? (
            <PreviewBody data={preview.data as AiOperationPreview} />
          ) : null}
        </div>
      )}
    </>
  );
}

function PreviewBody({ data }: { data: AiOperationPreview }) {
  const included = data.context.filter((c) => c.included);
  const missing = data.context.filter((c) => !c.included);
  // request 是 sanitize 過的 provider 輸入；prompt 欄位名依模型而異，取常見的兩個
  const req = data.request as Record<string, unknown> | undefined;
  const sent = typeof req?.prompt === "string" ? req.prompt : typeof req?.text === "string" ? req.text : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Meta as="div" style={{ fontSize: "var(--fs-11)" }}>
        <b>{data.model}</b>
        {data.estimatedPoints != null ? `・約 −${data.estimatedPoints} 點` : ""}
      </Meta>
      <Meta as="div" style={{ fontSize: "var(--fs-11)" }}>
        帶入：{included.length ? included.map((c) => c.label).join("・") : "（只有這一格的提示詞）"}
      </Meta>
      {missing.length > 0 && (
        <Meta as="div" style={{ fontSize: "var(--fs-11)", opacity: 0.75 }}>
          沒帶入：{missing.map((c) => c.label).join("・")}
        </Meta>
      )}
      {sent && (
        <pre
          style={{
            margin: 0,
            fontSize: "var(--fs-11)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 180,
            overflow: "auto",
          }}
        >
          {sent}
        </pre>
      )}
      {data.warnings.length > 0 && (
        <Hint layer="always" role="status" style={{ color: "var(--gold-ink)" }}>
          {data.warnings.map((w) => w.title).join("；")}
        </Hint>
      )}
    </div>
  );
}
