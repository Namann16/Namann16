# Financial formulas and methodology

Every formula in the application is defined once, in `packages/core/src/engine/metricDefs.ts`.
Nothing here is reimplemented in a route handler, a React component or an export.

Each metric carries its formula, the exact inputs it consumed, the period it applies to, and a
status saying whether the data was sufficient. That metadata is what the *View calculation*
drawers, the Excel export and the PDF report all read from.

## How a missing value is handled

`null` means **not available**. It is never `0`, and it never becomes `0`.

```ts
safeDiv(numerator, denominator)   // null if either is missing, or the denominator is zero
safeDivPositiveDenominator(n, d)  // also null when d <= 0, for ratios that need a positive base
sumStrict([...])                  // null if ANY input is missing — a total must not understate
sumDefined([...])                 // ignores missing inputs; null only if all are missing
```

A metric built from a missing input comes back with `status: 'insufficient_data'` and a note
naming what was required. A metric whose denominator is zero comes back as
`'undefined_denominator'`. A metric that does not apply to the industry comes back as
`'not_applicable'` with the reason.

---

## Statement derivation

Applied to a fixed point so chained derivations resolve. **Values you entered are never
overwritten** — if you supply both EBITDA and its components, your EBITDA stands and any
disagreement is raised by the data-quality engine instead of being silently resolved.

| Derived | Formula |
|---|---|
| Gross Profit | Revenue − COGS |
| COGS | Revenue − Gross Profit |
| Operating Expenses | Employee + Selling & Marketing + G&A + Other *(needs ≥2 components)* |
| EBITDA | Gross Profit − Operating Expenses |
| EBITDA *(alternative)* | EBIT + Depreciation + Amortisation |
| EBIT | EBITDA − Depreciation − Amortisation |
| PBT | EBIT − Interest Expense + Other Income + Exceptional Items |
| Net Income | PBT − Tax Expense |
| Total Current Assets | Cash + ST Investments + Receivables + Inventory + Other *(needs ≥3)* |
| Total Non-Current Assets | PP&E + Intangibles + Goodwill + LT Investments + Other *(needs ≥2)* |
| Total Assets | Total Current Assets + Total Non-Current Assets *(all parts required)* |
| Total Current Liabilities | Payables + ST Debt + Other Current Liabilities *(needs ≥2)* |
| Total Liabilities | Total Current + Total Non-Current Liabilities *(all parts required)* |
| Total Equity | Common + Preferred + Retained Earnings + Treasury + Other *(needs ≥2)* |
| CFO | Net Income + D&A + Non-Cash Items + WC Movements + Other Adjustments |
| CFI | −Capex + Sale of PP&E + Investment Purchases/Sales + Other |
| CFF | Debt Issued + Debt Repaid + Equity Issued + Buybacks + Dividends + Other |
| Net Change in Cash | CFO + CFI + CFF + FX Effect |
| Basic EPS | (Net Income − Preferred Dividends) / Shares Outstanding |

**Why the minimum-component rules exist.** Deriving a total from a single component would produce
a confidently wrong number: one component present out of five usually means a partial disclosure,
not a complete total. Below the minimum the total is left unavailable and reported as such.

**CFO reconstruction** additionally requires depreciation *and* at least one working-capital
movement. Without both, the reconstruction would understate the figure rather than be honestly
unavailable.

**Opening cash** is carried forward from the prior period's closing cash when not supplied, and
marked as calculated.

---

## Growth

| Metric | Formula |
|---|---|
| YoY growth | (Current − Prior) / Prior |
| CAGR | ((Ending / Beginning) ^ (1 / years)) − 1 |

**Growth is not reported off a zero or negative base.** A loss narrowing from −50 to −20 would
read as "−60% growth", which is meaningless. The engine returns `null` and says why.

**CAGR** is computed over the longest span where both endpoints are available *and strictly
positive*, because a compound rate through zero or a negative value has no real solution. If that
span is shorter than the full dataset, the metric records which years were used and why the
others were excluded. With fewer than two periods it returns `insufficient_data` with the message
*"At least two periods of data are required to calculate a compound growth rate."*

---

## Profitability

| Metric | Formula |
|---|---|
| Gross Margin | Gross Profit / Revenue |
| EBITDA Margin | EBITDA / Revenue |
| EBIT Margin | EBIT / Revenue |
| Net Profit Margin | Net Income / Revenue |
| PBT Margin | PBT / Revenue |
| Effective Tax Rate | Tax Expense / PBT *(not meaningful when PBT ≤ 0)* |

## Returns on capital

| Metric | Formula |
|---|---|
| ROA | Net Income / **Average** Total Assets |
| ROE | (Net Income − Preferred Dividends) / **Average** Total Equity |
| ROIC | NOPAT / **Average** Invested Capital |
| ROCE | EBIT / (Total Assets − Total Current Liabilities) |

Where:
- **NOPAT** = EBIT × (1 − effective tax rate)
- **Invested Capital** = Total Equity + Total Debt − Cash

**ROE and negative equity.** When equity is zero or negative, ROE is reported as unavailable, not
as a large negative or a spurious positive. A loss divided by negative equity produces a positive
percentage that looks like a strong return, which would be actively misleading.

**ROIC and the effective tax rate.** The rate is taken from the P&L (tax ÷ PBT) and is rejected if
it falls outside 0–60%, since a one-off tax credit or a loss year produces a rate that makes NOPAT
nonsense. Without a usable rate, ROIC reports insufficient data rather than assuming a statutory
rate the company may not pay.

---

## Average versus closing balances

Ratios that divide a **flow** (revenue, profit, COGS — earned across the year) by a **stock**
(assets, equity, inventory — measured at a point in time) use the average of the opening and
closing balance. Using the closing balance overstates the denominator for a growing company and
understates the return.

**Where no prior period exists**, the closing balance is used and the metric records
*"Closing balance used — no prior-period balance is available to compute an average."* The
methodology is disclosed rather than the two bases being silently mixed across periods.

Metrics on this basis: ROA, ROE, ROIC, equity multiplier, asset turnover, fixed asset turnover,
inventory turnover, receivables turnover, payables turnover, DSO, DIO, DPO.

---

## Liquidity

| Metric | Formula |
|---|---|
| Current Ratio | Total Current Assets / Total Current Liabilities |
| Quick Ratio | (Total Current Assets − Inventory) / Total Current Liabilities |
| Cash Ratio | (Cash + Short-Term Investments) / Total Current Liabilities |

Where inventory is not supplied but current assets are, the quick ratio treats inventory as nil
and notes that the ratio may be overstated if inventory exists.

## Solvency and leverage

| Metric | Formula |
|---|---|
| Total Debt | Short-Term Debt + Long-Term Debt |
| Net Debt | Total Debt − Cash − Short-Term Investments |
| Debt / Equity | Total Debt / Total Equity *(unavailable when equity ≤ 0)* |
| Debt / Assets | Total Debt / Total Assets |
| Net Debt / EBITDA | Net Debt / EBITDA |
| Interest Coverage | EBIT / Interest Expense |
| Equity Multiplier | Average Total Assets / Average Total Equity |
| CFO / Total Debt | CFO / Total Debt |

**Net cash positions.** When net debt is zero or negative, Net Debt / EBITDA is reported as
`0.0x` with a note, not as a negative multiple. A reading of "−0.8x leverage" invites
misinterpretation; "0.0x, net cash position" does not.

**Negative EBITDA** makes the leverage multiple uninterpretable, so it is reported as unavailable.

**No interest expense** makes coverage not applicable rather than infinite.

---

## Efficiency and working capital

| Metric | Formula |
|---|---|
| Asset Turnover | Revenue / Average Total Assets |
| Fixed Asset Turnover | Revenue / Average Net PP&E |
| Inventory Turnover | COGS / Average Inventory |
| Receivables Turnover | Revenue / Average Receivables |
| Payables Turnover | COGS / Average Payables |
| DSO | (Average Receivables / Revenue) × 365 |
| DIO | (Average Inventory / COGS) × 365 |
| DPO | (Average Payables / COGS) × 365 |
| Cash Conversion Cycle | DSO + DIO − DPO |
| Working Capital | Total Current Assets − Total Current Liabilities |
| Working Capital / Revenue | Working Capital / Revenue |

DSO uses revenue; DIO and DPO use COGS, because inventory and supplier balances are carried at
cost, not at selling price. A 365-day year is assumed.

For a business with no inventory the cycle treats DIO as nil and says so. Without DSO or DPO the
cycle is unavailable, since neither can be assumed.

---

## Cash flow

| Metric | Formula |
|---|---|
| Free Cash Flow | **CFO − Capital Expenditure** |
| CFO Margin | CFO / Revenue |
| FCF Margin | Free Cash Flow / Revenue |
| CFO / Net Income | CFO / Net Income |
| FCF / Net Income | Free Cash Flow / Net Income |
| Capex / CFO | Capital Expenditure / CFO |
| Capex / Revenue | Capital Expenditure / Revenue |

Conversion ratios are reported as unavailable when net income is zero or negative: a ratio against
a loss cannot be read as a conversion rate. Capex is taken as an absolute magnitude regardless of
the sign convention used on import.

---

## DuPont decomposition

```
ROE = Net Profit Margin × Asset Turnover × Equity Multiplier
```

The identity holds because
`(NI / Revenue) × (Revenue / Assets) × (Assets / Equity)` cancels to `NI / Equity`.

Because the components use average balance-sheet values, the product is reported **alongside**
directly calculated ROE as a consistency check rather than assumed to match. A large gap points to
an inconsistency in the underlying data and is visible instead of hidden.

**Attribution** uses a sequential chain decomposition. Each factor is moved from its prior-period
value to its current value in turn, holding the not-yet-moved factors at prior values:

```
base           = m₀ × t₀ × e₀
after margin   = m₁ × t₀ × e₀     margin effect   = after margin − base
after turnover = m₁ × t₁ × e₀     turnover effect = after turnover − after margin
after leverage = m₁ × t₁ × e₁     leverage effect = after leverage − after turnover
```

The three effects **sum exactly** to the total change in decomposed ROE, so nothing is left
unexplained. The primary driver is whichever effect is largest in absolute terms — calculated from
the data, never assumed. Where leverage is the largest positive contributor, the engine says so
explicitly, because a leverage-led ROE improvement raises returns without improving the business.

---

## Data quality checks

| Check | Test |
|---|---|
| Balance sheet identity | Total Assets = Total Liabilities + Total Equity, within tolerance |
| Cash flow reconciliation | CFO + CFI + CFF + FX vs the movement in balance-sheet cash |
| Component vs reported total | Where both were entered, do they agree? |
| Missing core line items | Which of the 16 essential items are absent, and for which years |
| Unavailable metrics | Which ratios could not be calculated, per period, and why |
| Sign sanity | Revenue, assets, inventory, receivables, cash or share count reported negative |
| Negative equity | Flagged, with the ratios it invalidates named |
| Period integrity | Duplicate labels, single-period datasets |

**Balance tolerance** is `max(|Total Assets| × balanceToleranceRatio, balanceToleranceAbsolute)` —
0.5% of assets or an absolute floor by default, both configurable. Rounding in a source document
should not raise a false failure, but a real imbalance is reported with the exact difference and
never hidden.

**First-period growth metrics are not warned about.** A growth or average-balance metric is
necessarily unavailable in the earliest year because there is no prior year. Reporting that would
add one warning per metric and bury the genuine problems.

---

## Financial health scoring

Seven pillars: Growth, Profitability, Liquidity, Solvency & Leverage, Operating Efficiency,
Cash Flow, Returns on Capital.

Each pillar is scored from named checks. A check maps a metric onto a linear band between a weak
level and a strong level, both drawn from the threshold configuration:

```
score = clamp((value − low) / (high − low), 0, 1)      // inverted when lower is better
```

Pillar score is the weighted average of its checks, ×100. The overall score is the
**coverage-weighted** average of the pillar scores, so a pillar resting on one check out of four
cannot swing the headline assessment.

**A check with no data is unrated and reduces the pillar's coverage. It does not score zero.** A
company is never penalised for data that was not supplied.

| Band | Label |
|---|---|
| 85–100 | Excellent |
| 72–84 | Strong |
| 58–71 | Healthy |
| 44–57 | Watch |
| 28–43 | Concern |
| 0–27 | Critical |

Every contributing factor is shown in the interface with the value observed, the band it was
scored against, and the points it contributed — split into what drives the score and what offsets
it. There are no undisclosed scores.

---

## Configurable thresholds

Nothing below is a fact. Each is a judgement call, each is overridable per company, and each flag
that fires records the threshold it used.

Resolution order: **engine defaults → industry overrides → your per-company overrides.**

| Threshold | Default | Controls |
|---|---|---|
| `receivablesVsRevenueGapPp` | 15 | Receivables-vs-revenue growth gap that raises a flag |
| `inventoryVsRevenueGapPp` | 15 | Inventory-vs-revenue growth gap |
| `assetsVsRevenueGapPp` | 15 | Asset-vs-revenue growth gap |
| `marginDeclinePeriods` | 2 | Consecutive EBITDA margin declines before flagging |
| `marginMaterialPp` | 1 | Minimum pp move called material |
| `netDebtToEbitdaHigh` | 3.0 | Leverage described as elevated |
| `netDebtToEbitdaCritical` | 4.5 | Leverage treated as critical |
| `interestCoverageLow` | 3.0 | Debt service described as weak |
| `interestCoverageCritical` | 1.5 | Debt service treated as critical |
| `currentRatioLow` | 1.0 | Liquidity flagged below this |
| `currentRatioStrong` | 1.5 | Liquidity described as comfortable |
| `quickRatioLow` | 0.8 | Quick-ratio floor |
| `debtToEquityHigh` | 1.5 | Capital structure described as aggressive |
| `cfoToNetIncomeLow` | 0.8 | Earnings quality questioned below this |
| `cccIncreaseDaysMaterial` | 15 | Cycle deterioration treated as material |
| `roeStrong` | 15% | ROE described as strong |
| `roicStrong` | 12% | ROIC described as strong |
| `roicHurdle` | 10% | Indicative cost-of-capital hurdle, **commentary only** |
| `revenueGrowthStrong` | 12% | Growth described as strong |
| `revenueGrowthWeak` | 2% | Growth described as weak |
| `fcfConversionLow` | 0.5 | FCF conversion flagged below this |
| `balanceToleranceRatio` | 0.005 | Balance-sheet rounding allowance, as a share of assets |
| `balanceToleranceAbsolute` | 0.01 | Absolute floor for that allowance |

`roicHurdle` deserves a note: it is a **configured assumption, not a measured cost of capital for
the company**. The insight that uses it says so in the text, rather than presenting the spread as
a fact about value creation.

---

## Industry configuration

The same threshold applied to a bank and a software company is a wrong answer twice. Industry
profiles adjust the thresholds and suppress metrics that do not apply.

| Industry | Notable overrides | Suppressed |
|---|---|---|
| Banking | D/E 12, leverage limits removed, ROE strong 14% | Inventory metrics, CCC, net debt/EBITDA, current/quick/cash ratios |
| Financial Services | D/E 6, leverage limits removed | Inventory metrics, CCC, net debt/EBITDA |
| Manufacturing | Asset-growth tolerance 20pp | — |
| FMCG | Leverage 2.5x, ROE 20%, ROIC 18%, current ratio 0.9 | — |
| Retail | Leverage 3.5x, inventory gap 12pp, current ratio 0.9 | — |
| Technology | Leverage 2.0x, ROIC/ROE 18%, growth 18%, asset gap 10pp | Inventory turnover, DIO |
| Pharmaceuticals | Receivables gap 18pp, ROIC 14% | — |
| Automobile | Leverage 3.0x, asset gap 20pp, ROIC 11% | — |
| Infrastructure | Leverage 5.0x/7.0x, coverage 2.0x, asset gap 40pp, ROIC 9% | — |
| Energy | Leverage 4.0x, coverage 2.5x, asset gap 30pp | — |
| Telecom | Leverage 4.0x, current ratio 0.7, asset gap 30pp, ROIC 9% | Inventory turnover, DIO |
| General / Other | Engine defaults | — |

For a bank, deposits are operating liabilities rather than leverage, and there is no inventory
cycle — so applying a 3.0x net-debt/EBITDA limit or reporting inventory days would be
meaningless rather than merely imprecise. For infrastructure, assets are expected to lead revenue
by design, which is why the asset-growth tolerance is 40pp rather than 15pp.
# Interim periods and scenarios

Quarterly and half-yearly periods use their entered values by default. When annualization is
enabled, period growth is compounded using `(1 + growth)^factor - 1`, where the factor is 4 for
quarterly data and 2 for half-yearly data. Flow-over-balance turnover and return metrics
annualize their flow numerator by the same factor; flow-based day metrics use `365 / factor` as
the period day basis. Scenario analysis applies temporary line-item overrides, reruns the deterministic
engine, and compares metric values, health score, and red flags; it never writes the overrides.
