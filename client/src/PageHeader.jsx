import React from 'react';

/**
 * Unified page header — title, description, toggles, filters, actions.
 * Presentation only; pages pass existing controls as slot content.
 */
export default function PageHeader({
  title,
  description,
  actions,
  toggles,
  filters,
  children,
  className = '',
}) {
  const rootClass = ['app-page-header', 'page-header', className].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      <div className="page-header__top">
        <div className="page-header__title-block">
          {title ? <h2 className="page-header__title">{title}</h2> : null}
          {description ? <p className="page-header__description">{description}</p> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
      {toggles ? <div className="page-header__toggles">{toggles}</div> : null}
      {filters ? <div className="page-header__filters">{filters}</div> : null}
      {children}
    </div>
  );
}
