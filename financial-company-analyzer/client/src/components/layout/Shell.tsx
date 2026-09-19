import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { unitsLabel } from '@fca/core';
import { useWorkspace } from '../../state/WorkspaceContext';
import { Badge, Banner } from '../ui/primitives';

type NavIconName =
  | 'home'
  | 'dashboard'
  | 'data'
  | 'statements'
  | 'ratios'
  | 'profitability'
  | 'liquidity'
  | 'working-capital'
  | 'cash-flow'
  | 'growth'
  | 'dupont'
  | 'health'
  | 'insights'
  | 'peers'
  | 'report'
  | 'settings';

/** Sidebar navigation, grouped so the sections read as one analytical workflow. */
const NAV_GROUPS: { label: string; items: { to: string; label: string; icon: NavIconName; needsCompany?: boolean }[] }[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: 'home' },
      { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', needsCompany: true },
      { to: '/data', label: 'Data Input', icon: 'data', needsCompany: true },
    ],
  },
  {
    label: 'Statements & Ratios',
    items: [
      { to: '/statements', label: 'Financial Statements', icon: 'statements', needsCompany: true },
      { to: '/ratios', label: 'Ratio Analysis', icon: 'ratios', needsCompany: true },
      { to: '/profitability', label: 'Profitability', icon: 'profitability', needsCompany: true },
      { to: '/liquidity-solvency', label: 'Liquidity & Solvency', icon: 'liquidity', needsCompany: true },
      { to: '/working-capital', label: 'Working Capital', icon: 'working-capital', needsCompany: true },
      { to: '/cash-flow', label: 'Cash Flow Analysis', icon: 'cash-flow', needsCompany: true },
      { to: '/growth', label: 'Growth & Trends', icon: 'growth', needsCompany: true },
      { to: '/dupont', label: 'DuPont Analysis', icon: 'dupont', needsCompany: true },
    ],
  },
  {
    label: 'Assessment',
    items: [
      { to: '/health', label: 'Financial Health', icon: 'health', needsCompany: true },
      { to: '/insights', label: 'Insights & Red Flags', icon: 'insights', needsCompany: true },
      { to: '/peers', label: 'Peer Comparison', icon: 'peers', needsCompany: true },
      { to: '/report', label: 'Report', icon: 'report', needsCompany: true },
      { to: '/settings', label: 'Settings', icon: 'settings' },
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

function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    className: 'h-4 w-4 shrink-0',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  const paths: Record<NavIconName, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    data: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    statements: <><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></>,
    ratios: <><path d="M5 19 19 5" /><circle cx="7" cy="7" r="2" /><circle cx="17" cy="17" r="2" /></>,
    profitability: <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-7" /></>,
    liquidity: <><path d="M12 3v18M5 8h10a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h11" /></>,
    'working-capital': <><path d="M3 7h18v13H3z" /><path d="M7 7V5h10v2M3 12h18M10 12v3h4v-3" /></>,
    'cash-flow': <><path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5" /></>,
    growth: <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-7M16 6h3v3" /></>,
    dupont: <><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /></>,
    health: <><path d="M12 21s8-4.5 8-11V5l-8-3-8 3v5c0 6.5 8 11 8 11Z" /><path d="m8 12 2.5 2.5L16 9" /></>,
    insights: <><path d="M9 18h6M10 22h4" /><path d="M8.5 15.5A7 7 0 1 1 15.5 15c-.8.6-1.5 1.5-1.5 3h-4c0-1.5-.7-2.4-1.5-3Z" /></>,
    peers: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 20c.3-3 2.3-5 6-5s5.7 2 6 5M15 15c3 .1 4.8 1.7 5 4" /></>,
    report: <><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1-1.8 3.1-.2-.1a2 2 0 0 0-3 .9v.2H9.5V19a2 2 0 0 0-3-.9l-.2.1-1.8-3.1.1-.1a2 2 0 0 0 0-3.5l-.1-.1 1.8-3.1.2.1a2 2 0 0 0 3-.9v-.2h5v.2a2 2 0 0 0 3 .9l.2-.1 1.8 3.1-.1.1a2 2 0 0 0 0 3.5Z" /></>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function NavItem({ to, label, icon, disabled, dirty }: { to: string; label: string; icon: NavIconName; disabled: boolean; dirty: boolean }) {
  if (disabled) {
    return (
      <span
        className="sidebar-item"
        aria-disabled="true"
        title="Open or create a company analysis to use this section."
      >
        <NavIcon name={icon} />
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
      <NavIcon name={icon} />
      {label}
    </NavLink>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { current, analysis, analysing, error, clearError, meta, dirty, theme, setTheme } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);

  const hasCompany = Boolean(current);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const revealable = () => main.querySelectorAll<HTMLElement>('.stagger > *:not(.scroll-reveal)');
    const revealAll = () => revealable().forEach((element) => element.classList.add('scroll-revealed'));
    if (!('IntersectionObserver' in window)) {
      revealAll();
      return;
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('scroll-revealed', entry.isIntersecting);
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -4% 0px' },
    );

    const observeSections = () => {
      revealable().forEach((element) => {
        element.classList.add('scroll-reveal');
        revealObserver.observe(element);
      });
    };

    observeSections();
    const mutationObserver = new MutationObserver(observeSections);
    mutationObserver.observe(main, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      revealObserver.disconnect();
    };
  }, []);

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
                    <NavItem key={item.to} to={item.to} label={item.label} icon={item.icon} dirty={dirty} disabled={Boolean(item.needsCompany) && !hasCompany} />
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
        <main ref={mainRef} className="flex-1 px-4 py-5 lg:px-6 lg:py-7" style={{ viewTransitionName: 'page' }}>{children}</main>

        <footer className="hairline-t px-4 py-3 text-caption-2 leading-relaxed text-ink-500 lg:px-6">
          All metrics are calculated deterministically from the data you entered. Figures shown as “n/a” could not be calculated and are not zero.
          {analysis && ` Engine version ${analysis.engineVersion}.`}
        </footer>
      </div>
    </div>
  );
}
