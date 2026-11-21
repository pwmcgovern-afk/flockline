import { dailyDigestPath } from "../shared/dailyDigest.js";
import { reviewStatusLabel } from "../shared/findingCopy.js";
import { createDigestProvider } from "./digestProvider.js";
import { renderDigestHtml } from "./digestEmail.js";
import { addBirdIllustrations, missingBirdIllustrations } from "./birdIllustrations.js";
import { createDigestStore, withDigestLease } from "./digestDeliveryStore.js";
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
// already cached, so most species arrived text-only. Draw the missing plates
// before sending; artwork is presentation, so the observations stay identical.
export async function deliverDailyDigest(digest, {
  configuration = getDigestConfiguration(process.env, "daily"),
  provider = createDigestProvider(configuration.apiKey),
  store = createDigestStore(),
  illustrate = addBirdIllustrations,
  environment = process.env,
  generateMissing = true,
  allowPartialArtwork = false,
} = {}) {
  const region = configuration.regions.find((item) => item.id === digest.scopeId);
  if (!configuration.ready || configuration.frequency !== "daily" || !region?.topicId || digest.back !== 1) {
    throw new Error("Missing daily edition or delivery configuration.");
  }
  return withDigestLease({ date: digest.date, region: region.id, store, kind: "daily-delivery" }, async (state, save) => {
    if (!state.broadcastId && !await provider.hasRecipients(configuration, region)) {
      await save({ status: "no_recipients", phase: "complete" });
      return;
    }
    let edition = digest;
    if (!state.broadcastId) {
      await save({ phase: "illustrations" });
      edition = await illustrate(digest, configuration.publicAppUrl || "https://flockline.app", {
        generateMissing, generationBudget: 6, generationConcurrency: 4, environment,
      });
      const unresolved = missingBirdIllustrations(edition);
      await save({ findings: edition.findings.length, illustrations: edition.findings.length - unresolved.length, unresolved });
      if (unresolved.length && !allowPartialArtwork) {
        await save({ status: "awaiting_illustrations", phase: "awaiting_illustrations" });
        return;
      }
      // Last attempts of the morning: a few text-only birds beat no email.
      if (unresolved.length) await save({ partialArtwork: true });
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
