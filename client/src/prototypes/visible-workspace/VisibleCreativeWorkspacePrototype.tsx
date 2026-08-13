/**
 * PROTOTYPE ONLY — Aios Visible Creative Workspace 設計原型。
 *
 * 目的：回答一個產品問題，不是交付一個功能。
 *   「底層做了 #707 / #710 / #722 / #723 / v4 這麼多輪，
 *     為什麼使用者打開 Aios 還是覺得『沒什麼變』？」
 *
 * 答案在 docs/product/aios-visible-workspace-design.md 的 Before 量測：
 * 現行助手是一張 600px 寬的浮動卡，AI 的自我記錄（狀態卡＋工作過程）
 * 佔的畫素比「答案本身」還多，而**作品佔 0%**。
 *
 * 這支原型只做一件事：把版面反過來——作品最大，Aios 退到旁邊，
 * 自然語言變成情境命令列而不是聊天室。
 *
 * 規則：
 * - 全部使用 fixture 假資料（./fixtures），不呼叫任何 tRPC、不寫入任何 truth。
 * - 不從 production 匯入、也不被 production 匯入；只有一條 /prototype/* route 進得來。
 * - 版面只用 client/src/components/ui 的 primitives（UIUX-01 棘輪對新檔案 baseline = 0）。
 * - 樣式獨立在 ./workspace.prototype.css，**不動 styles.css**（v4 主工程正在改那支）。
 */
import { useMemo, useState } from "react";
import { Badge, Button, Card, Chip, Hint, Meta, Pill } from "../../components/ui";
import { Icon } from "../../components/Icon";
import {
  ACT_PROGRESS,
  CANDIDATES,
  CANDIDATES_PARTIAL,
  DIRECTIONS,
  FOCUS_SHOT_NO,
  PROJECT_CRUMB,
  PROTOTYPE_BANNER,
  REFERENCES,
  SCENARIOS,
  SHOTS,
  frameArt,
  type CandidateState,
  type PrototypeCandidate,
  type PrototypeShot,
  type Scenario,
  type ShotState,
} from "./fixtures";
import "./workspace.prototype.css";

/* ── 狀態語彙：一律對齊 sceneVersions 的既有狀態，不自己發明第五種 ────────── */

const SHOT_PILL: Record<ShotState, { status: "done" | "running" | "failed" | "queued" | "neutral"; text: string }> = {
  current: { status: "done", text: "已完成" },
  generating: { status: "running", text: "生成中" },
  awaiting_approval: { status: "queued", text: "待核准" },
  failed: { status: "failed", text: "失敗" },
  empty: { status: "neutral", text: "未開始" },
};

const CANDIDATE_PILL: Record<CandidateState, { status: "done" | "running" | "failed" | "queued"; text: string }> = {
  done: { status: "done", text: "可採用" },
  generating: { status: "running", text: "生成中" },
  failed: { status: "failed", text: "失敗" },
  awaiting_approval: { status: "queued", text: "待核准" },
};

const REF_ICON = { character: "User", look: "Palette", scene: "Compass" } as const;

/* ── 情境命令列：placeholder 跟著選取走（這是「Chat → Command Bar」的核心） ── */

function commandPlaceholder(scenario: Scenario, shotNo: number, multi: number): string {
  if (scenario === "act") return "告訴 Aios 接下來這一幕要怎麼收…";
  if (scenario === "idle") return "接下來想讓 Aios 完成什麼？";
  if (multi > 1) return `告訴 Aios 想怎麼調整這 ${multi} 鏡…`;
  return `告訴 Aios 想怎麼修改 Shot ${String(shotNo).padStart(2, "0")}…`;
}

/* ── 小元件 ──────────────────────────────────────────────────────────────── */

function Crumb({ trail, shot }: { trail: string[]; shot?: PrototypeShot }) {
  return (
    <div className="vcw-crumb">
      {trail.map((part) => (
        <span key={part} className="vcw-crumb__part">
          {part}
          <Icon name="ChevronRight" size={13} />
        </span>
      ))}
      {shot && <strong className="vcw-crumb__now">Shot {String(shot.no).padStart(2, "0")}・{shot.title}</strong>}
    </div>
  );
}

/** 作品舞台：整個設計的重點就是這一塊要最大 */
function Stage({ shot, empty }: { shot?: PrototypeShot; empty?: boolean }) {
  if (empty || !shot?.artUrl) {
    return (
      <div className="vcw-stage vcw-stage--empty">
        <div className="vcw-stage__placeholder">
          <Icon name="Image" size={28} />
          <Meta as="p">這一鏡還沒有畫面</Meta>
          <Button variant="primary" size="sm"><Icon name="Sparkles" size={14} /> 讓 Aios 提幾個方向</Button>
        </div>
      </div>
    );
  }
  return (
    <figure className="vcw-stage">
      <img className="vcw-stage__art" src={shot.artUrl} alt={`Shot ${shot.no} ${shot.title} 的現用畫面`} />
      <figcaption className="vcw-stage__bar">
        <Badge>現用</Badge>
        {shot.reviewStatus === "approved" && <Badge>已通過</Badge>}
        {shot.outdatedReason && <Pill status="failed">畫面過時・{shot.outdatedReason}</Pill>}
        <span className="vcw-spacer" />
        <Button size="sm" variant="ghost"><Icon name="Layers" size={14} /> 版本</Button>
        <Button size="sm" variant="tonal"><Icon name="LayoutGrid" size={14} /> 開啟單格工作室</Button>
      </figcaption>
    </figure>
  );
}

/** 創作方向：短、可看、可選——不是三段 AI 說明 */
function DirectionRow({
  picked,
  onPick,
}: {
  picked: string[];
  onPick: (id: string) => void;
}) {
  return (
    <section className="vcw-directions" aria-label="創作方向">
      <div className="vcw-directions__head">
        <strong>創作方向</strong>
        <Meta as="span">Aios 提議三個真的不同的做法・選一個或多個</Meta>
      </div>
      <ul className="vcw-directions__list">
        {DIRECTIONS.map((d) => {
          const on = picked.includes(d.id);
          return (
            <li key={d.id}>
              <Chip
                as="div"
                selected={on}
                onClick={() => onPick(d.id)}
                className="vcw-direction"
                aria-label={`${d.label}：${d.changes.join("、")}`}
              >
                <img className="vcw-direction__art" src={frameArt(d.art, d.id.length)} alt="" />
                <span className="vcw-direction__copy">
                  <strong>{d.label}</strong>
                  <span className="vcw-direction__changes">{d.changes.join("・")}</span>
                  <span className="vcw-direction__keep">
                    <Icon name="Lock" size={11} /> 保持 {d.keep.join("／")}
                  </span>
                </span>
              </Chip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 候選：直接出現在眼前，不是躲在另一個 modal 裡 */
function CandidateRail({ candidates }: { candidates: PrototypeCandidate[] }) {
  const usable = candidates.filter((c) => c.state === "done");
  const net = candidates.reduce((sum, c) => sum + (c.points ?? 0), 0);
  return (
    <section className="vcw-candidates" aria-label="候選">
      <div className="vcw-candidates__head">
        <strong>候選</strong>
        <Meta as="span">
          {usable.length}/{candidates.length} 可採用・已結算 {net} 點
        </Meta>
      </div>
      <ul className="vcw-candidates__list">
        {candidates.map((c) => {
          const dir = DIRECTIONS.find((d) => d.id === c.directionId);
          const pill = CANDIDATE_PILL[c.state];
          return (
            <li key={c.slot} className="vcw-candidate" data-state={c.state}>
              <div className="vcw-candidate__frame">
                {c.assetUrl ? (
                  <img src={c.assetUrl} alt={`候選 ${c.slot}：${dir?.label ?? ""}`} loading="lazy" />
                ) : (
                  <div className="vcw-candidate__pending" aria-hidden="true">
                    <Icon name={c.state === "failed" ? "X" : c.state === "awaiting_approval" ? "Clock" : "Sparkles"} size={20} />
                  </div>
                )}
                <span className="vcw-candidate__slot">{c.slot}</span>
              </div>
              <div className="vcw-candidate__meta">
                <strong>{dir?.label ?? c.slot}</strong>
                <Pill status={pill.status}>{pill.text}</Pill>
              </div>
              {c.error && <Meta as="p" className="vcw-candidate__err">{c.error}</Meta>}
              {c.state === "done" && (
                <div className="vcw-candidate__actions">
                  <Button size="sm" variant="primary">採用</Button>
                  <Button size="sm" variant="ghost">再變體</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="vcw-candidates__foot">
        <Button size="sm" variant="tonal" disabled={usable.length < 2}>
          <Icon name="Copy" size={14} /> 並排比較{usable.length < 2 ? "（需 2 個以上）" : ""}
        </Button>
      </div>
    </section>
  );
}

/** Aios 面板：講「做到哪了」，不是「跑了什麼工具」 */
function AiosRail({ candidates, busy }: { candidates: PrototypeCandidate[]; busy: boolean }) {
  const [showLog, setShowLog] = useState(false);
  const running = candidates.filter((c) => c.state === "generating").length;
  return (
    <Card variant="quiet" className="vcw-aios">
      <header className="vcw-aios__head">
        <span className="vcw-aios__mark" data-busy={busy}><Icon name="Sparkles" size={14} /></span>
        <strong>Aios</strong>
        {busy && <Pill status="running">候選 {candidates.length - running}/{candidates.length}</Pill>}
      </header>

      <ul className="vcw-aios__refs">
        {REFERENCES.map((r) => (
          <li key={r.label}>
            <Icon name={REF_ICON[r.kind]} size={13} />
            <span>{r.label}</span>
            {r.locked && <Badge>保持</Badge>}
          </li>
        ))}
      </ul>

      <Hint>這一輪只改鏡頭與光線；角色、造型、場景由既有錨點鎖住。</Hint>

      <Button size="sm" variant="ghost" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>
        <Icon name={showLog ? "ChevronDown" : "ChevronRight"} size={13} /> 查看詳細活動
      </Button>
      {showLog && (
        <ol className="vcw-aios__log">
          <li><Meta as="span">讀取 Shot 08 的角色／場景錨點</Meta></li>
          <li><Meta as="span">組裝三份 Creative Direction context</Meta></li>
          <li><Meta as="span">送出 3 個生成工作</Meta></li>
        </ol>
      )}
    </Card>
  );
}

/** 生產長條：一鏡一格，看得到縮圖與真實狀態 */
function Filmstrip({
  shots,
  focusNo,
  onFocus,
}: {
  shots: PrototypeShot[];
  focusNo: number;
  onFocus: (no: number) => void;
}) {
  return (
    <section className="vcw-strip" aria-label="這一幕的每一鏡">
      <ul className="vcw-strip__list">
        {shots.map((s) => {
          const pill = SHOT_PILL[s.state];
          return (
            <li key={s.id}>
              <Chip
                as="div"
                selected={s.no === focusNo}
                onClick={() => onFocus(s.no)}
                className="vcw-strip__cell"
                aria-label={`Shot ${s.no} ${s.title}，${pill.text}`}
              >
                <span className="vcw-strip__frame">
                  {s.artUrl ? <img src={s.artUrl} alt="" loading="lazy" /> : <Icon name="Image" size={16} />}
                  <span className="vcw-strip__no">{String(s.no).padStart(2, "0")}</span>
                </span>
                <span className="vcw-strip__meta">
                  <Pill status={pill.status}>{pill.text}</Pill>
                  <span className="vcw-strip__tracks" aria-hidden="true">
                    <Icon name="Image" size={11} className={s.hasImage ? "on" : "off"} />
                    <Icon name="Film" size={11} className={s.hasVideo ? "on" : "off"} />
                    <Icon name="Mic" size={11} className={s.hasVoice ? "on" : "off"} />
                  </span>
                </span>
              </Chip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 長任務：一幕的階段進度——每個數字都由真實 Shot 列推導，不畫假進度條 */
function ActBoard() {
  return (
    <section className="vcw-act" aria-label="第一幕進度">
      <div className="vcw-act__head">
        <strong>第一幕</strong>
        <Meta as="span">12 鏡・每個數字都是實際完成的鏡數</Meta>
      </div>
      <ul className="vcw-act__phases">
        {ACT_PROGRESS.map((p) => (
          <li key={p.phase} className="vcw-act__phase" data-idle={!p.started}>
            <span className="vcw-act__name">{p.phase}</span>
            <span className="vcw-act__count">{p.started ? `${p.done}/${p.total}` : "—"}</span>
            <span className="vcw-act__track" aria-hidden="true">
              <span className="vcw-act__fill" style={{ width: p.started ? `${(p.done / p.total) * 100}%` : "0%" }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── 主體 ────────────────────────────────────────────────────────────────── */

export function VisibleCreativeWorkspacePrototype() {
  const [scenario, setScenario] = useState<Scenario>("shot");
  const [focusNo, setFocusNo] = useState(FOCUS_SHOT_NO);
  const [picked, setPicked] = useState<string[]>([]);

  const shot = useMemo(() => SHOTS.find((s) => s.no === focusNo), [focusNo]);
  const showDirections = scenario === "directions" || scenario === "generating" || scenario === "partial";
  const candidates = scenario === "partial" ? CANDIDATES_PARTIAL : CANDIDATES;
  const showCandidates = scenario === "generating" || scenario === "partial";
  const busy = showCandidates && candidates.some((c) => c.state === "generating");

  function togglePick(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  return (
    <div className="vcw" data-scenario={scenario}>
      <div className="vcw-proto-bar" role="note">
        <Badge>PROTOTYPE</Badge>
        <Meta as="span">{PROTOTYPE_BANNER}</Meta>
        <span className="vcw-spacer" />
        <ul className="vcw-proto-bar__tabs">
          {SCENARIOS.map((s) => (
            <li key={s.id}>
              <Chip as="span" selected={scenario === s.id} onClick={() => setScenario(s.id)} title={s.hint}>
                {s.label}
              </Chip>
            </li>
          ))}
        </ul>
      </div>

      <header className="vcw-top">
        <Crumb trail={PROJECT_CRUMB} shot={scenario === "act" || scenario === "idle" ? undefined : shot} />
        <span className="vcw-spacer" />
        <Meta as="span">畫面 7/12・影片 3/12</Meta>
      </header>

      <div className="vcw-body">
        <main className="vcw-main">
          {scenario === "act" ? (
            <ActBoard />
          ) : (
            <Stage shot={shot} empty={scenario === "idle" ? false : shot?.state === "empty"} />
          )}
          {showDirections && <DirectionRow picked={picked} onPick={togglePick} />}
          {showCandidates && <CandidateRail candidates={candidates} />}
        </main>

        <aside className="vcw-rail">
          <AiosRail candidates={candidates} busy={busy} />
          {scenario === "act" && (
            <Card variant="quiet" className="vcw-rail__note">
              <strong>還差什麼</strong>
              <Meta as="p">影片 9 鏡未做・審核 10 鏡待看</Meta>
              <Button size="sm" variant="primary">繼續這一幕</Button>
            </Card>
          )}
        </aside>
      </div>

      <Filmstrip shots={SHOTS} focusNo={focusNo} onFocus={setFocusNo} />

      <form className="vcw-command" onSubmit={(e) => e.preventDefault()}>
        <Icon name="Sparkles" size={16} />
        <input
          className="vcw-command__input"
          placeholder={commandPlaceholder(scenario, focusNo, 1)}
          aria-label="告訴 Aios 你想怎麼修改"
        />
        <Button size="sm" variant="primary" type="submit" aria-label="送出">
          <Icon name="Send" size={15} />
        </Button>
      </form>
    </div>
  );
}
