import { dailyDigestPath } from "../shared/dailyDigest.js";
import { reviewStatusLabel } from "../shared/findingCopy.js";
import { createDigestProvider } from "./digestProvider.js";
import { renderDigestHtml } from "./digestEmail.js";
import { addBirdIllustrations, missingBirdIllustrations } from "./birdIllustrations.js";
import { createDigestStore, withDigestLease } from "./digestDeliveryStore.js";
import { getDailyDigest } from "./dailyDigestArchive.js";
import { DIGEST_REGIONS } from "../shared/digestRegions.js";
import { getDigestConfiguration } from "./digestSubscriptions.js";

const preferences = "{{{RESEND_UNSUBSCRIBE_URL}}}";

export function dailyBroadcast(digest, region, configuration) {
  const url = configuration.publicAppUrl + dailyDigestPath(region.id, digest.date);
  const subject = region.name + " daily bird digest · " + digest.date;
  const entries = digest.findings.map((bird) => [bird.title, bird.detail, reviewStatusLabel(bird)]);
  const intro = entries.length ? "Selected reports from eBird's notable feed." : "No reports were included in today's selection.";
  return {
    name: "Flockline " + subject, subject, previewText: entries.map(([title]) => title).join(", ") || intro,
    segmentId: configuration.segmentId, topicId: region.topicId, from: configuration.from, replyTo: configuration.replyTo || undefined,
    html: renderDigestHtml({ ...digest, scopeLabel: digest.scopeLabel || region.name }, configuration.publicAppUrl, { archiveUrl: url, edition: "daily", unsubscribeUrl: preferences }),
    text: [subject, intro, url, ...entries.map((entry) => entry.join("\n")), "Manage editions or unsubscribe: " + preferences].join("\n\n"),
  };
}

// The saved daily page is frozen at publication and only carries art that was
// already cached. Delivery re-reads the plate cache (filled by the shared
// daily-illustrations job) so the email gets every plate drawn since. Like the
// weekly path, delivery never waits on an image model itself.
export async function deliverDailyDigest(digest, {
  configuration = getDigestConfiguration(process.env, "daily"),
  provider = createDigestProvider(configuration.apiKey),
  store = createDigestStore(),
  illustrate = addBirdIllustrations,
  allowPartialArtwork = false,
  generationReady = true,
} = {}) {
  const region = configuration.regions.find((item) => item.id === digest.scopeId);
  if (!configuration.ready || configuration.frequency !== "daily" || !region?.topicId || digest.back !== 1) {
    throw new Error("Missing daily edition or delivery configuration.");
  }
  return withDigestLease({ date: digest.date, region: region.id, store, kind: "daily-delivery" }, async (state, save) => {
    if (!state.broadcastId && !await provider.hasRecipients(configuration, region)) {
      await save({ status: "no_recipients", phase: "complete", unresolved: [], partialArtwork: false });
      return;
    }
    let edition = digest;
    if (!state.broadcastId) {
      await save({ phase: "illustrations" });
      // Same HTTPS base the saved edition was illustrated with. A cache lookup
      // failure must not cost the morning email, so fall back to the saved art.
      edition = await illustrate(digest, "https://flockline.app", { generateMissing: false }).catch((error) => {
        console.error(JSON.stringify({ event: "daily_illustration_lookup_failed", scopeId: digest.scopeId, message: error?.message }));
        return digest;
      });
      const unresolved = missingBirdIllustrations(edition);
      // Waiting only helps birds the illustration job is able to draw.
      const drawable = generationReady && edition.findings.some((bird) =>
        bird.comName && bird.speciesCode && missingBirdIllustrations({ findings: [bird] }).length);
      const partialArtwork = unresolved.length > 0;
      await save({ findings: edition.findings.length, illustrations: edition.findings.length - unresolved.length, unresolved, partialArtwork });
      if (drawable && !allowPartialArtwork) {
        await save({ status: "awaiting_illustrations", phase: "awaiting_illustrations" });
        return;
      }
    }
    const broadcast = dailyBroadcast(edition, region, configuration);
    // Recover the same provider draft even if the first request lost its response.
    let existing = state.broadcastId ? await provider.getBroadcast(state.broadcastId) : await provider.findBroadcast(broadcast.name);
    if (!existing) {
      if (state.broadcastId) throw new Error("The recorded daily broadcast is missing.");
      existing = await provider.createDraft(broadcast);
      if (!existing?.id) throw new Error("Daily draft creation failed.");
      await save({ broadcastId: existing.id, status: "draft" });
      existing = await provider.getBroadcast(existing.id);
    }
    if (existing.status === "draft") {
      await save({ broadcastId: existing.id, phase: "send_broadcast" });
      await provider.sendBroadcast(existing.id);
      existing = await provider.getBroadcast(existing.id);
    }
    if (!["sent", "queued", "scheduled", "sending"].includes(existing.status)) throw new Error("Unexpected daily broadcast status.");
    await save({ broadcastId: existing.id, providerStatus: existing.status, status: existing.status === "sent" ? "sent" : "submitted" });
  });
}

// One pass for all five regions, so a species in both Nationwide and its
// region is drawn once. Runs a few minutes after publication; delivery picks
// the new plates up from the cache on its next attempt.
export async function illustrateDailyEditions(date, {
  read = getDailyDigest, illustrate = addBirdIllustrations, environment = process.env,
  regions = DIGEST_REGIONS, budget = 6, reverse = false,
} = {}) {
  const reads = await Promise.all(regions.map((region) => read(region.id, date, 1).then(
    (edition) => ({ id: region.id, edition }),
    (error) => ({ id: region.id, error: error?.message || "read failed" }),
  )));
  const editions = reads.filter((item) => item.edition).map((item) => item.edition);
  const missingRegions = reads.filter((item) => !item.edition).map((item) => item.id);
  const bySpecies = new Map();
  for (const bird of editions.flatMap((edition) => edition.findings)) {
    const code = String(bird.speciesCode || "").toLowerCase();
    // Keep a copy that has the common name, which generation needs.
    if (code && (!bySpecies.has(code) || (!bySpecies.get(code).comName && bird.comName))) bySpecies.set(code, bird);
  }
  // The later run walks the list from the other end, so species that keep
  // failing at the front cannot use up every run's budget.
  const findings = [...bySpecies.values()];
  if (reverse) findings.reverse();
  if (!findings.length) return { editions: editions.length, missingRegions, species: 0, unresolved: [] };
  // Budget equals concurrency: one wave, so a slow model cannot push a second
  // wave past the function's time limit.
  const result = await illustrate({ findings }, "https://flockline.app", {
    generateMissing: true, generationBudget: budget, generationConcurrency: budget, environment,
  });
  return { editions: editions.length, missingRegions, species: findings.length, unresolved: missingBirdIllustrations(result) };
}
