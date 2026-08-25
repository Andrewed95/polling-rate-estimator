// Test cases for the polling estimator — run by test/run_node.mjs (CI/node)
// and openable in a browser via the demo page's test link. Extracted from
// inputprobe's engine suite by tools/make_estimator_repo.py; the full suite
// (DPI, buttons, keyboard) lives with the site.
import { mean, median, quantile, spreadPct, histogram } from "../src/stats.js";
import { analyze, intervalsFrom, modalInterval, segmentedRate, detectGrain,
  nearestTier, TIERS, MAX_PAUSE_SHARE, MIN_MEANINGFUL_HZ } from "../src/polling.js";
import { pollingReport } from "../src/report.js";
import { timestamps, pauses, GRAIN_DEFAULT, GRAIN_ISOLATED } from "./streams.mjs";

export const assert = {
  ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); },
  equal(a, b, msg) {
    if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  close(a, b, eps, msg) {
    if (!(Math.abs(a - b) <= eps)) throw new Error(msg || `expected ${a} within ${eps} of ${b}`);
  },
};

function stream(rateHz, seconds, t0 = 0) {
  const dt = 1000 / rateHz, out = [];
  for (let t = t0; t < t0 + seconds * 1000; t += dt) out.push(t);
  return out;
}

export const cases = [

  ["stats: median/mean/quantile/spread", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.close(mean([1, 2, 3, 4]), 2.5, 1e-9);
    assert.close(quantile([0, 10], 0.5), 5, 1e-9);
    assert.close(spreadPct([98, 100, 102]), 4, 1e-9);
    assert.equal(histogram([1, 1.1, 2.6], 1).length, 2);
  }],


  // THE claim the site is built on, pinned under the REAL clock: a 1000 Hz
  // mouse delivered in 60 fps batches reads ~60 Hz if you time the delivered
  // events, and ~1000 Hz if you time the coalesced ones.
  ["polling: naive timestamps measure the display, coalesced measure the mouse", () => {
    const real = analyze(timestamps(1000, 1, { grain: GRAIN_DEFAULT }));
    const naive = analyze(timestamps(60, 1, { grain: GRAIN_DEFAULT }));
    assert.ok(naive.ok && real.ok);
    assert.close(naive.rateHz, 60, 3, "naive reads the refresh rate");
    assert.close(real.rateHz, 1000, 20, "coalesced reads the true rate");
    assert.equal(real.tier, 1000);
    assert.ok(real.tierOk);
  }],


  ["polling: every tier is exact on an ideal clock", () => {
    for (const t of TIERS) {
      const r = analyze(timestamps(t, t >= 4000 ? 0.5 : 1));
      assert.equal(r.tier, t, `tier ${t}`);
      assert.ok(r.tierOk, `tierOk at ${t}`);
      assert.close(r.rateHz, t, t * 0.01, `rate at ${t}`);
    }
  }],


  // The regression this whole module was rewritten for (2026-07-30).
  ["polling: every tier survives the browser's 100us timestamp clamp", () => {
    for (const t of TIERS) {
      const r = analyze(timestamps(t, 1, { grain: GRAIN_DEFAULT }));
      assert.close(r.rateHz, t, t * 0.02, `clamped rate at ${t}`);
      assert.equal(r.tier, t, `clamped tier at ${t}`);
      assert.ok(r.tierOk, `clamped tierOk at ${t}`);
    }
  }],


  // Worst realistic capture: clamp + jitter + a tab-switch + drag pauses.
  ["polling: clamp + jitter + stalls together stay within 2%", () => {
    const stalls = [{ at: 0.4, ms: 150 }, { at: 0.9, ms: 250 }, { at: 1.5, ms: 90 }];
    for (const t of TIERS) {
      const r = analyze(timestamps(t, 2, {
        grain: GRAIN_DEFAULT, jitterPct: 0.15, stalls,
      }));
      assert.close(r.rateHz, t, t * 0.02, `messy rate at ${t}`);
      assert.equal(r.tier, t, `messy tier at ${t}`);
      assert.ok(r.segments > 1, `stalls should split the stream at ${t}`);
    }
  }],


  // Documents WHY the estimator is segmented — both rejected alternatives are
  // shown failing on the same stream that the shipped one gets right.
  ["polling: mode dies on quantization, 1/mean dies on pauses, segmented holds", () => {
    const clamped8k = timestamps(8000, 1, { grain: GRAIN_DEFAULT });
    const modeHz = 1000 / modalInterval(intervalsFrom(clamped8k).intervals);
    assert.ok(modeHz > 9000, `mode should misread ~10000 Hz, got ${Math.round(modeHz)}`);
    assert.close(analyze(clamped8k).rateHz, 8000, 160, "segmented survives the clamp");

    const paused = timestamps(1000, 2, {
      grain: GRAIN_DEFAULT,
      stalls: [{ at: 0.2, ms: 120 }, { at: 0.4, ms: 120 },
               { at: 0.6, ms: 120 }, { at: 0.8, ms: 120 }],
    });
    const oneOverMean = (paused.length - 1) * 1000 / (paused[paused.length - 1] - paused[0]);
    assert.ok(oneOverMean < 900, `1/mean should sag to ~800, got ${Math.round(oneOverMean)}`);
    assert.close(analyze(paused).rateHz, 1000, 20, "segmented ignores the pauses");
  }],


  ["polling: events sharing a clock tick still count toward the rate", () => {
    // 2000 device reports in 1s, but the clock only resolves 1ms -> half the
    // intervals are zero. Dropping them would halve the reported rate.
    const ts = timestamps(2000, 1, { grain: 1 });
    assert.ok(intervalsFrom(ts).zeros > 0, "this stream must contain tick collisions");
    assert.close(analyze(ts).rateHz, 2000, 40);
    assert.equal(analyze(ts).tier, 2000);
  }],


  ["polling: clock grain is detected, or honestly reported as unknown", () => {
    const grainOf = (hz, opts) => detectGrain(intervalsFrom(timestamps(hz, 1, opts)).intervals);
    // 8000 Hz on the default clamp: 0.125ms can't sit on a 0.1ms grid, so the
    // stream alternates 0.1/0.2 and the grid is visible.
    assert.equal(grainOf(8000, { grain: GRAIN_DEFAULT }), GRAIN_DEFAULT);
    // Cross-origin isolated, with the jitter any real mouse has.
    assert.equal(grainOf(8000, { grain: GRAIN_ISOLATED, jitterPct: 0.1 }), GRAIN_ISOLATED);
    // A perfectly periodic 1 kHz stream lands every interval on exactly 1.0ms.
    // That is consistent with a 1ms grid, a 0.1ms grid, or no grid: no evidence,
    // so no answer. Reporting a grain here would be a guess the page then quotes.
    assert.equal(grainOf(1000, { grain: GRAIN_DEFAULT }), null);
    assert.equal(detectGrain([1.0001, 2.3337, 0.7771, 1.1113, 3.0009,
                              0.5551, 1.7773, 2.1119, 0.3337]), null);
    assert.equal(detectGrain([1, 2]), null, "too few samples to claim a grain");
  }],


  // --- the sub-cut pause hole (found 2026-07-30, after the clamp fix) ---

  ["polling: hesitations big enough to split are excluded, not averaged in", () => {
    // The three cases that used to misread. All now split cleanly, so the rate
    // is right AND the guard stays quiet -- refusing these would be a false alarm.
    for (const [hz, ms] of [[8000, 1.8], [1000, 7], [125, 55]]) {
      const r = analyze(timestamps(hz, 2, {
        grain: GRAIN_DEFAULT, jitterPct: 0.1, stalls: pauses(20, ms, 2),
      }));
      assert.close(r.rateHz, hz, hz * 0.01, `${hz} Hz with ${ms}ms pauses`);
      assert.ok(r.tierOk, `tierOk at ${hz}`);
      assert.ok(r.reliable, `${hz} Hz split cleanly -- must NOT refuse`);
      assert.close(r.pauseShare, 0, 0.005, `pauseShare at ${hz}`);
    }
  }],


  ["polling: the guard never fires on a clean capture, at any tier or grain", () => {
    for (const grain of [0, GRAIN_DEFAULT, GRAIN_ISOLATED]) {
      for (const hz of TIERS) {
        const r = analyze(timestamps(hz, 1, { grain, jitterPct: 0.15 }));
        assert.ok(r.reliable, `false refusal at ${hz} Hz, grain ${grain}`);
        assert.close(r.pauseShare, 0, 0.005, `${hz} Hz, grain ${grain}`);
      }
    }
  }],


  // The guard's whole justification: pauseShare is not just a flag, it is an
  // estimate of HOW FAR LOW the reading is. If these stop tracking, the
  // threshold stops meaning anything.
  ["polling: sub-cut hesitation is refused, and pauseShare tracks the real bias", () => {
    // n is larger at 1000 Hz because its residual band is narrow (median 1ms,
    // so anything over 2ms splits) -- it takes many small hesitations to matter.
    for (const [hz, ms, n] of [[125, 5, 20], [125, 10, 20], [125, 15, 20],
                               [1000, 1.5, 100]]) {
      const r = analyze(timestamps(hz, 2, {
        grain: GRAIN_DEFAULT, jitterPct: 0.1, stalls: pauses(n, ms, 2),
      }));
      const bias = Math.abs(r.rateHz / hz - 1);
      assert.ok(r.pauseShare > MAX_PAUSE_SHARE,
        `${hz} Hz / ${ms}ms should refuse, share was ${(r.pauseShare * 100).toFixed(1)}%`);
      assert.ok(!r.reliable, `${hz} Hz / ${ms}ms must be marked unreliable`);
      assert.close(r.pauseShare, bias, 0.015,
        `share ${(r.pauseShare * 100).toFixed(1)}% should track bias ${(bias * 100).toFixed(1)}%`);
      assert.ok(r.unreliableReason.includes("%"), "reason must quote the number");
    }
  }],


  ["polling: a hesitation-riddled drag refuses instead of reporting 84 Hz", () => {
    const r = analyze(timestamps(125, 2, {
      grain: GRAIN_DEFAULT, jitterPct: 0.1, stalls: pauses(100, 10, 2),
    }));
    assert.ok(!r.reliable);
    assert.ok(r.pauseShare > 0.25, `expected heavy contamination, got ${r.pauseShare}`);
    assert.ok(r.unreliableReason.includes("continuously"),
      "the copy must tell the user what to do, not just that it failed");
  }],


  // Pins the mechanism, so a future retune can't silently move the boundary:
  // an X ms pause yields an interval of X + one normal interval.
  ["polling: the split boundary is 2x the median interval", () => {
    const med = 8;                       // 125 Hz
    const justUnder = analyze(timestamps(125, 2, {
      grain: GRAIN_DEFAULT, stalls: pauses(20, med * 2 - 2, 2),
    }));
    const justOver = analyze(timestamps(125, 2, {
      grain: GRAIN_DEFAULT, stalls: pauses(20, med * 2 + 4, 2),
    }));
    assert.equal(justUnder.segments, 1, "below 2x median: averaged into one run");
    assert.ok(justOver.segments > 1, "above 2x median: split out");
    assert.ok(!justUnder.reliable, "the averaged-in case must be caught by the guard");
    assert.ok(justOver.reliable, "the split case is a good measurement");
  }],


  // Contamination just under the threshold is tolerated on purpose: the
  // underread there is ~3%, immaterial against the 15% tier tolerance, and
  // refusing it would make the tool feel broken on ordinary hands.
  ["polling: contamination just below the threshold is tolerated, not refused", () => {
    const r = analyze(timestamps(500, 2, {
      grain: GRAIN_DEFAULT, jitterPct: 0.1, stalls: pauses(20, 3, 2),
    }));
    assert.ok(r.pauseShare < MAX_PAUSE_SHARE && r.pauseShare > 0.02,
      `expected a near-threshold share, got ${(r.pauseShare * 100).toFixed(1)}%`);
    assert.ok(r.reliable, "a ~3% underread should not be refused");
    assert.close(r.rateHz, 500, 500 * 0.04);
  }],


  // Precise, hand-built: three runs of two intervals each, all below
  // minRunEvents (4), so nothing survives and there is no number to report.
  ["polling: runs too short to estimate from are discarded, not averaged", () => {
    const chopped = [0, 1, 2, 100, 101, 102, 200, 201, 202, 300, 301, 302];
    const seg = segmentedRate(chopped);
    assert.equal(seg.segments, 0, "2-interval runs are below minRunEvents");
    assert.ok(Number.isNaN(seg.hz), "no surviving run means no rate");
    const r = analyze(chopped);
    assert.ok(!r.reliable);
    assert.ok(r.unreliableReason.includes("continuous"),
      "no usable run should say so plainly");
  }],


  // --- the report-layer contract (found at the boundary, 2026-07-30) ---

  // tierOk and reliable are separate on purpose, and at the boundary that is a
  // trap: contamination can land a wrong number NEAR a real tier.
  ["polling: a contaminated rate can sit on a tier — tierOk must not be trusted alone", () => {
    // 51% of intervals at 1.0ms, 49% at 2.9ms: median stays 1.0 so cut is 3.0
    // and nothing splits, but the mean nearly doubles. A 1000 Hz device reads
    // ~518 Hz, which is within 15% of the real 500 Hz tier.
    const ts = [];
    let t = 0;
    for (let i = 0; i < 2000; i++) {
      ts.push(Math.round(t * 10) / 10);
      t += (i % 100 < 51) ? 1.0 : 2.9;
    }
    const r = analyze(ts);
    assert.ok(r.tierOk, "precondition: the wrong number sits on a tier");
    assert.ok(!r.reliable, "precondition: the guard catches the contamination");
    assert.ok(Math.abs(r.rateHz / 1000 - 1) > 0.4, "precondition: it is ~48% wrong");

    // The contract: the report must not expose the tier at all.
    const rep = pollingReport(r);
    assert.equal(rep.show, false);
    assert.equal(rep.tier, null, "an unreliable result must not carry a tier");
    assert.equal(rep.tierOk, null, "an unreliable result must not carry tierOk");
    assert.equal(rep.rateHz, null, "an unreliable result must not carry a rate");
    assert.equal(rep.message, r.unreliableReason);
  }],


  ["polling: the report nulls the measurement for EVERY unreliable case", () => {
    const unreliable = [
      analyze([0, 1, 2]),                                              // too few samples
      analyze([0, 1, 2, 100, 101, 102, 200, 201, 202, 300, 301, 302]), // no usable run
      analyze(Array.from({ length: 60 }, (_, i) => i * 55)),           // too slow
      analyze(timestamps(125, 2, {                                     // contaminated
        grain: GRAIN_DEFAULT, jitterPct: 0.1, stalls: pauses(20, 10, 2),
      })),
    ];
    for (const r of unreliable) {
      const rep = pollingReport(r);
      assert.equal(rep.show, false, "nothing to show");
      assert.equal(rep.tier, null);
      assert.equal(rep.tierOk, null);
      assert.equal(rep.rateHz, null);
      assert.ok(rep.message.length > 0, "a refusal must always explain itself");
    }
    // ...and a good measurement still reports normally.
    const good = pollingReport(analyze(timestamps(1000, 1, { grain: GRAIN_DEFAULT })));
    assert.equal(good.show, true);
    assert.equal(good.tier, 1000);
    assert.ok(good.rateHz > 0);
  }],


  // The third failure mode: neither pauseShare nor tierOk can say "the mouse
  // barely moved". Reachable by an ordinary user who hardly moves the mouse.
  ["polling: a capture too slow to hold device-rate information is refused", () => {
    const barelyMoved = Array.from({ length: 60 }, (_, i) => i * 55);  // ~18 Hz
    const r = analyze(barelyMoved);
    assert.ok(r.rateHz < MIN_MEANINGFUL_HZ);
    assert.close(r.pauseShare, 0, 1e-9, "nothing looks like a pause at this scale");
    assert.ok(!r.reliable, "the too-slow guard must catch what pauseShare cannot");
    assert.ok(/barely moved|not reporting/.test(r.unreliableReason),
      "the copy must name the actual cause, not just report a low number");
    // A real 125 Hz mouse is still comfortably above the floor.
    assert.ok(analyze(timestamps(125, 1, { grain: GRAIN_DEFAULT })).reliable,
      "the slowest real tier must not trip the floor");
  }],


  ["polling: tiers snap in log space, not linear", () => {
    assert.equal(nearestTier(1450), 2000, "linear snapping would say 1000");
    assert.equal(nearestTier(5657), 8000, "linear snapping would say 4000");
    assert.equal(nearestTier(940), 1000);
    assert.equal(nearestTier(130), 125);
  }],


  ["polling: degenerate inputs refuse rather than guess", () => {
    const { intervals, zeros } = intervalsFrom([0, 1, 1, 2]);
    assert.equal(intervals.length, 2);
    assert.equal(zeros, 1);
    assert.equal(analyze([0, 1, 2]).ok, false, "refuses tiny samples");
    assert.ok(Number.isNaN(segmentedRate([5]).hz), "one timestamp is not a rate");
  }],
];

export function runAll() {
  const results = [];
  for (const [name, fn] of cases) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: e.message }); }
  }
  return results;
}
