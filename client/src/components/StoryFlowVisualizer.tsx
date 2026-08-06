import { Icon } from "./Icon";

/**
 * 三幕劇可視化圖表 (3-Act Story Arc Diagram)
 */
export function ThreeActStoryArc({
  acts,
  canEdit,
  onChange,
}: {
  acts: { hook: string; turn: string; cta: string };
  canEdit: boolean;
  onChange: (key: "hook" | "turn" | "cta", value: string) => void;
}) {
  return (
    <div className="three-act-story-arc">
      <div className="three-act-header">
        <span className="three-act-header__title">
          <Icon name="Layers" size={14} />
          三幕劇視覺結構（寫腳本與分鏡 AI 專用）
        </span>
        <span className="three-act-header__hint">引導 AI 掌握節奏起伏</span>
      </div>

      <div className="three-act-timeline">
        {/* 第 1 幕：開場勾子 */}
        <div className={`three-act-stage stage-hook ${acts.hook ? "is-active" : ""}`}>
          <div className="three-act-stage__header">
            <span className="three-act-stage__badge">🪝 第 1 幕</span>
            <span className="three-act-stage__name">開場勾子 (Hook)</span>
          </div>
          <span className="three-act-stage__guide">前 3 秒抓住眼球、拋出痛點或懸念</span>
          <textarea
            key={`hook-${acts.hook}`}
            className="three-act-stage__input"
            defaultValue={acts.hook}
            readOnly={!canEdit}
            maxLength={500}
            rows={2}
            placeholder="例：陳師姐在深夜禪房獨坐，眼中帶著迷惘與疲憊…"
            onBlur={(e) => {
              if (canEdit && e.target.value !== acts.hook) {
                onChange("hook", e.target.value);
              }
            }}
          />
        </div>

        <div className="three-act-arrow">
          <Icon name="ChevronRight" size={18} />
        </div>

        {/* 第 2 幕：轉折與體悟 */}
        <div className={`three-act-stage stage-turn ${acts.turn ? "is-active" : ""}`}>
          <div className="three-act-stage__header">
            <span className="three-act-stage__badge">⚡ 第 2 幕</span>
            <span className="three-act-stage__name">轉折體悟 (Turn)</span>
          </div>
          <span className="three-act-stage__guide">遇見佛法與修行心境轉變之刻</span>
          <textarea
            key={`turn-${acts.turn}`}
            className="three-act-stage__input"
            defaultValue={acts.turn}
            readOnly={!canEdit}
            maxLength={500}
            rows={2}
            placeholder="例：師父的一句開示如醍醐灌頂，心門頓時敞開…"
            onBlur={(e) => {
              if (canEdit && e.target.value !== acts.turn) {
                onChange("turn", e.target.value);
              }
            }}
          />
        </div>

        <div className="three-act-arrow">
          <Icon name="ChevronRight" size={18} />
        </div>

        {/* 第 3 幕：昇華與行動 */}
        <div className={`three-act-stage stage-cta ${acts.cta ? "is-active" : ""}`}>
          <div className="three-act-stage__header">
            <span className="three-act-stage__badge">🌟 第 3 幕</span>
            <span className="three-act-stage__name">昇華行動 (CTA)</span>
          </div>
          <span className="three-act-stage__guide">心靈洗滌、感恩重生與行動號召</span>
          <textarea
            key={`cta-${acts.cta}`}
            className="three-act-stage__input"
            defaultValue={acts.cta}
            readOnly={!canEdit}
            maxLength={500}
            rows={2}
            placeholder="例：晨光中露出釋懷笑容，邀請觀眾一同體會心靈平靜…"
            onBlur={(e) => {
              if (canEdit && e.target.value !== acts.cta) {
                onChange("cta", e.target.value);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
