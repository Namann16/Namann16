import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { unitsLabel } from '@fca/core';
import { useWorkspace } from '../../state/WorkspaceContext';
import { Badge, Banner } from '../ui/primitives';

/** Sidebar navigation, grouped so the sections read as one analytical workflow. */
const NAV_GROUPS: { label: string; items: { to: string; label: string; needsCompany?: boolean }[] }[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Home' },
      { to: '/dashboard', label: 'Dashboard', needsCompany: true },
      { to: '/data', label: 'Data Input', needsCompany: true },
    ],
  },
  {
    label: 'Statements & Ratios',
    items: [
      { to: '/statements', label: 'Financial Statements', needsCompany: true },
      { to: '/ratios', label: 'Ratio Analysis', needsCompany: true },
      { to: '/profitability', label: 'Profitability', needsCompany: true },
      { to: '/liquidity-solvency', label: 'Liquidity & Solvency', needsCompany: true },
      { to: '/working-capital', label: 'Working Capital', needsCompany: true },
      { to: '/cash-flow', label: 'Cash Flow Analysis', needsCompany: true },
      { to: '/growth', label: 'Growth & Trends', needsCompany: true },
      { to: '/dupont', label: 'DuPont Analysis', needsCompany: true },
    ],
  },
  {
    label: 'Assessment',
    items: [
      { to: '/health', label: 'Financial Health', needsCompany: true },
      { to: '/insights', label: 'Insights & Red Flags', needsCompany: true },
      { to: '/peers', label: 'Peer Comparison', needsCompany: true },
      { to: '/report', label: 'Report', needsCompany: true },
      { to: '/settings', label: 'Settings' },
    ],
  },
];

function AnalysisProgress() {
  const [step, setStep] = useState(0);
  const steps = ['Reading inputs', 'Calculating metrics', 'Checking quality', 'Building insights'];

  useEffect(() => {
    const timer = window.setInterval(() => setStep((current) => Math.min(current + 1, steps.length - 1)), 420);
    return () => window.clearInterval(timer);
  }, [steps.length]);

  return (
    <span className="analysis-progress hidden items-center gap-2 sm:flex" role="status" aria-live="polite">
      <span className="analysis-progress-dot" aria-hidden="true" />
      <span>{steps[step]}…</span>
    </span>
  );
}

function NavItem({ to, label, disabled, dirty }: { to: string; label: string; disabled: boolean; dirty: boolean }) {
  if (disabled) {
    return (
      <span
        className="sidebar-item"
        aria-disabled="true"
        title="Open or create a company analysis to use this section."
      >
        {label}
      </span>
    );
  }

  return (
    <NavLink
      to={to}
      end={to === '/'}
      // Cross-fades the outgoing page against the incoming one where the browser supports it.
      // Everything still works without it, so nothing depends on the API being present.
      viewTransition
      onClick={(event) => {
        if (dirty && !window.confirm('You have unsaved financial data. Leave without saving?')) {
          event.preventDefault();
        }
      }}
      // The selected style is driven by aria-current, so the accessible state and the visible
      // state cannot drift apart.
      className="sidebar-item"
    >
      {label}
    </NavLink>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { current, analysis, analysing, error, clearError, meta, dirty, theme, setTheme } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const hasCompany = Boolean(current);

  return (
    <div className="flex h-full min-h-screen flex-col lg:flex-row">
      {/* Sidebar */}
      {/*
        The sidebar is a material, not a panel: content scrolling in the main column stays faintly
        visible through it, which is what reads as chrome floating above content rather than a box
        beside it. A single hairline marks where it ends.
      */}
      <aside
        className={`${mobileOpen ? 'block' : 'hidden'} material w-full shrink-0 hairline lg:sticky lg:top-0 lg:block lg:h-screen lg:w-[15rem] lg:border-b-0 lg:border-r-[0.5px] lg:border-r-[color:var(--separator)]`}
        style={{ viewTransitionName: 'chrome' }}
      >
        <div className="flex h-full flex-col">
          <button
            type="button"
            onClick={() => { navigate('/'); setMobileOpen(false); }}
            className="flex items-center gap-2.5 px-4 py-4 text-left"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-600 text-[10px] font-semibold text-white dark:bg-accent-600/[0.08]0">FA</span>
            <span className="text-headline font-semibold leading-tight">
              Financial<br />Company Analyzer
            </span>
          </button>

          <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 pb-4" aria-label="Sections">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="group-header px-2.5 pb-1">{group.label}</p>
                <div className="space-y-0.5" onClick={() => setMobileOpen(false)}>
                  {group.items.map((item) => (
                    <NavItem key={item.to} to={item.to} label={item.label} dirty={dirty} disabled={Boolean(item.needsCompany) && !hasCompany} />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="hairline-t px-3 py-3">
            <div className="segmented mb-2 w-full" role="group" aria-label="Appearance">
              {(['light', 'dark', 'system'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  className="segment capitalize"
                  aria-pressed={theme === option}
                >
                  {option}
                </button>
              ))}
            </div>
            {meta && (
              <p className="text-caption-2 leading-snug text-ink-500 dark:text-ink-500">
                Storage: {meta.config.storage === 'mongodb' ? 'MongoDB' : 'in-memory (not persisted)'}
                <br />
                Narrative: {meta.config.llmEnabled ? 'LLM enabled' : 'deterministic templates'}
              </p>
            )}
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="material hairline sticky top-0 z-30" style={{ viewTransitionName: 'toolbar' }}>
          <div className="flex items-center gap-2 px-4 py-2.5 lg:px-6">
            <button
              type="button"
              className="btn-secondary shrink-0 lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-label="Toggle navigation"
            >
              Menu
            </button>

            {current ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="min-w-0">
                  <p className="truncate text-headline font-semibold leading-tight">
                    {current.company.name}
                  </p>
                  {/* The strap line is context the page header repeats, so it is desktop-only. */}
                  <p className="hidden truncate text-footnote text-ink-500 dark:text-ink-400 lg:block">
                    {meta?.industries.find((i) => i.key === current.company.industry)?.label ?? current.company.industry}
                    {' · '}{unitsLabel(current.company.currency, current.company.units)}
                    {analysis?.latestPeriod ? ` · Latest ${analysis.latestPeriod}` : ' · No periods entered'}
                  </p>
                </div>
                {current.company.isSample && (
                  <Badge tone="caution" className="hidden shrink-0 sm:inline-flex">Fictional sample data</Badge>
                )}
                {dirty && <Badge tone="accent" className="shrink-0">Unsaved</Badge>}
              </div>
            ) : (
              <p className="flex-1 text-callout text-ink-500 dark:text-ink-400">No analysis open</p>
            )}

            <div className="flex shrink-0 items-center gap-1.5">
              {analysing && <AnalysisProgress />}
              {analysis && analysis.redFlags.length > 0 && (
                <NavLink to="/insights" aria-label={`${analysis.redFlags.length} red flags`}>
                  <Badge tone="negative">
                    <span className="sm:hidden">{analysis.redFlags.length} ⚠</span>
                    <span className="hidden sm:inline">
                      {analysis.redFlags.length} red {analysis.redFlags.length === 1 ? 'flag' : 'flags'}
                    </span>
                  </Badge>
                </NavLink>
              )}
              {analysis && analysis.dataQuality.failures > 0 && (
                <NavLink to="/data" aria-label={`${analysis.dataQuality.failures} data failures`}>
                  <Badge tone="negative">
                    <span className="sm:hidden">{analysis.dataQuality.failures} ✕</span>
                    <span className="hidden sm:inline">
                      {analysis.dataQuality.failures} data {analysis.dataQuality.failures === 1 ? 'failure' : 'failures'}
                    </span>
                  </Badge>
                </NavLink>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div className="px-4 pt-3">
            <Banner tone="negative" title="Something went wrong" onDismiss={clearError}>{error}</Banner>
          </div>
        )}

        {/* Only the content carries the `page` name, so the chrome stays put while it changes. */}
        <main className="flex-1 px-4 py-5 lg:px-6 lg:py-7" style={{ viewTransitionName: 'page' }}>{children}</main>

        <footer className="hairline-t px-4 py-3 text-caption-2 leading-relaxed text-ink-500 lg:px-6">
          All metrics are calculated deterministically from the data you entered. Figures shown as “n/a” could not be calculated and are not zero.
          {analysis && ` Engine version ${analysis.engineVersion}.`}
        </footer>
      </div>
    </div>
  );
}
