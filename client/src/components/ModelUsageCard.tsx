/**
 * 模型指南頂欄：我的使用量（近 30 天）
 * 取代「站內契約健康」——一般創作者要看的是自己用了什麼，不是 404／逾時／NIM。
 *
 * 為什麼是圖不是字：這張卡回答三個問題——「我花了多少」「順不順」「用在哪一類」。
 * 前兩個是單一數字（摘要格＋完成率計量條），第三個是佔比與排名（堆疊條＋橫向長條）。
 * 三種資料各配一種形，不是把同一批數字換三種寫法。
 *
 * 誠實規則：
 * - 摘要格與分佈條的分母都是 **全部** 用過的模型（端點的 totals 已改為全量計算），
 *   榜單只列前 12 名，其餘併成「其他 N 顆」，所以圖上的 100% 真的是 100%。
 * - 「送出」含排隊中／待審／已否決，不等於失敗，因此標「完成／送出」不標「成功率」。
 * - 點數只在完成時累計，自帶金鑰（BYOK）跑的會是 0 點——次數多而點數 0 是正常的。
 * - 條是裝飾（aria-hidden），每個數字都仍以文字留在 DOM 裡，讀屏與測試都拿得到。
 */
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { getModel } from "@shared/models";
import { Icon, type IconName } from "./Icon";
import { Button, Card, Hint, Meta, Skeleton } from "./ui";

/** 榜單預設長度；其餘收在「再顯示」後面，手機才不會被一張卡吃掉整屏 */
const RANK_PREVIEW = 6;

type UsageKind = "image" | "video" | "audio" | "text" | "other";

/**
 * 四種產出類型的固定色序（外加中性的「其他」）。
 *
 * - **顏色跟著類型走，不跟著名次走**：篩掉一列不會讓其他列改色。
 * - 取自品牌色帶與點綴色，避開 --success／--danger——那兩個在站內是狀態語意
 *   （完成／失敗），借去當分類色會讓「綠色那條」被誤讀成「成功的那條」。
 * - 這組四色經色盲安全檢查（全配對 ΔE：deutan／protan／tritan 皆 ≥ 8，
 *   一般視覺 ≥ 17）；其中 --brand-lime 對底色對比未達 3:1，故每一列都必須
 *   同時有圖示與文字標籤，不靠顏色單獨表意。
 */
const KIND_META: Record<UsageKind, { label: string; icon: IconName }> = {
  image: { label: "圖片", icon: "Image" },
  video: { label: "影片", icon: "Clapperboard" },
  audio: { label: "語音", icon: "Volume2" },
  text: { label: "文字", icon: "FileText" },
  other: { label: "其他", icon: "Package" },
};
/** 分佈條的段落順序：固定不變，跟資料大小無關 */
const KIND_ORDER: UsageKind[] = ["image", "video", "audio", "text", "other"];

export interface UsageRow {
  modelId: string;
  submits: number;
  done: number;
  points: number;
}
export interface UsageData {
  days: number;
  models: UsageRow[];
  totalSubmits: number;
  totalDone: number;
  totalPoints: number;
  /** 期間內用過的不同模型數（含未進榜的）。舊版端點沒有這個欄位，缺少時退回榜單長度。 */
  modelCount?: number;
}

export function ModelUsageCard() {
  const usage = trpc.models.myUsage.useQuery({ days: 30 }, { staleTime: 60_000 });

  if (usage.isLoading) {
    return (
      <Card as="section" className="model-usage-overview" data-fb="模型使用量">
        <Skeleton style={{ height: 208 }} />
      </Card>
    );
  }

  if (usage.error) {
    return (
      <Card as="section" className="model-usage-overview" data-fb="模型使用量">
        <UsageHead />
        <p className="error" style={{ marginTop: 8 }}>載入失敗——{usage.error.message}</p>
      </Card>
    );
  }

  const data = usage.data;
  if (!data) return null;
  return <UsageOverview data={data} />;
}

/** 標題列（載入失敗時也要在，卡片才不會只剩一句紅字） */
function UsageHead({ days, trailing }: { days?: number; trailing?: boolean }) {
  return (
    <div className="model-usage__head">
      <b className="model-usage__title">
        <Icon name="Star" size={16} />我的使用量
      </b>
      {days != null && <Meta>近 {days} 天</Meta>}
      {trailing && (
        <Link href="/dashboard" className="model-usage__cta">
          到工作台繼續用 <Icon name="ArrowRight" size={12} />
        </Link>
      )}
    </div>
  );
}

/**
 * 純呈現層：吃一份聚合資料就畫得出來，不碰網路。
 * 拆出來是為了讓測試與版面預覽都能餵假資料，不必架 tRPC。
 */
export function UsageOverview({ data }: { data: UsageData }) {
  const empty = data.models.length === 0;
  if (empty) {
    return (
      <Card as="section" className="model-usage-overview" data-fb="模型使用量">
        <UsageHead days={data.days} />
        <Hint layer="always" style={{ margin: "8px 0 0" }}>
          還沒有生成紀錄——用下方「怎麼選模型」挑一個，到工作台跑一輪就會出現在這裡。
        </Hint>
      </Card>
    );
  }

  const rows = data.models.map((row) => {
    const m = getModel(row.modelId);
    return {
      ...row,
      label: m?.label ?? row.modelId,
      kind: ((m?.kind ?? "other") as UsageKind),
    };
  });

  const modelCount = data.modelCount ?? rows.length;
  const listedSubmits = rows.reduce((s, r) => s + r.submits, 0);
  /** 未進榜的模型：次數併進分佈條的「其他」，圖上的百分比才對得起 totalSubmits */
  const restModels = Math.max(0, modelCount - rows.length);
  const restSubmits = Math.max(0, data.totalSubmits - listedSubmits);

  const doneRate = data.totalSubmits > 0 ? Math.round((data.totalDone / data.totalSubmits) * 100) : 0;
  const maxSubmits = Math.max(...rows.map((r) => r.submits), 1);

  const mixTotal = Math.max(data.totalSubmits, 1);
  const mix = KIND_ORDER.map((kind) => {
    const submits =
      rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.submits, 0) +
      (kind === "other" ? restSubmits : 0);
    return { kind, submits, pct: (submits / mixTotal) * 100 };
  }).filter((seg) => seg.submits > 0);

  return (
    <Card as="section" className="model-usage-overview" data-fb="模型使用量">
      <UsageHead days={data.days} trailing />

      {/* ① 摘要：三個單一數字，配摘要格不配圖表 */}
      <div className="model-usage__stats" role="group" aria-label="近期使用摘要">
        <span>
          <strong>{data.totalSubmits.toLocaleString()}</strong>
          <small>次送出</small>
        </span>
        <span className="model-usage__stat--meter">
          <strong>{data.totalDone.toLocaleString()}</strong>
          <small>次完成 · {doneRate}%</small>
          <i className="model-usage__meter" aria-hidden="true">
            <i style={{ width: `${doneRate}%` }} />
          </i>
        </span>
        <span>
          <strong>{data.totalPoints.toLocaleString()}</strong>
          <small>點</small>
        </span>
        <span>
          <strong>{modelCount.toLocaleString()}</strong>
          <small>顆模型</small>
        </span>
      </div>

      {/* ② 分佈：整段期間的次數怎麼分到四種產出，一條堆疊條＋圖例 */}
      {mix.length > 1 && (
        <div className="model-usage__mix">
          <div className="model-usage__mixbar" aria-hidden="true">
            {mix.map((seg) => (
              <i key={seg.kind} className={`is-${seg.kind}`} style={{ width: `${seg.pct}%` }} />
            ))}
          </div>
          <ul className="model-usage__legend">
            {mix.map((seg) => (
              <li key={seg.kind} className={`is-${seg.kind}`}>
                <i aria-hidden="true" />
                {KIND_META[seg.kind].label}
                <b>{seg.submits}</b>
                <Meta>次</Meta>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ③ 排名：哪幾顆撐起這 30 天——長度＝送出次數，顏色＝產出類型 */}
      <UsageRank rows={rows} maxSubmits={maxSubmits} />

      {restModels > 0 && (
        <Meta as="p" className="model-usage__foot">
          榜上是送出次數前 {rows.length} 名；其餘 {restModels} 顆（{restSubmits} 次）併入分佈條的「其他」。
        </Meta>
      )}
    </Card>
  );
}

function UsageRank({
  rows,
  maxSubmits,
}: {
  rows: Array<UsageRow & { label: string; kind: UsageKind }>;
  maxSubmits: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = rows.length - RANK_PREVIEW;
  const visible = expanded || hidden <= 0 ? rows : rows.slice(0, RANK_PREVIEW);
  /** 只有一顆模型時長條永遠是滿格，畫了也比不出東西——那就只留數字。 */
  const withBars = rows.length > 1;

  return (
    <>
      <ol className="model-usage__rank">
        {visible.map((row, i) => (
          <li
            key={row.modelId}
            className={`model-usage__row is-${row.kind}`}
            title={`${KIND_META[row.kind].label}・${row.label}：送出 ${row.submits} 次、完成 ${row.done} 次、${row.points} 點`}
          >
            {withBars && (
              <i
                className="model-usage__bar"
                aria-hidden="true"
                style={{ width: `${(row.submits / maxSubmits) * 100}%` }}
              />
            )}
            <span className="model-usage__no" aria-hidden="true">{i + 1}</span>
            <span className="model-usage__kind" aria-hidden="true">
              <Icon name={KIND_META[row.kind].icon} size={13} />
            </span>
            <span className="model-usage__name">{row.label}</span>
            <span className="model-usage__num">
              {row.submits} 次 · {row.points} 點
            </span>
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="model-usage__more"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} />
          {expanded ? "收合榜單" : `再顯示 ${hidden} 顆`}
        </Button>
      )}
    </>
  );
}
