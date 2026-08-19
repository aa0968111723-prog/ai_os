import { Icon } from "../components/Icon";
import { Button } from "../components/ui";
import { setCompanionSurfaceOverride } from "../lib/companionSurface";
import { openCompanionDeepLink } from "./openInBrowser";
import { useOrbMotion } from "./useOrbMotion";

/**
 * 「我」分頁。
 *
 * ## 為什麼這一頁這麼短
 *
 * Companion 只保留三個分頁（AI／任務／我），而「我」的工作只有四件：
 * 換組、進 Web 完整設定、切回完整工作站、看目前的動畫層級。
 * 設定頁本身不搬進 App——那是一頁又一頁的表單，在瀏覽器裡填比較快，
 * 而且搬進來會立刻讓 App 變回「桌面版的縮小版」。
 */
export function CompanionMe({
  userName,
  groups,
  activeGroupId,
  onActiveGroupIdChange,
}: {
  userName?: string;
  groups: { groupId: string; groupName: string; role: string }[];
  activeGroupId: string;
  onActiveGroupIdChange: (groupId: string) => void;
}) {
  const motion = useOrbMotion();

  return (
    <div className="companion-me">
      <h1 className="companion-me__title">{userName ?? "我"}</h1>

      {groups.length > 1 && (
        <section className="companion-me__section" aria-label="切換組別">
          <h2 className="companion-me__label">目前組別</h2>
          <ul className="companion-me__groups">
            {groups.map((group) => (
              <li key={group.groupId}>
                <button
                  type="button"
                  className={group.groupId === activeGroupId ? "is-active" : ""}
                  aria-current={group.groupId === activeGroupId ? "true" : undefined}
                  onClick={() => onActiveGroupIdChange(group.groupId)}
                >
                  <span>{group.groupName}</span>
                  {group.groupId === activeGroupId && <Icon name="Check" size={16} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="companion-me__section" aria-label="在瀏覽器開啟">
        <h2 className="companion-me__label">完整工作站</h2>
        <p className="companion-me__hint">
          分鏡、素材、時間軸與設定都在瀏覽器裡，畫面大、拖曳也順手。
        </p>
        <div className="companion-me__actions">
          <Button variant="tonal" onClick={() => openCompanionDeepLink({ target: "projects" })}>
            <Icon name="Monitor" size={15} />
            開啟全部專案
          </Button>
          <Button variant="ghost" onClick={() => openCompanionDeepLink({ target: "tasks" })}>
            <Icon name="Monitor" size={15} />
            開啟協作中心
          </Button>
        </div>
      </section>

      <section className="companion-me__section" aria-label="顯示與動畫">
        <h2 className="companion-me__label">動畫</h2>
        <p className="companion-me__hint">
          目前是「{motionLabel(motion.tier)}」（{motion.reason}）。
          系統的「減少動態」設定會即時生效。
        </p>
      </section>

      <section className="companion-me__section" aria-label="切換版本">
        <h2 className="companion-me__label">版本</h2>
        <p className="companion-me__hint">
          想在這支手機上直接用完整工作站也可以，隨時能切回來。
        </p>
        <Button
          variant="ghost"
          onClick={() => setCompanionSurfaceOverride("workspace")}
        >
          改用完整工作站
        </Button>
      </section>
    </div>
  );
}

function motionLabel(tier: string): string {
  if (tier === "full") return "完整動畫";
  if (tier === "reduced") return "簡化動畫";
  return "不播動畫";
}

export default CompanionMe;
