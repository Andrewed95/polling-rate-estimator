# polling-rate-estimator

Estimate a mouse or keyboard's real polling rate from event timestamps —
and refuse to print a number when the capture can't support one.

This is the measurement engine behind
[inputprobe.com/polling-rate-test](https://inputprobe.com/polling-rate-test/),
published so the method can be checked rather than believed.

## Why most browser testers are wrong

A browser draws the page at your display's refresh rate and delivers mouse
input in batches aligned with those frames. Testers that count one movement
per delivered event are measuring the monitor: a 1000 Hz mouse reads as 60 Hz
on a 60 Hz display. The fix is `PointerEvent.getCoalescedEvents()`, which
exposes the individual device reports inside each batch with their own
timestamps. This package analyzes those timestamps. (That failure mode is
pinned as a test case — `polling: naive timestamps measure the display,
coalesced measure the mouse`.)

The second, less obvious problem is the clock: browsers clamp
`event.timeStamp` to 100 µs unless the page is cross-origin isolated. At
8000 Hz the true interval is 125 µs, so on a 100 µs grid the *modal* interval
quantizes to 100 µs and a mode-based estimator reports 10,000 Hz — a 25%
error on exactly the tier an enthusiast owns. The reported rate here is
therefore derived from event counts over elapsed time within continuous
runs, which quantization cannot bias.

## What it refuses to do

The estimator returns a refusal, with the reason, instead of a number when:

- the capture has **no stretch of continuous movement** long enough to
  measure;
- more than **3% of the drag was hesitation** rather than movement (pauses
  bias the rate low — the bias tracks the hesitation share almost 1:1, so it
  is measured and refused rather than silently absorbed);
- the observed rate is **below any real device tier** — that stream is a
  barely-moved mouse or a browser handing back frame-batched events, and
  calling it a measurement would be a lie.

`pollingReport()` nulls every measurement field on refusal, so a UI cannot
render a stale number by forgetting to check a flag.

## Validation status — read this before trusting it

| Tier | Status |
|---|---|
| 125 Hz | **Validated against real hardware** (wired Logitech M170; Chrome and Safari; bench log in [docs/VALIDATION.md](docs/VALIDATION.md)) |
| 250–8000 Hz | **Simulated distortions only** — the suite models the browser's 100 µs timestamp clamp, per-interval jitter, and mid-drag stalls, and holds to <1% error under all three at every tier. No high-rate physical device has been on the bench yet. |

If you own an 8 kHz device and a USB analyzer, an issue with a capture would
genuinely improve this table.

## Wrong turns, kept on purpose

Two earlier estimators are still in the code as diagnostics because their
failure modes are the documentation:

- **Modal interval** dies on clock quantization (the 8 kHz → "10,000 Hz"
  error above).
- **1/mean** dies on pauses: four ordinary 120 ms hesitations in a drag read
  1000 Hz as 806.
- The first gap-splitting cut-off was tuned (`gapFactor 8 / floor 2 ms`) and
  had a silent hole: hesitations just below the cut were averaged in. Tuning
  moves that boundary; it cannot remove it. The fix is `pauseShare`: the
  residual contamination is measured, and past 3% the run is refused. Same
  doctrine as the rest of inputprobe — a confident wrong number wastes your
  time in a way an honest refusal does not.

## Use

Browser (the only part that touches the DOM is `src/capture.js`):

```js
import { onRawMoves } from "./src/capture.js";
import { analyze, pollingReport } from "./src/index.js";

const stamps = [];
onRawMoves(area, (batch) => {
  for (const s of batch) stamps.push(s.t);
  const rep = pollingReport(analyze(stamps));
  out.textContent = rep.message;      // rate, or the reason there isn't one
});
```

Node (pure analysis — feed it timestamps from anywhere, including a USB
capture):

```js
import { analyze } from "polling-rate-estimator";
console.log(analyze(timestampsMs));
```

Demo: serve the repo root (`python3 -m http.server`) and open
`demo/index.html`. Tests: `npm test` (no dependencies).

## License

MIT. If you use this to build a tester, publishing your validation data the
same way would be a good tradition to start.
