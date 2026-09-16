/** Public surface of the deterministic financial engine. */

export * from './types.js';

export * from './utils/number.js';
export * from './utils/format.js';
export * from './utils/metric.js';

export * from './engine/lineItems.js';
export * from './engine/thresholds.js';
export * from './engine/normalize.js';
export * from './engine/metricDefs.js';
export * from './engine/calculate.js';
export * from './engine/dupont.js';
export * from './engine/dataQuality.js';
export * from './engine/health.js';
export * from './engine/rules.js';
export * from './engine/insights.js';
export * from './engine/peers.js';
export * from './engine/analyze.js';

export * from './excel/parseValue.js';
export * from './excel/mapping.js';

export * from './sample/apexConsumer.js';
