"""Builds the fictional Apex Consumer Products Ltd dataset.

The model is constructed so that the balance sheet balances by construction and the cash flow
statement reconciles with the movement in balance-sheet cash. Other current liabilities absorbs
the residual, which is how accruals behave in a real statement.
Output: packages/core/src/sample/apexConsumer.ts
"""
import json

YEARS = ["FY21", "FY22", "FY23", "FY24", "FY25", "FY26"]
END = ["2021-03-31","2022-03-31","2023-03-31","2024-03-31","2025-03-31","2026-03-31"]

revenue      = [1000.0, 1150.0, 1300.0, 1500.0, 1720.0, 1980.0]
cogs_pct     = [0.620,  0.615,  0.609,  0.604,  0.598,  0.602]
emp_pct      = [0.092,  0.091,  0.090,  0.089,  0.088,  0.089]
sm_pct       = [0.072,  0.071,  0.070,  0.069,  0.068,  0.070]
ga_pct       = [0.054,  0.053,  0.052,  0.051,  0.050,  0.051]
dep_pct      = [0.041,  0.040,  0.040,  0.039,  0.038,  0.039]
amort        = [3.0, 3.2, 3.5, 3.8, 4.0, 4.4]
other_income = [6.0, 7.0, 8.5, 9.0, 11.0, 12.0]
tax_rate     = 0.252

# Working capital drivers (days). FY26 shows a deliberate stretch in receivables.
dso_days = [52, 51, 50, 49, 48, 62]
dio_days = [64, 63, 62, 60, 58, 61]
dpo_days = [58, 58, 59, 60, 61, 59]

# Debt schedule: a leveraged start that is progressively repaid.
st_debt = [60.0, 58.0, 55.0, 50.0, 45.0, 48.0]
lt_debt = [340.0, 320.0, 295.0, 262.0, 225.0, 205.0]
interest_rate = 0.089

capex        = [72.0, 80.0, 88.0, 99.0, 108.0, 138.0]
dividend_pay = [0.22, 0.23, 0.24, 0.25, 0.26, 0.26]  # share of net income

share_capital = 100.0
shares_out    = [50.0]*6   # crore shares
share_price   = [118.0, 146.0, 171.0, 214.0, 268.0, 302.0]

opening_ppe = 620.0
opening_intangibles = 38.0
goodwill = 55.0
opening_re = 285.0
opening_cash = 92.0
opening_lt_inv = 30.0
opening_other_nca = 24.0
opening_oca = 38.0

rows = []
ppe = opening_ppe
intangibles = opening_intangibles
re = opening_re
cash = opening_cash
prev_ar = prev_inv = prev_ap = prev_oca = None

def r(x, n=1):
    return round(x + 0.0, n)

for i, y in enumerate(YEARS):
    rev = revenue[i]
    cogs = rev * cogs_pct[i]
    gp = rev - cogs
    emp = rev * emp_pct[i]
    sm = rev * sm_pct[i]
    ga = rev * ga_pct[i]
    opex = emp + sm + ga
    ebitda = gp - opex
    dep = rev * dep_pct[i]
    am = amort[i]
    ebit = ebitda - dep - am
    debt_avg = (st_debt[i] + lt_debt[i]) if i == 0 else ((st_debt[i]+lt_debt[i]) + (st_debt[i-1]+lt_debt[i-1]))/2
    interest = debt_avg * interest_rate
    pbt = ebit - interest + other_income[i]
    tax = pbt * tax_rate
    ni = pbt - tax

    ar = rev * dso_days[i] / 365.0
    inv = cogs * dio_days[i] / 365.0
    ap = cogs * dpo_days[i] / 365.0
    oca = opening_oca * (rev / revenue[0])

    div = ni * dividend_pay[i]
    re = re + ni - div

    ppe = ppe + capex[i] - dep
    intangibles = intangibles - am + (6.0 if i >= 3 else 0.0)
    lt_inv = opening_lt_inv + i * 4.0
    other_nca = opening_other_nca + i * 2.5

    if i == 0:
        # First year: seed working-capital deltas as nil and let cash be the opening balance.
        d_ar = d_inv = d_ap = d_oca = 0.0
        cfo = ni + dep + am
        debt_issued = 0.0
        debt_repaid = 0.0
    else:
        d_ar = -(ar - prev_ar)
        d_inv = -(inv - prev_inv)
        d_ap = (ap - prev_ap)
        d_oca = -(oca - prev_oca)
        cfo = ni + dep + am + d_ar + d_inv + d_ap + d_oca
        delta_debt = (st_debt[i] + lt_debt[i]) - (st_debt[i-1] + lt_debt[i-1])
        debt_issued = max(delta_debt, 0.0)
        debt_repaid = min(delta_debt, 0.0)

    cfi = -capex[i] - (4.0 if i > 0 else 0.0) - (6.0 if i >= 3 else 0.0)
    cff = debt_issued + debt_repaid - div
    net_change = cfo + cfi + cff
    opening_cash_i = cash
    cash = cash + net_change

    total_ca_components = cash + 0.0 + ar + inv + oca
    st_inv = 18.0 + i * 3.0
    total_ca = cash + st_inv + ar + inv + oca
    total_nca = ppe + intangibles + goodwill + lt_inv + other_nca
    total_assets = total_ca + total_nca

    equity = share_capital + re
    # Other current liabilities absorbs accruals so that the identity holds exactly.
    other_ncl = 42.0 + i * 3.0
    total_ncl = lt_debt[i] + other_ncl
    other_cl = total_assets - equity - total_ncl - ap - st_debt[i]
    total_cl = ap + st_debt[i] + other_cl
    total_liab = total_cl + total_ncl

    eps = ni / shares_out[i]

    rows.append({
        "label": y, "endDate": END[i], "order": i,
        "values": {
            "revenue": r(rev), "cogs": r(cogs),
            "employeeExpenses": r(emp), "sellingMarketingExpenses": r(sm), "generalAdminExpenses": r(ga),
            "depreciation": r(dep), "amortization": r(am),
            "interestExpense": r(interest), "otherIncome": r(other_income[i]),
            "taxExpense": r(tax),
            "cash": r(cash), "shortTermInvestments": r(st_inv),
            "accountsReceivable": r(ar), "inventory": r(inv), "otherCurrentAssets": r(oca),
            "ppe": r(ppe), "intangibleAssets": r(intangibles), "goodwill": r(goodwill),
            "longTermInvestments": r(lt_inv), "otherNonCurrentAssets": r(other_nca),
            "accountsPayable": r(ap), "shortTermDebt": r(st_debt[i]), "otherCurrentLiabilities": r(other_cl),
            "longTermDebt": r(lt_debt[i]), "otherNonCurrentLiabilities": r(other_ncl),
            "commonEquity": r(share_capital), "retainedEarnings": r(re),
            "cfDepreciation": r(dep), "cfAmortization": r(am),
            "changeInReceivables": r(d_ar), "changeInInventory": r(d_inv),
            "changeInPayables": r(d_ap), "changeInOtherWorkingCapital": r(d_oca),
            "cfo": r(cfo),
            "capex": r(capex[i]), "purchaseOfPPE": r(-capex[i]),
            "purchaseOfInvestments": r(-(4.0 if i > 0 else 0.0) - (6.0 if i >= 3 else 0.0)),
            "cfi": r(cfi),
            "debtIssued": r(debt_issued), "debtRepaid": r(debt_repaid), "dividendsPaid": r(-div),
            "cff": r(cff),
            "openingCash": r(opening_cash_i), "closingCash": r(cash),
            "sharesOutstanding": r(shares_out[i], 2), "sharePrice": r(share_price[i], 2),
            "basicEPS": r(eps, 2), "dilutedEPS": r(eps * 0.985, 2),
        },
    })
    prev_ar, prev_inv, prev_ap, prev_oca = ar, inv, ap, oca

# Verify the identity on the rounded numbers actually written to the file.
for row in rows:
    v = row["values"]
    ta = v["cash"]+v["shortTermInvestments"]+v["accountsReceivable"]+v["inventory"]+v["otherCurrentAssets"] \
         + v["ppe"]+v["intangibleAssets"]+v["goodwill"]+v["longTermInvestments"]+v["otherNonCurrentAssets"]
    tl = v["accountsPayable"]+v["shortTermDebt"]+v["otherCurrentLiabilities"]+v["longTermDebt"]+v["otherNonCurrentLiabilities"]
    te = v["commonEquity"]+v["retainedEarnings"]
    diff = ta - (tl + te)
    if abs(diff) > 0.15:
        # Push the rounding residual into other current liabilities so the file itself balances.
        v["otherCurrentLiabilities"] = round(v["otherCurrentLiabilities"] + diff, 1)
        tl += diff
    print(f'{row["label"]}: assets={ta:.1f} liab+eq={tl+te:.1f} diff={ta-(tl+te):.3f}')

body = json.dumps(rows, indent=2)
ts = '''import type { CompanyDataset, FinancialPeriod } from '../types.js';

/**
 * Apex Consumer Products Ltd. — FICTIONAL SAMPLE DATA.
 *
 * This company does not exist. The figures were generated from a consistent financial model so
 * that the balance sheet balances exactly, the cash flow statement reconciles with the movement
 * in cash, and the series exercises every feature of the analyzer: margin expansion, progressive
 * deleveraging, growing free cash flow, and a deliberate stretch in receivables in FY26 that the
 * red-flag engine should detect.
 *
 * Units: INR crore. Share counts are in crore shares, so EPS is in rupees per share.
 */
export const SAMPLE_PERIOD_DATA = __ROWS__ as const;

export function buildSamplePeriods(): FinancialPeriod[] {
  return SAMPLE_PERIOD_DATA.map((period) => ({
    label: period.label,
    endDate: period.endDate,
    order: period.order,
    values: { ...period.values } as Record<string, number | null>,
    // Every figure in the sample file is treated as reported data; the engine derives the rest.
    sources: Object.fromEntries(Object.keys(period.values).map((k) => [k, 'entered' as const])),
  }));
}

export const SAMPLE_COMPANY: CompanyDataset['company'] = {
  name: 'Apex Consumer Products Ltd.',
  industry: 'fmcg',
  sector: 'Consumer Staples',
  country: 'India',
  currency: 'INR',
  fiscalYearEnd: '31 March',
  reportingPeriod: 'annual',
  units: 'crores',
  ticker: 'APEXCP',
  benchmark: 'NIFTY FMCG',
  sharePrice: 302,
  sharesOutstanding: 50,
  marketCap: 15100,
  isSample: true,
  notes: 'Fictional sample dataset supplied with the application for demonstration and testing. Not a real company.',
};

export const SAMPLE_PEERS: NonNullable<CompanyDataset['peers']> = [
  { name: 'Northline Foods Ltd.', source: 'Fictional peer data', metrics: { revenueGrowth: 11.4, ebitdaMargin: 17.2, netMargin: 10.1, roe: 19.8, roic: 16.4, debtToEquity: 0.42, netDebtToEbitda: 1.1, currentRatio: 1.42, assetTurnover: 1.18, fcfMargin: 6.9 } },
  { name: 'Verdant Household Ltd.', source: 'Fictional peer data', metrics: { revenueGrowth: 8.2, ebitdaMargin: 19.6, netMargin: 12.4, roe: 24.1, roic: 20.2, debtToEquity: 0.18, netDebtToEbitda: 0.2, currentRatio: 1.85, assetTurnover: 1.31, fcfMargin: 9.8 } },
  { name: 'Coastal Staples Ltd.', source: 'Fictional peer data', metrics: { revenueGrowth: 14.9, ebitdaMargin: 14.8, netMargin: 7.6, roe: 15.2, roic: 11.9, debtToEquity: 0.78, netDebtToEbitda: 2.4, currentRatio: 1.16, assetTurnover: 1.02, fcfMargin: 3.1 } },
];

export function buildSampleDataset(): CompanyDataset {
  return {
    company: { ...SAMPLE_COMPANY },
    periods: buildSamplePeriods(),
    peers: SAMPLE_PEERS.map((p) => ({ ...p, metrics: { ...p.metrics } })),
  };
}
'''.replace('__ROWS__', body)

open('packages/core/src/sample/apexConsumer.ts','w').write(ts)
print("written")
