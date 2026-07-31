import { useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { Hint } from "../../components/ui";
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
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
    <div className="creation-skill-picker" ref={rootRef}>
      <div className="creation-skill-picker__row">
        <button
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

      {open && (
        <div
          id={menuId}
          role="dialog"
          aria-label="請誰來幫忙"
          className="creation-skill-menu"
        >
          <header className="creation-skill-menu__head">
            <strong>請誰來幫忙</strong>
            {/* 怎麼操作這張選單的說明；熟手不需要 → guide 層，精簡模式收成「？」 */}
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
        </div>
      )}
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
