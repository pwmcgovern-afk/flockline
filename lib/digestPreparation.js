import { getWeeklyRoundup } from "./ebirdCore.js";
import { addBirdIllustrations, missingBirdIllustrations } from "./birdIllustrations.js";
import { createDigestStore, withDigestLease } from "./digestDeliveryStore.js";

export async function loadDigestRoundup({ region, date, saved, getRoundup = getWeeklyRoundup }) {
  const roundup = saved || await getRoundup({ region: region.id, fresh: "1" });
  if (roundup.source !== "ebird" || roundup.scopeId !== region.id || String(roundup.generatedAt).slice(0, 10) !== date) {
    throw new Error("A live roundup for the current edition date is required.");
  }
  return roundup;
}

// Prewarm and delivery share a lease and a saved edition. Choosing the birds
// once prevents a later eBird refresh from replacing the species we drew.
export async function prepareDigestIllustrations({ region, date, appUrl, environment = process.env }, {
  store = createDigestStore(), getRoundup = getWeeklyRoundup,
  illustrate = addBirdIllustrations, now = Date.now
} = {}) {
  return withDigestLease({ date, region: region.id, store, now }, async (state, save) => {
    // An existing campaign is immutable, including after an uncertain send.
    if (state.broadcastId) return;
    const roundup = await loadDigestRoundup({ region, date, saved: state.roundup, getRoundup });
    if (!state.roundup) await save({ roundup, status: "preparing" });
    const illustrated = await illustrate(roundup, appUrl, {
      generateMissing: true, generationBudget: 3, generationConcurrency: 3, environment
    });
    const unresolved = missingBirdIllustrations(illustrated);
    await save({
      roundup: illustrated, status: unresolved.length ? "awaiting_illustrations" : "prepared",
      findings: illustrated.findings.length,
      illustrations: illustrated.findings.length - unresolved.length,
      unresolved
    });
  });
}
