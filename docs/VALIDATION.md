# Validation

The estimator's accuracy claims, and exactly what stands behind each.

## Hardware bench

| date | device | interface | browser | result |
|---|---|---|---|---|
| 2026-08 | Logitech M170 (wired, 125 Hz) | USB full-speed | Chrome, Safari | reported rate within tier tolerance across repeated captures; refusals fired on deliberate hesitation runs as designed |

That is the entire hardware row. One device, one tier. It is listed rather
than padded because the simulated rows below are not a substitute for it.

## Simulated distortions (every tier: 125–8000 Hz)

The test suite (`npm test`) generates synthetic streams that model the
environment, not just the math:

- **Timestamp clamp**: 100 µs grid (browser default) and 5 µs
  (cross-origin isolated), including the 8 kHz case where the clamp equals
  80% of the true interval;
- **Jitter**: per-interval noise;
- **Stalls**: mid-drag pauses and tab-switch-scale gaps, both above and
  just below the split threshold.

Under clamp + jitter + stalls together the segmented estimator holds to
<1% at every tier; the mode- and mean-based estimators fail exactly where
the header comments say they do, and those failures are pinned as passing
tests (they are the reason this estimator exists).

## Known limits

- 250–8000 Hz behaviour is demonstrated against simulation only. No
  physical high-rate device has been benched yet; treat those tiers as
  method-validated, not hardware-validated.
- Firefox coarsens event timestamps to ~2 ms by default, which caps what
  any in-browser method can resolve there; the capture layer reports the
  detected clock grain (or null for "cannot tell") rather than guessing.
- Wireless dongles can aggregate or re-time reports; a wired capture is
  the cleaner experiment.
