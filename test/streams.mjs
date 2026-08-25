// Synthetic input streams for engine tests.
//
// These model the ENVIRONMENT, not just the math: the browser's timestamp
// clamp, frame batching, drag pauses, tab-switch stalls. Ideal streams alone
// confirmed the polling claim while the real 100us clamp falsified it at
// 4000/8000 Hz -- see docs/validation-protocol.md.

// Deterministic PRNG: pins must not depend on Math.random.
export function rng(seed = 42) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export const GRAIN_DEFAULT = 0.1;    // browsers clamp event.timeStamp to 100us
export const GRAIN_ISOLATED = 0.005; // cross-origin isolated -> 5us

/**
 * timestamps(hz, seconds, opts)
 *   grain     quantize onto this ms grid (0 / null = ideal clock)
 *   jitterPct per-interval jitter, +/- fraction
 *   stalls    [{at: seconds, ms}] gaps injected mid-stream (pauses, tab switch)
 *   seed      PRNG seed
 */
export function timestamps(hz, seconds, {
  grain = 0, jitterPct = 0, stalls = [], seed = 42,
} = {}) {
  const rand = rng(seed);
  const dt = 1000 / hz;
  const out = [];
  let t = 0, shift = 0;
  const pending = [...stalls].sort((a, b) => a.at - b.at);
  while (t < seconds * 1000) {
    while (pending.length && t >= pending[0].at * 1000) {
      shift += pending.shift().ms;
    }
    const stamped = t + shift;
    out.push(grain ? Math.round(stamped / grain) * grain : stamped);
    t += dt * (1 + (rand() - 0.5) * 2 * jitterPct);
  }
  return out;
}

// The naive path: a 1000 Hz mouse delivered in 60 fps batches, timed by the
// delivered events instead of the coalesced ones.
export const frameBatched = (seconds, opts) => timestamps(60, seconds, opts);

// n hesitations of `ms` spread evenly through a `span`-second drag. Ordinary
// hand behaviour, not adversarial input -- micro-hesitations of 30-60ms during
// a drag are normal, which is what makes the sub-cut pause hole reachable.
export const pauses = (n, ms, span) =>
  Array.from({ length: n }, (_, i) => ({ at: (span * (i + 1)) / (n + 1), ms }));
