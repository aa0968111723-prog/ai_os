import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function SecondaryPageHeader({
  eyebrow,
  title,
  description,
  icon,
  badge,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  icon?: IconName;
  badge?: ReactNode;
}) {
  return (
    <header className="secondary-page-header">
      <div className="secondary-page-header__copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>
          {icon ? <span className="secondary-page-header__icon"><Icon name={icon} size={21} /></span> : null}
          {title}
        </h1>
        <div className="secondary-page-header__lede">{description}</div>
      </div>
      {badge ? <div className="secondary-page-header__badge">{badge}</div> : null}
    </header>
  );
}
