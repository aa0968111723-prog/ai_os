import { type CSSProperties } from "react";
import { Link } from "wouter";
import { BrandLogo } from "./BrandLogo";
import { Icon } from "./Icon";
import { Badge, Button, Card, Hint } from "./ui";

/** 未入組的三步（設計規格）：拿邀請連結 → 開啟加入 → 回到工作台開始 */
const STEPS: Array<{ n: string; label: string; hint: string }> = [
  { n: "1", label: "拿邀請連結", hint: "請組長或管理員把邀請連結寄給你" },
  { n: "2", label: "開啟連結加入", hint: "填好資料就會被加進那個組別" },
  { n: "3", label: "回到工作台", hint: "已入組就能開始建立專案" },
];

const numStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: "50%",
  background: "var(--primary-solid)",
  color: "var(--primary-fg)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "var(--mono)",
  flex: "none",
};

/**
 * 未入組引導卡：帳號建好了、但還沒被加進任何組別時顯示（取代原本的一句 EmptyState）。
 * 說明「組別」是什麼，並給出明確下一步——拿邀請連結 → 加入 → 回到工作台；
 * 被加進組之後按「重新檢查」，不用整頁重整就會進入工作台（refetch auth.me）。
 * 是否顯示由 SessionGate 依 me.groups.length 決定。
 */
export function NoGroupGuide({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <Card variant="primary" data-fb="未入組引導卡" style={{ marginTop: "var(--sp-32)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <BrandLogo variant="mark" size="sm" decorative />
        <h2 style={{ margin: 0 }}>歡迎加入！還差一步：加入一個組別</h2>
        <Badge style={{ marginLeft: "auto" }}>未入組</Badge>
      </div>

      <Hint style={{ marginTop: 8, fontSize: 13 }}>
        這套工具以<strong>組別</strong>為單位一起創作：一個組是一群夥伴共用的工作空間，
        由組長或管理員建立、邀請成員。你已經註冊成功，但還沒被加入任何組別，所以暫時不能建立專案。
      </Hint>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0 4px" }}>
        {STEPS.map((s, i) => (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={s.hint}>
              <span className="mono" style={numStyle}>{s.n}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden style={{ opacity: 0.55, display: "inline-flex" }}>
                <Icon name="ArrowRight" size={14} />
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="primary" disabled={!onRefresh} onClick={onRefresh}>
          <Icon name="RotateCw" size={16} />
          重新檢查（我已經被加進組了）
        </Button>
        <Link href="/help" className="m-touch" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <Icon name="HelpCircle" size={14} />看怎麼用
        </Link>
      </div>
      {!onRefresh && <Hint as="span">（載入中，稍後就能重新檢查）</Hint>}
    </Card>
  );
}
