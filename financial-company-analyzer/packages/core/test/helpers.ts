import type { CompanyDataset, CompanyProfile, FinancialPeriod, Num } from '../src/types.js';

export const testCompany: CompanyProfile = {
  name: 'Test Co Ltd.',
  industry: 'general',
  currency: 'INR',
  units: 'crores',
};

/** Build a period from a plain object of line items. Everything supplied counts as entered data. */
export function period(label: string, order: number, values: Record<string, Num>): FinancialPeriod {
  return {
    label,
    order,
    values,
    sources: Object.fromEntries(Object.keys(values).map((k) => [k, 'entered' as const])),
  };
}

export function dataset(periods: FinancialPeriod[], overrides: Partial<CompanyDataset> = {}): CompanyDataset {
  return { company: { ...testCompany, ...(overrides.company ?? {}) }, periods, ...overrides };
}

/** Round for comparison against hand-calculated expectations. */
export function approx(value: Num, expected: number, tolerance = 0.01): boolean {
  return value !== null && Math.abs(value - expected) <= tolerance;
}
