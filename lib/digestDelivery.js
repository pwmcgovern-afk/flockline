import { getWeeklyRoundup } from "./ebirdCore.js";
import { addBirdIllustrations, missingBirdIllustrations } from "./birdIllustrations.js";
import { loadDigestRoundup } from "./digestPreparation.js";
import { buildWeeklyDigestBroadcast } from "./digestEmail.js";
import { saveRoundup } from "./roundupArchive.js";
import { createDigestStore, deliveryPath, withDigestLease } from "./digestDeliveryStore.js";
import { createDigestProvider } from "./digestProvider.js";

export async function runDigestEdition({ configuration, region, date, checkOnly = false }, {
  store = createDigestStore(), provider = createDigestProvider(configuration.apiKey),
  getRoundup = getWeeklyRoundup, illustrate = addBirdIllustrations, archive = saveRoundup,
  now = Date.now
} = {}) {
  const prepare = async (saved) => {
    const roundup = await loadDigestRoundup({ region, date, saved, getRoundup });
    // Art generation belongs to prewarm jobs. Email delivery uses the cache
    // and must never spend its function lifetime waiting for an image model.
    return illustrate(roundup, configuration.publicAppUrl, { generateMissing: false });
  };
  const archiveUrl = `${configuration.publicAppUrl}/roundup/${region.id}/${date}?src=email`;

  if (checkOnly) {
    const path = deliveryPath(date, region.id, "check");
    const previous = await store.read(path);
    try {
      await provider.verifySender(configuration.from);
      const hasRecipients = await provider.hasRecipients(configuration, region);
      const edition = await store.read(deliveryPath(date, region.id));
      const roundup = await prepare(edition?.value.roundup);
      const unresolved = missingBirdIllustrations(roundup);
      const broadcast = buildWeeklyDigestBroadcast(roundup, configuration, { archiveUrl });
      const result = {
        date, region: region.id, status: unresolved.length ? "awaiting_illustrations" : "ready", checkedAt: new Date(now()).toISOString(),
        hasRecipients, findings: roundup.findings.length,
        illustrations: roundup.findings.length - unresolved.length, unresolved,
        htmlBytes: Buffer.byteLength(broadcast.html), sent: false
      };
      await store.write(path, result, previous?.etag);
      return result;
    } catch (error) {
      await store.write(path, { date, region: region.id, status: "failed", checkedAt: new Date(now()).toISOString(), sent: false }, previous?.etag).catch(() => {});
      throw error;
    }
  }

  return withDigestLease({ date, region: region.id, store, now }, async (state, save) => {
    let roundup = state.roundup;
    if (!roundup) {
      roundup = await loadDigestRoundup({ region, date, getRoundup });
      await save({ roundup, status: "prepared" });
    }
    // Retry the cache for the pinned birds after prewarm fills any gaps.
    // Once a provider draft exists, preserve it for duplicate-safe recovery.
    if (!state.broadcastId) {
      roundup = await prepare(roundup);
      const unresolved = missingBirdIllustrations(roundup);
      await save({ roundup, findings: roundup.findings.length,
        illustrations: roundup.findings.length - unresolved.length, unresolved });
      if (unresolved.length) {
        await save({ status: "awaiting_illustrations" });
        return;
      }
    }
    // Retrying the same saved content preserves the actual issue and its URL.
    await archive(roundup);
    await save({ archived: true });

    const broadcast = buildWeeklyDigestBroadcast(roundup, configuration, { archiveUrl });
    let existing = state.broadcastId
      ? await provider.getBroadcast(state.broadcastId)
      : await provider.findBroadcast(broadcast.name);
    if (!existing) {
      if (!await provider.hasRecipients(configuration, region)) {
        await save({ status: "no_recipients", hasRecipients: false });
        return;
      }
      existing = await provider.createDraft(broadcast);
      if (!existing?.id) throw new Error("Resend did not return a broadcast ID.");
      // Persist the ID BEFORE sending. Retrying this ID cannot create a second
      // campaign, including when Resend accepted a send but its response was lost.
      await save({ broadcastId: existing.id, status: "draft", hasRecipients: true });
      existing = await provider.getBroadcast(existing.id);
    } else {
      await save({ broadcastId: existing.id });
    }

    if (existing.status === "draft") {
      if (!await provider.hasRecipients(configuration, region)) {
        await save({ status: "no_recipients", hasRecipients: false });
        return;
      }
      await provider.sendBroadcast(existing.id);
      existing = await provider.getBroadcast(existing.id);
    }
    if (!["sent", "queued", "sending", "scheduled"].includes(existing.status)) {
      throw new Error(`Unexpected broadcast status: ${existing.status || "missing"}.`);
    }
    await save({
      status: existing.status === "sent" ? "sent" : "submitted",
      providerStatus: existing.status, broadcastId: existing.id,
      ...(existing.sent_at ? { sentAt: existing.sent_at } : {})
    });
  });
}
