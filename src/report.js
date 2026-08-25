// Display layer for engine results. Pure -- no DOM.
//
// This file exists to make ONE contract structural rather than a convention a
// page author has to remember: when a measurement is unreliable, there is no
// measurement to show. `tierOk` and `reliable` are deliberately separate fields
// in analyze() because they answer different questions, and that separation is
// a trap at the boundary -- a contaminated 1000 Hz device can report rateHz 518
// with tier 500 and tierOk TRUE, which would render "500 Hz" confidently about
// a number 48% wrong.
//
// So the report NULLS the measurement fields whenever reliable is false. A page
// cannot render a stale tier by forgetting to check a flag, because the tier is
// not there to render. Pinned in tests/cases.mjs.

export function pollingReport(result) {
  const base = {
    show: false,        // is there a number to display at all?
    rateHz: null,
    tier: null,
    tierOk: null,
    message: "",
    // Diagnostics stay available even when the measurement is refused -- they
    // are what a curious user or a bug report needs, and they are labelled as
    // diagnostics rather than as the answer.
    diagnostics: null,
  };

  if (!result || !result.ok) {
    return {
      ...base,
      message: "Not enough samples yet. Keep moving the mouse over the test area.",
    };
  }

  const diagnostics = {
    samples: result.n,
    segments: result.segments,
    pauseShare: result.pauseShare,
    clockGrainMs: result.clockGrainMs,
    modalHz: result.modalHz,
    avgHz: result.avgHz,
    maxHz: result.maxHz,
  };

  if (!result.reliable) {
    return { ...base, diagnostics, message: result.unreliableReason };
  }

  return {
    show: true,
    rateHz: result.rateHz,
    tier: result.tier,
    tierOk: result.tierOk,
    diagnostics,
    message: result.tierOk
      ? `${Math.round(result.rateHz)} Hz, a standard ${result.tier} Hz polling rate.`
      : `${Math.round(result.rateHz)} Hz, which is not one of the standard polling `
        + `rates. That can mean a non-standard device, or a driver setting worth checking.`,
  };
}
