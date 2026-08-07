import { useCallback, useId, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { Hint } from "../../components/ui";
import { MenuSurface } from "../../app/components/MenuSurface";
import {
  getAgentSkill,
  listModeSkills,
  listRoleSkills,
  type AgentSkill,
  type AgentSkillId,
} from "../../../../shared/agentSkills";

/**
 * 創作者向「＋ 請誰來幫忙」：視覺卡面掛技能／劇組職能。
 * 不是代碼列表；掛上後只改 mode／goal 提示，不扣點。
 */
export function CreationSkillPicker({
  selectedIds,
  onChange,
  disabled = false,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  // 外點／Esc／手機貼底 sheet 都收在 MenuSurface（見該檔的三個陷阱說明）
  const close = useCallback(() => setOpen(false), []);

  const toggle = (id: AgentSkillId) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
      return;
    }
    const skill = getAgentSkill(id);
    if (!skill) return;
    if (skill.kind === "mode") {
      const withoutModes = selectedIds.filter((x) => getAgentSkill(x)?.kind !== "mode");
      onChange([...withoutModes, id]);
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));

  const chips = selectedIds
    .map((id) => getAgentSkill(id))
    .filter(Boolean) as AgentSkill[];

  return (
    <div className="creation-skill-picker">
      <div className="creation-skill-picker__row">
        <button
          ref={triggerRef}
          type="button"
          className="creation-skill-add"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? menuId : undefined}
          title="請誰來幫忙"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="creation-skill-add__glyph" aria-hidden>
            <Icon name="Plus" size={18} />
          </span>
          <span className="creation-skill-add__label">請誰來幫忙</span>
        </button>
        {chips.map((skill) => (
          <button
            key={skill.id}
            type="button"
            className={`creation-skill-chip${skill.kind === "role" ? " is-role" : " is-mode"}`}
            title={`${skill.scene} · ${skill.summary}（點一下卸下）`}
            disabled={disabled}
            onClick={() => remove(skill.id)}
          >
            <span className="creation-skill-chip__icon" aria-hidden>
              <Icon name={skill.icon as IconName} size={14} />
            </span>
            <span>{skill.title}</span>
            <span className="creation-skill-chip__x" aria-hidden>×</span>
          </button>
        ))}
      </div>

      {/* dialog 而非 menu：內容是一牆可勾選的卡片，不是 menuitem 清單，
          所以 roving 關掉、role 用 dialog（承諾了方向鍵漫遊卻沒實作反而更糟）。
          stretch：184px 的窄下拉裝不下卡片牆。手機自動變貼底 sheet。 */}
      <MenuSurface
        open={open}
        onClose={close}
        label="請誰來幫忙"
        triggerRef={triggerRef}
        surfaceRole="dialog"
        placement="stretch"
        roving={false}
        id={menuId}
        className="creation-skill-menu"
      >
          <header className="creation-skill-menu__head">
            <strong>請誰來幫忙</strong>
            {/* 怎麼操作這張選單的說明 */}
            <Hint as="span">點卡面掛上；多步開拍前仍會請你過目</Hint>
          </header>

          <section className="creation-skill-menu__section">
            <h3 className="creation-skill-menu__label">怎麼開始</h3>
            <div className="creation-skill-menu__grid">
              {listModeSkills().map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  selected={selectedIds.includes(skill.id)}
                  onToggle={() => toggle(skill.id)}
                />
              ))}
            </div>
          </section>

          <section className="creation-skill-menu__section">
            <h3 className="creation-skill-menu__label">劇組職能</h3>
            <div className="creation-skill-menu__grid creation-skill-menu__grid--roles">
              {listRoleSkills().map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  selected={selectedIds.includes(skill.id)}
                  onToggle={() => toggle(skill.id)}
                />
              ))}
            </div>
          </section>
      </MenuSurface>
    </div>
  );
}

function SkillCard({
  skill,
  selected,
  onToggle,
}: {
  skill: AgentSkill;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`creation-skill-card${selected ? " is-selected" : ""}${skill.kind === "role" ? " is-role" : ""}`}
      aria-pressed={selected}
      onClick={onToggle}
    >
      <span className="creation-skill-card__avatar" aria-hidden data-scene={skill.id}>
        <Icon name={skill.icon as IconName} size={22} />
      </span>
      <span className="creation-skill-card__body">
        <span className="creation-skill-card__scene">{skill.scene}</span>
        <span className="creation-skill-card__title">{skill.title}</span>
        <span className="creation-skill-card__summary">{skill.summary}</span>
      </span>
      {selected && (
        <span className="creation-skill-card__check" aria-hidden>
          <Icon name="Check" size={14} />
        </span>
      )}
    </button>
  );
}
