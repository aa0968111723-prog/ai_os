import type { CSSProperties } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { AssetImg, MissingMediaBox } from "../../components/MediaFallback";
import { Chip, Meta, Pill } from "../../components/ui";
import {
  assetFileUrl,
  type PreviewMedia,
  type PreviewMediaKind,
  type ToolResultPreview as Preview,
} from "../../../../shared/toolResultPreview";

/**
 * 工具跑完之後，把**實際結果**畫出來。
 *
 * 為什麼需要這個：先前工具結果只以純文字存在——使用者看到「查了素材庫(12 筆)」，
 * 但那 12 筆是什麼、長什麼樣，完全看不到。`AiTraceHistory` 更直接把整包 payload
 * 用 `<pre>{JSON.stringify(...)}</pre>` 倒出來，等於要使用者自己讀 JSON。
 *
 * 這裡刻意**只畫真的發生過的事**：工具查到的素材、那一鏡的畫面、生成的成品、
 * 資料庫的列。不畫流程圖、不畫狀態機、不畫任何「示意」——那些都是我們想像出來的，
 * 不是這次工具的結果。
 *
 * ## 手機優先（390px 是硬性條件）
 * 390px 扣掉安全區與 padding 剩約 330px。素材格用 `auto-fill minmax(92px, 1fr)`
 * 落在 3 欄；表格類一律走「標籤在上、值在下」的堆疊卡而不是真表格——
 * 真表格在窄螢幕只能橫捲，而 html/body 是 `overflow-x: clip`（有測試鎖住），
 * 超寬內容不會產生捲軸，是**被硬裁**。
 */

const MEDIA_ICON: Record<PreviewMediaKind, IconName> = {
  image: "Image",
  video: "Film",
  audio: "Music",
  doc: "FileText",
};

/** 生成狀態 → Pill。Pill 只有五種狀態，這裡把六種生成狀態收斂進去。 */
function generationPill(status: string): { status: "queued" | "running" | "done" | "failed" | "neutral"; label: string } {
  switch (status) {
    case "done": return { status: "done", label: "完成" };
    case "running": return { status: "running", label: "生成中" };
    case "queued": return { status: "queued", label: "排隊中" };
    case "awaiting_approval": return { status: "queued", label: "待核准" };
    case "failed": return { status: "failed", label: "失敗" };
    case "rejected": return { status: "failed", label: "已駁回" };
    default: return { status: "neutral", label: status };
  }
}

/**
 * 一格媒體。
 *
 * 只有 image 真的載圖：伺服器端沒有影片首幀擷取，`meta.thumbPath` 也只針對 image 補產，
 * 對影片硬塞 `<video>` 只會在手機上白吃頻寬換來一塊黑底。影音與文件改用圖示磚，
 * 資訊量一樣（使用者要知道的是「這格是什麼」），成本天差地遠。
 */
function MediaTile({
  media,
  alt,
  size = 92,
}: {
  media: PreviewMedia;
  alt: string;
  size?: number | string;
}) {
  const box: CSSProperties = {
    width: "100%",
    aspectRatio: "1 / 1",
    minHeight: typeof size === "number" ? size : undefined,
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--card2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  if (media.source === "none") {
    // 「還沒生成」與「找不到」對使用者的意義完全不同：前者是待辦，後者是壞掉。
    return media.reason === "missing" ? (
      <MissingMediaBox label="素材遺失" height="100%" iconSize={16} style={box} />
    ) : (
      <div style={box} role="img" aria-label="尚未生成">
        <Icon name="Sparkles" size={16} />
      </div>
    );
  }

  if (media.mediaKind !== "image") {
    return (
      <div style={box} role="img" aria-label={`${alt}（${media.mediaKind}）`}>
        <Icon name={MEDIA_ICON[media.mediaKind]} size={18} />
      </div>
    );
  }

  return (
    <div style={box}>
      <AssetImg
        src={assetFileUrl(media.assetId, { thumb: true, mediaKind: media.mediaKind })}
        alt={alt}
        loading="lazy"
        decoding="async"
        fallbackLabel="素材遺失"
        fallbackHeight="100%"
        fallbackIconSize={16}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}

/** 素材庫：縮圖網格。標題放在圖下方兩行內截斷，不用 title 屬性（手機沒有 hover）。 */
function AssetGrid({ preview }: { preview: Extract<Preview, { kind: "assets" }> }) {
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
          gap: 8,
        }}
      >
        {preview.items.map((item) => (
          <div key={item.assetId} style={{ minWidth: 0 }}>
            <MediaTile
              media={{ source: "asset", assetId: item.assetId, mediaKind: item.mediaKind }}
              alt={item.title}
            />
            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 3 }}>
              {item.locked ? <Icon name="Lock" size={10} /> : null}
              {item.aiGenerated ? <Icon name="Sparkles" size={10} /> : null}
              <Meta
                as="span"
                style={{
                  fontSize: 11,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {item.title}
              </Meta>
            </div>
          </div>
        ))}
      </div>
      {preview.truncated ? (
        <Meta as="p" style={{ margin: "6px 0 0" }}>
          只顯示最近 {preview.items.length} 筆（AI 這次也只看到這些）——完整清單在素材庫。
        </Meta>
      ) : null}
    </div>
  );
}

/** 分鏡：畫面在左、文字在右；窄螢幕自動疊成上下。 */
function SceneDetail({ preview }: { preview: Extract<Preview, { kind: "scene" }> }) {
  const { scene } = preview;
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <div style={{ flex: "0 0 110px", maxWidth: 110 }}>
        <MediaTile media={scene.visual} alt={`第 ${scene.sceneNo} 鏡的畫面`} />
      </div>
      <div style={{ flex: "1 1 12rem", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <strong>第 {scene.sceneNo} 鏡「{scene.title}」</strong>
          <Chip>{scene.durationSec} 秒</Chip>
          {scene.narration.source === "asset" ? <Chip>有旁白</Chip> : null}
        </div>
        {/* 未填與填了空的要能分辨：未填顯示灰字「未填」，不是留白 */}
        <Meta as="p" style={{ margin: "6px 0 0" }}>
          提示詞：{scene.prompt ?? "（未填）"}
        </Meta>
        <Meta as="p" style={{ margin: "4px 0 0" }}>
          旁白：{scene.voiceover ?? "（未填）"}
        </Meta>
      </div>
    </div>
  );
}

/** 生成紀錄：每列一格成品縮圖＋模型／狀態／點數。 */
function GenerationList({ preview }: { preview: Extract<Preview, { kind: "generations" }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {preview.items.map((item, index) => {
        const pill = generationPill(item.status);
        return (
          <div key={`${item.modelLabel}-${index}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: "0 0 56px", maxWidth: 56 }}>
              <MediaTile media={item.media} alt={item.prompt} size={56} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Pill status={pill.status}>{pill.label}</Pill>
                <Meta as="span" style={{ fontSize: 11 }}>{item.modelLabel}・{item.points} 點</Meta>
              </div>
              <Meta as="p" style={{ margin: "3px 0 0", fontSize: 11 }}>{item.prompt}</Meta>
            </div>
          </div>
        );
      })}
      {preview.truncated ? (
        <Meta as="p" style={{ margin: 0 }}>只顯示最近 {preview.items.length} 筆。</Meta>
      ) : null}
    </div>
  );
}

/**
 * 資料庫的列。
 *
 * 刻意不用 `<table>`：390px 放不下多欄表格，而 html/body 的 `overflow-x: clip` 會把
 * 超寬內容硬裁掉（不是給你捲軸）。改成每列一張堆疊卡，標籤在左、值在右。
 */
function RowsTable({ preview }: { preview: Extract<Preview, { kind: "rows" }> }) {
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {preview.rows.map((row, index) => (
          <div
            key={index}
            style={{
              background: "var(--card2)",
              borderRadius: 8,
              padding: "6px 8px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {row.cells.map((cell) => (
              <div key={cell.label} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                <Meta as="span" style={{ flex: "0 0 5.5rem", fontSize: 11 }}>{cell.label}</Meta>
                <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{cell.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <Meta as="p" style={{ margin: "6px 0 0" }}>
        「{preview.tableName}」共 {preview.total} 列，AI 這次讀了 {preview.rows.length} 列。
      </Meta>
    </div>
  );
}

/** 模型目錄：每列一張卡（同樣不用表格，理由見 RowsTable）。 */
function ModelTable({ preview }: { preview: Extract<Preview, { kind: "models" }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {preview.items.map((m) => (
        <div key={m.id} style={{ background: "var(--card2)", borderRadius: 8, padding: "6px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 12 }}>{m.label}</strong>
            <Chip>{m.tierLabel}</Chip>
            <Chip>{m.points} 點</Chip>
            {m.ready ? null : <Pill status="queued">待驗證</Pill>}
          </div>
          <Meta as="p" style={{ margin: "3px 0 0", fontSize: 11 }}>{m.bestFor}</Meta>
          {m.needsSource ? (
            <Meta as="p" style={{ margin: "2px 0 0", fontSize: 11 }}>需要來源素材：{m.needsSource}</Meta>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * 依 preview 型別分派。
 *
 * `kind: "text"` 是降級出口——工具沒有可視覺化的結果（查無資料、參數錯誤，或這個工具
 * 本來就只回文字）時走這裡，照舊顯示那段文字。有它在，新增工具不必先實作預覽也能接上。
 */
export function ToolResultPreview({ preview }: { preview: Preview }) {
  switch (preview.kind) {
    case "assets": return <AssetGrid preview={preview} />;
    case "scene": return <SceneDetail preview={preview} />;
    case "generations": return <GenerationList preview={preview} />;
    case "rows": return <RowsTable preview={preview} />;
    case "models": return <ModelTable preview={preview} />;
    case "text":
      return (
        <Meta as="p" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {preview.text}
        </Meta>
      );
    // TS 認為上面已窮舉，但 preview 是從 SSE／資料庫 JSON 來的執行期資料——
    // 舊資料或未來新增的 kind 會落到這裡。安靜不渲染，不要讓整條軌跡爆掉。
    default:
      return null;
  }
}
