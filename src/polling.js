// Polling-rate analysis from event timestamps.
//
// Claim 1 (the site's pitch): mousemove/pointermove events are BATCHED to the
// animation frame, so per-event timestamps measure the display refresh rate,
// not the mouse. Feed this module the timeStamps of getCoalescedEvents() to
// get the real rate -- feeding it delivered-event timestamps reproduces the
// naive-tester error (pinned as a test case, because that error is our claim).
//
// Claim 2 (learned the hard way, 2026-07-30): the CLOCK has to be modelled too.
// Browsers clamp event.timeStamp to 100us unless the document is cross-origin
// isolated. At 8000 Hz the true interval is 0.125ms; on a 0.1ms grid it
// quantizes to 0.1/0.2 and the MODE lands on 0.1 -> "10,000 Hz", a 25% error
// on exactly the tier an enthusiast owns. So the reported rate is derived from
// EVENT COUNTS OVER ELAPSED TIME, which quantization cannot bias -- the grid
// error averages out over a run.
//
// But a plain (n-1)/(last-first) is 1/mean, which any pause or tab-switch
// destroys: measured against a 0.1ms grid with four normal 120ms drag pauses,
// 1000 Hz reads 806 and 8000 Hz reads 6451. Hence segmentedRate(): split at
// real gaps FIRST, then count within runs. That holds to <1% at every tier
// under clamp + jitter + stalls together.
import { mean, median, histogram } from "./stats.js";

export const TIERS = [125, 250, 500, 1000, 2000, 4000, 8000];

// Timestamp quanta a browser might expose, coarsest first.
const GRAINS = [1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005];

export function intervalsFrom(timestamps) {
  const out = [];
  let zeros = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const d = timestamps[i] - timestamps[i - 1];
    if (d > 0) out.push(d);
    else zeros++;               // clock-granularity collisions at high rates
  }
  return { intervals: out, zeros };
}

// Modal interval via rounding to a fixed resolution. Robust against outliers
// (frame stalls, tab switches) but NOT against clock quantization -- kept as a
// diagnostic, no longer the reported number. See the header comment.
export function modalInterval(intervals, resolutionMs = 0.025) {
  if (!intervals.length) return NaN;
  const counts = new Map();
  for (const d of intervals) {
    const k = Math.round(d / resolutionMs);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let bestK = NaN, bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; bestK = k; }
  return bestK * resolutionMs;
}

// Coarsest grain the data actually demonstrates: every interval sits on a
// multiple of it AND at least two different multiples appear. That second
// condition is what keeps this honest -- a perfectly periodic 1000 Hz stream
// has every interval at exactly 1.0ms, which is consistent with a 1ms grid, a
// 0.1ms grid or no grid at all. There is no evidence, so it returns null
// rather than inventing a number the page would then quote at the user.
export function detectGrain(intervals) {
  if (intervals.length < 8) return null;
  for (const g of GRAINS) {
    const multiples = new Set();
    let onGrid = 0;
    for (const d of intervals) {
      const k = Math.round(d / g);
      if (Math.abs(d / g - k) < 1e-3) { onGrid++; multiples.add(k); }
    }
    if (onGrid / intervals.length >= 0.98 && multiples.size >= 2) return g;
  }
  return null;
}

// THE estimator. Split the stream wherever a gap dwarfs the local scale (a
// pause, a tab switch, a lifted mouse), then sum events and durations across
// the surviving runs. Counts come from the timestamp array, NOT from
// intervalsFrom() -- that helper drops zero-length intervals, but coalesced
// events sharing one clock tick are real device reports and must count.
//
// Splitting alone is not enough, and the reason is worth stating because it is
// not obvious: an X ms pause produces an interval of X PLUS one normal
// interval, so the real split boundary is `pause > 2 x median`, not `> cut`.
// Anything shorter is averaged in and biases the rate LOW. Tuning moves that
// boundary (the old gapFactor 8 / floorMs 2 put it at 16ms at 125 Hz -- inside
// ordinary hand hesitation -- and at 8000 Hz the floor dominated, so the error
// stayed silently inside tolerance). Tuning cannot remove it. Hence pauseShare
// below: the residual is measured and, past a threshold, REFUSED -- the same
// doctrine as dpi.js declining when three passes disagree.
export function segmentedRate(timestamps, {
  gapFactor = 3, floorMs = 0.5, minRunEvents = 4,
} = {}) {
  const empty = { hz: NaN, segments: 0, events: 0, ms: 0, pauseShare: NaN };
  if (timestamps.length < 2) return empty;

  const deltas = [];
  for (let i = 1; i < timestamps.length; i++) {
    deltas.push(timestamps[i] - timestamps[i - 1]);
  }
  const med = median(deltas);
  const cut = Math.max(med * gapFactor, floorMs);

  // Grain-aware "this interval cost more than a normal one" threshold. Without
  // the grain term, quantization reads as pausing: at 8000 Hz on a 0.1ms clock
  // the stream alternates 0.1/0.2 and every 0.2 would look like a stall.
  const grain = detectGrain(deltas) || 0;
  const excessThr = Math.max(1.5 * med, med + 2 * grain);

  const runs = [];
  let cur = [];
  for (const d of deltas) {
    if (d > cut) { if (cur.length) runs.push(cur); cur = []; }
    else cur.push(d);
  }
  if (cur.length) runs.push(cur);

  let events = 0, ms = 0, excess = 0, segments = 0;
  for (const run of runs) {
    if (run.length < minRunEvents) continue;   // too short to estimate from
    segments++;
    for (const d of run) {
      events++;
      ms += d;
      if (d > excessThr) excess += d - med;    // time the pause added
    }
  }
  if (ms <= 0) return { ...empty, segments };
  return {
    hz: (events * 1000) / ms,
    segments,
    events,
    ms,
    // Share of surviving-run time that was hesitation rather than movement.
    // Measured to track the rate's downward bias almost 1:1 (a 4.5% share
    // corresponds to a 4.3% underread), so it is both the flag and the size.
    pauseShare: excess / ms,
  };
}

// Above this share the underread is material against the 15% tier tolerance.
export const MAX_PAUSE_SHARE = 0.03;

// Below this the capture simply does not contain device-rate information: the
// slowest mouse ever made is 125 Hz, so a stream this sparse is a barely-moved
// mouse or a browser handing us frame-batched events. It is a THIRD failure
// mode -- pauseShare cannot see it (relative to a 55ms median nothing looks
// like a pause) and tierOk only says "not near a tier", which is not the same
// sentence as "the mouse barely moved".
export const MIN_MEANINGFUL_HZ = Math.min(...TIERS) * 0.6;

// Tiers are log-spaced, so snap in log space: linear distance sends 1450 Hz to
// 1000 rather than 2000, and 5657 Hz to 4000 rather than 8000.
export function nearestTier(hz) {
  if (!(hz > 0)) return NaN;
  let best = TIERS[0];
  for (const t of TIERS) {
    if (Math.abs(Math.log(t / hz)) < Math.abs(Math.log(best / hz))) best = t;
  }
  return best;
}

export function analyze(timestamps) {
  const { intervals, zeros } = intervalsFrom(timestamps);
  if (intervals.length < 8) {
    return { n: intervals.length, zeros, ok: false, reason: "too few samples" };
  }
  const seg = segmentedRate(timestamps);
  const rateHz = seg.hz;
  const tier = nearestTier(rateHz);
  const modal = modalInterval(intervals);

  // Two DIFFERENT questions, kept separate because they need different copy:
  // `reliable` = was the capture clean enough to trust at all;
  // `tierOk`   = does the trusted number sit near a known hardware tier.
  let reliable = true;
  let unreliableReason = "";
  if (!(seg.segments > 0) || !Number.isFinite(rateHz)) {
    reliable = false;
    unreliableReason = "That capture had no stretch of continuous movement long "
      + "enough to measure. Move the mouse steadily across the test area and try again.";
  } else if (rateHz < MIN_MEANINGFUL_HZ) {
    reliable = false;
    unreliableReason = `That capture saw only about ${Math.round(rateHz)} events per `
      + `second, far below the slowest mouse ever made (${Math.min(...TIERS)} Hz). `
      + "Either the mouse barely moved, or this browser is not reporting individual "
      + "device events. Move the mouse continuously and briskly across the test area.";
  } else if (seg.pauseShare > MAX_PAUSE_SHARE) {
    reliable = false;
    unreliableReason = `About ${Math.round(seg.pauseShare * 100)}% of that drag was `
      + "hesitation rather than movement, which makes the rate read low. Move "
      + "continuously across the whole test and try again.";
  }

  return {
    ok: true,
    n: intervals.length,
    zeros,
    rateHz,                                 // reported: quantization- and stall-robust
    tier,
    tierOk: Math.abs(rateHz - tier) / tier <= 0.15,
    reliable,
    unreliableReason,
    pauseShare: seg.pauseShare,
    segments: seg.segments,
    clockGrainMs: detectGrain(intervals),   // null when undeterminable
    // diagnostics -- displayed, never the headline
    modalHz: 1000 / modal,
    avgHz: 1000 / mean(intervals),
    minHz: 1000 / Math.max(...intervals),   // worst gap seen
    maxHz: 1000 / Math.min(...intervals),   // fastest burst seen
    histogram: histogram(intervals, 0.25),
  };
}
