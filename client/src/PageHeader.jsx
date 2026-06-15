import React, { useEffect, useState } from 'react';

/** Tiny help line pinned to the bottom of a page — keeps headers compact on phone/tablet. */
export function PageFooterHint({ children }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div className="app-page-footer-hint" role="note">
      <p>{children}</p>
    </div>
  );
}

/**
 * Unified page header — title, toggles, filters, actions.
 * Pass `collapsible` to fold controls into a summary bar + "Show controls".
 * Put longer guidance in `<PageFooterHint>` at the bottom of the page, not `description`.
 */
export default function PageHeader({
  title,
  description,
  actions,
  toggles,
  filters,
  children,
  className = '',
  collapsible = false,
  collapsibleSummary = [],
}) {
  const [controlsOpen, setControlsOpen] = useState(false);
  const rootClass = ['app-page-header', 'page-header', className].filter(Boolean).join(' ');
  const hasCollapsibleControls = Boolean(toggles || filters);
  const summaryItems = Array.isArray(collapsibleSummary)
    ? collapsibleSummary.filter(Boolean)
    : [];

  useEffect(() => {
    if (!collapsible) return undefined;
    const mq = window.matchMedia('(min-width: 900px)');
    const sync = () => setControlsOpen(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [collapsible]);

  return (
    <div className={`${rootClass}${collapsible ? ' page-header--collapsible' : ''}`}>
      <div className="page-header__top">
        <div className="page-header__title-block">
          {title ? <h2 className="page-header__title">{title}</h2> : null}
          {description ? <p className="page-header__description page-header__description--legacy">{description}</p> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>

      {collapsible ? (
        <>
          {hasCollapsibleControls && (
            <div className="page-header__mobile-bar">
              {!controlsOpen && summaryItems.length > 0 && (
                <div className="page-header__summary-chips" aria-label="Current plan filters">
                  {summaryItems.map((chip, i) => (
                    <span key={`${String(chip)}-${i}`} className="page-header__summary-chip">
                      {chip}
                    </span>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="page-header__controls-toggle"
                aria-expanded={controlsOpen}
                onClick={() => setControlsOpen((v) => !v)}
              >
                {controlsOpen ? 'Hide controls ▲' : 'Show controls ▾'}
              </button>
            </div>
          )}
          {hasCollapsibleControls && (
            <div
              className={`page-header__collapsible-body${controlsOpen ? ' page-header__collapsible-body--open' : ''}`}
            >
              {toggles ? <div className="page-header__toggles">{toggles}</div> : null}
              {filters ? <div className="page-header__filters">{filters}</div> : null}
            </div>
          )}
        </>
      ) : (
        <>
          {toggles ? <div className="page-header__toggles">{toggles}</div> : null}
          {filters ? <div className="page-header__filters">{filters}</div> : null}
        </>
      )}

      {children}
    </div>
  );
}
