import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { unitsLabel } from '@fca/core';
import { useWorkspace } from '../../state/WorkspaceContext';
import { Badge, Banner, Spinner } from '../ui/primitives';

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

function NavItem({ to, label, disabled }: { to: string; label: string; disabled: boolean }) {
  if (disabled) {
    return (
      <span
        className="block cursor-not-allowed rounded px-2.5 py-1.5 text-[12.5px] text-ink-400 dark:text-ink-600"
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
      className={({ isActive }) =>
        `block rounded px-2.5 py-1.5 text-[12.5px] transition-colors ${
          isActive
            ? 'bg-accent-700 font-medium text-white'
            : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
        }`
      }
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
      <aside
        className={`${mobileOpen ? 'block' : 'hidden'} w-full shrink-0 border-b border-ink-200 bg-white lg:block lg:w-56 lg:border-b-0 lg:border-r dark:border-ink-800 dark:bg-ink-900`}
      >
        <div className="flex h-full flex-col">
          <button
            type="button"
            onClick={() => { navigate('/'); setMobileOpen(false); }}
            className="flex items-center gap-2 px-4 py-3.5 text-left"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded bg-accent-700 text-[11px] font-bold text-white">FA</span>
            <span className="text-[13px] font-semibold leading-tight text-ink-900 dark:text-ink-50">
              Financial<br />Company Analyzer
            </span>
          </button>

          <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 pb-4" aria-label="Sections">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="label-caps px-2.5 pb-1">{group.label}</p>
                <div className="space-y-0.5" onClick={() => setMobileOpen(false)}>
                  {group.items.map((item) => (
                    <NavItem key={item.to} to={item.to} label={item.label} disabled={Boolean(item.needsCompany) && !hasCompany} />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-ink-200 px-3 py-2.5 dark:border-ink-800">
            <div className="mb-2 flex items-center gap-1" role="group" aria-label="Colour theme">
              {(['light', 'dark', 'system'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  className={`flex-1 rounded px-1.5 py-1 text-2xs capitalize transition-colors ${
                    theme === option ? 'bg-accent-700 text-white' : 'text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800'
                  }`}
                  aria-pressed={theme === option}
                >
                  {option}
                </button>
              ))}
            </div>
            {meta && (
              <p className="text-2xs leading-snug text-ink-400 dark:text-ink-500">
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
        <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/90 backdrop-blur dark:border-ink-800 dark:bg-ink-900/90">
          <div className="flex items-center gap-2 px-3 py-2 lg:px-4 lg:py-2.5">
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
                  <p className="truncate text-[13.5px] font-semibold leading-tight text-ink-900 dark:text-ink-50">
                    {current.company.name}
                  </p>
                  {/* The strap line is context the page header repeats, so it is desktop-only. */}
                  <p className="hidden truncate text-2xs text-ink-500 dark:text-ink-400 lg:block">
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
              <p className="flex-1 text-[12.5px] text-ink-500 dark:text-ink-400">No analysis open</p>
            )}

            <div className="flex shrink-0 items-center gap-1.5">
              {analysing && <span className="hidden sm:block"><Spinner label="Recalculating" /></span>}
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

        <main className="flex-1 px-4 py-4 lg:px-6 lg:py-5">{children}</main>

        <footer className="border-t border-ink-200 px-4 py-2.5 text-2xs text-ink-400 dark:border-ink-800 dark:text-ink-500 lg:px-6">
          All metrics are calculated deterministically from the data you entered. Figures shown as “n/a” could not be calculated and are not zero.
          {analysis && ` Engine version ${analysis.engineVersion}.`}
        </footer>
      </div>
    </div>
  );
}
