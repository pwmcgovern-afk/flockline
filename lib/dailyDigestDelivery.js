import { dailyDigestPath } from "../shared/dailyDigest.js";
import { reviewStatusLabel } from "../shared/findingCopy.js";
import { createDigestProvider } from "./digestProvider.js";
import { renderDigestHtml } from "./digestEmail.js";
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

export async function deliverDailyDigest(digest, {
  configuration = getDigestConfiguration(process.env, "daily"),
  provider = createDigestProvider(configuration.apiKey),
  store = createDigestStore(),
} = {}) {
  const region = configuration.regions.find((item) => item.id === digest.scopeId);
  if (!configuration.ready || configuration.frequency !== "daily" || !region?.topicId || digest.back !== 1) {
    throw new Error("Missing daily edition or delivery configuration.");
  }
  const broadcast = dailyBroadcast(digest, region, configuration);
  return withDigestLease({ date: digest.date, region: region.id, store, kind: "daily-delivery" }, async (state, save) => {
    if (!state.broadcastId && !await provider.hasRecipients(configuration, region)) {
      await save({ status: "no_recipients", phase: "complete" });
      return;
    }
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
