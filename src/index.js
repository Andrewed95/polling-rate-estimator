// Public surface. The analysis is pure (node-safe); capture touches the DOM
// and is only importable in a browser.
export { analyze, segmentedRate, intervalsFrom, modalInterval, detectGrain,
  nearestTier, TIERS, MAX_PAUSE_SHARE, MIN_MEANINGFUL_HZ } from "./polling.js";
export { pollingReport } from "./report.js";
export { mean, median, quantile, spreadPct, histogram } from "./stats.js";
