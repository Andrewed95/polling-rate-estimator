// Browser capture layer — the ONLY engine file that touches the DOM.
// Everything it emits feeds the pure modules (polling.js, dpi.js, ...).
//
// Correctness notes that ARE the product:
// - getCoalescedEvents() exists on PointerEvent, so we listen to POINTERMOVE.
//   mousemove is a MouseEvent and silently hides the coalesced batch — the
//   root cause of naive testers reporting the display refresh rate.

export function supportsCoalesced() {
  return typeof PointerEvent !== "undefined" &&
         "getCoalescedEvents" in PointerEvent.prototype;
}

// Subscribe to raw move samples. cb(samples, frameEvent) where samples is
// [{dx, dy, t}] — one entry per underlying device report when coalescing is
// available, else one per delivered event (degraded=true tells the page to
// say so honestly rather than pretend).
export function onRawMoves(target, cb) {
  const degraded = !supportsCoalesced();
  const h = (e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    const evs = degraded ? [e] : e.getCoalescedEvents();
    const batch = (evs.length ? evs : [e]).map((c) => ({
      dx: c.movementX || 0, dy: c.movementY || 0, t: c.timeStamp,
    }));
    // Some browsers populate timestamps on coalesced events but not
    // movementX/movementY. The timestamps are what the polling analyzer needs
    // and stay valid, but anything counting movement would silently read zero
    // for the entire drag -- so fall back to the dispatched event's totals,
    // attributed to the last sample to keep both the sum and the timing right.
    if (!batch.some((s) => s.dx || s.dy) && (e.movementX || e.movementY)) {
      batch[batch.length - 1].dx = e.movementX;
      batch[batch.length - 1].dy = e.movementY;
    }
    cb(batch, e);
  };
  target.addEventListener("pointermove", h, { passive: true });
  return () => target.removeEventListener("pointermove", h);
}
