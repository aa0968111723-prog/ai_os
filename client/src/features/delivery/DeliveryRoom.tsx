/**
 * ④ 成片・交付室第一屏（重構需求 §12／§13）。
 *
 * 交付頁先前的問題是它變成「第二套製作流程」——在這裡補畫面、在這裡配音，
 * 於是同一件事有兩個入口、兩套 UI。這一屏只回答三個問題：
 *   1. 整部片做到哪了？
 *   2. 還缺什麼？
 *   3. 點一下能不能直接去處理？
 *
 * 補件本身**不在這裡做**：點缺漏是跳回 ② 分鏡的那一鏡（單格工作室才是製作的唯一入口）。
 * 這樣「補畫面」永遠只有一個地方，交付室維持它該有的職責。
 *
 * 完成度與缺漏清單全部來自 shared/shotCompletion.ts 的純函式——
 * 與分鏡卡狀態點、前後鏡導航同一份真相，不會出現「這裡說缺、那裡說有」。
 */
import { useMemo } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Card, EmptyState, Hint, Meta } from "../../components/ui";
import {
  COMPLETION_TRACKS,
  TRACK_LABEL,
  computeProjectCompletion,
  computeShotCompletion,
  listDeliveryIssues,
  type ShotCompletionInput,
} from "@shared/shotCompletion";

/** 缺漏軌 → 該去哪處理（人話），讓「點了要幹嘛」在跳轉前就講清楚 */
const FIX_HINT: Record<string, string> = {
  image: "到這一鏡生成畫面",
  video: "到這一鏡生成影片",
  voice: "到這一鏡錄／生成配音",
  audio: "到這一鏡加環境音",
  review: "到這一鏡確認後送審通過",
};

export function DeliveryRoom({
  projectId,
  onOpenShot,
}: {
  projectId: string;
  /** 點缺漏＝跳到那一鏡（製作只有單格工作室一個入口） */
  onOpenShot: (shotId: string) => void;
}) {
  const shots = trpc.scenes.listByProject.useQuery({ projectId });

  const { completions, project, issues } = useMemo(() => {
    const rows = (shots.data ?? []) as unknown as ShotCompletionInput[];
    const completions = rows.map(computeShotCompletion);
    return {
      completions,
      project: computeProjectCompletion(completions),
      issues: listDeliveryIssues(completions),
    };
  }, [shots.data]);

  if (shots.isLoading) {
    return (
      <Card as="section">
        <Meta as="p">正在盤點完成度…</Meta>
      </Card>
    );
  }

  if (project.shots === 0) {
    return (
      <Card as="section">
        <EmptyState
          icon={<Icon name="Clapperboard" size={20} />}
          title="還沒有分鏡可以交付"
          description="先回到「① 故事」寫故事、產生分鏡，這裡就會自動出現整部片的完成度與待辦。"
        />
      </Card>
    );
  }

  return (
    <Card as="section" className="delivery-room" data-fb="成片交付室">
      <div className="delivery-room__head">
        <h3 style={{ margin: 0 }}>整部片完成度</h3>
        <strong className="delivery-room__percent">{project.percent}%</strong>
        <Meta as="span">
          {project.completeShots} / {project.shots} 鏡全部就緒
        </Meta>
      </div>

      {/* 逐軌進度：一眼看出是「畫面都好了但配音沒跟上」還是別的 */}
      <div className="delivery-room__tracks">
        {COMPLETION_TRACKS.map((t) => (
          <div key={t} className="delivery-room__track">
            <Meta as="span">{TRACK_LABEL[t]}</Meta>
            <strong>
              {project.perTrack[t]} / {project.shots}
            </strong>
          </div>
        ))}
      </div>

      {issues.length === 0 ? (
        <Hint role="status" style={{ marginTop: 10 }}>
          <Icon name="Check" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
          每一鏡的畫面、影片、配音、音效與審核都齊了——可以打包交付。
        </Hint>
      ) : (
        <>
          <Hint role="status" style={{ marginTop: 10 }}>
            <Icon name="TriangleAlert" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            目前有 {issues.length} 個待處理，點任何一項直接去那一鏡處理。
          </Hint>
          <ul className="delivery-room__issues">
            {issues.slice(0, 20).map((it) => (
              <li key={`${it.shotId}-${it.track}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenShot(it.shotId)}
                  title={FIX_HINT[it.track]}
                >
                  <span className="delivery-room__issue-shot">#{it.orderIndex}</span>
                  <span className="delivery-room__issue-title">{it.shotTitle || "未命名鏡"}</span>
                  <span className="delivery-room__issue-label">{it.label}</span>
                </Button>
              </li>
            ))}
          </ul>
          {issues.length > 20 && (
            <Meta as="p" style={{ margin: "4px 0 0" }}>
              還有 {issues.length - 20} 項——處理完上面這些會自動往下遞補。
            </Meta>
          )}
        </>
      )}
    </Card>
  );
}
