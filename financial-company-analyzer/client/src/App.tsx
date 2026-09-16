import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { useWorkspace } from './state/WorkspaceContext';
import { Banner, EmptyState, Spinner } from './components/ui/primitives';

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

  if (loading && !current) return <Spinner label="Opening analysis" />;
  if (!current) {
    return (
      <EmptyState
        title="No analysis is open"
        message="Create a company analysis, open an existing one, or load the fictional sample dataset to explore the application."
        action={<a className="btn-primary" href="/">Go to Home</a>}
      />
    );
  }
  if (!analysis) return <Spinner label="Calculating analysis" />;
  return children;
}

export default function App() {
  const { meta, metaError } = useWorkspace();

  if (metaError) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Banner tone="negative" title="Cannot reach the analysis server">
          {metaError}
          <span className="mt-2 block">
            Start the API with <code className="font-mono">npm run dev:server</code> from the project root, then reload this page.
          </span>
        </Banner>
      </div>
    );
  }

  if (!meta) {
    return <div className="flex h-screen items-center justify-center"><Spinner label="Loading workspace" /></div>;
  }

  const guarded = (element: JSX.Element) => <RequiresCompany>{element}</RequiresCompany>;

  return (
    <Shell>
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
    </Shell>
  );
}
