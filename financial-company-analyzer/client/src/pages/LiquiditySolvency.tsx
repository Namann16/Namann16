import { useWorkspace } from '../state/WorkspaceContext';
import { Card, PageHeader } from '../components/ui/primitives';
import { FinancialChart } from '../components/charts/Charts';
import { AnalysisSection, KpiCard, usableSeries } from '../components/analysis/MetricViews';
import { combineSeries, fmtCtx } from '../lib/display';

/** Plain-language explanations shown alongside the ratios, not just the formula. */
const EXPLANATIONS: { title: string; formula: string; body: string }[] = [
  {
    title: 'Current Ratio',
    formula: 'Current Assets / Current Liabilities',
    body: 'Measures the ability to meet short-term obligations using assets expected to convert to cash within a year. A reading below 1.0x means liabilities falling due exceed the assets available to settle them, which is not automatically a problem for a business that collects cash quickly, but leaves no buffer.',
  },
  {
    title: 'Quick Ratio',
    formula: '(Current Assets − Inventory) / Current Liabilities',
    body: 'The same test with inventory removed, because inventory is the slowest current asset to turn into cash and may not sell at book value. A large gap between the current and quick ratio tells you how much of the liquidity position depends on selling stock.',
  },
  {
    title: 'Cash Ratio',
    formula: '(Cash + Short-Term Investments) / Current Liabilities',
    body: 'The most conservative test: what could be settled from cash already in hand, assuming nothing is collected and nothing is sold.',
  },
  {
    title: 'Net Debt / EBITDA',
    formula: '(Total Debt − Cash − Short-Term Investments) / EBITDA',
    body: 'How many years of current operating earnings would be needed to repay borrowings net of cash. This is the standard leverage test in credit agreements, which is why the threshold is industry-specific: an infrastructure business is financed very differently from a software one.',
  },
  {
    title: 'Interest Coverage',
    formula: 'EBIT / Interest Expense',
    body: 'How many times operating profit covers the interest bill. It answers a different question from leverage: a company can carry high debt comfortably if rates are low and earnings are stable, and low debt uncomfortably if they are not.',
  },
  {
    title: 'Debt / Equity',
    formula: 'Total Debt / Total Equity',
    body: 'How much borrowed capital is used per unit of shareholder capital. Higher leverage amplifies returns to shareholders in good years and losses in bad ones. The ratio is not meaningful when equity is negative, and is reported as unavailable in that case.',
  },
];

export default function LiquiditySolvency() {
  const { analysis, current } = useWorkspace();
  if (!analysis || !current) return null;

  const { metrics, company, thresholds } = analysis;
  const ctx = fmtCtx(company);

  const liquidity = combineSeries([
    { key: 'current', series: metrics['currentRatio'] },
    { key: 'quick', series: metrics['quickRatio'] },
    { key: 'cash', series: metrics['cashRatio'] },
  ]);

  const leverage = combineSeries([
    { key: 'totalDebt', series: metrics['totalDebt'] },
    { key: 'netDebt', series: metrics['netDebt'] },
    { key: 'leverage', series: metrics['netDebtToEbitda'] },
  ]);

  const coverage = combineSeries([
    { key: 'coverage', series: metrics['interestCoverage'] },
    { key: 'debtToEquity', series: metrics['debtToEquity'] },
  ]);

  const insights = analysis.insights.filter((i) => i.category === 'liquidity' || i.category === 'solvency');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Liquidity & Solvency"
        description="Liquidity asks whether the company can pay what falls due in the next year. Solvency asks whether its capital structure is sustainable over the longer term. A company can be solvent and still run out of cash, which is why both are shown together."
      />

      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Current ratio" series={metrics['currentRatio']} company={company} emphasise />
        <KpiCard label="Quick ratio" series={metrics['quickRatio']} company={company} />
        <KpiCard label="Cash ratio" series={metrics['cashRatio']} company={company} />
        <KpiCard label="Net debt / EBITDA" series={metrics['netDebtToEbitda']} company={company} emphasise />
        <KpiCard label="Interest coverage" series={metrics['interestCoverage']} company={company} />
        <KpiCard label="Debt / equity" series={metrics['debtToEquity']} company={company} />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Liquidity ratios" description={`The dashed line marks the ${thresholds.currentRatioLow.toFixed(1)}x current-ratio minimum configured for this industry.`}>
          <FinancialChart
            data={liquidity}
            unit="times"
            ctx={ctx}
            series={[
              { key: 'current', label: 'Current ratio', type: 'line' },
              { key: 'quick', label: 'Quick ratio', type: 'line' },
              { key: 'cash', label: 'Cash ratio', type: 'line' },
            ]}
            {...(thresholds.currentRatioLow > 0
              ? { reference: { value: thresholds.currentRatioLow, label: `Minimum ${thresholds.currentRatioLow.toFixed(1)}x` } }
              : {})}
          />
        </Card>

        <Card title="Debt and leverage" description={`Bars show debt levels; the line shows the leverage multiple against the ${thresholds.netDebtToEbitdaHigh.toFixed(1)}x level treated as elevated.`}>
          <FinancialChart
            data={leverage}
            unit="currency"
            rightUnit="times"
            ctx={ctx}
            series={[
              { key: 'totalDebt', label: 'Total debt', type: 'bar' },
              { key: 'netDebt', label: 'Net debt', type: 'bar' },
              { key: 'leverage', label: 'Net debt / EBITDA', type: 'line', unit: 'times', axis: 'right' },
            ]}
          />
        </Card>

        <Card title="Debt service" description={`Interest coverage against the ${thresholds.interestCoverageLow.toFixed(1)}x threshold below which servicing capacity is described as weak.`} className="xl:col-span-2">
          <FinancialChart
            data={coverage}
            unit="times"
            ctx={ctx}
            height={240}
            series={[
              { key: 'coverage', label: 'Interest coverage', type: 'line' },
              { key: 'debtToEquity', label: 'Debt / equity', type: 'line' },
            ]}
            reference={{ value: thresholds.interestCoverageLow, label: `Weak below ${thresholds.interestCoverageLow.toFixed(1)}x` }}
          />
        </Card>
      </div>

      <AnalysisSection
        title="Liquidity"
        description="Short-term coverage of obligations falling due within the year."
        series={usableSeries(analysis, 'liquidity')}
        company={company}
      />

      <AnalysisSection
        title="Solvency and leverage"
        description="Capital structure and the capacity to service it."
        series={usableSeries(analysis, 'solvency')}
        company={company}
        insights={insights}
      />

      <Card title="What these ratios mean" description="Definitions in plain language, not just formulas.">
        <div className="grid gap-4 md:grid-cols-2">
          {EXPLANATIONS.map((item) => (
            <div key={item.title}>
              <p className="text-[12.5px] font-semibold text-ink-900 dark:text-ink-100">{item.title}</p>
              <p className="mt-0.5 font-mono text-[11.5px] text-ink-500 dark:text-ink-400">{item.formula}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-300">{item.body}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
