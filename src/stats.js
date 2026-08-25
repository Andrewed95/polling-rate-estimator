// Pure statistics helpers. No DOM, no state — everything here runs in node
// tests and in the browser unchanged.

export function mean(xs) {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs) {
  if (!xs.length) return NaN;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function quantile(xs, q) {
  if (!xs.length) return NaN;
  const a = [...xs].sort((p, q_) => p - q_);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (pos - lo);
}

// (max - min) / median, as a percentage. The tightness of repeated passes is
// itself evidence a measurement is valid — wide spread means a confound
// (usually OS acceleration) and the caller must refuse to report a number.
export function spreadPct(xs) {
  if (xs.length < 2) return 0;
  const m = median(xs);
  if (!m) return NaN;
  return ((Math.max(...xs) - Math.min(...xs)) / m) * 100;
}

export function histogram(xs, binWidth) {
  if (!xs.length || binWidth <= 0) return [];
  const lo = Math.floor(Math.min(...xs) / binWidth) * binWidth;
  const bins = new Map();
  for (const x of xs) {
    const i = Math.floor((x - lo) / binWidth);
    bins.set(i, (bins.get(i) || 0) + 1);
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, n]) => ({ lo: lo + i * binWidth, hi: lo + (i + 1) * binWidth, n }));
}
