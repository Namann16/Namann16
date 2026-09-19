import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Shell } from './components/layout/Shell';
import { useWorkspace } from './state/WorkspaceContext';
import { AnalysisSkeleton, Banner, Card, EmptyState, Spinner } from './components/ui/primitives';
import { API_BASE_URL } from './api/client';

import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import DataInput from './pages/DataInput';
import Statements from './pages/Statements';
import Ratios from './pages/Ratios';
import Profitability from './pages/Profitability';
import LiquiditySolvency from './pages/LiquiditySolvency';
import WorkingCapital from './pages/WorkingCapital';
import CashFlow from './pages/CashFlow';
import GrowthTrends from './pages/GrowthTrends';
import DuPont from './pages/DuPont';
import FinancialHealth from './pages/FinancialHealth';
import Insights from './pages/Insights';
import Peers from './pages/Peers';
import Report from './pages/Report';
import Settings from './pages/Settings';

/**
 * Guard for sections that need an open analysis.
 *
 * Rather than redirecting silently, it explains what is missing and offers the way forward —
 * the user should always know why a screen is unavailable.
 */
function RequiresCompany({ children }: { children: JSX.Element }) {
  const { current, analysis, loading } = useWorkspace();

  if (loading && !current) return <AnalysisSkeleton label="Opening analysis" />;
  if (!current) {
    return (
      <EmptyState
        title="No analysis is open"
        message="Create a company analysis, open an existing one, or load the fictional sample dataset to explore the application."
        action={<a className="btn-primary" href="/">Go to Home</a>}
      />
    );
  }
  // A shape that matches what is coming, so the layout does not jump when it arrives.
  if (!analysis) return <AnalysisSkeleton />;
  return children;
}

function EntrySplash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const revealDuration = reduced ? 120 : 1450;
    const leaveTimer = window.setTimeout(() => setLeaving(true), revealDuration);
    const doneTimer = window.setTimeout(onDone, revealDuration + (reduced ? 0 : 420));
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div className={`entry-splash${leaving ? ' entry-splash-leaving' : ''}`} role="status" aria-label="Loading Financified">
      <div className="entry-splash-orbit entry-splash-orbit-one" aria-hidden="true" />
      <div className="entry-splash-orbit entry-splash-orbit-two" aria-hidden="true" />
      <div className="entry-splash-content">
        <span className="entry-splash-kicker">Financial clarity, amplified</span>
        <h1 className="entry-splash-wordmark">
          <span>Financified</span>
        </h1>
        <span className="entry-splash-rule" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function App() {
  const { meta, metaError, connecting, retryConnection } = useWorkspace();
  const location = useLocation();
  const [showEntrySplash, setShowEntrySplash] = useState(true);
  const finishEntrySplash = () => setShowEntrySplash(false);

  useEffect(() => {
    if (!showEntrySplash) return;
    const htmlOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = htmlOverflow;
      document.body.style.overflow = bodyOverflow;
    };
  }, [showEntrySplash]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, left: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, [location.pathname]);

  let appContent: JSX.Element;
  if (metaError) {
    // The same browser error covers "host unreachable" and "origin refused by CORS", so the
    // guidance below names both rather than asserting a cause it cannot actually distinguish.
    const isLocal = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    const target = API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');

    appContent = (
      <div className="mx-auto max-w-2xl p-6">
        <Card title="Cannot reach the analysis server">
          <Banner tone="negative">{metaError}</Banner>

          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
            The interface loaded, but it could not fetch anything from the API at{' '}
            <code className="font-mono text-[11.5px]">{target}/api</code>.
          </p>

          {isLocal ? (
            <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
              <li>• Start the API with <code className="font-mono">npm run dev</code> from the project root — that runs the server and this app together.</li>
              <li>• If the API is on a different port, set <code className="font-mono">PORT</code> in <code className="font-mono">.env</code> to match.</li>
            </ul>
          ) : (
            <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">
              <li>
                <strong className="font-medium">The API may be asleep.</strong> Free hosting tiers stop the server after a period
                of inactivity and take up to a minute to start again. Try once more before assuming anything is broken.
              </li>
              <li>
                <strong className="font-medium">This site&rsquo;s address may not be allow-listed.</strong> The API only answers
                origins named in its <code className="font-mono">CORS_ORIGIN</code> setting. If this page is on a new deployment
                URL, add <code className="font-mono">{typeof window !== 'undefined' ? window.location.origin : ''}</code> to it.
              </li>
              <li>
                <strong className="font-medium">Check the API directly:</strong> open{' '}
                <a className="text-accent-600 underline" href={`${target}/api/meta/health`} target="_blank" rel="noreferrer">
                  {target}/api/meta/health
                </a>{' '}
                — if that returns data, the server is fine and the problem is the allow-list above.
              </li>
            </ul>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button type="button" className="btn-primary" onClick={() => void retryConnection()} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Try again'}
            </button>
            <span className="text-2xs text-ink-500 dark:text-ink-400">Nothing you entered has been lost.</span>
          </div>
        </Card>
      </div>
    );
  } else if (!meta) {
    appContent = <div className="flex h-screen items-center justify-center"><Spinner label="Loading workspace" /></div>;
  } else {
    const guarded = (element: JSX.Element) => <RequiresCompany>{element}</RequiresCompany>;
    appContent = (
      <Shell>
        <div key={location.pathname} className="route-transition">
          <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={guarded(<Dashboard />)} />
          <Route path="/data" element={<DataInput />} />
          <Route path="/statements" element={guarded(<Statements />)} />
          <Route path="/ratios" element={guarded(<Ratios />)} />
          <Route path="/profitability" element={guarded(<Profitability />)} />
          <Route path="/liquidity-solvency" element={guarded(<LiquiditySolvency />)} />
          <Route path="/working-capital" element={guarded(<WorkingCapital />)} />
          <Route path="/cash-flow" element={guarded(<CashFlow />)} />
          <Route path="/growth" element={guarded(<GrowthTrends />)} />
          <Route path="/dupont" element={guarded(<DuPont />)} />
          <Route path="/health" element={guarded(<FinancialHealth />)} />
          <Route path="/insights" element={guarded(<Insights />)} />
          <Route path="/peers" element={guarded(<Peers />)} />
          <Route path="/report" element={guarded(<Report />)} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Shell>
    );
  }

  return (
    <>
      {appContent}
      {showEntrySplash && <EntrySplash onDone={finishEntrySplash} />}
    </>
  );
}
